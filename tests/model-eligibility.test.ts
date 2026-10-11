import { expect, test } from "vitest";

import { listServiceModels } from "@/server/model-api";
import { providerRegistry } from "@/server/provider-registry";

async function catalogue(slug: string, rows: unknown[], includeExcluded = true) {
  const adapter = providerRegistry.find((entry) => entry.provider.slug === slug)?.adapter;
  if (!adapter) {
    throw new Error("Missing provider");
  }
  let field = "data";
  if (adapter.protocol === "gemini" || adapter.protocol === "xai") {
    field = "models";
  } else if (adapter.protocol === "cursor") {
    field = "items";
  }
  return listServiceModels(
    adapter,
    "test",
    async (url) => {
      await Promise.resolve();
      if (slug === "grok") {
        expect(url).toBe("https://api.x.ai/v1/language-models");
      }
      return Response.json({ [field]: rows, ...(slug === "claude" ? { has_more: false } : {}) });
    },
    includeExcluded,
  );
}

test("lifecycle and fine-tuning exclude explicit records while unknowns stay visible", async () => {
  const result = await catalogue("chatgpt", [
    { id: "future-image-sounding-name", object: "model" },
    { id: "retired", lifecycle: "retired", object: "model" },
    { id: "ft:base:organisation:custom", object: "model" },
    { created: 1_700_000_000, id: "old-snapshot", object: "model", output_modalities: ["text"] },
  ]);
  expect(result.map((model) => model.metadata?.reasons ?? [])).toEqual([
    [],
    ["inactive-lifecycle"],
    ["fine-tuned"],
    [],
  ]);
  expect(result[3]?.metadata?.releasedAt).toBe(1_700_000_000_000);
});

test("Anthropic active lifecycle and reliable dates survive normalisation", async () => {
  const result = await catalogue("claude", [
    {
      created_at: "2026-10-07T18:00:00Z",
      display_name: "Active",
      id: "active",
      lifecycle: "active",
      type: "model",
    },
    { display_name: "Old", id: "deprecated", lifecycle: "deprecated", type: "model" },
  ]);
  expect(result[0]?.metadata).toMatchObject({
    dateSource: "api.created_at",
    reasons: [],
    releasedAt: Date.parse("2026-10-07T18:00:00Z"),
  });
  expect(result[1]?.metadata?.reasons).toEqual(["inactive-lifecycle"]);
});

test("Gemini documented speech excludes without guessing from unknown IDs", async () => {
  const result = await catalogue("gemini", [
    {
      name: "models/gemini-2.5-flash-preview-tts",
      supportedGenerationMethods: ["generateContent"],
    },
    { name: "models/unknown-tts", supportedGenerationMethods: ["generateContent"] },
    {
      name: "models/multimodal-image",
      outputModalities: ["image", "text"],
      supportedGenerationMethods: ["generateContent"],
    },
    {
      name: "models/image-only",
      outputModalities: ["image"],
      supportedGenerationMethods: ["generateContent"],
    },
    { name: "models/embed", supportedGenerationMethods: ["embedContent"] },
  ]);
  expect(result.map((model) => model.metadata?.reasons ?? [])).toEqual([
    ["speech-generation"],
    [],
    [],
    ["no-text-output"],
    ["no-generate-content"],
  ]);
});

test("latest explicit Gemini lifecycle announcement overrides stable catalogue labels", async () => {
  const result = await catalogue("gemini", [
    {
      name: "models/gemini-3.1-flash-image",
      outputModalities: ["image", "text"],
      supportedGenerationMethods: ["generateContent"],
    },
  ]);
  expect(result[0]?.metadata?.reasons).toEqual(["deprecated"]);
  expect(result[0]?.metadata?.evidence["documentedTask"]).toMatchObject({
    announcedAt: "2026-10-06",
    checkedAt: "2026-10-11",
    source: "https://ai.google.dev/gemini-api/docs/changelog",
  });
});

test("stable Gemini image and text output remains eligible without a lifecycle announcement", async () => {
  const result = await catalogue("gemini", [
    {
      name: "models/gemini-3-pro-image",
      outputModalities: ["image", "text"],
      supportedGenerationMethods: ["generateContent"],
    },
  ]);
  expect(result[0]?.metadata?.reasons).toEqual([]);
});

test("Gemini Omni preview preserves video capability and explicit deprecation evidence", async () => {
  const result = await catalogue("gemini", [
    { name: "models/gemini-omni-flash-preview", supportedGenerationMethods: ["generateContent"] },
  ]);
  expect(result[0]?.metadata?.reasons).toEqual(["deprecated"]);
  expect(result[0]?.metadata?.evidence["documentedTask"]).toMatchObject({
    capabilityTask: "video-generation",
    source: "https://ai.google.dev/gemini-api/docs/changelog",
    task: "deprecated",
  });
});

