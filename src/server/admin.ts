// Workers nodejs_compat provides a constant-time comparison for equal-length digests.
// oxlint-disable-next-line import/no-nodejs-modules
import { timingSafeEqual } from "node:crypto";

import { isId } from "@/domain";

import {
  loadModels,
  loadProviders,
  orderCatalogue,
  parseModel,
  parseProvider,
  resolveProvider,
  isModelName,
} from "./catalogue";
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

function parseId(body: unknown): string {
  if (!body || typeof body !== "object" || !("id" in body) || !isId(body.id)) {
    throw new ApiError(400, "Invalid catalogue ID");
  }
  return body.id;
}

async function setCatalogueState(
  db: D1Database,
  table: "providers" | "models",
  body: unknown,
): Promise<void> {
  const id = parseId(body);
  if (
    !body ||
    typeof body !== "object" ||
    !("active" in body) ||
    typeof body.active !== "boolean"
  ) {
    throw new ApiError(400, "Invalid catalogue state");
  }
  const result = await db
    .prepare(`UPDATE ${table} SET active = ? WHERE id = ?`)
    .bind(body.active ? 1 : 0, id)
    .run();
  if (result.meta.changes === 0) {
    throw new ApiError(404, "Unknown catalogue record");
  }
}

async function writeProvider(db: D1Database, body: unknown, update: boolean): Promise<void> {
  const provider = parseProvider(body);
  if (update) {
    const result = await db
      .prepare(
        "UPDATE providers SET slug = ?, name = ?, maker = ?, status = ?, statusLabel = ?, logo = ? WHERE id = ?",
      )
      .bind(
        provider.slug,
        provider.name,
        provider.maker,
        provider.status,
        provider.statusLabel,
        provider.logo,
        parseId(body),
      )
      .run();
    if (result.meta.changes === 0) {
      throw new ApiError(404, "Unknown provider");
    }
  } else {
    const result = await db
      .prepare(
        `INSERT INTO providers (id, slug, name, maker, status, statusLabel, logo, active, position) SELECT ?, ?, ?, ?, ?, ?, ?, 1, COALESCE(MAX(position), -1) + 1 FROM providers HAVING COUNT(*) < 256`,
      )
      .bind(
        crypto.randomUUID(),
        provider.slug,
        provider.name,
        provider.maker,
        provider.status,
        provider.statusLabel,
        provider.logo,
      )
      .run();
    if (result.meta.changes === 0) {
      throw new ApiError(400, "Catalogue limit is 256 providers");
    }
  }
}

async function writeModel(db: D1Database, body: unknown, update: boolean): Promise<void> {
  if (update) {
    const id = parseId(body);
    if (!body || typeof body !== "object" || !("name" in body) || !isModelName(body.name)) {
      throw new ApiError(400, "Invalid model");
    }
    const result = await db
      .prepare("UPDATE models SET name = ? WHERE id = ?")
      .bind(body.name, id)
      .run();
    if (result.meta.changes === 0) {
      throw new ApiError(404, "Unknown model");
    }
  } else {
    const model = parseModel(body);
    await resolveProvider(db, model.provider, false);
    const result = await db
      .prepare(
        `INSERT INTO models (id, provider, name, active, position) SELECT ?, ?, ?, 1, COALESCE(MAX(position), -1) + 1 FROM models WHERE provider = ? HAVING COUNT(*) < 256`,
      )
      .bind(crypto.randomUUID(), model.provider, model.name, model.provider)
      .run();
    if (result.meta.changes === 0) {
      throw new ApiError(400, "Catalogue limit is 256 models per provider");
    }
  }
}

async function mutateCatalogue(
  path: string,
  body: unknown,
  bindings: Cloudflare.Env,
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const match =
    /^\/api\/admin\/(?<table>providers|models)(?:\/(?<action>order|state|update))?$/u.exec(path);
  if (!match?.groups) {
    throw new ApiError(404, "Not found");
  }
  const table = match.groups["table"] === "providers" ? "providers" : "models";
  const { action } = match.groups;
  try {
    if (action === "order") {
      await orderCatalogue(bindings.DB, body, table);
    } else if (action === "state") {
      await setCatalogueState(bindings.DB, table, body);
    } else if (table === "providers") {
      await writeProvider(bindings.DB, body, action === "update");
    } else {
      await writeModel(bindings.DB, body, action === "update");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      throw new ApiError(409, "Catalogue value already exists");
    }
    throw error;
  }
  return Response.json(
    table === "providers" ? await loadProviders(bindings.DB) : await loadModels(bindings.DB),
    { headers },
  );
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
  if (path === "/api/admin/providers" && request.method === "GET") {
    return Response.json(await loadProviders(bindings.DB), { headers });
  }
  if (request.method !== "POST") {
    throw new ApiError(405, "Method not allowed");
  }
  const body = await readJson(request, path.endsWith("/order") ? 262_144 : 16_384);
  if (path === "/api/admin/logout") {
    return Response.json(
      { authenticated: false },
      { headers: { ...headers, "Set-Cookie": cookie(request, "", 0) } },
    );
  }
  return mutateCatalogue(path, body, bindings);
}

export { handleAdmin };
