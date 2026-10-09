import { describe, expect, it } from "vitest";

import {
  findProvider,
  isCategory,
  isRange,
  providers,
  ranges,
  isProviderModel,
  isModelFilter,
} from "@/domain";

describe("provider registry", () => {
  it("validates model metadata against its provider and separates filters", () => {
    expect(isProviderModel("claude", "Claude Sonnet 5.5")).toBe(true);
    expect(isProviderModel("claude", "GLM-5.3")).toBe(false);
    expect(isProviderModel("zai", "GLM-5.3")).toBe(true);
    expect(isProviderModel("kimi", "Kimi K3")).toBe(true);
    expect(isModelFilter("claude", "")).toBe(true);
    expect(isModelFilter("claude", "unspecified")).toBe(true);
    expect(isProviderModel("claude", "unspecified")).toBe(false);
    expect(isModelFilter("claude", "<script>")).toBe(false);
  });
  it("has ten distinct, shareable provider paths", () => {
    expect(providers.map((provider) => provider.id)).toEqual([
      "claude",
      "chatgpt",
      "gemini",
      "copilot",
      "grok",
      "mistral",
      "deepseek",
      "cursor",
      "zai",
      "kimi",
    ]);
    expect(new Set(providers.map((provider) => provider.id)).size).toBe(10);
    expect(findProvider("unknown")).toBeUndefined();
  });

  it("only accepts the defined categories and ranges", () => {
    expect(
      ["nerfed", "slow", "broken", "healthy", "__proto__", undefined].map((value) =>
        isCategory(value),
      ),
    ).toEqual([true, true, true, false, false, false]);
    expect(["6h", "24h", "7d", "1y", "__proto__"].map((value) => isRange(value))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(ranges["6h"].count * ranges["6h"].step).toBe(21_600_000);
    expect(ranges["24h"].count * ranges["24h"].step).toBe(86_400_000);
    expect(ranges["7d"].count * ranges["7d"].step).toBe(604_800_000);
  });
});
