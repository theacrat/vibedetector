/* oxlint-disable unicorn/no-null -- SQL and JSON use null for unspecified metadata and retractions. */
import { afterAll, expect, test } from "bun:test";

import { initialModels as providerModels } from "@seed/models";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

import { providers } from "@/domain";
import { aggregate } from "@/server/aggregation";
import { handleApi } from "@/server/api";
import { loadModels, orderModels } from "@/server/catalogue";
import { dashboardFromDatabase } from "@/server/queries";
import { browserIdentity, challengeConfig, readJson, verifyChallenge } from "@/server/security";
import type { VerifyFetch } from "@/server/security";
import { HOUR, loadReports, retainReports, saveReport, sessionReport } from "@/server/storage";

const runtimes: Miniflare[] = [];
afterAll(async () => {
  await Promise.all(runtimes.map(async (runtime) => runtime.dispose()));
});

async function migrateModels(db: D1Database): Promise<void> {
  const migration = await Bun.file(
    new URL("../migrations/0002_report_models.sql", import.meta.url),
  ).text();
  await db.batch(
    migration
      .split(";")
      .filter((sql) => sql.trim() !== "")
      .map((sql) => db.prepare(sql)),
  );
  const catalogue = await Bun.file(
    new URL("../migrations/0003_model_catalogue.sql", import.meta.url),
  ).text();
  await db.batch(
    catalogue
      .split(";")
      .filter((sql) => sql.trim() !== "")
      .map((sql) => db.prepare(sql)),
  );
}

async function database(includeModels = true): Promise<D1Database> {
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
  const migration = await Bun.file(
    new URL("../migrations/0001_reports.sql", import.meta.url),
  ).text();
  await db.batch(
    migration
      .split(";")
      .filter((sql) => sql.trim() !== "")
      .map((sql) => db.prepare(sql)),
  );
  if (includeModels) {
    await migrateModels(db);
  }
  return db;
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/reports/claude", {
    body,
    headers: {
      "CF-Connecting-IP": "127.0.0.1",
      "Content-Type": "application/json",
      Origin: "http://localhost",
      ...headers,
    },
    method: "POST",
  });
}

function cookieHeader(response: Response): string {
  const cookie = response.headers.get("Set-Cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error("Expected identity cookie");
  }
  return cookie;
}

function reportPost(
  category: string | null,
  cookie = "",
  window = Math.floor(Date.now() / HOUR),
): Request {
  return post(JSON.stringify({ category, token: "dummy", window }), { Cookie: cookie });
}

async function mockResponse(body: unknown): Promise<Response> {
  const response = await Promise.resolve(Response.json(body));
  return response;
}

const successfulVerify: VerifyFetch = async () =>
  mockResponse({
    hostname: "example.com",
    metadata: { result_with_testing_key: true },
    success: true,
  });

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "Did not reject";
  } catch (error) {
    return error instanceof Error ? error.message : "Unknown error";
  }
}

async function errorStatus(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    throw new Error("Expected rejection");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof error.status === "number"
    ) {
      return error.status;
    }
    throw error;
  }
}

test("D1 atomic upsert retries preserve timestamps across switches and retractions", async () => {
  const db = await database();
  const now = 100 * HOUR + 10;
  await Promise.all(
    Array.from({ length: 20 }, async () => saveReport(db, "claude", "hash", "nerfed", now)),
  );
  await saveReport(db, "claude", "hash", "slow", now + 1000);
  expect(await loadReports(db, "claude", now + 2000)).toEqual([
    { category: "slow", created_at: now, model: null },
  ]);
  // SQL NULL is the persisted retraction state, not an omitted parameter.
  await saveReport(db, "claude", "hash", null, now + 2000);
  const retracted = await sessionReport(db, "claude", "hash", now);
  expect(retracted.category).toBeNull();
  await saveReport(db, "claude", "hash", "broken", now + 3000);
  await saveReport(db, "claude", "hash", "slow", now + HOUR);
  expect(await loadReports(db, "claude", now + HOUR)).toEqual([
    { category: "broken", created_at: now, model: null },
    { category: "slow", created_at: now + HOUR, model: null },
  ]);
});

test("UTC buckets, actual trailing hour and baseline thresholds", () => {
  const [provider] = providers;
  const now = 100 * HOUR + HOUR / 2;
  const empty = aggregate(provider, "24h", [], now);
  expect(empty.hourly).toBe(0);
  expect(empty.verdict).toBe("insufficient community data");
  expect(empty.buckets).toHaveLength(49);
  expect(empty.buckets[48]?.t).toBe(now);
  const reports = [
    ...Array.from({ length: 100 }, (_value, index) => ({
      category: "slow" as const,
      created_at: (52 + (index % 48)) * HOUR,
    })),
    { category: "broken" as const, created_at: now - 10 },
  ];
  const dashboard = aggregate(provider, "6h", reports, now);
  expect(dashboard.baseline).toBe(100 / 48);
  expect(dashboard.hourly).toBe(1);
  expect(dashboard.verdict).toBe("no report spike");
  expect(dashboard.buckets[23]?.broken).toBe(1);
  expect(aggregate(provider, "7d", reports.slice(1), now).baseline).toBeNull();
});

test("D1 retention drains more than 5000 expired rows in bounded batches", async () => {
  const db = await database();
  await db
    .prepare(`WITH RECURSIVE ids(value) AS (SELECT 0 UNION ALL SELECT value + 1 FROM ids WHERE value < 5001)
    INSERT INTO reports (provider, identity_hash, window, created_at, category) SELECT 'claude', CAST(value AS TEXT), 0, 0, NULL FROM ids`)
    .run();
  await saveReport(db, "claude", "recent", "slow", 200 * HOUR);
  await retainReports(db, 200 * HOUR);
  expect(await db.prepare("SELECT COUNT(*) AS total FROM reports").first<number>("total")).toBe(1);
  await retainReports(db, 200 * HOUR);
  expect(await loadReports(db, "claude", 200 * HOUR)).toEqual([
    { category: "slow", created_at: 200 * HOUR, model: null },
  ]);
});

