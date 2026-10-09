import { describe, expect, it } from "vitest";

import { parseCatalogue } from "@/ui/catalogue-data";

describe("model catalogue responses", () => {
  it("accepts active and archived database entries", () => {
    expect(
      parseCatalogue([
        { active: true, name: "New Claude", provider: "claude" },
        { active: false, name: "Old Kimi", provider: "kimi" },
      ]).map((model) => model.active),
    ).toEqual([true, false]);
  });
  it("rejects malformed or cross-domain catalogue data", () => {
    expect(() => parseCatalogue({})).toThrow("model catalogue");
    expect(() => parseCatalogue([{ active: true, name: "Model", provider: "unknown" }])).toThrow(
      "model catalogue",
    );
    expect(() => parseCatalogue([{ active: 1, name: "Model", provider: "claude" }])).toThrow(
      "model catalogue",
    );
    expect(() => parseCatalogue([{ active: true, name: 12, provider: "claude" }])).toThrow(
      "model catalogue",
    );
  });
});
