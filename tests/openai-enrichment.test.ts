import { afterAll, expect, test } from "bun:test";

import { convertV4MiniflareOptions, Miniflare } from "miniflare";

import { loadActiveModels } from "@/server/catalogue";
import { syncCatalogue } from "@/server/catalogue-sync";
import type { CatalogueFetch } from "@/server/model-api";
import { parseDocument } from "@/server/openai-document";
import { enrichOpenAIModels, fetchMarkdown } from "@/server/openai-enrichment";

const PROVIDER = "10000000-0000-4000-8000-000000000002";
const INDEX = "https://developers.openai.com/api/docs/models.md";
const URL = "https://developers.openai.com/api/docs/models/gpt-5.4.md";
const WEEK = 604_800_000;
const runtimes: Miniflare[] = [];
const DOCUMENT = `# GPT-5.4

Model ID: \`gpt-5.4\`

## Model details

- Default snapshot: \`gpt-5.4-2026-03-05\`
- Input modalities: text, image
- Output modalities: text
- 1,050,000 context window
- 128,000 max output tokens

## Endpoints

| Endpoint | Route | Support |
| --- | --- | --- |
| Responses | \`v1/responses\` | Supported |
| Embeddings | \`v1/embeddings\` | Not supported |

## Snapshots

- \`gpt-5.4-2026-03-05\`

## Rate limits
`;
const INDEX_BODY = "# Models\n\n- [GPT-5.4](/api/docs/models/gpt-5.4.md)\n";

afterAll(async () => {
  await Promise.all(runtimes.map(async (runtime) => runtime.dispose()));
});

async function database() {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          compatibilityDate: "2026-10-08",
          d1Databases: ["DB"],
          modules: true,
          script: "export default { fetch() { return new Response('ok'); } }",
        },
      ],
    }),
  );
  runtimes.push(runtime);
  const { DB: db } = await runtime.getBindings<{ DB: D1Database }>();
  for (const filename of [
    "0001_reports.sql",
    "0002_report_models.sql",
    "0003_model_catalogue.sql",
    "0004_catalogue_identities.sql",
    "0005_catalogue_sync.sql",
    "0006_model_metadata.sql",
    "0007_catalogue_eligibility.sql",
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each migration needs the preceding schema.
    const sql = await Bun.file(`migrations/${filename}`).text();
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each migration needs the preceding schema.
    await db.batch(
      sql
        .split(";")
        .filter((statement) => statement.trim())
        .map((statement) => db.prepare(statement)),
    );
  }
  await db
    .prepare(
      "UPDATE catalogue_sync SET lease = 'owner', lease_until = unixepoch('subsec') * 1000 + 120000 WHERE provider = ?",
    )
    .bind(PROVIDER)
    .run();
  return db;
}

function source(calls: string[]): CatalogueFetch {
  return async (url, init) => {
    calls.push(url);
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
    expect(new Headers(init.headers).get("Accept")).toBe("text/markdown");
    expect(init.redirect).toBe("error");
    const response = await Promise.resolve(
      new Response(url === INDEX ? INDEX_BODY : DOCUMENT, {
        headers: { "content-type": "text/markdown; charset=utf-8" },
      }),
    );
    return response;
  };
}

test("document fields are sourced literally", () => {
  expect(parseDocument(DOCUMENT)).toEqual({
    contextWindow: 1_050_000,
    defaultSnapshot: "gpt-5.4-2026-03-05",
    endpoints: { "v1/embeddings": false, "v1/responses": true },
    inputModalities: ["text", "image"],
    maxOutputTokens: 128_000,
    modelId: "gpt-5.4",
    outputModalities: ["text"],
    snapshots: ["gpt-5.4-2026-03-05"],
  });
});

test("sync filters documented non-chat output and keeps unknowns and exact callable snapshots", async () => {
  const db = await database();
  await db
    .prepare(
      "UPDATE catalogue_sync SET lease = '', lease_until = 0, attempted_at = 0 WHERE provider = ?",
    )
    .bind(PROVIDER)
    .run();
  const index = `${INDEX_BODY}- [Speech](/api/docs/models/speech.md)\n`;
  await syncCatalogue({ DB: db, OPENAI_API_KEY: "test" }, PROVIDER, async (url) => {
    await Promise.resolve();
    if (url === "https://api.openai.com/v1/models") {
      return Response.json({
        data: ["gpt-5.4", "gpt-5.4-2026-03-05", "speech", "unknown"].map((id) => ({
          id,
          object: "model",
        })),
      });
    }
    let markdown = url === INDEX ? index : DOCUMENT;
    if (url.endsWith("speech.md")) {
      markdown = DOCUMENT.replaceAll("gpt-5.4", "speech")
        .replace("Output modalities: text", "Output modalities: audio")
        .replace("`v1/responses` | Supported", "`v1/responses` | Not supported");
    }
    return new Response(markdown, { headers: { "content-type": "text/markdown" } });
  });
  const active = await loadActiveModels(db, PROVIDER);
  expect(active.map((model) => model.name)).toEqual(["gpt-5.4", "gpt-5.4-2026-03-05", "unknown"]);
  const archived = await db
    .prepare("SELECT active, filter_reason FROM models WHERE external_id = 'speech'")
    .first();
  expect(archived).toEqual({
    active: 0,
    filter_reason: '["no-text-output","no-chat-or-responses"]',
  });
});