test("identity is hashed, HttpOnly, host-only and reused", async () => {
  const first = await browserIdentity(new Request("https://vibedetector.net"));
  expect(first.cookie).toContain("HttpOnly");
  expect(first.cookie).toContain("Secure");
  expect(first.cookie).not.toContain("Domain=");
  expect(first.cookie).not.toContain(first.hash);
  if (!first.cookie) {
    throw new Error("Missing identity");
  }
  const second = await browserIdentity(
    new Request("https://vibedetector.net", { headers: { Cookie: first.cookie } }),
  );
  expect(second.hash).toBe(first.hash);
  expect(second.cookie).toBeNull();
});

test("boundary rejects foreign origin, non-JSON and oversized streamed bodies", async () => {
  const foreign = post("{}", { Origin: "https://evil.invalid" });
  const wrongType = post("{}", { "Content-Type": "text/plain" });
  const malformed = post("{");
  expect(await errorStatus(readJson(foreign))).toBe(403);
  expect(await errorStatus(readJson(wrongType))).toBe(415);
  expect(await errorStatus(readJson(malformed))).toBe(400);
  const oversized = "x".repeat(4097);
  const oversizedRequest = post(oversized);
  expect(await errorStatus(readJson(oversizedRequest))).toBe(413);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
    start(controller) {
      controller.enqueue(new Uint8Array(3000));
      controller.enqueue(new Uint8Array(1097));
    },
  });
  const request = new Request("http://localhost/api/reports/claude", {
    body: stream,
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    method: "POST",
  });
  expect(await errorStatus(readJson(request))).toBe(413);
  expect(cancelled).toBe(true);
});

test("Turnstile checks hostname/action and fails closed", async () => {
  const config = { hostname: "vibedetector.net", local: false, secret: "real", siteKey: "real" };
  await Promise.all(
    [
      { success: false },
      { action: "report", hostname: "evil.invalid", success: true },
      { action: "other", hostname: config.hostname, success: true },
    ].map(async (result) => {
      const verify: VerifyFetch = async () => mockResponse(result);
      expect(await errorStatus(verifyChallenge(config, "token", verify))).toBe(403);
    }),
  );
  expect(
    await errorStatus(
      verifyChallenge(config, "token", async () => {
        await Promise.resolve();
        throw new Error("offline");
      }),
    ),
  ).toBe(503);
  await verifyChallenge(config, "token", async () =>
    mockResponse({ action: "report", hostname: config.hostname, success: true }),
  );
});

test("live dummy Siteverify shape is accepted only for exact local test keys", async () => {
  const db = await database();
  const bindings: Cloudflare.Env = {
    DB: db,
    REPORT_RATE_LIMIT: {
      async limit() {
        const success = await Promise.resolve(true);
        return { success };
      },
    },
    TURNSTILE_HOSTNAME: "vibedetector.net",
    TURNSTILE_SITE_KEY: "0x4AAAAAAFROSyaakxb3TQIa",
  };
  const config = challengeConfig(bindings, "localhost");
  expect(config.siteKey).toBe("1x00000000000000000000AA");
  const result = {
    challenge_ts: "2026-10-08T20:00:00Z",
    "error-codes": [],
    hostname: "example.com",
    metadata: { result_with_testing_key: true },
    success: true,
  };
  const verify: VerifyFetch = async () => mockResponse(result);
  await verifyChallenge(config, "XXXX.DUMMY.TOKEN.XXXX", verify);
  expect(await errorStatus(verifyChallenge({ ...config, local: false }, "dummy", verify))).toBe(
    403,
  );
  expect(await errorStatus(verifyChallenge({ ...config, secret: "real" }, "dummy", verify))).toBe(
    403,
  );
  const noMetadata: VerifyFetch = async () =>
    mockResponse({ hostname: result.hostname, success: true });
  expect(await errorStatus(verifyChallenge(config, "dummy", noMetadata))).toBe(403);
  expect(() => challengeConfig(bindings, "vibedetector.net")).toThrow("not configured");
});

