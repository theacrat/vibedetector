import type { CatalogueFetch } from "@/server/model-api";

interface ProbePage {
  fields: string[];
  models: Record<string, unknown>[];
  status: number;
  url: string;
}

const metadataFields = new Set([
  "id",
  "name",
  "display_name",
  "displayName",
  "object",
  "type",
  "created",
  "owned_by",
  "description",
  "version",
  "inputTokenLimit",
  "outputTokenLimit",
  "supportedGenerationMethods",
  "capabilities",
  "max_context_length",
  "aliases",
]);

function modelMetadata(body: object) {
  let entries: unknown;
  if ("data" in body) {
    entries = body.data;
  } else if ("models" in body) {
    entries = body.models;
  } else if ("items" in body) {
    entries = body.items;
  }
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    return [
      Object.fromEntries(Object.entries(entry).filter(([field]) => metadataFields.has(field))),
    ];
  });
}

async function boundedText(response: Response, signal?: AbortSignal | null) {
  if (!response.body) {
    throw new Error("Invalid model response");
  }
  signal?.throwIfAborted();
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel();
  };
  signal?.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Read sequentially to enforce the bound before buffering.
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) {
        throw new Error("Invalid model response");
      }
      size += value.byteLength;
      if (size > 2_000_000) {
        throw new Error("Model response too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    signal?.throwIfAborted();
    return text + decoder.decode();
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel();
  }
}

async function inspectPage(
  url: string,
  init: RequestInit,
  pages: ProbePage[],
  request: CatalogueFetch = fetch,
) {
  const response = await request(url, init);
  const page: ProbePage = { fields: [], models: [], status: response.status, url };
  pages.push(page);
  if (!response.ok) {
    await response.body?.cancel();
    return new Response(undefined, { status: response.status });
  }
  const text = await boundedText(response, init.signal);
  const body: unknown = JSON.parse(text);
  if (body && typeof body === "object" && !Array.isArray(body)) {
    page.fields = Object.keys(body);
    page.models = modelMetadata(body);
  }
  return new Response(text, { headers: response.headers, status: response.status });
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  return /^(?:Service returned HTTP \d{3}|Invalid model response|Invalid pagination|Unsupported pagination|Duplicate model ID|Empty model catalogue|Too many models|Too many model pages|Model response too large)$/u.test(
    message,
  )
    ? message
    : "Request or response validation failed";
}

export { inspectPage, safeError };
export type { ProbePage };
