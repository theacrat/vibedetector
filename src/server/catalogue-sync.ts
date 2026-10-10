import { listServiceModels } from "./model-api";
import type { CatalogueFetch, ExternalModel } from "./model-api";
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

async function applyCatalogue(
  db: D1Database,
  provider: string,
  lease: string,
  models: ExternalModel[],
): Promise<void> {
  const fence =
    "EXISTS (SELECT 1 FROM catalogue_sync WHERE provider = ? AND lease = ? AND lease_until > unixepoch('subsec') * 1000)";
  const encoded = JSON.stringify(models.map((model) => ({ ...model, uuid: crypto.randomUUID() })));
  await db.batch([
    db
      .prepare(`INSERT INTO catalogue_sync_guard SELECT CASE WHEN ${fence} THEN 1 ELSE 0 END`)
      .bind(provider, lease),
    db
      .prepare(`INSERT INTO models (id, provider, name, active, position, external_id)
      SELECT json_extract(j.value, '$.uuid'),
      ?1, json_extract(j.value, '$.name'), 1, CAST(j.key AS INTEGER), json_extract(j.value, '$.id')
      FROM json_each(?2) j WHERE true
      ON CONFLICT(provider, external_id) DO UPDATE SET name = excluded.name, active = 1, position = excluded.position`)
      .bind(provider, encoded),
    db
      .prepare(
        `UPDATE models SET active = 0 WHERE provider = ? AND (external_id IS NULL OR external_id NOT IN (SELECT json_extract(value, '$.id') FROM json_each(?)))`,
      )
      .bind(provider, encoded),
    db
      .prepare(`INSERT INTO catalogue_sync_guard SELECT CASE WHEN ${fence} THEN 1 ELSE 0 END`)
      .bind(provider, lease),
    db
      .prepare(
        "UPDATE catalogue_sync SET succeeded_at = unixepoch('subsec') * 1000, model_count = ?, status = 'Synced', lease = '', lease_until = 0 WHERE provider = ? AND lease = ?",
      )
      .bind(models.length, provider, lease),
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
    const models = await listServiceModels(adapter, key, request);
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
