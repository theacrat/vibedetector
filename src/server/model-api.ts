import type { ModelAdapter } from "./provider-registry";

interface ExternalModel {
  id: string;
  name: string;
}
type CatalogueFetch = (input: string, init: RequestInit) => Promise<Response>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid model response");
  }
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown, max = 512): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > max ||
    value.trim() !== value ||
    /[\p{Cc}]/u.test(value)
  ) {
    throw new Error("Invalid model response");
  }
  return value;
}

function parseModel(
  value: unknown,
  adapter: ModelAdapter,
): { model: ExternalModel; selectable: boolean } {
  const row = record(value);
  const id = text(adapter.protocol === "gemini" ? row["name"] : row["id"]);
  if (adapter.protocol === "list" && row["object"] !== "model") {
    throw new Error("Invalid model response");
  }
  if (adapter.protocol === "anthropic" && row["type"] !== "model") {
    throw new Error("Invalid model response");
  }
  let selectable = true;
  if (adapter.protocol === "gemini") {
    const methods = row["supportedGenerationMethods"];
    if (
      !id.startsWith("models/") ||
      !Array.isArray(methods) ||
      !methods.every((method) => typeof method === "string")
    ) {
      throw new Error("Invalid model response");
    }
    selectable = methods.includes("generateContent");
  }
  const label = adapter.protocol === "cursor" ? `${text(row["displayName"], 128)} (${id})` : id;
  return { model: { id, name: text(label, 700) }, selectable };
}

function nextPage(body: Record<string, unknown>, adapter: ModelAdapter): string {
  if (adapter.protocol === "anthropic") {
    if (typeof body["has_more"] !== "boolean") {
      throw new TypeError("Invalid pagination");
    }
    return body["has_more"] ? text(body["last_id"]) : "";
  }
  if (adapter.protocol === "gemini") {
    return "nextPageToken" in body ? text(body["nextPageToken"], 4096) : "";
  }
  if (
    body["has_more"] === true ||
    body["nextCursor"] ||
    body["nextPageToken"] ||
    body["next"] ||
    body["next_page"]
  ) {
    throw new Error("Unsupported pagination");
  }
  return "";
}

async function boundedBody(response: Response): Promise<string> {
  if (!response.body) {
    throw new Error("Invalid model response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      // Stream reads are sequential so the byte limit is enforced before buffering.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Invalid model response");
      }
      size += value.byteLength;
      if (size > 2_000_000) {
        throw new Error("Model response too large");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function pageUrl(adapter: ModelAdapter, cursor: string): URL {
  const url = new URL(adapter.endpoint);
  if (adapter.protocol === "anthropic") {
    url.searchParams.set("limit", "1000");
    if (cursor) {
      url.searchParams.set("after_id", cursor);
    }
  } else if (adapter.protocol === "gemini") {
    url.searchParams.set("pageSize", "1000");
    if (cursor) {
      url.searchParams.set("pageToken", cursor);
    }
  }
  return url;
}

function parsePage(
  body: Record<string, unknown>,
  adapter: ModelAdapter,
): { models: ExternalModel[]; cursor: string; ids: string[] } {
  const fields = { anthropic: "data", cursor: "items", gemini: "models", list: "data" };
  const values = body[fields[adapter.protocol]];
  if (!Array.isArray(values)) {
    throw new TypeError("Invalid model response");
  }
  const parsed = values.map((value: unknown) => parseModel(value, adapter));
  const models = parsed.filter((value) => value.selectable).map((value) => value.model);
  const ids = parsed.map((value) => value.model.id);
  const cursor = nextPage(body, adapter);
  if (cursor && values.length === 0) {
    throw new Error("Invalid pagination");
  }
  if (adapter.protocol === "anthropic" && cursor && cursor !== record(values.at(-1))["id"]) {
    throw new Error("Invalid pagination");
  }
  return { cursor, ids, models };
}

async function fetchPage(
  adapter: ModelAdapter,
  cursor: string,
  headers: Headers,
  signal: AbortSignal,
  request: CatalogueFetch,
) {
  const response = await request(pageUrl(adapter, cursor).href, {
    headers,
    redirect: "error",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Service returned HTTP ${response.status}`);
  }
  const raw = await boundedBody(response);
  return parsePage(record(JSON.parse(raw)), adapter);
}

async function listServiceModels(
  adapter: ModelAdapter,
  key: string,
  request: CatalogueFetch = fetch,
): Promise<ExternalModel[]> {
  const headers = new Headers({ Accept: "application/json" });
  if (adapter.protocol === "anthropic") {
    headers.set("x-api-key", key);
    headers.set("anthropic-version", "2023-06-01");
  } else if (adapter.protocol === "gemini") {
    headers.set("x-goog-api-key", key);
  } else {
    headers.set("Authorization", `Bearer ${key}`);
  }
  const models: ExternalModel[] = [];
  const ids = new Set<string>();
  const pages = new Set<string>();
  const signal = AbortSignal.timeout(60_000);
  let cursor = "";
  for (let page = 0; page < 100; page += 1) {
    // Pagination requires the preceding page's validated token.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const result = await fetchPage(adapter, cursor, headers, signal, request);
    for (const id of result.ids) {
      if (ids.has(id)) {
        throw new Error("Duplicate model ID");
      }
      ids.add(id);
      if (ids.size > 5000) {
        throw new Error("Too many models");
      }
    }
    models.push(...result.models);
    ({ cursor } = result);
    if (!cursor) {
      if (models.length === 0) {
        throw new Error("Empty model catalogue");
      }
      return models;
    }
    if (pages.has(cursor)) {
      throw new Error("Invalid pagination");
    }
    pages.add(cursor);
  }
  throw new Error("Too many model pages");
}

export { listServiceModels };
export type { CatalogueFetch, ExternalModel };
