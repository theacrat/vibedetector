import { afterAll, expect, test } from "bun:test";

import { convertV4MiniflareOptions, Miniflare } from "miniflare";

import { loadModels } from "@/server/catalogue";
import { applyCatalogue, syncCatalogue } from "@/server/catalogue-sync";
import { saveReport, sessionReport } from "@/server/storage";

const CLAUDE = "10000000-0000-4000-8000-000000000001";
const CHATGPT = "10000000-0000-4000-8000-000000000002";
const runtimes: Miniflare[] = [];

afterAll(async () => {
  await Promise.all(runtimes.map(async (runtime) => runtime.dispose()));
});

async function migrate(db: D1Database, filename: string) {
  const sql = await Bun.file(`migrations/${filename}`).text();
  await db.batch(
    sql
      .split(";")
      .filter((statement) => statement.trim())
      .map((statement) => db.prepare(statement)),
  );
}

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
  ]) {
    // Schema versions must be applied in order.
    // oxlint-disable-next-line eslint/no-await-in-loop
    await migrate(db, filename);
  }
  return db;
}

async function lease(db: D1Database, token: string) {
  await db
    .prepare(
      "UPDATE catalogue_sync SET lease = ?, lease_until = unixepoch('subsec') * 1000 + 120000 WHERE provider = ?",
    )
    .bind(token, CLAUDE)
    .run();
}

test("populated sync migration preserves report fields, UUIDs and foreign keys", async () => {
  const db = await database();
  const models = await loadModels(db);
  for (const model of models) {
    // Each provider's report is persisted before migrating.
    // oxlint-disable-next-line eslint/no-await-in-loop
    await saveReport(db, model.provider, model.id, "slow", 1_800_000, model.id);
  }
  const reports = await db.prepare("SELECT * FROM reports ORDER BY provider, identity_hash").all();
  await migrate(db, "0005_catalogue_sync.sql");
  const migratedReports = await db
    .prepare("SELECT * FROM reports ORDER BY provider, identity_hash")
    .all();
  expect(migratedReports.results).toEqual(reports.results);
  const next = await loadModels(db);
  expect(next.map((model) => model.id)).toEqual(models.map((model) => model.id));
  const retired = new Set([
    "10000000-0000-4000-8000-000000000004",
    "10000000-0000-4000-8000-000000000008",
    "10000000-0000-4000-8000-000000000009",
  ]);
  const expected = structuredClone(models);
  for (const model of expected) {
    if (retired.has(model.provider)) {
      model.active = false;
    }
  }
  expect(next).toEqual(expected);
  const foreignKeys = await db.prepare("PRAGMA foreign_key_check").all();
  expect(foreignKeys.results).toEqual([]);
});

test("new API identities never adopt manual UUIDs and survive reappearance", async () => {
  const db = await database();
  const [old] = await loadModels(db, CLAUDE);
  if (!old) {
    throw new Error("Missing model");
  }
  await saveReport(db, CLAUDE, "owner", "slow", Date.now(), old.id);
  await migrate(db, "0005_catalogue_sync.sql");
  await lease(db, "a");
  await applyCatalogue(db, CLAUDE, "a", [{ id: "exact-id", name: old.name }]);
  const first = await loadModels(db, CLAUDE);
  const api = first.find((model) => model.active);
  expect(api?.id).not.toBe(old.id);
  expect(first.find((model) => model.id === old.id)?.active).toBe(false);
  const saved = await sessionReport(db, CLAUDE, "owner", Date.now());
  expect(saved.model).toBe(old.id);
  await lease(db, "b");
  await applyCatalogue(db, CLAUDE, "b", [{ id: "other", name: "other" }]);
  await lease(db, "c");
  await applyCatalogue(db, CLAUDE, "c", [{ id: "exact-id", name: "renamed" }]);
  const restored = await loadModels(db, CLAUDE);
  expect(restored.find((model) => model.active)?.id).toBe(api?.id);
});

test("expired owner rolls back and cannot overwrite successor catalogue or status", async () => {
  const db = await database();
  await migrate(db, "0005_catalogue_sync.sql");
  await lease(db, "a");
  await db
    .prepare("UPDATE catalogue_sync SET lease_until = 0 WHERE provider = ?")
    .bind(CLAUDE)
    .run();
  expect(applyCatalogue(db, CLAUDE, "a", [{ id: "stale", name: "stale" }])).rejects.toThrow();
  await lease(db, "b");
  await applyCatalogue(db, CLAUDE, "b", [{ id: "fresh", name: "fresh" }]);
  const before = await db
    .prepare("SELECT * FROM catalogue_sync WHERE provider = ?")
    .bind(CLAUDE)
    .first();
  expect(applyCatalogue(db, CLAUDE, "a", [{ id: "stale", name: "stale" }])).rejects.toThrow();
  const after = await db
    .prepare("SELECT * FROM catalogue_sync WHERE provider = ?")
    .bind(CLAUDE)
    .first();
  expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  const models = await loadModels(db, CLAUDE);
  expect(models.filter((model) => model.active).map((model) => model.name)).toEqual(["fresh"]);
});

test("one provider failure preserves its catalogue while another syncs and cooldown is atomic", async () => {
  const db = await database();
  await migrate(db, "0005_catalogue_sync.sql");
  const before = await loadModels(db, CLAUDE);
  let calls = 0;
  const bindings = { ANTHROPIC_API_KEY: "secret", DB: db, OPENAI_API_KEY: "secret" };
  await syncCatalogue(bindings, undefined, async (url) => {
    await Promise.resolve();
    calls += 1;
    return url.includes("anthropic")
      ? new Response("secret", { status: 429 })
      : Response.json({ data: [{ id: "api-id", object: "model" }], object: "list" });
  });
  expect(await loadModels(db, CLAUDE)).toEqual(before);
  const synced = await loadModels(db, CHATGPT);
  expect(synced.filter((model) => model.active).map((model) => model.name)).toEqual(["api-id"]);
  await syncCatalogue(bindings, undefined, async () => {
    await Promise.resolve();
    calls += 1;
    throw new Error("Must not fetch in cooldown");
  });
  expect(calls).toBe(2);
});
