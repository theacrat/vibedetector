import { findProvider, isCategory, isRange, providers } from "../domain";
import { aggregate } from "./aggregation";
import { ApiError, browserIdentity, challengeConfig, readJson, verifyChallenge } from "./security";
import type { VerifyFetch } from "./security";
import { loadReports, saveReport, sessionCategory } from "./storage";

function json(value: unknown, status = 200, cookie: string | null = null): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  if (cookie) {
    headers.set("Set-Cookie", cookie);
  }
  return new Response(JSON.stringify(value), { headers, status });
}

export async function handleApi(
  request: Request,
  bindings: Cloudflare.Env,
  verifyFetch: VerifyFetch = fetch,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const now = Date.now();
    if (url.pathname === "/api/overview") {
      if (request.method !== "GET") {
        throw new ApiError(405, "Method not allowed");
      }
      return json(
        await Promise.all(
          providers.map(async (provider) => {
            const dashboard = aggregate(
              provider,
              "24h",
              await loadReports(bindings.DB, provider.id, now),
              now,
            );
            return { buckets: dashboard.buckets, hourly: dashboard.hourly, provider };
          }),
        ),
      );
    }
    const match = /^\/api\/(providers|session|reports)\/([^/]+)$/.exec(url.pathname);
    if (!match) {
      throw new ApiError(404, "Not found");
    }
    const route = match[1];
    const provider = findProvider(match[2] ?? "");
    if (!provider) {
      throw new ApiError(404, "Unknown provider");
    }
    if (request.method !== (route === "reports" ? "POST" : "GET")) {
      throw new ApiError(405, "Method not allowed");
    }
    if (route === "providers") {
      const range = url.searchParams.get("range") ?? "24h";
      if (!isRange(range)) {
        throw new ApiError(400, "Invalid range");
      }
      return json(
        aggregate(provider, range, await loadReports(bindings.DB, provider.id, now), now),
      );
    }
    const config = challengeConfig(bindings, url.hostname);
    if (route === "session") {
      const identity = await browserIdentity(request);
      return json(
        {
          category: await sessionCategory(bindings.DB, provider.id, identity.hash, now),
          siteKey: config.siteKey,
        },
        200,
        identity.cookie,
      );
    }
    const body = await readJson(request);
    if (
      !body ||
      typeof body !== "object" ||
      !("category" in body) ||
      (body.category !== null && !isCategory(body.category)) ||
      !("token" in body) ||
      typeof body.token !== "string" ||
      !body.token ||
      body.token.length > 2048
    ) {
      throw new ApiError(400, "Invalid report");
    }
    if (!bindings.REPORT_RATE_LIMIT) {
      throw new ApiError(503, "Reporting rate limiter unavailable");
    }
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip) {
      throw new ApiError(503, "Reporting rate limiter unavailable");
    }
    if (!(await bindings.REPORT_RATE_LIMIT.limit({ key: ip })).success) {
      throw new ApiError(429, "Too many reports");
    }
    await verifyChallenge(config, body.token, verifyFetch);
    const identity = await browserIdentity(request);
    return json(
      {
        category: await saveReport(
          bindings.DB,
          provider.id,
          identity.hash,
          body.category,
          Date.now(),
        ),
      },
      200,
      identity.cookie,
    );
  } catch (error) {
    return error instanceof ApiError
      ? json({ error: error.message }, error.status)
      : json({ error: "Service unavailable" }, 503);
  }
}
