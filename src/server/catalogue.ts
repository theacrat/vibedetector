import { isId } from "@/domain";
import type { ModelOption, Provider } from "@/domain";

import { ApiError } from "./security";

const localLogos = new Set(
  ["claude", "chatgpt", "gemini", "copilot", "grok", "mistral", "deepseek", "zai", "kimi"].map(
    (slug) => `/logos/${slug}.svg`,
  ),
);
const reservedSlugs = new Set([
  "api",
  "admin",
  "privacy",
  "methodology",
  "robots",
  "sitemap",
  "robots.txt",
  "sitemap.xml",
]);

function isModelName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 120 &&
    value === value.trim() &&
    !/[\p{Cc}]/u.test(value)
  );
}

function isSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 80 &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value) &&
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value) &&
    !reservedSlugs.has(value)
  );
}

function isHttps(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function parseProvider(body: unknown): Omit<Provider, "id" | "active"> {
  if (
    !body ||
    typeof body !== "object" ||
    !("slug" in body) ||
    !isSlug(body.slug) ||
    !("name" in body) ||
    !isModelName(body.name) ||
    !("maker" in body) ||
    !isModelName(body.maker) ||
    !("statusLabel" in body) ||
    !isModelName(body.statusLabel) ||
    !("status" in body) ||
    !isHttps(body.status) ||
    !("logo" in body) ||
    typeof body.logo !== "string" ||
    !(body.logo === "" || localLogos.has(body.logo) || isHttps(body.logo))
  ) {
    throw new ApiError(400, "Invalid provider");
  }
  return {
    logo: body.logo,
    maker: body.maker,
    name: body.name,
    slug: body.slug,
    status: body.status,
    statusLabel: body.statusLabel,
  };
}

function readProvider(row: unknown): Provider {
  if (
    !row ||
    typeof row !== "object" ||
    !("id" in row) ||
    !isId(row.id) ||
    !("active" in row) ||
    (row.active !== 0 && row.active !== 1)
  ) {
    throw new Error("Invalid stored provider");
  }
  return { ...parseProvider(row), active: row.active === 1, id: row.id };
}

function readModel(row: unknown): ModelOption {
  if (
    !row ||
    typeof row !== "object" ||
    !("id" in row) ||
    !isId(row.id) ||
    !("provider" in row) ||
    !isId(row.provider) ||
    !("name" in row) ||
    !isModelName(row.name) ||
    !("active" in row) ||
    (row.active !== 0 && row.active !== 1)
  ) {
    throw new Error("Invalid stored model");
  }
  return { active: row.active === 1, id: row.id, name: row.name, provider: row.provider };
}

async function loadProviders(db: D1Database, activeOnly = false): Promise<Provider[]> {
  const result = await db
    .prepare(
      `SELECT * FROM providers ${activeOnly ? "WHERE active = 1" : ""} ORDER BY position, id`,
    )
    .all<unknown>();
  if (!result.success) {
    throw new Error("Catalogue read failed");
  }
  return result.results.map(readProvider);
}

async function resolveProvider(
  db: D1Database,
  slugOrId: string,
  activeOnly = true,
): Promise<Provider> {
  const row = await db
    .prepare(
      `SELECT * FROM providers WHERE ${isId(slugOrId) ? "id" : "slug"} = ? ${activeOnly ? "AND active = 1" : ""}`,
    )
    .bind(slugOrId)
    .first<unknown>();
  if (!row) {
    throw new ApiError(404, "Unknown provider");
  }
  return readProvider(row);
}

async function loadModels(
  db: D1Database,
  provider?: string,
  activeOnly = false,
): Promise<ModelOption[]> {
  const result = await db
    .prepare(
      `SELECT m.id, m.provider, m.name, m.active FROM models m JOIN providers p ON p.id = m.provider WHERE (? = '' OR m.provider = ?) ${activeOnly ? "AND m.active = 1 AND p.active = 1" : ""} ORDER BY p.position, m.position, m.id`,
    )
    .bind(provider ?? "", provider ?? "")
    .all<unknown>();
  if (!result.success) {
    throw new Error("Catalogue read failed");
  }
  return result.results.map(readModel);
}

async function loadActiveModels(db: D1Database, provider: string): Promise<ModelOption[]> {
  await resolveProvider(db, provider);
  return loadModels(db, provider, true);
}

function parseModel(body: unknown): { provider: string; name: string } {
  if (
    !body ||
    typeof body !== "object" ||
    !("provider" in body) ||
    !isId(body.provider) ||
    !("name" in body) ||
    !isModelName(body.name)
  ) {
    throw new ApiError(400, "Invalid model");
  }
  return { name: body.name, provider: body.provider };
}

async function orderCatalogue(
  db: D1Database,
  body: unknown,
  table: "providers" | "models",
): Promise<void> {
  if (
    !body ||
    typeof body !== "object" ||
    !("ids" in body) ||
    !Array.isArray(body.ids) ||
    !body.ids.every(isId) ||
    body.ids.length > 256 ||
    new Set(body.ids).size !== body.ids.length
  ) {
    throw new ApiError(400, "Invalid catalogue order");
  }
  const ids: string[] = body.ids;
  let provider = "";
  if (table === "models") {
    if (!("provider" in body) || !isId(body.provider)) {
      throw new ApiError(400, "Invalid provider");
    }
    ({ provider } = body);
    await resolveProvider(db, provider, false);
  }
  const scope = table === "models" ? "provider = ?" : "1 = 1";
  const encoded = JSON.stringify(ids);
  const sql = `UPDATE ${table} SET position = (SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value = ${table}.id) WHERE ${scope} AND (SELECT COUNT(*) FROM ${table} WHERE ${scope}) = ? AND (SELECT COUNT(*) FROM ${table} WHERE ${scope} AND id IN (SELECT value FROM json_each(?))) = ?`;
  const args =
    table === "models"
      ? [encoded, provider, provider, ids.length, provider, encoded, ids.length]
      : [encoded, ids.length, encoded, ids.length];
  const result = await db
    .prepare(sql)
    .bind(...args)
    .run();
  if (!result.success) {
    throw new Error("Catalogue order failed");
  }
  if (result.meta.changes !== ids.length) {
    throw new ApiError(409, "Catalogue changed; reload before ordering");
  }
}

async function orderModels(db: D1Database, body: unknown): Promise<void> {
  return orderCatalogue(db, body, "models");
}

export {
  isModelName,
  isSlug,
  loadProviders,
  resolveProvider,
  loadModels,
  loadActiveModels,
  parseProvider,
  parseModel,
  orderCatalogue,
  orderModels,
};