test("API persists reports and fails closed on challenge, rate-limit and database errors", async () => {
  const db = await database();
  let challenges = 0;
  let limited = false;
  const bindings: Cloudflare.Env = {
    DB: db,
    REPORT_RATE_LIMIT: {
      async limit() {
        const success = await Promise.resolve(!limited);
        return { success };
      },
    },
    TURNSTILE_HOSTNAME: "vibedetector.net",
    TURNSTILE_SITE_KEY: "0x4AAAAAAFROSyaakxb3TQIa",
  };
  const verify: VerifyFetch = async () => {
    challenges += 1;
    return mockResponse({
      hostname: "example.com",
      metadata: { result_with_testing_key: true },
      success: true,
    });
  };
  const session = await handleApi(new Request("http://localhost/api/session/claude"), bindings);
  const sessionBody: unknown = await session.json();
  // The session API uses JSON null for no active report.
  expect(sessionBody).toEqual({
    category: null,
    model: null,
    models: await loadModels(db, "claude"),
    siteKey: "1x00000000000000000000AA",
    window: Math.floor(Date.now() / HOUR),
  });
  expect(session.headers.get("Cache-Control")).toBe("no-store");
  const cookie = cookieHeader(session);
  const response = await handleApi(reportPost("slow", cookie), bindings, verify);
  const responseBody: unknown = await response.json();
  expect(responseBody).toEqual({ category: "slow", model: null });
  expect(challenges).toBe(1);
  const expiredWindow = Math.floor(Date.now() / HOUR) - 1;
  const stale = await handleApi(reportPost("broken", cookie, expiredWindow), bindings, verify);
  expect(stale.status).toBe(409);
  expect(challenges).toBe(1);
  const dashboardResponse = await handleApi(
    new Request("http://localhost/api/providers/claude"),
    bindings,
  );
  const dashboardBody: unknown = await dashboardResponse.json();
  expect(dashboardBody).toMatchObject({ hourly: 1, verdict: "insufficient community data" });
  const failedChallenge = await handleApi(reportPost("broken", cookie), bindings, async () =>
    mockResponse({ success: false }),
  );
  expect(failedChallenge.status).toBe(403);
  const afterFailure = await handleApi(
    new Request("http://localhost/api/session/claude", { headers: { Cookie: cookie } }),
    bindings,
  );
  const afterBody: unknown = await afterFailure.json();
  expect(afterBody).toEqual({
    category: "slow",
    model: null,
    models: await loadModels(db, "claude"),
    siteKey: "1x00000000000000000000AA",
    window: Math.floor(Date.now() / HOUR),
  });
  const missingRateLimit = { ...bindings };
  Reflect.deleteProperty(missingRateLimit, "REPORT_RATE_LIMIT");
  const missing = await handleApi(reportPost("slow"), missingRateLimit, verify);
  expect(missing.status).toBe(503);
  const production = await handleApi(
    new Request("https://vibedetector.net/api/session/claude"),
    bindings,
  );
  expect(production.status).toBe(503);
  limited = true;
  const throttled = await handleApi(reportPost("slow"), bindings, verify);
  expect(throttled.status).toBe(429);
  expect(challenges).toBe(1);
  const unknown = await handleApi(new Request("http://localhost/api/providers/unknown"), bindings);
  expect(unknown.status).toBe(404);
  const invalidRange = await handleApi(
    new Request("http://localhost/api/providers/claude?range=bad"),
    bindings,
  );
  expect(invalidRange.status).toBe(400);
  const invalidCategory = await handleApi(reportPost("other"), bindings, verify);
  expect(invalidCategory.status).toBe(400);
  await db.prepare("DROP TABLE reports").run();
  const failure = await handleApi(new Request("http://localhost/api/overview"), bindings);
  expect(failure.status).toBe(503);
  const failureBody: unknown = await failure.json();
  expect(failureBody).toEqual({ error: "Service unavailable" });
});

test("storage rejects corrupt categories and timestamps at the D1 boundary", async () => {
  const db = await database();
  await db.prepare("PRAGMA ignore_check_constraints = ON").run();
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO reports (provider, identity_hash, window, created_at, category) VALUES ('claude', 'bad', ?, ?, 'invalid')",
    )
    .bind(Math.floor(now / HOUR), now)
    .run();
  let rejected = false;
  try {
    await loadReports(db, "claude", now);
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
  await db.prepare("DROP TABLE reports").run();
  await db
    .prepare(
      "CREATE TABLE reports (provider TEXT, identity_hash TEXT, window INTEGER, created_at TEXT, category TEXT, model TEXT)",
    )
    .run();
  await db
    .prepare("INSERT INTO reports VALUES ('claude', 'bad', ?, ?, 'slow', NULL)")
    .bind(Math.floor(now / HOUR), String(now))
    .run();
  rejected = false;
  try {
    await loadReports(db, "claude", now);
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
});

test("additive model migration preserves old active and retracted rows", async () => {
  const db = await database(false);
  await db
    .prepare(
      "INSERT INTO reports VALUES ('claude', 'old', 100, ?, 'slow'), ('claude', 'undo', 100, ?, NULL)",
    )
    .bind(100 * HOUR, 100 * HOUR + 1)
    .run();
  await migrateModels(db);
  expect(await loadReports(db, "claude", 100 * HOUR + 10)).toEqual([
    { category: "slow", created_at: 100 * HOUR, model: null },
    { category: null, created_at: 100 * HOUR + 1, model: null },
  ]);
  await saveReport(db, "claude", "old", "broken", 100 * HOUR + 10, "Claude Opus 5.5");
  expect(await sessionReport(db, "claude", "old", 100 * HOUR + 20)).toEqual({
    category: "broken",
    model: "Claude Opus 5.5",
  });
  expect(await db.prepare("SELECT COUNT(*) AS total FROM reports").first<number>("total")).toBe(2);
  const indexes = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reports' ORDER BY name",
    )
    .all<{ name: string }>();
  expect(indexes.results).toEqual([
    { name: "reports_provider_time" },
    { name: "reports_retention" },
  ]);
  await saveReport(db, "zai", "new", "slow", 100 * HOUR + 30, "GLM-5.3");
  await saveReport(db, "kimi", "new", "broken", 100 * HOUR + 40, "Kimi K3");
  expect(await loadReports(db, "zai", 100 * HOUR + 50)).toEqual([
    { category: "slow", created_at: 100 * HOUR + 30, model: "GLM-5.3" },
  ]);
  expect(await loadReports(db, "kimi", 100 * HOUR + 50)).toEqual([
    { category: "broken", created_at: 100 * HOUR + 40, model: "Kimi K3" },
  ]);
});

