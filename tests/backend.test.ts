/* oxlint-disable unicorn/no-null -- SQL and JSON encode absent metadata and retractions as null. */
import { afterAll, expect, test } from "bun:test";

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
async function allowLimit(): Promise<{ success: boolean }> {
  await Promise.resolve();
  return { success: true };
}
async function denyLimit(): Promise<{ success: boolean }> {
  await Promise.resolve();
  return { success: false };
}
async function verified(): Promise<Response> {
  await Promise.resolve();
  return Response.json({ metadata: { result_with_testing_key: true }, success: true });
}

async function signedAdminCookie(issued: number): Promise<string> {
  const encoder = new TextEncoder();
  const payload = `${issued}.${"a".repeat(32)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const signature = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `vd_admin=${payload}.${signature}`;
}

const migrations = [
  "0001_reports.sql",
  "0002_report_models.sql",
  "0003_model_catalogue.sql",
  "0004_catalogue_identities.sql",
];
const initialProvider = {
  active: true,
  id: CLAUDE,
  logo: "/logos/claude.svg",
  maker: "Anthropic",
  name: "Claude",
  slug: "claude",
  status: "https://status.claude.com",
  statusLabel: "Official status",
};

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
    ADMIN_RATE_LIMIT: { limit: allowLimit },
    DB: db,
    REPORT_RATE_LIMIT: { limit: allowLimit },
    TURNSTILE_HOSTNAME: "vibedetector.net",
    TURNSTILE_SITE_KEY: "0x4AAAAAAFROSyaakxb3TQIa",
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
  const observed1 = await loadModels(db);
  expect(observed1.length).toBe(55);
  const observed2 = await loadProviders(db);
  expect(observed2.length).toBe(10);
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
  expect(migrate(db, migrations[3] ?? "")).rejects.toThrow();
  expect(await db.prepare("SELECT model FROM reports").first<{ model: string }>()).toEqual({
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
  const observed3 = await handleApi(request("/api/providers/claude"), bindings(db));
  expect(observed3.status).toBe(404);
});

test("composite D1 ownership rejects cross-provider models even through direct SQL", async () => {
  const db = await database();
  const model = await firstModel(db);
  expect(saveReport(db, CHATGPT, "browser", "slow", Date.now(), model.id)).rejects.toThrow(
    "Invalid report model",
  );
  expect(
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
  const providers = await loadProviders(db);
  const provider = providers.find((entry: Provider) => entry.slug === "new-provider");
  if (!provider) {
    throw new Error("Missing created provider");
  }
  expect(isId(provider.id)).toBe(true);
  const observed4 = await handleApi(
    request("/api/admin/models", { name: "Generic model", provider: provider.id }, cookie),
    bindings(db),
  );
  expect(observed4.status).toBe(200);
  const model = await firstModel(db, provider.id);
  const observed5 = await handleApi(
    request("/api/admin/models/state", { active: false, id: model.id }, cookie),
    bindings(db),
  );
  expect(observed5.status).toBe(200);
  const observed6 = await handleApi(
    request("/api/admin/models/update", { id: model.id, name: "Renamed model" }, cookie),
    bindings(db),
  );
  expect(observed6.status).toBe(200);
  expect(await loadModels(db, provider.id)).toEqual([
    { active: false, id: model.id, name: "Renamed model", provider: provider.id },
  ]);
  const observed7 = await handleApi(
    request(
      "/api/admin/providers/update",
      { ...providerInput, id: provider.id, name: "Renamed provider" },
      cookie,
    ),
    bindings(db),
  );
  expect(observed7.status).toBe(200);
  const observed8 = await resolveProvider(db, provider.id);
  expect(observed8.name).toBe("Renamed provider");
  const observed9 = await handleApi(
    request("/api/admin/providers/state", { active: false, id: provider.id }, cookie),
    bindings(db),
  );
  expect(observed9.status).toBe(200);
  await Promise.all(
    ["providers", "models", "session", "reports"].map(async (route) => {
      const response = await handleApi(
        request(`/api/${route}/${provider.id}`, route === "reports" ? {} : undefined),
        bindings(db),
      );
      expect(response.status).toBe(404);
    }),
  );
  expect(dashboardFromDatabase(db, provider.slug, "24h", Date.now())).rejects.toThrow(
    "Unknown provider",
  );
  const observed10 = await overviewFromDatabase(db, Date.now());
  expect(observed10.some((entry) => entry.provider.id === provider.id)).toBe(false);
  const observed11 = await sitemap(db, "https://example.com/?a=1&b=2");
  expect(observed11.text()).resolves.not.toContain("new-provider");
  const observed12 = await loadModels(db, provider.id);
  expect(observed12.length).toBe(1);
  const observed13 = await handleApi(
    request("/api/admin/providers/state", { active: true, id: provider.id }, cookie),
    bindings(db),
  );
  expect(observed13.status).toBe(200);
  const observed14 = await resolveProvider(db, provider.slug);
  expect(observed14.id).toBe(provider.id);
});

test("provider URLs and slugs reject unsafe values and duplicate display values return 409", async () => {
  const db = await database();
  const cookie = await admin(db);
  const provider = initialProvider;
  if (!provider) {
    throw new Error("Missing provider seed");
  }
  await Promise.all(
    [
      "api",
      "admin",
      "privacy",
      "methodology",
      "robots.txt",
      "sitemap.xml",
      "UPPER",
      "../escape",
      "abcdefab-0000-4000-8000-000000000001",
    ].map(async (slug) => {
      const observed15 = await handleApi(
        request("/api/admin/providers", { ...provider, slug }, cookie),
        bindings(db),
      );
      expect(observed15.status).toBe(400);
    }),
  );
  expect(() =>
    parseProvider({ ...provider, status: ["javascript", "alert(1)"].join(":") }),
  ).toThrow();
  expect(() => parseProvider({ ...provider, logo: "/logos/../private.svg" })).toThrow();
  expect(() => parseProvider({ ...provider, logo: "http://example.com/logo.svg" })).toThrow();
  const observed16 = await handleApi(
    request("/api/admin/providers", provider, cookie),
    bindings(db),
  );
  expect(observed16.status).toBe(409);
  const model = await firstModel(db);
  const observed17 = await handleApi(
    request("/api/admin/models", { name: model.name, provider: CLAUDE }, cookie),
    bindings(db),
  );
  expect(observed17.status).toBe(409);
});

test("UUID lookup cannot be shadowed by a legacy slug or bypass provider archival", async () => {
  const db = await database();
  const target = "abcdefab-0000-4000-8000-000000000001";
  await db
    .prepare(
      "INSERT INTO providers SELECT ?, 'target-provider', name, maker, status, statusLabel, logo, 1, 10 FROM providers WHERE id = ?",
    )
    .bind(target, CLAUDE)
    .run();
  await db.prepare("UPDATE providers SET slug = ? WHERE id = ?").bind(target, CHATGPT).run();
  expect(await resolveProvider(db, target)).toMatchObject({ id: target, slug: "target-provider" });
  await db.prepare("UPDATE providers SET active = 0 WHERE id = ?").bind(target).run();
  const response = await handleApi(request(`/api/providers/${target}`), bindings(db));
  expect(response.status).toBe(404);
  expect(resolveProvider(db, target)).rejects.toThrow("Unknown provider");
  const archived = await resolveProvider(db, target, false);
  expect(archived.id).toBe(target);
});

test("atomic full-ID orders include archived records, competing orders and append safely", async () => {
  const db = await database();
  const models = await loadModels(db, CLAUDE);
  const ids = models.map((model) => model.id);
  const reverse = ids.toReversed();
  await db.prepare("UPDATE models SET active = 0 WHERE id = ?").bind(ids[0]).run();
  await orderCatalogue(db, { ids: reverse, provider: CLAUDE }, "models");
  const observed18 = await loadModels(db, CLAUDE);
  expect(observed18.map((model) => model.id)).toEqual(reverse);
  expect(orderCatalogue(db, { ids: reverse.slice(1), provider: CLAUDE }, "models")).rejects.toThrow(
    "Catalogue changed",
  );
  expect(
    orderCatalogue(db, { ids: [ids[0], ids[0]], provider: CLAUDE }, "models"),
  ).rejects.toThrow();
  await Promise.all([
    orderCatalogue(db, { ids, provider: CLAUDE }, "models"),
    orderCatalogue(db, { ids: reverse, provider: CLAUDE }, "models"),
  ]);
  const observed19 = await loadModels(db, CLAUDE);
  expect([ids, reverse]).toContainEqual(observed19.map((model) => model.id));
  const cookie = await admin(db);
  const observed20 = await handleApi(
    request("/api/admin/models", { name: "Appended", provider: CLAUDE }, cookie),
    bindings(db),
  );
  expect(observed20.status).toBe(200);
  const observed21 = await loadModels(db, CLAUDE);
  expect(observed21.at(-1)?.name).toBe("Appended");
  const observed22 = await loadProviders(db);
  const providers = observed22.map((provider) => provider.id).toReversed();
  await orderCatalogue(db, { ids: providers }, "providers");
  const observed23 = await loadProviders(db);
  expect(observed23.map((provider) => provider.id)).toEqual(providers);
  const oversized = new Request("http://localhost/api/admin/providers/order", {
    body: " ".repeat(262_145),
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost" },
    method: "POST",
  });
  const observed24 = await handleApi(oversized, bindings(db));
  expect(observed24.status).toBe(413);
});

test("archive model exception stays scoped to saved identity, provider, hour and retraction state", async () => {
  const db = await database();
  const model = await firstModel(db);
  const now = Math.floor(Date.now() / HOUR) * HOUR + 1000;
  await saveReport(db, CLAUDE, "owner", "slow", now, model.id);
  await db.prepare("UPDATE models SET active = 0 WHERE id = ?").bind(model.id).run();
  expect(await loadActiveModels(db, CLAUDE)).not.toContainEqual(model);
  const observed25 = await dashboardFromDatabase(db, CLAUDE, "24h", now, model.id);
  expect(observed25.model).toBe("");
  expect(saveReport(db, CLAUDE, "other", "slow", now, model.id)).rejects.toThrow();
  expect(saveReport(db, CLAUDE, "owner", "slow", now + HOUR, model.id)).rejects.toThrow();
  await saveReport(db, CLAUDE, "owner", "broken", now, model.id);
  await saveReport(db, CLAUDE, "owner", null, now, model.id);
  expect(saveReport(db, CLAUDE, "owner", "slow", now, model.id)).rejects.toThrow();
  await db.prepare("UPDATE providers SET active = 0 WHERE id = ?").bind(CLAUDE).run();
  expect(saveReport(db, CLAUDE, "owner", null, now, model.id)).rejects.toThrow();
});

test("HTTP reports return UUIDs and restore them through the same signed browser identity", async () => {
  const db = await database();
  const model = await firstModel(db);
  const env = bindings(db);
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
  expect(await report.json<{ category: string; model: string }>()).toEqual({
    category: "slow",
    model: model.id,
  });
  const observed26 = await handleApi(request(`/api/session/${CLAUDE}`, undefined, cookie), env);
  const restored: unknown = await observed26.json();
  expect(restored).toMatchObject({ category: "slow", model: model.id });
  const observed27 = await handleApi(
    request(
      "/api/reports/claude",
      { category: "slow", model: model.name, token: "dummy", window },
      cookie,
    ),
    env,
    verified,
  );
  expect(observed27.status).toBe(400);
  const observed28 = await handleApi(
    request(
      "/api/reports/claude",
      { category: "slow", token: "dummy", window: window - 1 },
      cookie,
    ),
    env,
    verified,
  );
  expect(observed28.status).toBe(409);
  const observed29 = await handleApi(
    request("/api/reports/claude", { category: "slow", token: "dummy", window }, cookie),
    env,
    async () => {
      await Promise.resolve();
      return Response.json({ success: false });
    },
  );
  expect(observed29.status).toBe(403);
  const observed30 = await handleApi(
    request("/api/reports/claude", { category: "slow", token: "dummy", window }, cookie),
    { ...env, REPORT_RATE_LIMIT: { limit: denyLimit } },
    verified,
  );
  expect(observed30.status).toBe(429);
});

test("admin authentication and CSRF stay fail closed for both catalogues", async () => {
  const db = await database();
  const env = bindings(db);
  const observed31 = await handleApi(request("/api/admin/providers"), env);
  expect(observed31.status).toBe(401);
  const observed32 = await handleApi(request("/api/admin/models"), env);
  expect(observed32.status).toBe(401);
  const observed33 = await handleApi(request("/api/admin/login", { key: "wrong" }), env);
  expect(observed33.status).toBe(401);
  const observed34 = await handleApi(
    request("/api/admin/login", { key: SECRET }, "", "https://attacker.com"),
    env,
  );
  expect(observed34.status).toBe(403);
  const cookie = await admin(db);
  const observed35 = await handleApi(
    request("/api/admin/providers", undefined, cookie.slice(0, -2)),
    env,
  );
  expect(observed35.status).toBe(401);
  const observed36 = await handleApi(
    request(
      "/api/admin/providers/state",
      { active: false, id: CLAUDE },
      cookie,
      "https://attacker.com",
    ),
    env,
  );
  expect(observed36.status).toBe(403);
  const observed37 = await handleApi(request("/api/admin/providers", undefined, cookie), {
    ...env,
    ADMIN_KEY: "a-different-secret-that-is-long-enough-to-use",
  });
  expect(observed37.status).toBe(401);
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
  expect(readJson(request("/api/reports/claude", {}, "", "https://attacker.com"))).rejects.toThrow(
    "Origin rejected",
  );
  const oversizedBody = { padding: "x".repeat(5000) };
  expect(readJson(request("/api/reports/claude", oversizedBody))).rejects.toThrow("Body too large");
  const config = {
    hostname: "example.com",
    local: false,
    secret: "production-secret",
    siteKey: "production-site-key",
  };
  expect(
    verifyChallenge(config, "token", async () => {
      await Promise.resolve();
      return Response.json({ action: "wrong", hostname: "example.com", success: true });
    }),
  ).rejects.toThrow("Challenge rejected");
  await verifyChallenge(config, "token", async () => {
    await Promise.resolve();
    return Response.json({ action: "report", hostname: "example.com", success: true });
  });
  const db = await database();
  expect(() => challengeConfig(bindings(db), "example.com")).toThrow("Reporting is not configured");
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
  const provider = initialProvider;
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

test("catalogue limits, duplicate names and streamed body limits are enforced at the API boundary", async () => {
  const db = await database();
  const cookie = await admin(db);
  const existing = await firstModel(db);
  const observed1 = await handleApi(
    request("/api/admin/models", { name: existing.name, provider: existing.provider }, cookie),
    bindings(db),
  );
  expect(observed1.status).toBe(409);
  const createdNames = Array.from({ length: 250 }, (_value, index) => `Cap model ${index}`);
  const responses = await Promise.all(
    createdNames.map(async (name) =>
      handleApi(request("/api/admin/models", { name, provider: CLAUDE }, cookie), bindings(db)),
    ),
  );
  expect(responses.filter((response) => response.status === 200)).toHaveLength(250);
  const observed2 = await loadModels(db, CLAUDE);
  expect(observed2.length).toBe(256);
  const capped = await handleApi(
    request("/api/admin/models", { name: "Over cap", provider: CLAUDE }, cookie),
    bindings(db),
  );
  expect(capped.status).toBe(400);
  const smallBody = new Request("http://localhost/api/admin/models", {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"name":"Streamed"'));
        controller.enqueue(new TextEncoder().encode(",".repeat(17_000)));
        controller.close();
      },
    }),
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost" },
    method: "POST",
  });
  const observed3 = await handleApi(smallBody, bindings(db));
  expect(observed3.status).toBe(413);
  const observed4 = await loadModels(db, CLAUDE);
  const largeOrder = new Request("http://localhost/api/admin/models/order", {
    body:
      JSON.stringify({ ids: observed4.map((model) => model.id), provider: CLAUDE }) +
      " ".repeat(262_145),
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost" },
    method: "POST",
  });
  const observed5 = await handleApi(largeOrder, bindings(db));
  expect(observed5.status).toBe(413);
});

test("actual Miniflare Worker transport signs admin sessions and returns UUID catalogue rows", async () => {
  const bundle = await Bun.build({
    entrypoints: [new URL("../src/server/api.ts", import.meta.url).pathname],
    external: ["node:crypto"],
    target: "node",
  });
  expect(bundle.success).toBe(true);
  const [output] = bundle.outputs;
  if (!output) {
    throw new Error("Missing Worker bundle");
  }
  const script = `${await output.text()}\nexport default { fetch(request, env) { return handleApi(request, env); } };`;
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          bindings: { ADMIN_KEY: SECRET },
          compatibilityDate: "2026-10-08",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          modules: true,
          ratelimits: {
            ADMIN_RATE_LIMIT: { namespace_id: "874164", simple: { limit: 100, period: 60 } },
          },
          script,
        },
      ],
    }),
  );
  runtimes.push(runtime);
  const { DB: db } = await runtime.getBindings<{ DB: D1Database }>();
  for (const filename of migrations) {
    // Migrations depend on preceding schema versions.
    // oxlint-disable-next-line eslint/no-await-in-loop
    await migrate(db, filename);
  }
  // Miniflare's Bun type replacement misidentifies Fetcher as Request; runtime exposes fetch.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const worker = (await runtime.getWorker()) as unknown as {
    fetch: (input: string, init?: RequestInit) => Promise<Response>;
  };
  const login = await worker.fetch("https://localhost/api/admin/login", {
    body: JSON.stringify({ key: SECRET }),
    headers: {
      "CF-Connecting-IP": "192.0.2.10",
      "Content-Type": "application/json",
      Origin: "https://localhost",
    },
    method: "POST",
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("Set-Cookie")?.split(";")[0] ?? "";
  expect(cookie).toMatch(/^vd_admin=\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/u);
  const catalogue = await worker.fetch("https://localhost/api/admin/models", {
    headers: { Cookie: cookie },
  });
  expect(catalogue.status).toBe(200);
  const rows = await catalogue.json<ModelOption[]>();
  expect(rows.length).toBe(55);
  expect(rows.every((row) => isId(row.id) && isId(row.provider))).toBe(true);
});

test("admin rate limits, configuration, future signatures, expiry, rotation and HTTPS fail closed", async () => {
  const db = await database();
  const env = bindings(db);
  const missingKey = { ...env };
  delete missingKey.ADMIN_KEY;
  const missingLimiter = { ...env };
  delete missingLimiter.ADMIN_RATE_LIMIT;
  const oversizedKey = "x".repeat(1025);
  const statuses = await Promise.all([
    handleApi(request("/api/admin/login", { key: SECRET }), missingKey),
    handleApi(request("/api/admin/login", { key: SECRET }), missingLimiter),
    handleApi(request("/api/admin/login", { key: SECRET }), {
      ...env,
      ADMIN_RATE_LIMIT: { limit: denyLimit },
    }),
    handleApi(request("/api/admin/login", { key: oversizedKey }), env),
  ]);
  expect(statuses.map((response) => response.status)).toEqual([503, 503, 429, 400]);
  const future = await signedAdminCookie(Date.now() + HOUR);
  const expired = await signedAdminCookie(Date.now() - HOUR);
  const valid = await signedAdminCookie(Date.now());
  const signedResponses = await Promise.all(
    [future, expired, valid].map(async (cookie) =>
      handleApi(request("/api/admin/providers", undefined, cookie), env),
    ),
  );
  expect(signedResponses.map((response) => response.status)).toEqual([401, 401, 200]);
  const rotated = await handleApi(request("/api/admin/providers", undefined, valid), {
    ...env,
    ADMIN_KEY: "rotated-admin-secret-that-is-over-32-characters",
  });
  expect(rotated.status).toBe(401);
  const insecure = await handleApi(
    new Request("http://example.com/api/admin/providers", { headers: { Cookie: valid } }),
    env,
  );
  expect(insecure.status).toBe(403);
  const secure = await handleApi(
    new Request("https://localhost/api/admin/login", {
      body: JSON.stringify({ key: SECRET }),
      headers: {
        "CF-Connecting-IP": "127.0.0.1",
        "Content-Type": "application/json",
        Origin: "https://localhost",
      },
      method: "POST",
    }),
    env,
  );
  expect(secure.headers.get("Set-Cookie")).toContain("Secure");
});

test("concurrent provider creation stops at 256 and stale orders never change positions", async () => {
  const db = await database();
  await db
    .prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 245)
    INSERT INTO providers SELECT '20000000-0000-4000-8000-' || printf('%012d', i), 'cap-provider-' || i, 'Cap provider ' || i, 'Maker', 'https://example.com', 'Status', '/logos/claude.svg', 1, i + 10 FROM n`)
    .run();
  const cookie = await admin(db);
  const responses = await Promise.all(
    ["racing-a", "racing-b"].map(async (slug) =>
      handleApi(
        request("/api/admin/providers", { ...initialProvider, slug }, cookie),
        bindings(db),
      ),
    ),
  );
  const responseStatuses = responses
    .map((response) => response.status)
    .toSorted((left, right) => left - right);
  expect(responseStatuses).toEqual([200, 400]);
  const providers = await loadProviders(db);
  expect(providers).toHaveLength(256);
  const staleIds = providers
    .slice(1)
    .map((provider) => provider.id)
    .toReversed();
  const attempt = orderCatalogue(db, { ids: staleIds }, "providers");
  expect(attempt).rejects.toThrow("Catalogue changed");
  const after = await loadProviders(db);
  expect(after.map((provider) => provider.id)).toEqual(providers.map((provider) => provider.id));
  const positions = await db
    .prepare("SELECT position FROM providers ORDER BY position")
    .all<{ position: number }>();
  expect(new Set(positions.results.map((row) => row.position)).size).toBe(256);
});

