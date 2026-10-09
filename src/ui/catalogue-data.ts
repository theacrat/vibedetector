import { findProvider } from "@/domain";
import type { ModelOption } from "@/domain";

function isModelOption(value: unknown): value is ModelOption {
  return (
    typeof value === "object" &&
    value !== null &&
    "provider" in value &&
    typeof value.provider === "string" &&
    Boolean(findProvider(value.provider)) &&
    "name" in value &&
    typeof value.name === "string" &&
    "active" in value &&
    typeof value.active === "boolean"
  );
}

function parseCatalogue(value: unknown): ModelOption[] {
  if (!Array.isArray(value) || !value.every((entry: unknown) => isModelOption(entry))) {
    throw new TypeError("Could not load the model catalogue. Please try again.");
  }
  return value;
}

export { parseCatalogue };
