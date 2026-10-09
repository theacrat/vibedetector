import { findProvider } from "@/domain";
import type { ModelOption, ProviderId } from "@/domain";

import { ApiError } from "./security";

function isModelName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 120 &&
    value === value.trim() &&
    // Control-code rejection intentionally examines code points, not grapheme clusters.
    // oxlint-disable-next-line typescript/no-misused-spread
    ![...value].some(
      (character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127,
    ) &&
    !["all", "unspecified"].includes(value.toLowerCase())
  );
}

function readModel(row: unknown): ModelOption {
  if (
    !row ||
    typeof row !== "object" ||
    !("provider" in row) ||
    typeof row.provider !== "string" ||
    !("name" in row) ||
    !isModelName(row.name) ||
    !("active" in row) ||
    (row.active !== 0 && row.active !== 1)
  ) {
    throw new Error("Invalid stored model");
  }
  const provider = findProvider(row.provider);
  if (!provider) {
    throw new Error("Invalid stored provider");
  }
  return { active: row.active === 1, name: row.name, provider: provider.id };
}

async function loadModels(db: D1Database, provider?: ProviderId): Promise<ModelOption[]> {
  const statement =
    provider === undefined
      ? db.prepare("SELECT provider, name, active FROM models ORDER BY position, provider, name")
      : db
          .prepare(
            "SELECT provider, name, active FROM models WHERE provider = ? ORDER BY position, name",
          )
          .bind(provider);
  const result = await statement.all<unknown>();
  if (!result.success) {
    throw new Error("Catalogue read failed");
  }
  return result.results.map(readModel);
}

function parseModel(body: unknown): { provider: ProviderId; name: string } {
  if (
    !body ||
    typeof body !== "object" ||
    !("provider" in body) ||
    typeof body.provider !== "string" ||
    !("name" in body) ||
    !isModelName(body.name)
  ) {
    throw new ApiError(400, "Invalid model");
  }
  const provider = findProvider(body.provider);
  if (!provider) {
    throw new ApiError(400, "Invalid provider");
  }
  return { name: body.name, provider: provider.id };
}

async function loadActiveModels(db: D1Database, provider: ProviderId): Promise<ModelOption[]> {
  const models = await loadModels(db, provider);
  return models.filter((model) => model.active);
}

async function orderModels(db: D1Database, body: unknown): Promise<void> {
  if (
    !body ||
    typeof body !== "object" ||
    !("provider" in body) ||
    typeof body.provider !== "string" ||
    !("names" in body) ||
    !Array.isArray(body.names) ||
    !body.names.every(isModelName)
  ) {
    throw new ApiError(400, "Invalid model order");
  }
  const provider = findProvider(body.provider);
  if (!provider) {
    throw new ApiError(400, "Invalid provider");
  }
  const names: string[] = body.names;
  const encoded = JSON.stringify(names);
  const models = await loadModels(db, provider.id);
  const catalogue = new Set(models.map((model) => model.name));
  if (
    names.length !== catalogue.size ||
    new Set(names).size !== names.length ||
    !names.every((name) => catalogue.has(name))
  ) {
    throw new ApiError(400, "Invalid model order");
  }
  const [result] = await db.batch([
    db
      .prepare(
        `UPDATE models SET position = (
          SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value = models.name
        ) WHERE provider = ?
          AND (SELECT COUNT(*) FROM models WHERE provider = ?) = ?
          AND (SELECT COUNT(*) FROM models WHERE provider = ?
            AND name IN (SELECT value FROM json_each(?))) = ?`,
      )
      .bind(encoded, provider.id, provider.id, names.length, provider.id, encoded, names.length),
  ]);
  if (!result?.success) {
    throw new Error("Catalogue order failed");
  }
  if (result.meta.changes !== names.length) {
    throw new ApiError(409, "Catalogue changed; reload before ordering");
  }
}

export { isModelName, loadActiveModels, loadModels, orderModels, parseModel };