test("new ID refreshes the official index and new snapshot refreshes its documented parent", async () => {
  const db = await database();
  const now = Date.now();
  await enrichOpenAIModels(db, PROVIDER, "owner", ["gpt-5.4"], now, source([]));
  const calls: string[] = [];
  const request: CatalogueFetch = async (url) => {
    calls.push(url);
    let markdown = DOCUMENT.replace("## Rate limits", "- `brand-new-snapshot`\n\n## Rate limits");
    if (url === INDEX) {
      markdown = `${INDEX_BODY}- [New](/api/docs/models/new-model.md)\n`;
    } else if (url.endsWith("new-model.md")) {
      markdown = DOCUMENT.replaceAll("gpt-5.4", "new-model");
    }
    const response = await Promise.resolve(
      new Response(markdown, { headers: { "content-type": "text/markdown" } }),
    );
    return response;
  };
  await enrichOpenAIModels(
    db,
    PROVIDER,
    "owner",
    ["new-model", "brand-new-snapshot"],
    now + 100,
    request,
  );
  expect(calls).toContain(INDEX);
  expect(calls).toContain(URL);
  expect(calls).toContain("https://developers.openai.com/api/docs/models/new-model.md");
  const rows = await db
    .prepare("SELECT external_id, status FROM model_metadata ORDER BY external_id")
    .all();
  expect(rows.results).toEqual([
    { external_id: "brand-new-snapshot", status: "ok" },
    { external_id: "gpt-5.4", status: "ok" },
    { external_id: "new-model", status: "ok" },
  ]);
});

test("new ID bypasses a negative parent page and retries cannot turn stale evidence into a weekly negative", async () => {
  const db = await database();
  const now = Date.now();
  const failed: CatalogueFetch = async (url) => {
    const response = await Promise.resolve(
      new Response(url === INDEX ? INDEX_BODY : "Unavailable", {
        headers: { "content-type": "text/markdown" },
        status: url === INDEX ? 200 : 503,
      }),
    );
    return response;
  };
  await enrichOpenAIModels(db, PROVIDER, "owner", ["unknown"], now, failed);
  const before = await db
    .prepare("SELECT checked_at FROM model_metadata WHERE external_id = 'unknown'")
    .first();
  expect(before).toEqual({ checked_at: now - WEEK });
  const calls: string[] = [];
  await enrichOpenAIModels(db, PROVIDER, "owner", ["gpt-5.4-2026-03-05"], now + 1, source(calls));
  expect(calls).toEqual([INDEX, URL]);
  const row = await db
    .prepare("SELECT status FROM model_metadata WHERE external_id = 'gpt-5.4-2026-03-05'")
    .first();
  expect(row).toEqual({ status: "ok" });
});

test("truncated or changed documents preserve successful metadata and timestamps", async () => {
  const db = await database();
  const now = Date.now();
  await enrichOpenAIModels(db, PROVIDER, "owner", ["gpt-5.4"], now, source([]));
  const before = await db.prepare("SELECT * FROM model_metadata").all();
  const invalid = [
    "Model ID: `gpt-5.4`",
    DOCUMENT.replace("1,050,000", "1,,050,000"),
    DOCUMENT.replace("| Endpoint | Route | Support |", "| Name | URL | Available |"),
    DOCUMENT.replace("| Supported |", "| Yes |"),
    DOCUMENT.replace("text, image", "text, invented"),
  ];
  for (const [position, markdown] of invalid.entries()) {
    const request: CatalogueFetch = async (url) => {
      const response = await Promise.resolve(
        new Response(url === INDEX ? INDEX_BODY : markdown, {
          headers: { "content-type": "text/markdown" },
        }),
      );
      return response;
    };
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each weekly treatment follows the previous persisted state.
    await enrichOpenAIModels(
      db,
      PROVIDER,
      "owner",
      ["gpt-5.4"],
      now + WEEK * (position + 1),
      request,
    );
    // oxlint-disable-next-line eslint/no-await-in-loop -- Observe the persisted result of each invalid response.
    const after = await db.prepare("SELECT * FROM model_metadata").all();
    expect(after.results).toEqual(before.results);
  }
  expect(
    parseDocument(
      DOCUMENT.replace("- 1,050,000 context window\n", "").replace(
        "- 128,000 max output tokens\n",
        "",
      ),
    ).contextWindow,
  ).toBeUndefined();
});

