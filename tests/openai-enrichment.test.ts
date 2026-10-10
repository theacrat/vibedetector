import { afterAll, expect, test } from "bun:test";

import { convertV4MiniflareOptions, Miniflare } from "miniflare";

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
  expect(calls).toEqual([]);
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
  await enrichOpenAIModels(db, PROVIDER, "owner", ["gpt-5.4"], now + WEEK, source(calls));
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
  expect(metadata.results).toEqual([]);
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
