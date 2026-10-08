import { afterAll, expect, test } from "bun:test";

import { convertV4MiniflareOptions, Miniflare } from "miniflare";

import { providers } from "@/domain";
import { aggregate } from "@/server/aggregation";
import { handleApi } from "@/server/api";
import { browserIdentity, challengeConfig, readJson, verifyChallenge } from "@/server/security";
import type { VerifyFetch } from "@/server/security";
import { HOUR, loadReports, retainReports, saveReport, sessionCategory } from "@/server/storage";

const runtimes: Miniflare[] = [];
afterAll(async () => {
  await Promise.all(runtimes.map(async (runtime) => runtime.dispose()));
});

async function database(): Promise<D1Database> {
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
    { category: "slow", created_at: now },
  ]);
  // SQL NULL is the persisted retraction state, not an omitted parameter.
  // oxlint-disable-next-line unicorn/no-null
  await saveReport(db, "claude", "hash", null, now + 2000);
  expect(await sessionCategory(db, "claude", "hash", now)).toBeNull();
  await saveReport(db, "claude", "hash", "broken", now + 3000);
  await saveReport(db, "claude", "hash", "slow", now + HOUR);
  expect(await loadReports(db, "claude", now + HOUR)).toEqual([
    { category: "broken", created_at: now },
    { category: "slow", created_at: now + HOUR },
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
    INSERT INTO reports SELECT 'claude', CAST(value AS TEXT), 0, 0, NULL FROM ids`)
    .run();
  await saveReport(db, "claude", "recent", "slow", 200 * HOUR);
  await retainReports(db, 200 * HOUR);
  expect(await db.prepare("SELECT COUNT(*) AS total FROM reports").first<number>("total")).toBe(1);
  await retainReports(db, 200 * HOUR);
  expect(await loadReports(db, "claude", 200 * HOUR)).toEqual([
    { category: "slow", created_at: 200 * HOUR },
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
    TURNSTILE_SITE_KEY: "",
  };
  const config = challengeConfig(bindings, "localhost");
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
    TURNSTILE_SITE_KEY: "",
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
    // oxlint-disable-next-line unicorn/no-null
    category: null,
    siteKey: "1x00000000000000000000AA",
    window: Math.floor(Date.now() / HOUR),
  });
  expect(session.headers.get("Cache-Control")).toBe("no-store");
  const cookie = cookieHeader(session);
  const response = await handleApi(reportPost("slow", cookie), bindings, verify);
  const responseBody: unknown = await response.json();
  expect(responseBody).toEqual({ category: "slow" });
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
    .prepare("INSERT INTO reports VALUES ('claude', 'bad', ?, ?, 'invalid')")
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
      "CREATE TABLE reports (provider TEXT, identity_hash TEXT, window INTEGER, created_at TEXT, category TEXT)",
    )
    .run();
  await db
    .prepare("INSERT INTO reports VALUES ('claude', 'bad', ?, ?, 'slow')")
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
