import { listServiceModels } from "@/server/model-api";
import { inspectPage, safeError } from "@/server/model-probe";
import type { ProbePage } from "@/server/model-probe";
import { providerRegistry } from "@/server/provider-registry";

const [output] = process.argv.slice(2);
if (!output) {
  throw new Error("Supply an output JSON path. Run with Bun's --env-file for local credentials.");
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
