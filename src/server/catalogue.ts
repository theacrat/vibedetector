import { isId } from "@/domain";
import type { ModelOption, Provider } from "@/domain";
import { compareProviders } from "@/provider-order";

import { providerRegistry } from "./provider-registry";
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
    value.length <= 700 &&
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
  const registered = providerRegistry.find((entry) => entry.provider.id === row.id);
  if (registered) {
    return { ...registered.provider, active: row.active === 1 };
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
  return result.results
    .map(readProvider)
    .filter(
      (provider) =>
        !activeOnly || providerRegistry.some((entry) => entry.provider.id === provider.id),
    )
    .toSorted(compareProviders);
}

async function resolveProvider(
  db: D1Database,
  slugOrId: string,
  activeOnly = true,
): Promise<Provider> {
  const registered = providerRegistry.find((entry) => entry.provider.slug === slugOrId);
  const lookup = registered?.provider.id ?? slugOrId;
  const row = await db
    .prepare(
      `SELECT * FROM providers WHERE ${isId(lookup) ? "id" : "slug"} = ? ${activeOnly ? "AND active = 1" : ""}`,
    )
    .bind(lookup)
    .first<unknown>();
  if (!row) {
    throw new ApiError(404, "Unknown provider");
  }
  const provider = readProvider(row);
  if (activeOnly && !providerRegistry.some((entry) => entry.provider.id === provider.id)) {
    throw new ApiError(404, "Unknown provider");
  }
  return provider;
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

export {
  isModelName,
  isSlug,
  loadProviders,
  resolveProvider,
  loadModels,
  loadActiveModels,
  parseProvider,
};
