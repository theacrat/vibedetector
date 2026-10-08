import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

import { providers } from "../src/domain";
import { aggregate } from "../src/server/aggregation";
import { handleApi } from "../src/server/api";
import {
  ApiError,
  browserIdentity,
  challengeConfig,
  readJson,
  verifyChallenge,
} from "../src/server/security";
import type { VerifyFetch } from "../src/server/security";
import {
  HOUR,
  loadReports,
  retainReports,
  saveReport,
  sessionCategory,
} from "../src/server/storage";

async function database(): Promise<{ db: D1Database; sqlite: Database }> {
  const sqlite = new Database(":memory:");
  sqlite.exec(await Bun.file(new URL("../migrations/0001_reports.sql", import.meta.url)).text());
  const db = {
    prepare(sql: string) {
      let args: (string | number | null)[] = [];
      const statement = {
        async all() {
          return { success: true, results: sqlite.query(sql).all(...args) };
        },
        bind(...values: (string | number | null)[]) {
          args = values;
          return statement;
        },
        async first() {
          return sqlite.query(sql).get(...args);
        },
        async run() {
          sqlite.query(sql).run(...args);
          return { success: true };
        },
      };
      return statement;
    },
  } as D1Database;
  return { db, sqlite };
}

test("atomic retry, switching, retraction and next-hour reporting preserve the first timestamp", async () => {
  const { db, sqlite } = await database();
  const now = 100 * HOUR + 10;
  await Promise.all(
    Array.from({ length: 20 }, async () => saveReport(db, "claude", "hash", "nerfed", now)),
  );
  await saveReport(db, "claude", "hash", "slow", now + 1000);
  expect(await loadReports(db, "claude", now + 2000)).toEqual([
    { category: "slow", created_at: now },
  ]);
  await saveReport(db, "claude", "hash", null, now + 2000);
  expect(await sessionCategory(db, "claude", "hash", now)).toBeNull();
  await saveReport(db, "claude", "hash", "broken", now + 3000);
  await saveReport(db, "claude", "hash", "slow", now + HOUR);
  expect(await loadReports(db, "claude", now + HOUR)).toEqual([
    { category: "broken", created_at: now },
    { category: "slow", created_at: now + HOUR },
  ]);
  sqlite.close();
});

test("UTC buckets, trailing hour and baseline thresholds use real reports", () => {
  const provider = providers[0];
  const now = 100 * HOUR + HOUR / 2;
  const empty = aggregate(provider, "24h", [], now);
  expect(empty.hourly).toBe(0);
  expect(empty.verdict).toBe("insufficient community data");
  expect(empty.buckets).toHaveLength(48);
  expect(empty.buckets[47]?.t).toBe(now);
  const reports = [
    { category: null, created_at: 51 * HOUR },
    ...Array.from({ length: 100 }, (_, index) => ({
      category: "slow" as const,
      created_at: (52 + (index % 48)) * HOUR,
    })),
    { category: "broken" as const, created_at: now - 10 },
  ];
  const dashboard = aggregate(provider, "6h", reports, now);
  expect(dashboard.baseline).toBe(100 / 48);
  expect(dashboard.hourly).toBe(1);
  expect(dashboard.verdict).toBe("no report spike");
  expect(dashboard.buckets[23]?.broken).toBe(0);
  expect(dashboard.buckets[22]?.broken).toBe(1);
  expect(aggregate(provider, "7d", reports.slice(1), now).baseline).toBe(100 / 48);
  expect(aggregate(provider, "7d", reports.slice(2), now).baseline).toBeNull();
});

test("bounded retention deletes at most 5000 expired rows and keeps recent rows", async () => {
  const { db, sqlite } = await database();
  const insert = sqlite.prepare("INSERT INTO reports VALUES (?, ?, ?, ?, ?)");
  for (let index = 0; index < 5002; index++) {
    insert.run("claude", `hash${index}`, 0, 0, null);
  }
  insert.run("claude", "recent", 200, 200 * HOUR, "slow");
  await retainReports(db, 200 * HOUR);
  expect(sqlite.query("SELECT COUNT(*) AS n FROM reports").get()).toEqual({ n: 3 });
  await retainReports(db, 200 * HOUR);
  expect(await loadReports(db, "claude", 200 * HOUR)).toEqual([
    { category: "slow", created_at: 200 * HOUR },
  ]);
  sqlite.close();
});

test("identity is random, hashed, HttpOnly, host-only and reusable", async () => {
  const first = await browserIdentity(new Request("https://vibedetector.net"));
  expect(first.cookie).toContain("HttpOnly");
  expect(first.cookie).toContain("Secure");
  expect(first.cookie).not.toContain("Domain=");
  expect(first.cookie).not.toContain(first.hash);
  const second = await browserIdentity(
    new Request("https://vibedetector.net", { headers: { Cookie: first.cookie!.split(";")[0]! } }),
  );
  expect(second.hash).toBe(first.hash);
  expect(second.cookie).toBeNull();
});

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

