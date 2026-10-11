import { listServiceModels } from "./model-api";
import type { CatalogueFetch, ExternalModel } from "./model-api";
import { enrichOpenAIModels } from "./openai-enrichment";
import { providerRegistry } from "./provider-registry";
import type { ModelSecret, RegisteredProvider } from "./provider-registry";
import { ApiError } from "./security";

type SyncBindings = { DB: D1Database } & Partial<Record<ModelSecret, string>>;
interface SyncStatus {
  provider: string;
  scope: string;
  configured: boolean;
  attemptedAt: number;
  succeededAt: number;
  modelCount: number;
  status: string;
  pending: boolean;
}

async function syncStatus(bindings: SyncBindings): Promise<SyncStatus[]> {
  const rows = await bindings.DB.prepare("SELECT * FROM catalogue_sync").all<{
    provider: string;
    attempted_at: number;
    succeeded_at: number;
    model_count: number;
    status: string;
    lease_until: number;
  }>();
  if (!rows.success) {
    throw new Error("Sync status unavailable");
  }
  return providerRegistry.map((entry) => {
    const row = rows.results.find((value) => value.provider === entry.provider.id);
    const configured = Boolean(entry.adapter && bindings[entry.adapter.secret]?.trim());
    let status = row?.status ?? "Never synced";
    if (status === "Syncing" && (row?.lease_until ?? 0) <= Date.now()) {
      status = "Sync expired. Previous catalogue kept.";
    }
    if (!configured) {
      status = "API key not configured";
    }
    if (!entry.adapter) {
      status = "Provider reporting only";
    }
    return {
      attemptedAt: row?.attempted_at ?? 0,
      configured,
      modelCount: row?.model_count ?? 0,
      pending: (row?.lease_until ?? 0) > Date.now(),
      provider: entry.provider.id,
      scope: entry.scope,
      status,
      succeededAt: row?.succeeded_at ?? 0,
    };
  });
}

async function orderedCatalogue(db: D1Database, provider: string, models: ExternalModel[]) {
  const existing = await db
    .prepare("SELECT external_id, first_seen_at FROM models WHERE provider = ?")
    .bind(provider)
    .all<{ external_id: string; first_seen_at: number }>();
  const firstSeen = new Map(existing.results.map((row) => [row.external_id, row.first_seen_at]));
  const now = Date.now();
  return models
    .map((model) => ({ ...model, firstSeenAt: firstSeen.get(model.id) ?? now }))
    .toSorted(
      (left, right) =>
        (right.metadata?.releasedAt ?? right.firstSeenAt) -
          (left.metadata?.releasedAt ?? left.firstSeenAt) || left.id.localeCompare(right.id, "en"),
    );
}

async function applyCatalogue(
  db: D1Database,
  provider: string,
  lease: string,
  models: ExternalModel[],
): Promise<void> {
  const fence =
    "EXISTS (SELECT 1 FROM catalogue_sync WHERE provider = ? AND lease = ? AND lease_until > unixepoch('subsec') * 1000)";
  const ordered = await orderedCatalogue(db, provider, models);
  const encoded = JSON.stringify(
    ordered.map((model) => ({
      ...model,
      active: model.metadata?.reasons.length ? 0 : 1,
      uuid: crypto.randomUUID(),
    })),
  );
  await db.batch([
    db
      .prepare(`INSERT INTO catalogue_sync_guard SELECT CASE WHEN ${fence} THEN 1 ELSE 0 END`)
      .bind(provider, lease),
    db
      .prepare(`INSERT INTO models (id, provider, name, active, position, external_id, first_seen_at, catalogue_metadata, filter_reason)
      SELECT json_extract(j.value, '$.uuid'),
       ?1, json_extract(j.value, '$.name'), json_extract(j.value, '$.active'), CAST(j.key AS INTEGER), json_extract(j.value, '$.id'), json_extract(j.value, '$.firstSeenAt'), json_extract(j.value, '$.metadata'), CASE WHEN json_extract(j.value, '$.active') = 0 THEN json_extract(j.value, '$.metadata.reasons') ELSE NULL END
      FROM json_each(?2) j WHERE true
       ON CONFLICT(provider, external_id) DO UPDATE SET name = excluded.name, active = excluded.active, position = excluded.position, catalogue_metadata = excluded.catalogue_metadata, filter_reason = excluded.filter_reason`)
      .bind(provider, encoded),
    db
      .prepare(
        `UPDATE models SET active = 0, filter_reason = '["absent-from-api"]' WHERE provider = ? AND (external_id IS NULL OR external_id NOT IN (SELECT json_extract(value, '$.id') FROM json_each(?)))`,
      )
      .bind(provider, encoded),
    db
      .prepare(`INSERT INTO catalogue_sync_guard SELECT CASE WHEN ${fence} THEN 1 ELSE 0 END`)
      .bind(provider, lease),
    db
      .prepare(
        "UPDATE catalogue_sync SET succeeded_at = unixepoch('subsec') * 1000, model_count = ?, status = 'Synced', lease = '', lease_until = 0 WHERE provider = ? AND lease = ?",
      )
      .bind(ordered.filter((model) => !model.metadata?.reasons.length).length, provider, lease),
    db.prepare("DELETE FROM catalogue_sync_guard"),
  ]);
}