test("expired owner cannot record discovery or enrichment", async () => {
  const db = await database();
  await db
    .prepare("UPDATE catalogue_sync SET lease_until = 0 WHERE provider = ?")
    .bind(PROVIDER)
    .run();
  await enrichOpenAIModels(db, PROVIDER, "owner", ["gpt-5.4"], Date.now(), source([]));
  const rows = await db.prepare("SELECT * FROM model_metadata").all();
  const cache = await db.prepare("SELECT * FROM openai_document_cache").all();
  expect(rows.results).toEqual([]);
  expect(cache.results).toEqual([]);
});

test("HTTP rejects redirects and malformed UTF-8", async () => {
  const headers = { "content-type": "text/markdown" };
  const redirect: CatalogueFetch = async (_url, init) => {
    expect(init.redirect).toBe("error");
    const response = await Promise.resolve(
      new Response("redirected", {
        headers: { ...headers, location: URL },
        status: 302,
      }),
    );
    return response;
  };
  let rejected = false;
  try {
    await fetchMarkdown(URL, AbortSignal.timeout(1000), redirect);
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
  const malformed: CatalogueFetch = async () => {
    const response = await Promise.resolve(new Response(new Uint8Array([0xc3, 0x28]), { headers }));
    return response;
  };
  rejected = false;
  try {
    await fetchMarkdown(URL, AbortSignal.timeout(1000), malformed);
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
});

test("actual request and pass deadlines cancel streams and stop queued launches", async () => {
  const db = await database();
  const index = `# Models\n${Array.from({ length: 45 }, (_unused, position) => `- [model-${position}](/api/docs/models/model-${position}.md)`).join("\n")}\n`;
  const launches: number[] = [];
  const cancellations: number[] = [];
  const started = Date.now();
  const request: CatalogueFetch = async (url) => {
    let response: Response;
    if (url === INDEX) {
      response = new Response(index, { headers: { "content-type": "text/markdown" } });
    } else {
      launches.push(Date.now() - started);
      response = new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancellations.push(Date.now() - started);
          },
        }),
        { headers: { "content-type": "text/markdown" } },
      );
    }
    const result = await Promise.resolve(response);
    return result;
  };
  await enrichOpenAIModels(db, PROVIDER, "owner", ["queued"], started, request);
  const elapsed = Date.now() - started;
  expect(launches).toHaveLength(12);
  expect(cancellations).toHaveLength(12);
  expect(cancellations[0]).toBeGreaterThanOrEqual(14_900);
  expect(cancellations[0]).toBeLessThan(18_000);
  expect(elapsed).toBeGreaterThanOrEqual(34_900);
  expect(elapsed).toBeLessThan(38_000);
  expect(Math.max(...launches)).toBeLessThan(35_000);
}, 45_000);

