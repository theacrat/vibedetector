import { describe, expect, it } from "vitest";

import { parseCatalogue, parseProviders } from "@/ui/catalogue-data";

import { provider, modelIds } from "./ui-fixtures";

describe("model catalogue responses", () => {
  it("accepts active and archived database entries", () => {
    expect(
      parseCatalogue([
        { active: true, id: modelIds[0], name: "New Claude", provider: provider.id },
        { active: false, id: modelIds[1], name: "Old Kimi", provider: provider.id },
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

it("provider catalogue accepts DB providers and rejects malformed identities", () => {
  expect(parseProviders([provider])).toEqual([provider]);
  expect(() => parseProviders([{ ...provider, id: "claude" }])).toThrow("provider catalogue");
  expect(() => parseProviders([{ ...provider, active: "true" }])).toThrow("provider catalogue");
});