async function syncProvider(
  bindings: SyncBindings,
  entry: RegisteredProvider,
  request: CatalogueFetch,
): Promise<void> {
  const { adapter, provider } = entry;
  const key = adapter && bindings[adapter.secret]?.trim();
  if (!adapter) {
    return;
  }
  const lease = crypto.randomUUID();
  const acquired =
    await bindings.DB.prepare(`UPDATE catalogue_sync SET lease = ?, lease_until = unixepoch('subsec') * 1000 + 120000, attempted_at = unixepoch('subsec') * 1000, status = 'Syncing'
    WHERE provider = ? AND lease_until <= unixepoch('subsec') * 1000 AND attempted_at <= unixepoch('subsec') * 1000 - 60000`)
      .bind(lease, provider.id)
      .run();
  if (!acquired.success) {
    throw new Error("Sync lease unavailable");
  }
  if (acquired.meta.changes !== 1) {
    return;
  }
  try {
    if (!key) {
      throw new Error("API key not configured");
    }
    const models = await listServiceModels(adapter, key, request, true);
    // oxlint-disable-next-line eslint/no-use-before-define -- The optional documentation step is isolated from catalogue failure handling.
    await enrichCatalogue(bindings.DB, entry, lease, models, request);
    // oxlint-disable-next-line eslint/no-use-before-define -- Evidence resolution precedes the fenced replacement.
    await catalogueEvidence(bindings.DB, entry, models);
    await applyCatalogue(bindings.DB, provider.id, lease, models);
  } catch (error) {
    const known =
      error instanceof Error &&
      /^(?:API key not configured|Service returned HTTP \d{3}|Invalid model response|Invalid pagination|Unsupported pagination|Duplicate model ID|Empty model catalogue|Too many models|Too many model pages|Model response too large)$/u.test(
        error.message,
      );
    const status =
      known && error instanceof Error ? error.message : "Sync failed. Previous catalogue kept.";
    await bindings.DB.prepare(
      "UPDATE catalogue_sync SET status = ?, lease = '', lease_until = 0 WHERE provider = ? AND lease = ? AND lease_until > unixepoch('subsec') * 1000",
    )
      .bind(status, provider.id, lease)
      .run();
  }
}

async function openaiEvidence(db: D1Database, provider: string, models: ExternalModel[]) {
  const rows = await db
    .prepare(`SELECT external_id, source_url,
    EXISTS (SELECT 1 FROM json_each(metadata_json, '$.outputModalities') WHERE value = 'text') AS text_output,
    COALESCE(json_extract(metadata_json, '$.endpoints."v1/chat/completions"'), 0) OR COALESCE(json_extract(metadata_json, '$.endpoints."v1/responses"'), 0) AS chat
    FROM model_metadata WHERE provider = ? AND status = 'ok' AND metadata_json IS NOT NULL`)
    .bind(provider)
    .all<{ external_id: string; source_url: string; text_output: number; chat: number }>();
  const documents = new Map(rows.results.map((row) => [row.external_id, row]));
  for (const model of models) {
    const document = documents.get(model.id);
    if (document) {
      model.metadata ??= { evidence: {}, reasons: [] };
      model.metadata.evidence["openaiDocument"] = document.source_url;
      if (document.text_output === 0) {
        model.metadata.reasons.push("no-text-output");
      }
      if (document.chat === 0) {
        model.metadata.reasons.push("no-chat-or-responses");
      }
    }
  }
}

async function catalogueEvidence(
  db: D1Database,
  entry: RegisteredProvider,
  models: ExternalModel[],
) {
  if (entry.adapter?.secret === "OPENAI_API_KEY") {
    await openaiEvidence(db, entry.provider.id, models);
    return;
  }
  // oxlint-disable-next-line eslint/no-use-before-define -- Alias policy consumes normalised evidence only.
  catalogueAliases(entry, models);
}

function catalogueAliases(entry: RegisteredProvider, models: ExternalModel[]) {
  const listed = new Map(models.map((model) => [model.id, model]));
  if (entry.adapter?.secret === "MISTRAL_API_KEY") {
    for (const model of models) {
      const canonical = model.metadata?.canonicalId;
      if (canonical && canonical !== model.id && listed.has(canonical)) {
        model.metadata?.reasons.push("alias-of-listed-canonical");
      }
    }
  } else {
    for (const model of models) {
      for (const alias of model.metadata?.aliases ?? []) {
        const candidate = listed.get(alias);
        if (
          candidate &&
          candidate.id !== model.id &&
          !candidate.metadata?.aliases?.includes(model.id)
        ) {
          candidate.metadata ??= { evidence: {}, reasons: [] };
          candidate.metadata.canonicalId = model.id;
          candidate.metadata.reasons.push("alias-of-listed-canonical");
        }
      }
    }
  }
}

async function enrichCatalogue(
  db: D1Database,
  entry: RegisteredProvider,
  lease: string,
  models: ExternalModel[],
  request: CatalogueFetch,
) {
  if (entry.adapter?.secret !== "OPENAI_API_KEY") {
    return;
  }
  try {
    await enrichOpenAIModels(
      db,
      entry.provider.id,
      lease,
      models.map((model) => model.id),
      Date.now(),
      request,
    );
  } catch {
    // Documentation availability must not change the account's catalogue.
  }
}

async function syncCatalogue(
  bindings: SyncBindings,
  provider?: string,
  request: CatalogueFetch = fetch,
): Promise<SyncStatus[]> {
  const entries = providerRegistry.filter((entry) => !provider || entry.provider.id === provider);
  if (entries.length === 0) {
    throw new ApiError(404, "Unknown provider");
  }
  await Promise.allSettled(entries.map(async (entry) => syncProvider(bindings, entry, request)));
  return syncStatus(bindings);
}

export { applyCatalogue, syncCatalogue, syncStatus };
export type { SyncStatus };
