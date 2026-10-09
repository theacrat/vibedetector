import { initialModels } from "@seed/models";
import { initialProviders } from "@seed/provider";
import { describe, expect, it } from "vitest";

import { isCategory, isId, isRange, ranges } from "@/domain";
import { isModelName, isSlug } from "@/server/catalogue";

describe("catalogue identities", () => {
  it("seeds distinct UUIDs with model names separated from identity", () => {
    expect(initialProviders.every((provider) => isId(provider.id))).toBe(true);
    expect(new Set(initialProviders.map((provider) => provider.id)).size).toBe(10);
    expect(Object.keys(initialModels).toSorted()).toEqual(
      initialProviders.map((provider) => provider.slug).toSorted(),
    );
    for (const names of Object.values(initialModels)) {
      expect(names.length).toBeGreaterThan(0);
      expect(new Set(names).size).toBe(names.length);
    }
    expect(
      ["claude", "GPT-6", "00000000-0000-0000-0000-000000000000", undefined].map((value) =>
        isId(value),
      ),
    ).toEqual([false, false, false, false]);
  });

  it("accepts generic display names but canonical nonreserved slugs", () => {
    expect(
      ["New provider", "Renamed", "unspecified", "", " padded ", "bad\nname"].map((value) =>
        isModelName(value),
      ),
    ).toEqual([true, true, true, false, false, false]);
    expect(
      [
        "new-provider",
        "api",
        "admin",
        "privacy",
        "methodology",
        "robots",
        "robots.txt",
        "sitemap",
        "sitemap.xml",
        "Claude",
        "../path",
        "two--hyphens",
      ].map((value) => isSlug(value)),
    ).toEqual([true, false, false, false, false, false, false, false, false, false, false, false]);
  });

  it("keeps category and bucket contracts", () => {
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