test("bootstrap caps requests, bounds concurrency and progresses without retrying cached pages", async () => {
  const db = await database();
  const now = Date.now();
  const index = `# Models\n${Array.from({ length: 45 }, (_unused, position) => `- [model-${position}](/api/docs/models/model-${position}.md)`).join("\n")}\n`;
  const calls: string[] = [];
  let active = 0;
  let peak = 0;
  let releases: (() => void)[] = [];
  const request: CatalogueFetch = async (url) => {
    calls.push(url);
    if (url === INDEX) {
      const response = await Promise.resolve(
        new Response(index, { headers: { "content-type": "text/markdown" } }),
      );
      return response;
    }
    active += 1;
    peak = Math.max(peak, active);
    // oxlint-disable-next-line promise/avoid-new -- Barrier observes concurrency without timing assumptions.
    await new Promise<void>((resolve) => {
      releases.push(resolve);
      if (releases.length === 4) {
        const wave = releases;
        releases = [];
        for (const release of wave) {
          release();
        }
      }
    });
    active -= 1;
    const id = url.split("/").at(-1)?.replace(".md", "") ?? "";
    return new Response(DOCUMENT.replaceAll("gpt-5.4", id), {
      headers: { "content-type": "text/markdown" },
    });
  };
  await enrichOpenAIModels(db, PROVIDER, "owner", ["unknown"], now, request);
  expect(calls.length).toBe(21);
  expect(peak).toBe(4);
  expect(active).toBe(0);
  const first = new Set(calls);
  calls.length = 0;
  await enrichOpenAIModels(db, PROVIDER, "owner", ["unknown"], now + 1, request);
  expect(calls.length).toBe(20);
  expect(calls.some((url) => first.has(url))).toBe(false);
  const metadata = await db
    .prepare("SELECT status, checked_at FROM model_metadata WHERE external_id = 'unknown'")
    .first();
  expect(metadata).toEqual({ checked_at: now + 1 - WEEK, status: "unknown" });
  const finish: CatalogueFetch = async (url) => {
    calls.push(url);
    const id = url.split("/").at(-1)?.replace(".md", "") ?? "";
    const response = await Promise.resolve(
      new Response(DOCUMENT.replaceAll("gpt-5.4", id), {
        headers: { "content-type": "text/markdown" },
      }),
    );
    return response;
  };
  calls.length = 0;
  await enrichOpenAIModels(db, PROVIDER, "owner", ["unknown"], now + 2, finish);
  expect(calls).toHaveLength(5);
  const completed = await db
    .prepare("SELECT status, checked_at FROM model_metadata WHERE external_id = 'unknown'")
    .first();
  expect(completed).toEqual({ checked_at: now + 2, status: "unknown" });
  calls.length = 0;
  await enrichOpenAIModels(db, PROVIDER, "owner", ["unknown"], now + 3, finish);
  expect(calls).toEqual([]);
});

test("sync entrypoint keeps successful account discovery when enrichment fails, then enriches the next sync", async () => {
  const db = await database();
  await db
    .prepare(
      "UPDATE catalogue_sync SET lease = '', lease_until = 0, attempted_at = 0 WHERE provider = ?",
    )
    .bind(PROVIDER)
    .run();
  const calls: string[] = [];
  const failed: CatalogueFetch = async (url, init) => {
    calls.push(url);
    if (url === "https://api.openai.com/v1/models") {
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-only");
      const response = await Promise.resolve(
        Response.json({ data: [{ id: "gpt-5.4", object: "model" }] }),
      );
      return response;
    }
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
    throw new Error("Documentation network failure");
  };
  const status = await syncCatalogue({ DB: db, OPENAI_API_KEY: "test-only" }, PROVIDER, failed);
  const openai = status.find((entry) => entry.provider === PROVIDER);
  expect(openai?.status).toBe("Synced");
  expect(openai?.modelCount).toBe(1);
  expect(openai?.pending).toBe(false);
  expect(calls).toEqual(["https://api.openai.com/v1/models", INDEX]);
  const model = await db
    .prepare(
      "SELECT active, external_id FROM models WHERE provider = ? AND external_id = 'gpt-5.4'",
    )
    .bind(PROVIDER)
    .first();
  expect(model).toEqual({ active: 1, external_id: "gpt-5.4" });
  const metadata = await db.prepare("SELECT status, checked_at FROM model_metadata").all();
  expect(metadata.results).toEqual([{ checked_at: 0, status: "unknown" }]);
  await db
    .prepare("UPDATE catalogue_sync SET attempted_at = 0 WHERE provider = ?")
    .bind(PROVIDER)
    .run();
  await db.prepare("UPDATE openai_document_cache SET checked_at = 0").run();
  const succeeded: CatalogueFetch = async (url, init) => {
    if (url === "https://api.openai.com/v1/models") {
      return failed(url, init);
    }
    return source([])(url, init);
  };
  const next = await syncCatalogue({ DB: db, OPENAI_API_KEY: "test-only" }, PROVIDER, succeeded);
  expect(next.find((entry) => entry.provider === PROVIDER)?.status).toBe("Synced");
  const enriched = await db
    .prepare("SELECT status, source_url FROM model_metadata WHERE external_id = 'gpt-5.4'")
    .first();
  expect(enriched).toEqual({ source_url: URL, status: "ok" });
});

