import { listServiceModels } from "@/server/model-api";
import { providerRegistry } from "@/server/provider-registry";

const [output] = process.argv.slice(2);
if (!output) {
  throw new Error("Supply an output JSON path. Run with Bun's --env-file for local credentials.");
}

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

async function inspectPage(url: string, init: RequestInit, pages: ProbePage[]) {
  const response = await fetch(url, init);
  const page: ProbePage = { fields: [], models: [], status: response.status, url };
  pages.push(page);
  if (response.ok) {
    const body: unknown = await response.clone().json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      page.fields = Object.keys(body);
      page.models = modelMetadata(body);
    }
  }
  return response;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  return /^(?:Service returned HTTP \d{3}|Invalid model response|Invalid pagination|Unsupported pagination|Duplicate model ID|Empty model catalogue|Too many models|Too many model pages|Model response too large)$/u.test(
    message,
  )
    ? message
    : "Request or response validation failed";
}

async function probeProvider(entry: (typeof providerRegistry)[number]) {
  const { adapter, provider } = entry;
  const pages: ProbePage[] = [];
  const started = Date.now();
  if (!adapter) {
    return { provider: provider.slug, status: "No adapter" };
  }
  const key = process.env[adapter.secret]?.trim();
  if (!key) {
    return { provider: provider.slug, status: "API key not configured" };
  }
  try {
    const models = await listServiceModels(adapter, key, async (url, init) =>
      inspectPage(url, init, pages),
    );
    console.log(
      `${provider.slug}: PASS ${models.length} selectable models (${pages.length} pages)`,
    );
    return {
      durationMs: Date.now() - started,
      endpoint: adapter.endpoint,
      models,
      pages,
      provider: provider.slug,
      scope: entry.scope,
      status: "PASS",
    };
  } catch (error) {
    const message = safeError(error);
    console.log(`${provider.slug}: FAIL ${message}`);
    return {
      durationMs: Date.now() - started,
      endpoint: adapter.endpoint,
      error: message,
      pages,
      provider: provider.slug,
      status: "FAIL",
    };
  }
}

const results = await Promise.all(providerRegistry.map(async (entry) => probeProvider(entry)));
await Bun.write(
  output,
  `${JSON.stringify({ checkedAt: new Date().toISOString(), results }, undefined, 2)}\n`,
);
console.log(`Model inventory saved to ${output}`);