test("D1 model metadata changes preserve deduplication, timestamps and retraction", async () => {
  const db = await database();
  const now = 100 * HOUR + 10;
  expect(await saveReport(db, "claude", "browser", "slow", now, "Claude Opus 5.5")).toBe("slow");
  await saveReport(db, "claude", "browser", "nerfed", now + 10, "Claude Sonnet 5.5");
  expect(await loadReports(db, "claude", now + 20)).toEqual([
    { category: "nerfed", created_at: now, model: "Claude Sonnet 5.5" },
  ]);
  await saveReport(db, "claude", "browser", null, now + 30, "Claude Sonnet 5.5");
  expect(await sessionReport(db, "claude", "browser", now + 40)).toEqual({
    category: null,
    model: "Claude Sonnet 5.5",
  });
  const retracted = await dashboardFromDatabase(db, "claude", "24h", now + 40);
  expect(retracted.hourly).toBe(0);
  await saveReport(db, "claude", "browser", "broken", now + 50);
  expect(await sessionReport(db, "claude", "browser", now + 60)).toEqual({
    category: "broken",
    model: null,
  });
  expect(
    await rejectionMessage(saveReport(db, "claude", "browser", "slow", now + 70, "GPT-6.1 Sol")),
  ).toBe("Invalid report model");
  expect(await loadReports(db, "claude", now + 80)).toEqual([
    { category: "broken", created_at: now, model: null },
  ]);
  await db.prepare("UPDATE reports SET model = ''").run();
  expect(await rejectionMessage(loadReports(db, "claude", now + 90))).toBe("Invalid stored model");
  expect(await rejectionMessage(sessionReport(db, "claude", "browser", now + 90))).toBe(
    "Invalid stored model",
  );
});

test("every model filter keeps literal provider totals, baseline and verdict on real D1", async () => {
  const db = await database();
  const now = 100 * HOUR + HOUR / 2;
  await saveReport(db, "claude", "history", "slow", 50 * HOUR);
  await db.batch(
    Array.from({ length: 120 }, (_value, index) =>
      db
        .prepare(
          "INSERT INTO reports (provider, identity_hash, window, created_at, category, model) VALUES ('claude', ?, 99, ?, 'slow', ?)",
        )
        .bind(`baseline-${index}`, 99 * HOUR, index % 2 === 0 ? "Claude Opus 5.5" : null),
    ),
  );
  await db.batch(
    Array.from({ length: 24 }, (_value, index) =>
      db
        .prepare(
          "INSERT INTO reports (provider, identity_hash, window, created_at, category, model) VALUES ('claude', ?, 100, ?, 'broken', ?)",
        )
        .bind(`current-${index}`, now - 10, index < 12 ? "Claude Sonnet 5.5" : null),
    ),
  );
  for (const range of ["6h", "24h", "7d"] as const) {
    for (const model of ["", "unspecified", ...providerModels.claude]) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      const dashboard = await dashboardFromDatabase(db, "claude", range, now, model);
      expect({
        baseline: dashboard.baseline,
        hourly: dashboard.hourly,
        verdict: dashboard.verdict,
      }).toEqual({ baseline: 2.5, hourly: 24, verdict: "killed the vibe" });
      expect(dashboard.model).toBe(model);
      const counts = { broken: 0, slow: 0 };
      for (const bucket of dashboard.buckets) {
        counts.broken += bucket.broken;
        counts.slow += bucket.slow;
      }
      const expected: Record<string, { broken: number; slow: number }> = {
        "": { broken: 24, slow: range === "7d" ? 121 : 120 },
        "Claude Opus 5.5": { broken: 0, slow: 60 },
        "Claude Sonnet 5.5": { broken: 12, slow: 0 },
        unspecified: { broken: 12, slow: range === "7d" ? 61 : 60 },
      };
      expect(counts).toEqual(expected[model] ?? { broken: 0, slow: 0 });
    }
  }
});

test("all model filters preserve provider insufficient-data and spike thresholds", () => {
  const [provider] = providers;
  const now = 100 * HOUR + HOUR / 2;
  const historical = [
    { category: "slow" as const, created_at: 50 * HOUR },
    ...Array.from({ length: 120 }, () => ({
      category: "slow" as const,
      created_at: 99 * HOUR,
      model: "Claude Opus 5.5",
    })),
  ];
  for (const model of ["", "unspecified", ...providerModels.claude]) {
    const insufficient = aggregate(
      provider,
      "24h",
      [{ category: "broken", created_at: now, model: "Claude Opus 5.5" }],
      now,
      model,
    );
    expect({
      baseline: insufficient.baseline,
      hourly: insufficient.hourly,
      verdict: insufficient.verdict,
    }).toEqual({ baseline: null, hourly: 1, verdict: "insufficient community data" });
    for (const [current, verdict] of [
      [1, "no report spike"],
      [10, "vibes are off"],
      [20, "killed the vibe"],
    ] as const) {
      const dashboard = aggregate(
        provider,
        "24h",
        [
          ...historical,
          ...Array.from({ length: current }, () => ({
            category: "broken" as const,
            created_at: now,
            model: "Claude Sonnet 5.5",
          })),
        ],
        now,
        model,
      );
      expect({
        baseline: dashboard.baseline,
        hourly: dashboard.hourly,
        verdict: dashboard.verdict,
      }).toEqual({ baseline: 2.5, hourly: current, verdict });
    }
  }
});