test("body rejects foreign origin, wrong content type, malformed JSON and oversized streams", async () => {
  await expect(readJson(post("{}", { Origin: "https://evil.invalid" }))).rejects.toMatchObject({
    status: 403,
  });
  await expect(readJson(post("{}", { "Content-Type": "text/plain" }))).rejects.toMatchObject({
    status: 415,
  });
  await expect(readJson(post("{"))).rejects.toMatchObject({ status: 400 });
  await expect(readJson(post("x".repeat(4097)))).rejects.toMatchObject({ status: 413 });
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(3000));
      controller.enqueue(new Uint8Array(1097));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://localhost/api/reports/claude", {
    method: "POST",
    body: stream,
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
  });
  await expect(readJson(request)).rejects.toMatchObject({ status: 413 });
  expect(cancelled).toBe(true);
});

test("Turnstile validates success, hostname, action and fails closed on outages", async () => {
  const config = { hostname: "vibedetector.net", local: false, secret: "real", siteKey: "real" };
  for (const result of [
    { success: false },
    { action: "report", hostname: "evil.invalid", success: true },
    { action: "other", hostname: config.hostname, success: true },
  ]) {
    await expect(
      verifyChallenge(config, "token", async () => Response.json(result)),
    ).rejects.toBeInstanceOf(ApiError);
  }
  await expect(
    verifyChallenge(config, "token", async () => {
      throw new Error("offline");
    }),
  ).rejects.toMatchObject({ status: 503 });
  await verifyChallenge(config, "token", async () =>
    Response.json({ action: "report", hostname: config.hostname, success: true }),
  );
  expect(() => challengeConfig({} as Cloudflare.Env, "vibedetector.net")).toThrow("not configured");
});

test("API exercises session, challenge, persistence, rate limit and failure responses", async () => {
  const { db, sqlite } = await database();
  let challenges = 0;
  let limited = false;
  const bindings = {
    DB: db,
    REPORT_RATE_LIMIT: {
      async limit() {
        return { success: !limited };
      },
    },
    TURNSTILE_HOSTNAME: "vibedetector.net",
    TURNSTILE_SITE_KEY: "",
  } as Cloudflare.Env;
  const verify: VerifyFetch = async () => {
    challenges++;
    return Response.json({ action: "test", hostname: "localhost", success: true });
  };
  const session = await handleApi(new Request("http://localhost/api/session/claude"), bindings);
  expect((await session.json()) as unknown).toEqual({
    category: null,
    siteKey: "1x00000000000000000000AA",
  });
  expect(session.headers.get("Cache-Control")).toBe("no-store");
  const cookie = session.headers.get("Set-Cookie")!.split(";")[0]!;
  const response = await handleApi(
    post(JSON.stringify({ category: "slow", token: "dummy" }), { Cookie: cookie }),
    bindings,
    verify,
  );
  expect((await response.json()) as unknown).toEqual({ category: "slow" });
  expect(challenges).toBe(1);
  const failedChallenge = await handleApi(
    post('{"category":"broken","token":"dummy"}', { Cookie: cookie }),
    bindings,
    async () => Response.json({ success: false }),
  );
  expect(failedChallenge.status).toBe(403);
  const afterFailure = await handleApi(
    new Request("http://localhost/api/session/claude", { headers: { Cookie: cookie } }),
    bindings,
  );
  expect((await afterFailure.json()) as unknown).toEqual({
    category: "slow",
    siteKey: "1x00000000000000000000AA",
  });
  const missingRateLimit = { ...bindings };
  Reflect.deleteProperty(missingRateLimit, "REPORT_RATE_LIMIT");
  expect(
    (await handleApi(post('{"category":null,"token":"dummy"}'), missingRateLimit, verify)).status,
  ).toBe(503);
  const missingSecret = await handleApi(
    new Request("https://vibedetector.net/api/session/claude"),
    bindings,
  );
  expect(missingSecret.status).toBe(503);
  const dashboard = await handleApi(new Request("http://localhost/api/providers/claude"), bindings);
  expect(((await dashboard.json()) as { hourly: number }).hourly).toBe(1);
  limited = true;
  expect(
    (await handleApi(post('{"category":null,"token":"dummy"}'), bindings, verify)).status,
  ).toBe(429);
  expect(challenges).toBe(1);
  expect(
    (await handleApi(new Request("http://localhost/api/providers/unknown"), bindings)).status,
  ).toBe(404);
  expect(
    (await handleApi(new Request("http://localhost/api/providers/claude?range=bad"), bindings))
      .status,
  ).toBe(400);
  expect(
    (await handleApi(post('{"category":"other","token":"dummy"}'), bindings, verify)).status,
  ).toBe(400);
  sqlite.close();
  const failure = await handleApi(new Request("http://localhost/api/overview"), bindings);
  expect(failure.status).toBe(503);
  expect((await failure.json()) as unknown).toEqual({ error: "Service unavailable" });
});
