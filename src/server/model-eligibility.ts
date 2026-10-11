import { documentedGeminiRelease, documentedGeminiTask } from "./documented-models";
import type { ModelAdapter } from "./provider-registry";

interface CatalogueMetadata {
  reasons: string[];
  aliases?: string[];
  canonicalId?: string;
  releasedAt?: number;
  dateSource?: string;
  evidence: Record<string, unknown>;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Invalid model response");
  }
  return value.map((item: unknown) => {
    if (typeof item !== "string" || item.length === 0 || item.length > 512) {
      throw new TypeError("Invalid model response");
    }
    return item;
  });
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError("Invalid model response");
  }
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid model response");
  }
  return Object.fromEntries(Object.entries(value));
}

function identityEvidence(row: Record<string, unknown>, result: CatalogueMetadata) {
  for (const field of ["lifecycle", "type", "owned_by", "publisher"]) {
    const value = row[field];
    if (value !== undefined) {
      if (typeof value !== "string") {
        throw new TypeError("Invalid model response");
      }
      result.evidence[field] = value;
    }
  }
  const { lifecycle } = row;
  if (
    typeof lifecycle === "string" &&
    ["deprecated", "retired", "shutdown", "shut_down"].includes(lifecycle)
  ) {
    result.reasons.push("inactive-lifecycle");
  }
  const { type } = row;
  if (typeof type === "string" && ["fine-tuned", "fine_tuned", "ft"].includes(type)) {
    result.reasons.push("fine-tuned");
  }
  if ("aliases" in row) {
    result.aliases = strings(row["aliases"]);
  }
}

function capabilityEvidence(row: Record<string, unknown>, result: CatalogueMetadata) {
  for (const field of ["output_modalities", "outputModalities"]) {
    if (field in row) {
      const output = strings(row[field]);
      result.evidence[field] = output;
      if (!output.includes("text")) {
        result.reasons.push("no-text-output");
      }
    }
  }
  if ("capabilities" in row) {
    const capabilities = object(row["capabilities"]);
    result.evidence["capabilities"] = capabilities;
    if ("completion_chat" in capabilities && !boolean(capabilities["completion_chat"])) {
      result.reasons.push("no-chat-completion");
    }
  }
}

function deprecationDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError("Invalid model response");
  }
  const date = value.slice(0, 10);
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new TypeError("Invalid model response");
  }
  return value;
}

function mistralEvidence(row: Record<string, unknown>, result: CatalogueMetadata) {
  if ("deprecation" in row && row["deprecation"] !== null) {
    const value = deprecationDate(row["deprecation"]);
    result.evidence["deprecation"] = value;
    result.reasons.push("deprecated");
  }
  const { id } = row;
  const { name } = row;
  if (typeof name === "string" && typeof id === "string" && result.aliases?.includes(name)) {
    result.canonicalId = name;
  }
  if (
    typeof id === "string" &&
    ["glm-5-2", "zai-glm-5-2", "zai-glm-5-3", "zai-glm-5", "zai-glm-latest"].includes(id)
  ) {
    result.evidence["publisher"] = {
      name: "Z.ai",
      source: "https://docs.mistral.ai/models/zai-glm-5-3",
    };
    result.reasons.push("third-party-publisher");
  }
}

function kimiEvidence(row: Record<string, unknown>, result: CatalogueMetadata) {
  const reasoning = "supports_reasoning" in row ? boolean(row["supports_reasoning"]) : undefined;
  const chat = "supports_text_chat" in row ? boolean(row["supports_text_chat"]) : undefined;
  if (reasoning !== undefined) {
    result.evidence["supports_reasoning"] = reasoning;
  }
  if (chat !== undefined) {
    result.evidence["supports_text_chat"] = chat;
  }
  if (reasoning === false && chat === false) {
    result.reasons.push("no-text-chat-or-reasoning");
  }
}

function releaseEvidence(
  row: Record<string, unknown>,
  adapter: ModelAdapter,
  result: CatalogueMetadata,
) {
  if (adapter.protocol === "gemini" && typeof row["name"] === "string") {
    const documented = documentedGeminiRelease(row["name"]);
    if (documented) {
      result.releasedAt = documented.releasedAt;
      result.dateSource = documented.source;
    }
  }
  if (
    ["OPENAI_API_KEY", "XAI_API_KEY", "ZAI_API_KEY"].includes(adapter.secret) &&
    "created" in row
  ) {
    const { created } = row;
    if (
      typeof created !== "number" ||
      !Number.isSafeInteger(created) ||
      created <= 0 ||
      created * 1000 > Date.now() + 86_400_000
    ) {
      throw new TypeError("Invalid model response");
    }
    result.releasedAt = created * 1000;
    result.dateSource = "api.created";
  }
  if (adapter.protocol === "anthropic" && "created_at" in row) {
    const created = row["created_at"];
    const timestamp = typeof created === "string" ? Date.parse(created) : Number.NaN;
    if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() + 86_400_000) {
      throw new TypeError("Invalid model response");
    }
    result.releasedAt = timestamp;
    result.dateSource = "api.created_at";
  }
}

function serviceEvidence(
  row: Record<string, unknown>,
  adapter: ModelAdapter,
  result: CatalogueMetadata,
) {
  if (adapter.secret === "MISTRAL_API_KEY") {
    mistralEvidence(row, result);
  }
  if (adapter.secret === "MOONSHOT_API_KEY") {
    kimiEvidence(row, result);
  }
  if (adapter.protocol === "gemini" && typeof row["name"] === "string") {
    const documented = documentedGeminiTask(row["name"]);
    if (documented) {
      result.evidence["documentedTask"] = documented;
      result.reasons.push(documented.task);
    }
  }
  if (adapter.secret === "MISTRAL_API_KEY" && typeof row["id"] === "string") {
    const mistralReleases: Record<string, string> = {
      "mistral-large-4": "2026-10-06",
      "mistral-large-4-0": "2026-10-06",
      "zai-glm-5-3": "2026-09-15",
    };
    const released = mistralReleases[row["id"]];
    if (released) {
      result.releasedAt = Date.parse(released);
      result.dateSource = "mistral.models";
    }
  }
  if (adapter.protocol === "cursor") {
    for (const field of ["variants", "parameters"]) {
      if (field in row) {
        const value = row[field];
        if (!Array.isArray(value)) {
          throw new TypeError("Invalid model response");
        }
        result.evidence[field] = value.map((item: unknown) => object(item));
      }
    }
  }
  if (
    adapter.secret === "OPENAI_API_KEY" &&
    typeof row["id"] === "string" &&
    row["id"].startsWith("ft:")
  ) {
    result.reasons.push("fine-tuned");
  }
}

function apiMetadata(
  row: Record<string, unknown>,
  adapter: ModelAdapter,
): CatalogueMetadata | undefined {
  const result: CatalogueMetadata = { evidence: {}, reasons: [] };
  identityEvidence(row, result);
  capabilityEvidence(row, result);
  serviceEvidence(row, adapter, result);
  releaseEvidence(row, adapter, result);
  return Object.keys(result.evidence).length > 0 ||
    result.reasons.length > 0 ||
    result.aliases ||
    result.releasedAt
    ? result
    : undefined;
}

export { apiMetadata };
export type { CatalogueMetadata };