test("HTTP model persistence, validation and challenge failure keep saved state", async () => {
  const db = await database();
  const bindings: Cloudflare.Env = {
    DB: db,
    REPORT_RATE_LIMIT: {
      async limit() {
        const success = await Promise.resolve(true);
        return { success };
      },
    },
    TURNSTILE_HOSTNAME: "vibedetector.net",
    TURNSTILE_SITE_KEY: "0x4AAAAAAFROSyaakxb3TQIa",
  };
  const verify = successfulVerify;
  const session = await handleApi(new Request("http://localhost/api/session/claude"), bindings);
  const cookie = cookieHeader(session);
  const window = Math.floor(Date.now() / HOUR);
  const request = (category: string | null, model: unknown) =>
    post(JSON.stringify({ category, model, token: "dummy", window }), { Cookie: cookie });
  const response = await handleApi(request("slow", "Claude Opus 5.5"), bindings, verify);
  const responseBody: unknown = await response.json();
  expect(responseBody).toEqual({ category: "slow", model: "Claude Opus 5.5" });
  const reload = await handleApi(
    new Request("http://localhost/api/session/claude", { headers: { Cookie: cookie } }),
    bindings,
  );
  const reloadBody: unknown = await reload.json();
  expect(reloadBody).toEqual({
    category: "slow",
    model: "Claude Opus 5.5",
    models: await loadModels(db, "claude"),
    siteKey: "1x00000000000000000000AA",
    window,
  });
  const switchResponse = await handleApi(request("broken", "Claude Sonnet 5.5"), bindings, verify);
  const switchBody: unknown = await switchResponse.json();
  expect(switchBody).toEqual({ category: "broken", model: "Claude Sonnet 5.5" });
  for (const model of ["GPT-6.1 Sol", "unspecified", "", 42, {}]) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const invalid = await handleApi(request("nerfed", model), bindings, verify);
    expect(invalid.status).toBe(400);
  }
  const denied = await handleApi(request("slow", "Claude Opus 5.5"), bindings, async () =>
    mockResponse({ success: false }),
  );
  expect(denied.status).toBe(403);
  const persisted = await handleApi(
    new Request("http://localhost/api/session/claude", { headers: { Cookie: cookie } }),
    bindings,
  );
  const persistedBody: unknown = await persisted.json();
  expect(persistedBody).toMatchObject({ category: "broken", model: "Claude Sonnet 5.5" });
  const filtered = await handleApi(
    new Request("http://localhost/api/providers/claude?model=Claude%20Opus%205.5"),
    bindings,
  );
  const filteredBody: unknown = await filtered.json();
  expect(filteredBody).toMatchObject({
    hourly: 1,
    model: "Claude Opus 5.5",
    verdict: "insufficient community data",
  });
  const invalidFilter = await handleApi(
    new Request("http://localhost/api/providers/claude?model=GPT-6.1%20Sol"),
    bindings,
  );
  expect(invalidFilter.status).toBe(200);
  const invalidFilterBody: unknown = await invalidFilter.json();
  expect(invalidFilterBody).toMatchObject({ model: "" });
  const undo = await handleApi(request(null, "Claude Sonnet 5.5"), bindings, verify);
  const undoBody: unknown = await undo.json();
  expect(undoBody).toEqual({ category: null, model: "Claude Sonnet 5.5" });
  const unspecified = await handleApi(request("slow", null), bindings, verify);
  const unspecifiedBody: unknown = await unspecified.json();
  expect(unspecifiedBody).toEqual({ category: "slow", model: null });
});

const adminKey = "a-secret-used-only-for-tests-123456789";

function adminRequest(
  path: string,
  body?: unknown,
  cookie = "",
  origin = "http://localhost",
): Request {
  return new Request(`http://localhost/api/admin/${path}`, {
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

async function apiStatus(
  request: Request,
  bindings: Cloudflare.Env,
  verify: VerifyFetch = successfulVerify,
): Promise<number> {
  const response = await handleApi(request, bindings, verify);
  return response.status;
}

async function migrateModelsCatalogue(db: D1Database): Promise<void> {
  const sql = await Bun.file(
    new URL("../migrations/0003_model_catalogue.sql", import.meta.url),
  ).text();
  await db.batch(
    sql
      .split(";")
      .filter((statement) => statement.trim() !== "")
      .map((statement) => db.prepare(statement)),
  );
}

function adminBindings(db: D1Database): Cloudflare.Env {
  return {
    ADMIN_KEY: adminKey,
    ADMIN_RATE_LIMIT: {
      async limit() {
        return { success: await Promise.resolve(true) };
      },
    },
    DB: db,
    REPORT_RATE_LIMIT: {
      async limit() {
        return { success: await Promise.resolve(true) };
      },
    },
    TURNSTILE_HOSTNAME: "vibedetector.net",
    TURNSTILE_SITE_KEY: "0x4AAAAAAFROSyaakxb3TQIa",
  };
}

test("admin fails closed, bounds keys, requires origin and limits login attempts separately", async () => {
  const bindings = adminBindings(await database());
  expect(await apiStatus(adminRequest("models"), bindings)).toBe(401);
  expect(
    await apiStatus(adminRequest("models", { name: "new", provider: "claude" }), bindings),
  ).toBe(401);
  expect(await apiStatus(adminRequest("login", { key: "wrong" }), bindings)).toBe(401);
  const oversizedKey = "x".repeat(1025);
  const oversizedBody = "x".repeat(5000);
  expect(await apiStatus(adminRequest("login", { key: oversizedKey }), bindings)).toBe(400);
  expect(await apiStatus(adminRequest("login", { key: oversizedBody }), bindings)).toBe(413);
  expect(
    await apiStatus(adminRequest("login", { key: adminKey }, "", "https://evil.invalid"), bindings),
  ).toBe(403);
  expect(
    await apiStatus(adminRequest("login", { key: adminKey }), { ...bindings, ADMIN_KEY: "short" }),
  ).toBe(503);
  const missing = { ...bindings };
  Reflect.deleteProperty(missing, "ADMIN_RATE_LIMIT");
  expect(await apiStatus(adminRequest("login", { key: adminKey }), missing)).toBe(503);
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          modules: true,
          ratelimits: {
            ADMIN_RATE_LIMIT: { namespace_id: "874164", simple: { limit: 2, period: 60 } },
          },
          script: "export default { fetch() { return new Response('ok'); } }",
        },
      ],
    }),
  );
  runtimes.push(runtime);
  const limits = await runtime.getBindings<{ ADMIN_RATE_LIMIT: RateLimit }>();
  const limited = { ...bindings, ADMIN_RATE_LIMIT: limits.ADMIN_RATE_LIMIT };
  expect(await apiStatus(adminRequest("login", { key: "wrong" }), limited)).toBe(401);
  expect(await apiStatus(adminRequest("login", { key: "wrong" }), limited)).toBe(401);
  expect(await apiStatus(adminRequest("login", { key: adminKey }), limited)).toBe(429);
});

