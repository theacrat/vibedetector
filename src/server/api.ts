import { findProvider, isCategory, isRange } from "@/domain";
import type { Category, ProviderId } from "@/domain";

import { dashboardFromDatabase, overviewFromDatabase } from "./queries";
import { ApiError, browserIdentity, challengeConfig, readJson, verifyChallenge } from "./security";
import type { VerifyFetch } from "./security";
import { HOUR, saveReport, sessionCategory } from "./storage";

function json(value: unknown, status = 200, cookie?: string | null): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (cookie) {
    headers.set("Set-Cookie", cookie);
  }
  return Response.json(value, { headers, status });
}

function parseReport(body: unknown): { category: Category | null; token: string; window: number } {
  if (
    !body ||
    typeof body !== "object" ||
    !("category" in body) ||
    (body.category !== null && !isCategory(body.category)) ||
    !("token" in body) ||
    typeof body.token !== "string" ||
    !body.token ||
    body.token.length > 2048 ||
    !("window" in body) ||
    typeof body.window !== "number" ||
    !Number.isSafeInteger(body.window)
  ) {
    throw new ApiError(400, "Invalid report");
  }
  return { category: body.category, token: body.token, window: body.window };
}

async function mutateReport(
  request: Request,
  bindings: Cloudflare.Env,
  provider: ProviderId,
  config: ReturnType<typeof challengeConfig>,
  verifyFetch: VerifyFetch,
): Promise<Response> {
  const body = parseReport(await readJson(request));
  if (body.window !== Math.floor(Date.now() / HOUR)) {
    throw new ApiError(409, "Reporting window expired");
  }
  if (!bindings.REPORT_RATE_LIMIT) {
    throw new ApiError(503, "Reporting rate limiter unavailable");
  }
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) {
    throw new ApiError(503, "Reporting rate limiter unavailable");
  }
  const limit = await bindings.REPORT_RATE_LIMIT.limit({ key: ip });
  if (!limit.success) {
    throw new ApiError(429, "Too many reports");
  }
  await verifyChallenge(config, body.token, verifyFetch);
  const identity = await browserIdentity(request);
  const now = Date.now();
  if (body.window !== Math.floor(now / HOUR)) {
    throw new ApiError(409, "Reporting window expired");
  }
  const category = await saveReport(bindings.DB, provider, identity.hash, body.category, now);
  return json({ category }, 200, identity.cookie);
}

async function overview(bindings: Cloudflare.Env, now: number): Promise<Response> {
  return json(await overviewFromDatabase(bindings.DB, now));
}

async function routeApi(
  request: Request,
  bindings: Cloudflare.Env,
  verifyFetch: VerifyFetch,
): Promise<Response> {
  const url = new URL(request.url);
  const now = Date.now();
  if (url.pathname === "/api/overview") {
    if (request.method !== "GET") {
      throw new ApiError(405, "Method not allowed");
    }
    return overview(bindings, now);
  }
  const match = /^\/api\/(?<route>providers|session|reports)\/(?<id>[^/]+)$/u.exec(url.pathname);
  if (!match?.groups) {
    throw new ApiError(404, "Not found");
  }
  const { route, id } = match.groups;
  const provider = findProvider(id ?? "");
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
    return json(await dashboardFromDatabase(bindings.DB, provider.id, range, now));
  }
  const config = challengeConfig(bindings, url.hostname);
  if (route === "session") {
    const identity = await browserIdentity(request);
    const category = await sessionCategory(bindings.DB, provider.id, identity.hash, now);
    return json(
      { category, siteKey: config.siteKey, window: Math.floor(now / HOUR) },
      200,
      identity.cookie,
    );
  }
  return mutateReport(request, bindings, provider.id, config, verifyFetch);
}

export async function handleApi(
  request: Request,
  bindings: Cloudflare.Env,
  verifyFetch: VerifyFetch = fetch,
): Promise<Response> {
  try {
    return await routeApi(request, bindings, verifyFetch);
  } catch (error) {
    return error instanceof ApiError
      ? json({ error: error.message }, error.status)
      : json({ error: "Service unavailable" }, 503);
  }
}
