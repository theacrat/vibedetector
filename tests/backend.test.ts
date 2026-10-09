/* oxlint-disable unicorn/no-null -- SQL and JSON encode absent metadata and retractions as null. */
import { afterAll, expect, test } from "bun:test";

import { initialProviders } from "@seed/provider";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

import { isId } from "@/domain";
import type { ModelOption, Provider } from "@/domain";
import { aggregate } from "@/server/aggregation";
import { handleApi } from "@/server/api";
import {
  loadActiveModels,
  loadModels,
  loadProviders,
  orderCatalogue,
  parseProvider,
  resolveProvider,
} from "@/server/catalogue";
import { dashboardFromDatabase, overviewFromDatabase } from "@/server/queries";
import { browserIdentity, challengeConfig, readJson, verifyChallenge } from "@/server/security";
import { sitemap } from "@/server/sitemap";
import { HOUR, loadReports, retainReports, saveReport, sessionReport } from "@/server/storage";

const runtimes: Miniflare[] = [];
const CLAUDE = "10000000-0000-4000-8000-000000000001";
const CHATGPT = "10000000-0000-4000-8000-000000000002";
const SECRET = "test-admin-secret-that-is-at-least-32-characters";
const migrations = [
  "0001_reports.sql",
  "0002_report_models.sql",
  "0003_model_catalogue.sql",
  "0004_catalogue_identities.sql",
];

afterAll(async () => {
  await Promise.all(runtimes.map(async (runtime) => runtime.dispose()));
});

async function migrate(db: D1Database, filename: string): Promise<void> {
  const sql = await Bun.file(new URL(`../migrations/${filename}`, import.meta.url)).text();
  await db.batch(
    sql
      .split(";")
      .filter((statement) => statement.trim() !== "")
      .map((statement) => db.prepare(statement)),
  );
}

async function database(legacy = false): Promise<D1Database> {
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
  for (const filename of migrations.slice(0, legacy ? 3 : 4)) {
    // Schema versions must be applied in order.
    // oxlint-disable-next-line eslint/no-await-in-loop
    await migrate(db, filename);
  }
  return db;
}

function bindings(db: D1Database): Cloudflare.Env {
  return {
    ADMIN_KEY: SECRET,
    ADMIN_RATE_LIMIT: { limit: async () => ({ success: true }) },
    DB: db,
    REPORT_RATE_LIMIT: { limit: async () => ({ success: true }) },
    TURNSTILE_HOSTNAME: "localhost",
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  };
}