test("weekly skip, immediate new ID and exact snapshot membership", async () => {
  const db = await database();
  const calls: string[] = [];
  const now = Date.now();
  await enrichOpenAIModels(db, PROVIDER, "owner", ["gpt-5.4"], now, source(calls));
  expect(calls).toEqual([INDEX, URL]);
  calls.length = 0;
  await enrichOpenAIModels(db, PROVIDER, "owner", ["gpt-5.4"], now + WEEK - 1, source(calls));
  expect(calls).toEqual([]);
  await enrichOpenAIModels(
    db,
    PROVIDER,
    "owner",
    ["gpt-5.4", "gpt-5.4-2026-03-05", "gpt-5.4-2099-01-01", "ft:private"],
    now + 1,
    source(calls),
  );
  expect(calls).toEqual([INDEX, URL]);
  const rows = await db
    .prepare("SELECT external_id, status, source_url FROM model_metadata ORDER BY external_id")
    .all();
  expect(rows.results).toEqual([
    // oxlint-disable-next-line unicorn/no-null -- D1 returns SQL NULL.
    { external_id: "ft:private", source_url: null, status: "unknown" },
    { external_id: "gpt-5.4", source_url: URL, status: "ok" },
    { external_id: "gpt-5.4-2026-03-05", source_url: URL, status: "ok" },
    // oxlint-disable-next-line unicorn/no-null -- D1 returns SQL NULL.
    { external_id: "gpt-5.4-2099-01-01", source_url: null, status: "unknown" },
  ]);
  calls.length = 0;
  await enrichOpenAIModels(db, PROVIDER, "owner", ["gpt-5.4"], now + WEEK + 1, source(calls));
  expect(calls).toEqual([INDEX, URL]);
});

test("failed page preserves prior metadata and success timestamp with a negative page cache", async () => {
  const db = await database();
  const now = Date.now();
  await enrichOpenAIModels(db, PROVIDER, "owner", ["gpt-5.4"], now, source([]));
  const before = await db.prepare("SELECT * FROM model_metadata").all();
  const calls: string[] = [];
  const failed: CatalogueFetch = async (url) => {
    calls.push(url);
    const response = await Promise.resolve(
      new Response(url === INDEX ? INDEX_BODY : "Unavailable", {
        headers: { "content-type": "text/markdown" },
        status: url === INDEX ? 200 : 503,
      }),
    );
    return response;
  };
  await enrichOpenAIModels(db, PROVIDER, "owner", ["gpt-5.4"], now + WEEK, failed);
  const after = await db.prepare("SELECT * FROM model_metadata").all();
  expect(after.results).toEqual(before.results);
  expect(calls).toEqual([INDEX, URL]);
  calls.length = 0;
  await enrichOpenAIModels(db, PROVIDER, "owner", ["gpt-5.4"], now + WEEK + 1, failed);
  expect(calls).toEqual([]);
});

test("stale owners cannot write successful, unknown or failed caches", async () => {
  const db = await database();
  const request: CatalogueFetch = async (url, init) => {
    await db
      .prepare("UPDATE catalogue_sync SET lease = 'replacement' WHERE provider = ?")
      .bind(PROVIDER)
      .run();
    return source([])(url, init);
  };
  await enrichOpenAIModels(db, PROVIDER, "owner", ["gpt-5.4", "unknown"], Date.now(), request);
  const metadata = await db.prepare("SELECT * FROM model_metadata").all();
  const cache = await db.prepare("SELECT * FROM openai_document_cache").all();
  expect(metadata.results).toHaveLength(2);
  expect(cache.results).toEqual([]);
});

test("documentation failures do not affect catalogue rows", async () => {
  const db = await database();
  const before = await db.prepare("SELECT * FROM models").all();
  await enrichOpenAIModels(db, PROVIDER, "owner", ["gpt-5.4"], Date.now(), async () => {
    const response = await Promise.resolve(new Response("bad", { status: 503 }));
    return response;
  });
  const after = await db.prepare("SELECT * FROM models").all();
  expect(after.results).toEqual(before.results);
});

test("HTTP rejects cross-origin, HTML and oversized streamed responses", () => {
  const signal = AbortSignal.timeout(1000);
  expect(fetchMarkdown("https://evil.example/model.md", signal, source([]))).rejects.toThrow(
    "Rejected documentation URL",
  );
  expect(
    fetchMarkdown(URL, signal, async () => {
      const response = await Promise.resolve(
        new Response("<html>", { headers: { "content-type": "text/html" } }),
      );
      return response;
    }),
  ).rejects.toThrow("Documentation unavailable");
  expect(
    fetchMarkdown(URL, signal, async () => {
      const response = await Promise.resolve(
        new Response(new Uint8Array(524_289), { headers: { "content-type": "text/markdown" } }),
      );
      return response;
    }),
  ).rejects.toThrow("Documentation too large");
});

test("deadline cancels a stalled streamed response", async () => {
  let cancelled = false;
  const request: CatalogueFetch = async () => {
    const response = await Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "text/markdown" } },
      ),
    );
    return response;
  };
  let failed = false;
  try {
    await fetchMarkdown(URL, AbortSignal.timeout(20), request);
  } catch {
    failed = true;
  }
  expect(failed).toBe(true);
  expect(cancelled).toBe(true);
});