test("admin cookie signatures, expiry, rotation, HTTPS and logout are enforced", async () => {
  const bindings = adminBindings(await database());
  const response = await handleApi(adminRequest("login", { key: adminKey }), bindings);
  expect(response.status).toBe(200);
  const cookie = cookieHeader(response);
  expect(response.headers.get("Set-Cookie")).toContain("HttpOnly; SameSite=Strict; Max-Age=3600");
  expect(response.headers.get("Set-Cookie")).not.toContain("Domain=");
  expect(cookie).not.toContain(adminKey);
  expect(await apiStatus(adminRequest("models", undefined, cookie), bindings)).toBe(200);
  expect(
    await apiStatus(adminRequest("models", undefined, cookie, "https://evil.invalid"), bindings),
  ).toBe(403);
  const crossSite = new Request("http://localhost/api/admin/models", {
    headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" },
  });
  expect(await apiStatus(crossSite, bindings)).toBe(403);
  const absentOrigin = new Request("http://localhost/api/admin/models", {
    headers: { Cookie: cookie },
  });
  expect(await apiStatus(absentOrigin, bindings)).toBe(200);
  const corrupt = `${cookie.slice(0, -1)}z`;
  expect(await apiStatus(adminRequest("models", undefined, corrupt), bindings)).toBe(401);
  expect(
    await apiStatus(adminRequest("models", undefined, cookie), {
      ...bindings,
      ADMIN_KEY: "rotated-test-key-12345678901234567890",
    }),
  ).toBe(401);
  const issued = `${Date.now() - HOUR - 1}`;
  const payload = `${issued}.${"0".repeat(32)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(adminKey),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const signature = Array.from(new Uint8Array(signed), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  expect(
    await apiStatus(
      adminRequest("models", undefined, `vd_admin=${payload}.${signature}`),
      bindings,
    ),
  ).toBe(401);
  const secure = await handleApi(
    new Request("https://vibedetector.net/api/admin/login", {
      body: JSON.stringify({ key: adminKey }),
      headers: {
        "CF-Connecting-IP": "127.0.0.1",
        "Content-Type": "application/json",
        Origin: "https://vibedetector.net",
      },
      method: "POST",
    }),
    bindings,
  );
  expect(secure.headers.get("Set-Cookie")).toContain("Secure");
  const insecure = await handleApi(
    new Request("http://vibedetector.net/api/admin/login", {
      body: JSON.stringify({ key: adminKey }),
      headers: {
        "CF-Connecting-IP": "127.0.0.1",
        "Content-Type": "application/json",
        Origin: "http://vibedetector.net",
      },
      method: "POST",
    }),
    bindings,
  );
  expect(insecure.status).toBe(403);
  const logout = await handleApi(adminRequest("logout", {}, cookie), bindings);
  expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
});

test("admin login and signed sessions execute inside the actual Workers runtime", async () => {
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
          bindings: { ADMIN_KEY: adminKey },
          compatibilityDate: "2026-10-08",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          modules: true,
          ratelimits: {
            ADMIN_RATE_LIMIT: { namespace_id: "874164", simple: { limit: 5, period: 60 } },
          },
          script,
        },
      ],
    }),
  );
  runtimes.push(runtime);
  const { DB: db } = await runtime.getBindings<{ DB: D1Database }>();
  await migrateModelsCatalogue(db);
  // Miniflare's Bun type replacement misidentifies Fetcher as Request; the runtime exposes fetch.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const worker = (await runtime.getWorker()) as unknown as {
    fetch: (input: string, init?: RequestInit) => Promise<Response>;
  };
  const login = await worker.fetch("https://localhost/api/admin/login", {
    body: JSON.stringify({ key: adminKey }),
    headers: {
      "CF-Connecting-IP": "192.0.2.99",
      "Content-Type": "application/json",
      Origin: "https://localhost",
    },
    method: "POST",
  });
  const loginBody: unknown = await login.json();
  expect(loginBody).toEqual({ authenticated: true });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("Set-Cookie")?.split(";")[0] ?? "";
  expect(cookie).toMatch(/^vd_admin=\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/u);
  const catalogue = await worker.fetch("https://localhost/api/admin/models", {
    headers: { Cookie: cookie },
  });
  expect(catalogue.status).toBe(200);
  const rows: unknown = await catalogue.json();
  expect(rows).toContainEqual({ active: true, name: "GPT-6 Astra", provider: "chatgpt" });
});

test("catalogue additions and states persist without reseeding and preserve archived history", async () => {
  const db = await database();
  const bindings = adminBindings(db);
  const login = await handleApi(adminRequest("login", { key: adminKey }), bindings);
  const cookie = cookieHeader(login);
  const model = { name: "Claude Future", provider: "claude" } as const;
  const add = await handleApi(adminRequest("models", model, cookie), bindings);
  expect(add.status).toBe(200);
  expect(add.headers.get("Cache-Control")).toBe("no-store");
  expect(
    await apiStatus(
      adminRequest("models/state", { ...model, active: false }, cookie, "https://evil.invalid"),
      bindings,
    ),
  ).toBe(403);
  for (const name of ["", "unspecified", "ALL", " x", "x".repeat(121), "bad\nname"]) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const status = await apiStatus(
      adminRequest("models", { name, provider: "claude" }, cookie),
      bindings,
    );
    expect(status).toBe(400);
  }
  const session = await handleApi(new Request("http://localhost/api/session/claude"), bindings);
  const identity = cookieHeader(session);
  const window = Math.floor(Date.now() / HOUR);
  const report = (category: string | null) =>
    post(JSON.stringify({ category, model: model.name, token: "dummy", window }), {
      Cookie: identity,
    });
  expect(await apiStatus(report("slow"), bindings)).toBe(200);
  expect(
    await apiStatus(adminRequest("models/state", { ...model, active: false }, cookie), bindings),
  ).toBe(200);
  expect(await apiStatus(adminRequest("models", model, cookie), bindings)).toBe(200);
  expect(await loadModels(db, "claude")).toContainEqual({ ...model, active: false });
  const choices = await handleApi(
    new Request("http://localhost/api/session/claude", { headers: { Cookie: identity } }),
    bindings,
  );
  const choiceBody: unknown = await choices.json();
  expect(choiceBody).toMatchObject({
    category: "slow",
    model: model.name,
    models: providerModels.claude.map((name) => ({ active: true, name, provider: "claude" })),
  });
  expect(await apiStatus(report("slow"), bindings)).toBe(200);
  const historical = await dashboardFromDatabase(db, "claude", "24h", Date.now(), model.name);
  expect(historical.model).toBe("");
  expect(historical.buckets.reduce((total, bucket) => total + bucket.slow, 0)).toBe(1);
  expect(historical.models).toEqual(
    providerModels.claude.map((name) => ({ active: true, name, provider: "claude" })),
  );
  const publicModels = await handleApi(new Request("http://localhost/api/models/claude"), bindings);
  const publicBody: unknown = await publicModels.json();
  expect(publicBody).toEqual(
    providerModels.claude.map((name) => ({ active: true, name, provider: "claude" })),
  );
  expect(await apiStatus(report(null), bindings)).toBe(200);
  expect(await apiStatus(report("broken"), bindings)).toBe(400);
  expect(
    await apiStatus(adminRequest("models/state", { ...model, active: true }, cookie), bindings),
  ).toBe(200);
  expect(await apiStatus(report("broken"), bindings)).toBe(200);
  const restoredModels = await handleApi(
    new Request("http://localhost/api/models/claude"),
    bindings,
  );
  const restoredBody: unknown = await restoredModels.json();
  expect(restoredBody).toContainEqual({ ...model, active: true });
  await db
    .prepare("UPDATE models SET active = 0 WHERE provider = 'chatgpt' AND name = 'GPT-6 Astra'")
    .run();
  await migrateModelsCatalogue(db);
  expect(await loadModels(db, "chatgpt")).toContainEqual({
    active: false,
    name: "GPT-6 Astra",
    provider: "chatgpt",
  });
});

test("archived and arbitrary named graph requests normalize to all without changing provider metrics", async () => {
  const db = await database();
  const bindings = adminBindings(db);
  const now = Date.now();
  await saveReport(db, "claude", "archived", "slow", now - 10, "Claude Opus 5.5");
  await saveReport(db, "claude", "active", "broken", now - 10, "Claude Sonnet 5.5");
  await db
    .prepare("UPDATE models SET active = 0 WHERE provider = 'claude' AND name = 'Claude Opus 5.5'")
    .run();
  for (const name of ["Claude Opus 5.5", "arbitrary old model"]) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const response = await handleApi(
      new Request(`http://localhost/api/providers/claude?model=${encodeURIComponent(name)}`),
      bindings,
    );
    // oxlint-disable-next-line eslint/no-await-in-loop
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      baseline: null,
      hourly: 2,
      model: "",
      verdict: "insufficient community data",
    });
    // oxlint-disable-next-line eslint/no-await-in-loop
    const dashboard = await dashboardFromDatabase(db, "claude", "24h", now, name);
    expect(dashboard.model).toBe("");
    expect(
      dashboard.buckets.reduce((total, bucket) => total + bucket.slow + bucket.broken, 0),
    ).toBe(2);
  }
  const active = await dashboardFromDatabase(db, "claude", "24h", now, "Claude Sonnet 5.5");
  expect(active.model).toBe("Claude Sonnet 5.5");
  expect(active.buckets.reduce((total, bucket) => total + bucket.slow + bucket.broken, 0)).toBe(1);
  expect(active.hourly).toBe(2);
  expect(await loadReports(db, "claude", now)).toHaveLength(2);
});

