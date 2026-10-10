import type { CatalogueFetch } from "./model-api";
import { parseDocument } from "./openai-document";
import type { DocumentMetadata } from "./openai-document";

const ORIGIN = "https://developers.openai.com";
const INDEX = `${ORIGIN}/api/docs/models.md`;
const WEEK = 7 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 20;
const CONCURRENCY = 4;
const MAX_BYTES = 512 * 1024;
const FENCE =
  "EXISTS (SELECT 1 FROM catalogue_sync WHERE provider = ? AND lease = ? AND lease_until > unixepoch('subsec') * 1000)";

interface CachedDocument {
  source_url: string;
  document_json: string | null;
  checked_at: number;
  succeeded_at: number;
}

interface EnrichmentContext {
  db: D1Database;
  provider: string;
  lease: string;
  now: number;
  request: CatalogueFetch;
  signal: AbortSignal;
}

async function persistDocument(context: EnrichmentContext, url: string, markdown?: string) {
  const { db, provider, lease, now } = context;
  await db
    .prepare(
      `INSERT INTO openai_document_cache (source_url, document_json, checked_at, succeeded_at) SELECT ?, ?, ?, ? WHERE ${FENCE} ON CONFLICT(source_url) DO UPDATE SET document_json = COALESCE(excluded.document_json, openai_document_cache.document_json), checked_at = excluded.checked_at, succeeded_at = CASE WHEN excluded.document_json IS NULL THEN openai_document_cache.succeeded_at ELSE excluded.succeeded_at END`,
    )
    // oxlint-disable-next-line unicorn/no-null -- D1 binds SQL NULL for an unsuccessful fetch.
    .bind(url, markdown ?? null, now, markdown ? now : 0, provider, lease)
    .run();
}

function pageSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
}

async function indexUrls(context: EnrichmentContext, index?: CachedDocument): Promise<string[]> {
  if (index && context.now - index.checked_at < WEEK) {
    // oxlint-disable-next-line eslint/no-use-before-define -- Parser is the source boundary used by the cache helper.
    return index.document_json ? parseIndex(index.document_json) : [];
  }
  try {
    // oxlint-disable-next-line eslint/no-use-before-define -- Fetcher is the source boundary used by the cache helper.
    const markdown = await fetchMarkdown(INDEX, pageSignal(context.signal), context.request);
    // oxlint-disable-next-line eslint/no-use-before-define -- Parser is the source boundary used by the cache helper.
    const urls = parseIndex(markdown);
    await persistDocument(context, INDEX, markdown);
    return urls;
  } catch {
    await persistDocument(context, INDEX);
    return [];
  }
}

async function refreshDocuments(
  context: EnrichmentContext,
  pages: string[],
  documents: Map<string, DocumentMetadata>,
) {
  const attempted = new Set<string>();
  const refreshed = new Set<string>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < pages.length && !context.signal.aborted) {
      const url = pages[cursor];
      cursor += 1;
      if (!url) {
        return;
      }
      attempted.add(url);
      try {
        // oxlint-disable-next-line eslint/no-use-before-define, eslint/no-await-in-loop -- Four workers bound requests through the source boundary.
        const markdown = await fetchMarkdown(url, pageSignal(context.signal), context.request);
        const document = parseDocument(markdown);
        documents.set(url, document);
        refreshed.add(url);
        // oxlint-disable-next-line eslint/no-await-in-loop -- Persist only the corresponding validated response.
        await persistDocument(context, url, markdown);
      } catch {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Negatively cache failures to prevent daily retries.
        await persistDocument(context, url);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, worker));
  return { attempted, refreshed };
}

function metadataWrite(
  context: EnrichmentContext,
  id: string,
  documents: Map<string, DocumentMetadata>,
  cached: Map<string, CachedDocument>,
  refreshed: Set<string>,
  complete: boolean,
) {
  const matches = [...documents].filter(
    ([, document]) => document.modelId === id || document.snapshots.includes(id),
  );
  const match = matches.length === 1 ? matches[0] : undefined;
  let checkedAt = complete ? context.now : context.now - WEEK;
  if (match) {
    checkedAt = refreshed.has(match[0]) ? context.now : (cached.get(match[0])?.succeeded_at ?? 0);
  }
  return context.db
    .prepare(
      `INSERT INTO model_metadata (provider, external_id, metadata_json, source_url, checked_at, status) SELECT ?, ?, ?, ?, ?, ? WHERE ${FENCE} ON CONFLICT(provider, external_id) DO UPDATE SET metadata_json = COALESCE(excluded.metadata_json, model_metadata.metadata_json), source_url = COALESCE(excluded.source_url, model_metadata.source_url), checked_at = CASE WHEN excluded.metadata_json IS NULL AND model_metadata.metadata_json IS NOT NULL THEN model_metadata.checked_at ELSE excluded.checked_at END, status = CASE WHEN excluded.metadata_json IS NULL AND model_metadata.metadata_json IS NOT NULL THEN model_metadata.status ELSE excluded.status END`,
    )
    .bind(
      context.provider,
      id,
      // oxlint-disable-next-line unicorn/no-null -- D1 requires SQL NULL for unknown metadata.
      match ? JSON.stringify(match[1]) : null,
      // oxlint-disable-next-line unicorn/no-null -- D1 requires SQL NULL for an unknown source.
      match?.[0] ?? null,
      checkedAt,
      match ? "ok" : "unknown",
      context.provider,
      context.lease,
    );
}

