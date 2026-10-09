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

export { isModelName, loadModels, parseModel };
