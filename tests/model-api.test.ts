import { describe, expect, test } from "vitest";

import { listServiceModels } from "@/server/model-api";
import type { ModelAdapter } from "@/server/provider-registry";
import { providerRegistry } from "@/server/provider-registry";

function adapter(slug: string): ModelAdapter {
  const value = providerRegistry.find((entry) => entry.provider.slug === slug)?.adapter;
  if (!value) {
    throw new Error("Missing adapter");
  }
  return value;
}

describe("official model APIs", () => {
  test("Cursor discovers Cloud Agent IDs and display names without consumer aliases", async () => {
    const result = await listServiceModels(adapter("cursor"), "secret", async (url, init) => {
      await Promise.resolve();
      expect(url).toBe("https://api.cursor.com/v1/models");
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret");
      expect(init.redirect).toBe("error");
      return Response.json({
        items: [{ aliases: ["composer"], displayName: "Composer 2", id: "composer-2" }],
      });
    });
    expect(result).toEqual([{ id: "composer-2", name: "Composer 2 (composer-2)" }]);
  });

  test("Anthropic walks all pages and checks advancing last_id", async () => {
    const urls: string[] = [];
    const result = await listServiceModels(adapter("claude"), "secret", async (url, init) => {
      await Promise.resolve();
      urls.push(url);
      expect(new Headers(init.headers).get("x-api-key")).toBe("secret");
      return Response.json(
        urls.length === 1
          ? { data: [{ id: "first", type: "model" }], has_more: true, last_id: "first" }
          : { data: [{ id: "last", type: "model" }], has_more: false, last_id: "last" },
      );
    });
    expect(result).toEqual([
      { id: "first", name: "first" },
      { id: "last", name: "last" },
    ]);
    expect(urls).toEqual([
      "https://api.anthropic.com/v1/models?limit=1000",
      "https://api.anthropic.com/v1/models?limit=1000&after_id=first",
    ]);
  });

  test("Google retains resource IDs, follows page tokens and filters generation capabilities", async () => {
    let calls = 0;
    const result = await listServiceModels(adapter("gemini"), "secret", async (url, init) => {
      await Promise.resolve();
      expect(new Headers(init.headers).get("x-goog-api-key")).toBe("secret");
      expect(url).not.toContain("secret");
      calls += 1;
      if (calls === 1) {
        return Response.json({
          models: [{ name: "models/embed", supportedGenerationMethods: ["embedContent"] }],
          nextPageToken: "next",
        });
      }
      expect(url).toContain("pageToken=next");
      return Response.json({
        models: [{ name: "models/gemini", supportedGenerationMethods: ["generateContent"] }],
      });
    });
    expect(result).toEqual([{ id: "models/gemini", name: "models/gemini" }]);
  });

  test.each([
    { data: [] },
    {
      data: [
        { id: "valid", object: "model" },
        { id: "valid", object: "model" },
      ],
    },
    { data: [{ id: " invalid ", object: "model" }] },
    { data: [{ id: "valid", object: "model" }], nextCursor: "more" },
    { data: [{ id: "valid", object: "model" }], has_more: true },
    { data: [{ id: "valid" }] },
  ])("rejects unsafe unpaginated results %j", async (body) => {
    await expect(
      listServiceModels(adapter("kimi"), "secret", async () => {
        await Promise.resolve();
        return Response.json(body);
      }),
    ).rejects.toThrow();
  });

  test("second-page failure cannot return a partial catalogue", async () => {
    let calls = 0;
    await expect(
      listServiceModels(adapter("claude"), "secret", async () => {
        await Promise.resolve();
        calls += 1;
        return calls === 1
          ? Response.json({
              data: [{ id: "first", type: "model" }],
              has_more: true,
              last_id: "first",
            })
          : new Response("secret diagnostic", { status: 429 });
      }),
    ).rejects.toThrow("Service returned HTTP 429");
  });

  test("stream byte bound does not trust Content-Length", async () => {
    await expect(
      listServiceModels(adapter("deepseek"), "secret", async () => {
        await Promise.resolve();
        return new Response("x".repeat(2_000_001), { headers: { "Content-Length": "1" } });
      }),
    ).rejects.toThrow("Model response too large");
  });

  test("malformed filtered Google models fail instead of disappearing", async () => {
    await expect(
      listServiceModels(adapter("gemini"), "secret", async () => {
        await Promise.resolve();
        return Response.json({
          models: [{ name: "models/embed", supportedGenerationMethods: [123] }],
        });
      }),
    ).rejects.toThrow();
  });
});