function request(path: string, body?: unknown, cookie = "", origin = "http://localhost"): Request {
  return new Request(`http://localhost${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "CF-Connecting-IP": "127.0.0.1",
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: origin,
    },
    method: body === undefined ? "GET" : "POST",
  });
}

async function admin(db: D1Database): Promise<string> {
  const response = await handleApi(request("/api/admin/login", { key: SECRET }), bindings(db));
  expect(response.status).toBe(200);
  const cookie = response.headers.get("Set-Cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error("Missing admin cookie");
  }
  return cookie;
}

async function firstModel(db: D1Database, provider = CLAUDE): Promise<ModelOption> {
  const [model] = await loadModels(db, provider);
  if (!model) {
    throw new Error("Missing seeded model");
  }
  return model;
}

test("migration preserves report identity, retractions, timestamps, model order and archived state", async () => {
  const db = await database(true);
  await db.batch([
    db.prepare(
      "UPDATE models SET active = 0, position = 73 WHERE provider = 'claude' AND name = 'Claude Opus 5.5'",
    ),
    db.prepare(
      "INSERT INTO reports VALUES ('claude', 'identity', 12, 12345, 'slow', 'Claude Opus 5.5')",
    ),
    db.prepare("INSERT INTO reports VALUES ('chatgpt', 'retraction', 13, 23456, NULL, NULL)"),
  ]);
  await migrate(db, migrations[3] ?? "");
  const model = await db
    .prepare("SELECT * FROM models WHERE provider = ? AND name = 'Claude Opus 5.5'")
    .bind(CLAUDE)
    .first<{ id: string; active: number; position: number }>();
  expect(isId(model?.id)).toBe(true);
  expect(model?.active).toBe(0);
  expect(model?.position).toBe(73);
  expect(await db.prepare("SELECT * FROM reports ORDER BY created_at").all()).toMatchObject({
    results: [
      {
        category: "slow",
        created_at: 12_345,
        identity_hash: "identity",
        model: model?.id,
        provider: CLAUDE,
        window: 12,
      },
      {
        category: null,
        created_at: 23_456,
        identity_hash: "retraction",
        model: null,
        provider: CHATGPT,
        window: 13,
      },
    ],
  });
  expect((await loadModels(db)).length).toBe(55);
  expect((await loadProviders(db)).length).toBe(10);
  expect(await db.prepare("PRAGMA foreign_key_check").all()).toMatchObject({ results: [] });
  const indexes = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all<{ name: string }>();
  expect(indexes.results.map((row) => row.name)).toContain("reports_provider_time");
  expect(indexes.results.map((row) => row.name)).toContain("reports_retention");
});

test("migration fails atomically for unknown named metadata rather than nulling it", async () => {
  const db = await database(true);
  await db
    .prepare(
      "INSERT INTO reports VALUES ('claude', 'identity', 12, 12345, 'slow', 'Unmapped historical model')",
    )
    .run();
  await expect(migrate(db, migrations[3] ?? "")).rejects.toThrow();
  expect(await db.prepare("SELECT model FROM reports").first()).toEqual({
    model: "Unmapped historical model",
  });
  expect(
    await db.prepare("SELECT name FROM sqlite_master WHERE name = 'providers'").first(),
  ).toBeNull();
});

test("D1 UUID rename stability preserves filtering, deduplication and report restoration", async () => {
  const db = await database();
  const model = await firstModel(db);
  const now = Math.floor(Date.now() / HOUR) * HOUR + 1000;
  await saveReport(db, CLAUDE, "browser", "slow", now, model.id);
  await db.batch([
    db.prepare("UPDATE models SET name = 'Corrected model name' WHERE id = ?").bind(model.id),
    db
      .prepare(
        "UPDATE providers SET name = 'Corrected provider name', slug = 'renamed-provider' WHERE id = ?",
      )
      .bind(CLAUDE),
  ]);
  await saveReport(db, CLAUDE, "browser", "broken", now + 5000, model.id);
  const dashboard = await dashboardFromDatabase(
    db,
    "renamed-provider",
    "24h",
    now + 5000,
    model.id,
  );
  expect(dashboard.model).toBe(model.id);
  expect(dashboard.provider.name).toBe("Corrected provider name");
  expect(dashboard.models.find((entry) => entry.id === model.id)?.name).toBe(
    "Corrected model name",
  );
  expect(dashboard.buckets.reduce((total, bucket) => total + bucket.broken, 0)).toBe(1);
  expect(await sessionReport(db, CLAUDE, "browser", now)).toEqual({
    category: "broken",
    model: model.id,
  });
  expect(await loadReports(db, CLAUDE, now + 5000)).toEqual([
    { category: "broken", created_at: now, model: model.id },
  ]);
  await saveReport(db, CLAUDE, "browser", null, now + 6000, model.id);
  expect(await sessionReport(db, CLAUDE, "browser", now)).toEqual({
    category: null,
    model: model.id,
  });
  expect((await handleApi(request("/api/providers/claude"), bindings(db))).status).toBe(404);
});

test("composite D1 ownership rejects cross-provider models even through direct SQL", async () => {
  const db = await database();
  const model = await firstModel(db);
  await expect(saveReport(db, CHATGPT, "browser", "slow", Date.now(), model.id)).rejects.toThrow(
    "Invalid report model",
  );
  await expect(
    db
      .prepare("INSERT INTO reports VALUES (?, 'browser', 1, 1, 'slow', ?)")
      .bind(CHATGPT, model.id)
      .run(),
  ).rejects.toThrow("FOREIGN KEY");
});

test("admin creates, renames, archives and restores providers and models without changing IDs", async () => {
  const db = await database();
  const cookie = await admin(db);
  const providerInput = {
    logo: "/logos/claude.svg",
    maker: "New maker",
    name: "New provider",
    slug: "new-provider",
    status: "https://status.example.com",
    statusLabel: "Status page",
  };
  const created = await handleApi(
    request("/api/admin/providers", providerInput, cookie),
    bindings(db),
  );
  expect(created.status).toBe(200);
  const providers = await created.json();
  const provider = providers.find((entry) => entry.slug === "new-provider");
  if (!provider) {
    throw new Error("Missing created provider");
  }
  expect(isId(provider.id)).toBe(true);
  expect(
    (
      await handleApi(
        request("/api/admin/models", { name: "Generic model", provider: provider.id }, cookie),
        bindings(db),
      )
    ).status,
  ).toBe(200);
  const model = await firstModel(db, provider.id);
  expect(
    (
      await handleApi(
        request("/api/admin/models/state", { active: false, id: model.id }, cookie),
        bindings(db),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await handleApi(
        request("/api/admin/models/update", { id: model.id, name: "Renamed model" }, cookie),
        bindings(db),
      )
    ).status,
  ).toBe(200);
  expect(await loadModels(db, provider.id)).toEqual([
    { active: false, id: model.id, name: "Renamed model", provider: provider.id },
  ]);
  expect(
    (
      await handleApi(
        request(
          "/api/admin/providers/update",
          { ...providerInput, id: provider.id, name: "Renamed provider" },
          cookie,
        ),
        bindings(db),
      )
    ).status,
  ).toBe(200);
  expect((await resolveProvider(db, provider.id)).name).toBe("Renamed provider");
  expect(
    (
      await handleApi(
        request("/api/admin/providers/state", { active: false, id: provider.id }, cookie),
        bindings(db),
      )
    ).status,
  ).toBe(200);
  for (const route of ["providers", "models", "session", "reports"]) {
    const response = await handleApi(
      request(`/api/${route}/${provider.id}`, route === "reports" ? {} : undefined),
      bindings(db),
    );
    expect(response.status).toBe(404);
  }
  await expect(dashboardFromDatabase(db, provider.slug, "24h", Date.now())).rejects.toThrow(
    "Unknown provider",
  );
  expect(
    (await overviewFromDatabase(db, Date.now())).some((entry) => entry.provider.id === provider.id),
  ).toBe(false);
  expect((await sitemap(db, "https://example.com/?a=1&b=2")).text()).resolves.not.toContain(
    "new-provider",
  );
  expect((await loadModels(db, provider.id)).length).toBe(1);
  expect(
    (
      await handleApi(
        request("/api/admin/providers/state", { active: true, id: provider.id }, cookie),
        bindings(db),
      )
    ).status,
  ).toBe(200);
  expect((await resolveProvider(db, provider.slug)).id).toBe(provider.id);
});

test("provider URLs and slugs reject unsafe values and duplicate display values return 409", async () => {
  const db = await database();
  const cookie = await admin(db);
  const provider = initialProviders[0];
  if (!provider) {
    throw new Error("Missing provider seed");
  }
  for (const slug of [
    "api",
    "admin",
    "privacy",
    "methodology",
    "robots.txt",
    "sitemap.xml",
    "UPPER",
    "../escape",
  ]) {
    expect(
      (
        await handleApi(
          request("/api/admin/providers", { ...provider, slug }, cookie),
          bindings(db),
        )
      ).status,
    ).toBe(400);
  }
  expect(() => parseProvider({ ...provider, status: "javascript:alert(1)" })).toThrow();
  expect(() => parseProvider({ ...provider, logo: "/logos/../private.svg" })).toThrow();
  expect(() => parseProvider({ ...provider, logo: "http://example.com/logo.svg" })).toThrow();
  expect(
    (await handleApi(request("/api/admin/providers", provider, cookie), bindings(db))).status,
  ).toBe(409);
  const model = await firstModel(db);
  expect(
    (
      await handleApi(
        request("/api/admin/models", { name: model.name, provider: CLAUDE }, cookie),
        bindings(db),
      )
    ).status,
  ).toBe(409);
});

test("atomic full-ID orders include archived records, competing orders and append safely", async () => {
  const db = await database();
  const models = await loadModels(db, CLAUDE);
  const ids = models.map((model) => model.id);
  const reverse = ids.toReversed();
  await db.prepare("UPDATE models SET active = 0 WHERE id = ?").bind(ids[0]).run();
  await orderCatalogue(db, { ids: reverse, provider: CLAUDE }, "models");
  expect((await loadModels(db, CLAUDE)).map((model) => model.id)).toEqual(reverse);
  await expect(
    orderCatalogue(db, { ids: reverse.slice(1), provider: CLAUDE }, "models"),
  ).rejects.toThrow("Catalogue changed");
  await expect(
    orderCatalogue(db, { ids: [ids[0], ids[0]], provider: CLAUDE }, "models"),
  ).rejects.toThrow();
  await Promise.all([
    orderCatalogue(db, { ids, provider: CLAUDE }, "models"),
    orderCatalogue(db, { ids: reverse, provider: CLAUDE }, "models"),
  ]);
  expect([ids, reverse]).toContainEqual((await loadModels(db, CLAUDE)).map((model) => model.id));
  const cookie = await admin(db);
  expect(
    (
      await handleApi(
        request("/api/admin/models", { name: "Appended", provider: CLAUDE }, cookie),
        bindings(db),
      )
    ).status,
  ).toBe(200);
  expect((await loadModels(db, CLAUDE)).at(-1)?.name).toBe("Appended");
  const providers = (await loadProviders(db)).map((provider) => provider.id).toReversed();
  await orderCatalogue(db, { ids: providers }, "providers");
  expect((await loadProviders(db)).map((provider) => provider.id)).toEqual(providers);
  const oversized = new Request("http://localhost/api/admin/providers/order", {
    body: " ".repeat(262_145),
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost" },
    method: "POST",
  });
  expect((await handleApi(oversized, bindings(db))).status).toBe(413);
});

test("archive model exception stays scoped to saved identity, provider, hour and retraction state", async () => {
  const db = await database();
  const model = await firstModel(db);
  const now = Math.floor(Date.now() / HOUR) * HOUR + 1000;
  await saveReport(db, CLAUDE, "owner", "slow", now, model.id);
  await db.prepare("UPDATE models SET active = 0 WHERE id = ?").bind(model.id).run();
  expect(await loadActiveModels(db, CLAUDE)).not.toContainEqual(model);
  expect((await dashboardFromDatabase(db, CLAUDE, "24h", now, model.id)).model).toBe("");
  await expect(saveReport(db, CLAUDE, "other", "slow", now, model.id)).rejects.toThrow();
  await expect(saveReport(db, CLAUDE, "owner", "slow", now + HOUR, model.id)).rejects.toThrow();
  await saveReport(db, CLAUDE, "owner", "broken", now, model.id);
  await saveReport(db, CLAUDE, "owner", null, now, model.id);
  await expect(saveReport(db, CLAUDE, "owner", "slow", now, model.id)).rejects.toThrow();
  await db.prepare("UPDATE providers SET active = 0 WHERE id = ?").bind(CLAUDE).run();
  await expect(saveReport(db, CLAUDE, "owner", null, now, model.id)).rejects.toThrow();
});

test("HTTP reports return UUIDs and restore them through the same signed browser identity", async () => {
  const db = await database();
  const model = await firstModel(db);
  const env = bindings(db);
  const verified = async () =>
    Response.json({ metadata: { result_with_testing_key: true }, success: true });
  const session = await handleApi(request("/api/session/claude"), env);
  const cookie = session.headers.get("Set-Cookie")?.split(";")[0] ?? "";
  const window = Math.floor(Date.now() / HOUR);
  const report = await handleApi(
    request(
      "/api/reports/claude",
      { category: "slow", model: model.id, token: "dummy", window },
      cookie,
    ),
    env,
    verified,
  );
  expect(report.status).toBe(200);
  expect(await report.json()).toEqual({ category: "slow", model: model.id });
  expect(
    await (await handleApi(request(`/api/session/${CLAUDE}`, undefined, cookie), env)).json(),
  ).toMatchObject({ category: "slow", model: model.id });
  expect(
    (
      await handleApi(
        request(
          "/api/reports/claude",
          { category: "slow", model: model.name, token: "dummy", window },
          cookie,
        ),
        env,
        verified,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handleApi(
        request(
          "/api/reports/claude",
          { category: "slow", token: "dummy", window: window - 1 },
          cookie,
        ),
        env,
        verified,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await handleApi(
        request("/api/reports/claude", { category: "slow", token: "dummy", window }, cookie),
        env,
        async () => Response.json({ success: false }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handleApi(
        request("/api/reports/claude", { category: "slow", token: "dummy", window }, cookie),
        { ...env, REPORT_RATE_LIMIT: { limit: async () => ({ success: false }) } },
        verified,
      )
    ).status,
  ).toBe(429);
});

test("admin authentication and CSRF stay fail closed for both catalogues", async () => {
  const db = await database();
  const env = bindings(db);
  expect((await handleApi(request("/api/admin/providers"), env)).status).toBe(401);
  expect((await handleApi(request("/api/admin/models"), env)).status).toBe(401);
  expect((await handleApi(request("/api/admin/login", { key: "wrong" }), env)).status).toBe(401);
  expect(
    (await handleApi(request("/api/admin/login", { key: SECRET }, "", "https://attacker.com"), env))
      .status,
  ).toBe(403);
  const cookie = await admin(db);
  expect(
    (await handleApi(request("/api/admin/providers", undefined, cookie.slice(0, -2)), env)).status,
  ).toBe(401);
  expect(
    (
      await handleApi(
        request(
          "/api/admin/providers/state",
          { active: false, id: CLAUDE },
          cookie,
          "https://attacker.com",
        ),
        env,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handleApi(request("/api/admin/providers", undefined, cookie), {
        ...env,
        ADMIN_KEY: "a-different-secret-that-is-long-enough-to-use",
      })
    ).status,
  ).toBe(401);
  const logout = await handleApi(request("/api/admin/logout", {}, cookie), env);
  expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
});

test("security validates identity cookies, body bounds, challenge hostname and action", async () => {
  const identity = await browserIdentity(request("/api/session/claude"));
  expect(identity.hash).toMatch(/^[a-f0-9]{64}$/u);
  expect(identity.cookie).toContain("HttpOnly; SameSite=Strict");
  const cookie = identity.cookie?.split(";")[0] ?? "";
  expect(await browserIdentity(request("/api/session/claude", undefined, cookie))).toEqual({
    cookie: null,
    hash: identity.hash,
  });
  await expect(
    readJson(request("/api/reports/claude", {}, "", "https://attacker.com")),
  ).rejects.toThrow("Origin rejected");
  await expect(
    readJson(request("/api/reports/claude", { padding: "x".repeat(5000) })),
  ).rejects.toThrow("Body too large");
  const config = {
    hostname: "example.com",
    local: false,
    secret: "production-secret",
    siteKey: "production-site-key",
  };
  await expect(
    verifyChallenge(config, "token", async () =>
      Response.json({ action: "wrong", hostname: "example.com", success: true }),
    ),
  ).rejects.toThrow("Challenge rejected");
  await verifyChallenge(config, "token", async () =>
    Response.json({ action: "report", hostname: "example.com", success: true }),
  );
  expect(() => challengeConfig(bindings({} as D1Database), "example.com")).toThrow(
    "Reporting is not configured",
  );
});

test("dynamic sitemap uses escaped active slugs and follows rename", async () => {
  const db = await database();
  await db.prepare("UPDATE providers SET slug = 'corrected-slug' WHERE id = ?").bind(CLAUDE).run();
  await db.prepare("UPDATE providers SET active = 0 WHERE id = ?").bind(CHATGPT).run();
  const response = await sitemap(db, "https://example.com/?a=1&b=2");
  expect(response.headers.get("Content-Type")).toContain("application/xml");
  const xml = await response.text();
  expect(xml).toContain("&amp;");
  expect(xml).toContain("corrected-slug");
  expect(xml).not.toContain("/claude</loc>");
  expect(xml).not.toContain("/chatgpt</loc>");
});

test("provider-only anomaly metrics stay unchanged by model UUID filters", () => {
  const provider = initialProviders[0];
  if (!provider) {
    throw new Error("Missing provider seed");
  }
  const now = 60 * HOUR + 2000;
  const reports = [
    { category: "slow" as const, created_at: now - 49 * HOUR, model: "model-a" },
    ...Array.from({ length: 240 }, (_value, index) => ({
      category: "slow" as const,
      created_at: now - (2 + (index % 46)) * HOUR,
      model: "model-a",
    })),
    ...Array.from({ length: 25 }, () => ({
      category: "broken" as const,
      created_at: now - 1000,
      model: "model-b",
    })),
  ];
  const all = aggregate(provider, "24h", reports, now);
  const filtered = aggregate(provider, "24h", reports, now, "model-a");
  expect(all.hourly).toBe(25);
  expect(all.baseline).toBe(5);
  expect(all.verdict).toBe("killed the vibe");
  expect(filtered.hourly).toBe(25);
  expect(filtered.baseline).toBe(5);
  expect(filtered.verdict).toBe("killed the vibe");
  expect(filtered.buckets.reduce((total, bucket) => total + bucket.broken, 0)).toBe(0);
});

test("retention uses the UUID dedup keys and drains more than one bounded batch", async () => {
  const db = await database();
  await db
    .prepare(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5002) INSERT INTO reports SELECT ?, CAST(i AS TEXT), 0, 1, 'slow', NULL FROM n",
    )
    .bind(CLAUDE)
    .run();
  await saveReport(db, CLAUDE, "current", "slow", Date.now());
  await retainReports(db, Date.now());
  expect(await db.prepare("SELECT identity_hash FROM reports").all()).toMatchObject({
    results: [{ identity_hash: "current" }],
  });
});