test("Mistral owner is the operator and canonical relationships remain explicit", async () => {
  const result = await catalogue("mistral", [
    {
      aliases: ["valid-latest"],
      capabilities: { completion_chat: true },
      created: 1_791_670_255,
      id: "valid",
      name: "valid",
      object: "model",
      owned_by: "mistralai",
    },
    {
      aliases: ["valid"],
      capabilities: { completion_chat: true },
      id: "valid-latest",
      name: "valid",
      object: "model",
      owned_by: "mistralai",
    },
    {
      capabilities: { completion_chat: true },
      id: "glm-5-2",
      object: "model",
      owned_by: "mistralai",
    },
    { capabilities: { completion_chat: false }, id: "embed", object: "model" },
    {
      capabilities: { completion_chat: true },
      id: "fine-tuned",
      object: "model",
      type: "fine-tuned",
    },
    { deprecation: "2026-09-01T00:00:00Z", id: "deprecated", object: "model" },
  ]);
  expect(result.map((model) => model.metadata?.reasons ?? [])).toEqual([
    [],
    [],
    ["third-party-publisher"],
    ["no-chat-completion"],
    ["fine-tuned"],
    ["deprecated"],
  ]);
  expect(result[0]?.metadata?.releasedAt).toBeUndefined();
  expect(result[1]?.metadata?.canonicalId).toBe("valid");
});

test.each(["", "not-a-date", "2026-02-30T00:00:00Z", "2026-09-01", { date: 42 }])(
  "invalid Mistral deprecation metadata fails safely",
  async (deprecation) => {
    await expect(
      catalogue("mistral", [{ deprecation, id: "model", object: "model" }]),
    ).rejects.toThrow("Invalid model response");
  },
);

test("Grok text capabilities and aliases use the full language catalogue", async () => {
  const result = await catalogue("grok", [
    {
      aliases: ["chat-latest"],
      created: 1_700_000_000,
      id: "chat",
      object: "model",
      output_modalities: ["text"],
    },
    { aliases: [], id: "image", object: "model", output_modalities: ["image"] },
  ]);
  expect(result[0]?.metadata).toMatchObject({
    aliases: ["chat-latest"],
    dateSource: "api.created",
    reasons: [],
  });
  expect(result[1]?.metadata?.reasons).toEqual(["no-text-output"]);
});

test("Kimi accepts reasoning or text chat and does not trust unstable creation time", async () => {
  const result = await catalogue("kimi", [
    { created: 1_790_257_672, id: "reasoning", object: "model", supports_reasoning: true },
    { id: "chat", object: "model", supports_reasoning: false, supports_text_chat: true },
    { id: "neither", object: "model", supports_reasoning: false, supports_text_chat: false },
    { id: "unknown", object: "model" },
  ]);
  expect(result.map((model) => model.metadata?.reasons ?? [])).toEqual([
    [],
    [],
    ["no-text-chat-or-reasoning"],
    [],
  ]);
  expect(result[0]?.metadata?.releasedAt).toBeUndefined();
});

test("Cursor Auto and variants are preserved and Z.AI unknown capabilities fail open", async () => {
  const cursor = await catalogue("cursor", [
    {
      aliases: ["auto"],
      displayName: "Auto",
      id: "default",
      variants: [{ displayName: "Auto", isDefault: true, params: [] }],
    },
  ]);
  expect(cursor[0]?.metadata?.evidence["variants"]).toEqual([
    { displayName: "Auto", isDefault: true, params: [] },
  ]);
  expect(cursor[0]?.metadata?.reasons).toEqual([]);
  expect(await catalogue("zai", [{ id: "unknown-image", object: "model" }], false)).toEqual([
    { id: "unknown-image", name: "unknown-image" },
  ]);
});

test.each([
  { output_modalities: [12] },
  { capabilities: { completion_chat: "yes" } },
  { aliases: [false] },
  { lifecycle: false },
  { created: "1700000000" },
])("malformed metadata fails the catalogue boundary %j", async (metadata) => {
  await expect(
    catalogue("chatgpt", [{ id: "model", object: "model", ...metadata }]),
  ).rejects.toThrow("Invalid model response");
});

test("valid all-filtered catalogues differ from upstream emptiness", async () => {
  expect(
    await catalogue(
      "deepseek",
      [{ id: "audio", object: "model", output_modalities: ["audio"] }],
      false,
    ),
  ).toEqual([]);
  await expect(catalogue("deepseek", [], false)).rejects.toThrow("Empty model catalogue");
});