test("streaming JSON enforces byte limits and media type without trusting Content-Length", () => {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await Promise.resolve();
      controller.enqueue(new Uint8Array(2048));
      controller.enqueue(new Uint8Array(2049));
      controller.close();
    },
  });
  const streamed = new Request("http://localhost/api/reports/claude", {
    body,
    headers: {
      "Content-Length": "1",
      "Content-Type": "application/json",
      Origin: "http://localhost",
    },
    method: "POST",
  });
  expect(readJson(streamed)).rejects.toThrow("Body too large");
  const text = new Request("http://localhost/api/reports/claude", {
    body: "{}",
    headers: { "Content-Type": "text/plain", Origin: "http://localhost" },
    method: "POST",
  });
  expect(readJson(text)).rejects.toThrow("Expected application/json");
  const invalid = new Request("http://localhost/api/reports/claude", {
    body: "{",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    method: "POST",
  });
  expect(readJson(invalid)).rejects.toThrow("Invalid JSON");
});

test("every D1 model filter keeps literal provider baseline, hourly total and verdict", async () => {
  const db = await database();
  const models = await loadModels(db, CLAUDE);
  const [first, second] = models;
  if (!first || !second) {
    throw new Error("Missing seeded models");
  }
  const now = 100 * HOUR + 2000;
  await db.batch([
    db
      .prepare("INSERT INTO reports VALUES (?, 'history', 1, ?, 'slow', NULL)")
      .bind(CLAUDE, now - 49 * HOUR),
    db
      .prepare(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 240) INSERT INTO reports SELECT ?, 'baseline-' || i, i, ?, 'slow', ? FROM n",
      )
      .bind(CLAUDE, 98 * HOUR, first.id),
    db
      .prepare(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 25) INSERT INTO reports SELECT ?, 'current-' || i, i, ?, 'broken', ? FROM n",
      )
      .bind(CLAUDE, now - 1000, second.id),
  ]);
  const filters = ["", "unspecified", ...models.map((model) => model.id)];
  const dashboards = await Promise.all(
    filters.map(async (filter) => dashboardFromDatabase(db, CLAUDE, "24h", now, filter)),
  );
  expect(
    dashboards.map((dashboard) => [dashboard.hourly, dashboard.baseline, dashboard.verdict]),
  ).toEqual(filters.map(() => [25, 5, "killed the vibe"]));
  const selected = await dashboardFromDatabase(db, CLAUDE, "24h", now, second.id);
  expect(selected.buckets.reduce((sum, bucket) => sum + bucket.broken, 0)).toBe(25);
  expect(selected.buckets.reduce((sum, bucket) => sum + bucket.slow, 0)).toBe(0);
});