function parseIndex(markdown: string): string[] {
  if (!markdown.startsWith("# Models\n")) {
    throw new Error("Invalid documentation index");
  }
  const paths = [
    ...markdown.matchAll(/\]\((?<path>\/api\/docs\/models\/[a-z0-9._-]+)\.md\)/gu),
  ].flatMap((match) => (match.groups?.["path"] ? [`${ORIGIN}${match.groups["path"]}.md`] : []));
  const urls = [...new Set(paths)];
  if (urls.length === 0 || urls.length > 500) {
    throw new Error("Invalid documentation index");
  }
  return urls;
}

async function documentationResponse(
  url: string,
  signal: AbortSignal,
  request: CatalogueFetch,
): Promise<Response> {
  const parsed = new URL(url);
  if (
    parsed.origin !== ORIGIN ||
    !/^\/api\/docs\/models(?:\/[a-z0-9._-]+)?\.md$/u.test(parsed.pathname) ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Rejected documentation URL");
  }
  const response = await request(url, {
    headers: { Accept: "text/markdown" },
    redirect: "error",
    signal,
  });
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get("content-type")?.startsWith("text/markdown")
  ) {
    await response.body?.cancel();
    throw new Error("Documentation unavailable");
  }
  return response;
}

async function fetchMarkdown(
  url: string,
  signal: AbortSignal,
  request: CatalogueFetch,
): Promise<string> {
  const response = await documentationResponse(url, signal, request);
  if (!response.body) {
    throw new Error("Documentation unavailable");
  }
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel();
  };
  signal.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Stream reads enforce the limit before buffering.
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) {
        throw new Error("Invalid documentation stream");
      }
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        throw new Error("Documentation too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    signal.throwIfAborted();
    return text + decoder.decode();
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel();
  }
}

async function resolveMetadata(context: EnrichmentContext, due: string[]) {
  const { db, now } = context;
  const cache = await db.prepare("SELECT * FROM openai_document_cache").all<CachedDocument>();
  const cached = new Map(cache.results.map((row) => [row.source_url, row]));
  const urls = await indexUrls(context, cached.get(INDEX));
  if (urls.length === 0) {
    return;
  }
  const exactUrls = new Set(
    due.map((id) => `${ORIGIN}/api/docs/models/${encodeURIComponent(id)}.md`),
  );
  const pages = urls
    .filter((url) => !cached.has(url) || now - (cached.get(url)?.checked_at ?? 0) >= WEEK)
    .toSorted(
      (left, right) =>
        Number(exactUrls.has(right)) - Number(exactUrls.has(left)) ||
        (cached.get(left)?.checked_at ?? 0) - (cached.get(right)?.checked_at ?? 0),
    )
    .slice(0, MAX_PAGES);
  const documents = new Map<string, DocumentMetadata>();
  for (const url of urls) {
    const markdown = cached.get(url)?.document_json;
    if (markdown) {
      documents.set(url, parseDocument(markdown));
    }
  }
  const { attempted, refreshed } = await refreshDocuments(context, pages, documents);
  const complete = urls.every(
    (url) =>
      attempted.has(url) || (cached.has(url) && now - (cached.get(url)?.checked_at ?? 0) < WEEK),
  );
  const writes = due.map((id) =>
    metadataWrite(context, id, documents, cached, refreshed, complete),
  );
  if (writes.length > 0) {
    await db.batch(writes);
  }
}

async function enrichOpenAIModels(
  db: D1Database,
  provider: string,
  lease: string,
  ids: string[],
  now = Date.now(),
  request: CatalogueFetch = fetch,
): Promise<void> {
  const context: EnrichmentContext = {
    db,
    lease,
    now,
    provider,
    request,
    signal: AbortSignal.timeout(35_000),
  };
  const existing = await db
    .prepare("SELECT external_id, checked_at FROM model_metadata WHERE provider = ?")
    .bind(provider)
    .all<{ external_id: string; checked_at: number }>();
  const checks = new Map(existing.results.map((row) => [row.external_id, row.checked_at]));
  const due = ids.filter((id) => !checks.has(id) || now - (checks.get(id) ?? 0) >= WEEK);
  if (due.length === 0) {
    return;
  }
  await resolveMetadata(context, due);
}

export { enrichOpenAIModels, parseIndex, fetchMarkdown };
