import { isId, isRange } from "@/domain";
import type { Dashboard, ModelOption, Overview, Provider } from "@/domain";

function isModelOption(value: unknown): value is ModelOption {
  return (
    typeof value === "object" &&
    value !== null &&
    "provider" in value &&
    typeof value.provider === "string" &&
    isId(value.provider) &&
    "id" in value &&
    isId(value.id) &&
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

function isProvider(value: unknown): value is Provider {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    isId(value.id) &&
    "slug" in value &&
    typeof value.slug === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.slug) &&
    "name" in value &&
    typeof value.name === "string" &&
    "maker" in value &&
    typeof value.maker === "string" &&
    "status" in value &&
    typeof value.status === "string" &&
    "statusLabel" in value &&
    typeof value.statusLabel === "string" &&
    "logo" in value &&
    typeof value.logo === "string" &&
    "active" in value &&
    typeof value.active === "boolean"
  );
}

function parseProviders(value: unknown): Provider[] {
  if (!Array.isArray(value) || !value.every((entry: unknown) => isProvider(entry))) {
    throw new TypeError("Could not load the provider catalogue. Please try again.");
  }
  return value;
}

function isBuckets(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (bucket: unknown) =>
        typeof bucket === "object" &&
        bucket !== null &&
        ["t", "nerfed", "slow", "broken"].every((key) => {
          const count: unknown = Reflect.get(bucket, key);
          return typeof count === "number" && Number.isFinite(count) && count >= 0;
        }),
    )
  );
}

function isOverview(value: unknown): value is Overview {
  return (
    typeof value === "object" &&
    value !== null &&
    "provider" in value &&
    isProvider(value.provider) &&
    "hourly" in value &&
    typeof value.hourly === "number" &&
    Number.isFinite(value.hourly) &&
    value.hourly >= 0 &&
    "buckets" in value &&
    isBuckets(value.buckets)
  );
}

function parseOverview(value: unknown): Overview[] {
  if (!Array.isArray(value) || !value.every((entry: unknown) => isOverview(entry))) {
    throw new TypeError("Could not load community reports. Please try again.");
  }
  return value;
}

function isDashboard(value: unknown): value is Dashboard {
  return (
    isOverview(value) &&
    "model" in value &&
    typeof value.model === "string" &&
    (!value.model || value.model === "unspecified" || isId(value.model)) &&
    "range" in value &&
    typeof value.range === "string" &&
    isRange(value.range) &&
    "baseline" in value &&
    (value.baseline === null ||
      (typeof value.baseline === "number" && Number.isFinite(value.baseline))) &&
    "asOf" in value &&
    typeof value.asOf === "number" &&
    Number.isFinite(value.asOf) &&
    "verdict" in value &&
    ["insufficient community data", "no report spike", "vibes are off", "killed the vibe"].includes(
      String(value.verdict),
    )
  );
}

function parseDashboard(value: unknown): Dashboard {
  if (!isDashboard(value) || !("models" in value)) {
    throw new TypeError("Could not load community reports. Please try again.");
  }
  return { ...value, models: parseCatalogue(value.models) };
}

export { parseCatalogue, parseProviders, isProvider, parseOverview, parseDashboard };