test("admin order persists full provider permutations, rejects invalid requests without writes and appends new models", async () => {
  const db = await database();
  await db
    .prepare(
      "DELETE FROM models WHERE provider = 'claude' AND name NOT IN ('Claude Opus 5.5', 'Claude Sonnet 5.5')",
    )
    .run();
  const bindings = adminBindings(db);
  const login = await handleApi(adminRequest("login", { key: adminKey }), bindings);
  const cookie = cookieHeader(login);
  await handleApi(
    adminRequest("models", { name: "Claude Archived", provider: "claude" }, cookie),
    bindings,
  );
  await handleApi(
    adminRequest(
      "models/state",
      { active: false, name: "Claude Archived", provider: "claude" },
      cookie,
    ),
    bindings,
  );
  const before = await db
    .prepare(
      "SELECT provider, name, active, position FROM models ORDER BY provider, position, name",
    )
    .all();
  const names = ["Claude Sonnet 5.5", "Claude Archived", "Claude Opus 5.5"];
  for (const body of [
    { names: ["Claude Sonnet 5.5", "Claude Opus 5.5"], provider: "claude" },
    { names: ["Claude Archived", "Claude Archived", "Claude Opus 5.5"], provider: "claude" },
    { names: ["GPT-6 Astra", "Claude Archived", "Claude Opus 5.5"], provider: "claude" },
    { names: ["Unknown", "Claude Archived", "Claude Opus 5.5"], provider: "claude" },
    { names, provider: "unknown" },
    { names: "bad", provider: "claude" },
    { names: [1, "Claude Archived", "Claude Opus 5.5"], provider: "claude" },
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    expect(await apiStatus(adminRequest("models/order", body, cookie), bindings)).toBe(400);
    // oxlint-disable-next-line eslint/no-await-in-loop
    const unchanged = await db
      .prepare(
        "SELECT provider, name, active, position FROM models ORDER BY provider, position, name",
      )
      .all();
    expect(unchanged.results).toEqual(before.results);
  }
  const order = { names, provider: "claude" };
  expect(await apiStatus(adminRequest("models/order", order), bindings)).toBe(401);
  expect(
    await apiStatus(adminRequest("models/order", order, cookie, "https://evil.invalid"), bindings),
  ).toBe(403);
  const absentOrigin = adminRequest("models/order", order, cookie);
  absentOrigin.headers.delete("Origin");
  expect(await apiStatus(absentOrigin, bindings)).toBe(403);
  expect(await apiStatus(adminRequest("models/order", undefined, cookie), bindings)).toBe(405);
  expect(await apiStatus(adminRequest("models/order", order, cookie), bindings)).toBe(200);
  expect(await apiStatus(adminRequest("models/order", order, cookie), bindings)).toBe(200);
  const ordered = await db
    .prepare("SELECT name, position FROM models WHERE provider = 'claude' ORDER BY position")
    .all();
  expect(ordered.results).toEqual([
    { name: "Claude Sonnet 5.5", position: 0 },
    { name: "Claude Archived", position: 1 },
    { name: "Claude Opus 5.5", position: 2 },
  ]);
  const other = await db
    .prepare(
      "SELECT provider, name, active, position FROM models WHERE provider != 'claude' ORDER BY provider, position, name",
    )
    .all();
  expect(other.results).toEqual(before.results.filter((row) => row["provider"] !== "claude"));
  const reload = await handleApi(adminRequest("models", undefined, cookie), bindings);
  const reloadBody: unknown = await reload.json();
  expect(reloadBody).toContainEqual({ active: false, name: "Claude Archived", provider: "claude" });
  const reloadedModels = await loadModels(db, "claude");
  expect(reloadedModels.map((model) => model.name)).toEqual(names);
  const publicList = await handleApi(new Request("http://localhost/api/models/claude"), bindings);
  const publicBody: unknown = await publicList.json();
  expect(publicBody).toEqual([
    { active: true, name: "Claude Sonnet 5.5", provider: "claude" },
    { active: true, name: "Claude Opus 5.5", provider: "claude" },
  ]);
  const dashboard = await dashboardFromDatabase(db, "claude", "24h", Date.now());
  expect(publicBody).toEqual(dashboard.models);
  const session = await handleApi(new Request("http://localhost/api/session/claude"), bindings);
  const sessionBody: unknown = await session.json();
  expect(sessionBody).toMatchObject({ models: publicBody });
  await Promise.all(
    ["Claude New A", "Claude New B"].map(async (name) => {
      expect(
        await apiStatus(adminRequest("models", { name, provider: "claude" }, cookie), bindings),
      ).toBe(200);
    }),
  );
  const appended = await db
    .prepare("SELECT name, position FROM models WHERE provider = 'claude' ORDER BY position")
    .all<{ name: string; position: number }>();
  expect(ordered.results).toEqual(appended.results.slice(0, 3));
  expect(
    appended.results
      .slice(3)
      .map((row) => row.name)
      .toSorted(),
  ).toEqual(["Claude New A", "Claude New B"]);
  expect(appended.results.map((row) => row.position)).toEqual([0, 1, 2, 3, 4]);
});

test("catalogue changes between order validation and D1 batch leave all positions untouched", async () => {
  const db = await database();
  await db
    .prepare(
      "DELETE FROM models WHERE provider = 'claude' AND name NOT IN ('Claude Opus 5.5', 'Claude Sonnet 5.5')",
    )
    .run();
  const guardedDb = new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          await target
            .prepare(
              "INSERT INTO models (provider, name, active, position) VALUES ('claude', 'Concurrent model', 1, 99)",
            )
            .run();
          return target.batch(statements);
        };
      }
      const value: unknown = Reflect.get(target, property);
      return value;
    },
  });
  expect(
    await errorStatus(
      orderModels(guardedDb, {
        names: ["Claude Sonnet 5.5", "Claude Opus 5.5"],
        provider: "claude",
      }),
    ),
  ).toBe(400);
  const rows = await db
    .prepare("SELECT name, position FROM models WHERE provider = 'claude' ORDER BY position")
    .all();
  expect(rows.results).toEqual([
    { name: "Claude Opus 5.5", position: 0 },
    { name: "Claude Sonnet 5.5", position: 1 },
    { name: "Concurrent model", position: 99 },
  ]);
});
