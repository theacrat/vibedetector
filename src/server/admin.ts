// Workers nodejs_compat provides a constant-time comparison for equal-length digests.
// oxlint-disable-next-line import/no-nodejs-modules
import { timingSafeEqual } from "node:crypto";

import { loadModels, orderModels, parseModel } from "./catalogue";
import { ApiError, readJson } from "./security";

const COOKIE = "vd_admin";
const LIFETIME = 3_600_000;
const encoder = new TextEncoder();

function adminSecret(bindings: Cloudflare.Env): string {
  if (!bindings.ADMIN_KEY || bindings.ADMIN_KEY.length < 32 || !bindings.ADMIN_RATE_LIMIT) {
    throw new ApiError(503, "Administration is not configured");
  }
  return bindings.ADMIN_KEY;
}

function cookie(request: Request, value: string, age: number): string {
  const url = new URL(request.url);
  return `${COOKIE}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${age}${url.protocol === "https:" ? "; Secure" : ""}`;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authenticate(request: Request, secret: string): Promise<void> {
  const raw =
    request.headers
      .get("Cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1) ?? "";
  const match = /^(?<issued>\d{13})\.(?<nonce>[a-f0-9]{32})\.(?<signature>[a-f0-9]{64})$/u.exec(
    raw,
  );
  if (!match?.groups) {
    throw new ApiError(401, "Authentication required");
  }
  const { issued = "", nonce = "", signature = "" } = match.groups;
  const age = Date.now() - Number(issued);
  const bytes = Uint8Array.from(signature.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
  if (
    age < 0 ||
    age >= LIFETIME ||
    !(await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret),
      bytes,
      encoder.encode(`${issued}.${nonce}`),
    ))
  ) {
    throw new ApiError(401, "Authentication required");
  }
}

async function login(
  request: Request,
  bindings: Cloudflare.Env,
  secret: string,
): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || !bindings.ADMIN_RATE_LIMIT) {
    throw new ApiError(503, "Administration rate limiter unavailable");
  }
  const limit = await bindings.ADMIN_RATE_LIMIT.limit({ key: ip });
  if (!limit.success) {
    throw new ApiError(429, "Too many login attempts");
  }
  const body = await readJson(request);
  if (
    !body ||
    typeof body !== "object" ||
    !("key" in body) ||
    typeof body.key !== "string" ||
    body.key.length > 1024
  ) {
    throw new ApiError(400, "Invalid login");
  }
  const expected = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  const presented = await crypto.subtle.digest("SHA-256", encoder.encode(body.key));
  if (!timingSafeEqual(new Uint8Array(expected), new Uint8Array(presented))) {
    throw new ApiError(401, "Invalid credentials");
  }
  const payload = `${Date.now()}.${hex(crypto.getRandomValues(new Uint8Array(16)).buffer)}`;
  const signature = hex(
    await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(payload)),
  );
  return Response.json(
    { authenticated: true },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": cookie(request, `${payload}.${signature}`, 3600),
      },
    },
  );
}

async function mutateCatalogue(
  path: string,
  body: unknown,
  bindings: Cloudflare.Env,
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (path === "/api/admin/models/order") {
    await orderModels(bindings.DB, body);
    return Response.json(await loadModels(bindings.DB), { headers });
  }
  const model = parseModel(body);
  if (path === "/api/admin/models") {
    const result = await bindings.DB.prepare(
      `INSERT OR IGNORE INTO models (provider, name, active, position)
       SELECT ?, ?, 1, COALESCE(MAX(position), -1) + 1 FROM models WHERE provider = ?
       HAVING COUNT(*) < 256`,
    )
      .bind(model.provider, model.name, model.provider)
      .run();
    if (
      result.meta.changes === 0 &&
      !(await bindings.DB.prepare("SELECT 1 FROM models WHERE provider = ? AND name = ?")
        .bind(model.provider, model.name)
        .first())
    ) {
      throw new ApiError(400, "Catalogue limit is 256 models per provider");
    }
  } else if (path === "/api/admin/models/state") {
    if (
      !body ||
      typeof body !== "object" ||
      !("active" in body) ||
      typeof body.active !== "boolean"
    ) {
      throw new ApiError(400, "Invalid model state");
    }
    const result = await bindings.DB.prepare(
      "UPDATE models SET active = ? WHERE provider = ? AND name = ?",
    )
      .bind(body.active ? 1 : 0, model.provider, model.name)
      .run();
    if (result.meta.changes === 0) {
      throw new ApiError(404, "Unknown model");
    }
  } else {
    throw new ApiError(404, "Not found");
  }
  return Response.json(await loadModels(bindings.DB), { headers });
}

async function handleAdmin(request: Request, bindings: Cloudflare.Env): Promise<Response> {
  const secret = adminSecret(bindings);
  const url = new URL(request.url);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new ApiError(403, "HTTPS required");
  }
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new ApiError(403, "Origin rejected");
  }
  const path = url.pathname;
  if (path === "/api/admin/login") {
    if (request.method !== "POST") {
      throw new ApiError(405, "Method not allowed");
    }
    return login(request, bindings, secret);
  }
  await authenticate(request, secret);
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== url.origin) {
    throw new ApiError(403, "Origin rejected");
  }
  const headers = { "Cache-Control": "no-store" };
  if (path === "/api/admin/models" && request.method === "GET") {
    return Response.json(await loadModels(bindings.DB), { headers });
  }
  if (request.method !== "POST") {
    throw new ApiError(405, "Method not allowed");
  }
  const body = await readJson(request, path === "/api/admin/models/order" ? 262_144 : 4096);
  if (path === "/api/admin/logout") {
    return Response.json(
      { authenticated: false },
      { headers: { ...headers, "Set-Cookie": cookie(request, "", 0) } },
    );
  }
  return mutateCatalogue(path, body, bindings);
}

export { handleAdmin };
