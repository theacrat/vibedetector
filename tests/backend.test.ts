/* oxlint-disable unicorn/no-null -- SQL and JSON use null for unspecified metadata and retractions. */
import { afterAll, expect, test } from "bun:test";

import { convertV4MiniflareOptions, Miniflare } from "miniflare";

import { providerModels, providers } from "@/domain";
import { aggregate } from "@/server/aggregation";
import { handleApi } from "@/server/api";
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
  await db.prepare("UPDATE reports SET model = 'GPT-6.1 Sol'").run();
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
  expect(invalidFilter.status).toBe(400);
  const undo = await handleApi(request(null, "Claude Sonnet 5.5"), bindings, verify);
  const undoBody: unknown = await undo.json();
  expect(undoBody).toEqual({ category: null, model: "Claude Sonnet 5.5" });
  const unspecified = await handleApi(request("slow", null), bindings, verify);
  const unspecifiedBody: unknown = await unspecified.json();
  expect(unspecifiedBody).toEqual({ category: "slow", model: null });
});
