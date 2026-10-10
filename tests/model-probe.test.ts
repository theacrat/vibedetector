import { expect, test } from "vitest";

import { inspectPage, safeError } from "@/server/model-probe";
import type { ProbePage } from "@/server/model-probe";

test("probe cancels oversized streamed success before capturing metadata", async () => {
  let consumed = 0;
  let cancelled = false;
  const pages: ProbePage[] = [];
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
    pull(controller) {
      consumed += 1;
      controller.enqueue(new Uint8Array(100_000));
      if (consumed === 100) {
        controller.close();
      }
    },
  });
  const failure = await inspectPage("https://api.openai.com/v1/models", {}, pages, async () => {
    await Promise.resolve();
    return new Response(body);
  }).catch((error: unknown) => error);
  expect(safeError(failure)).toBe("Model response too large");
  expect(cancelled).toBe(true);
  expect(consumed).toBeLessThan(30);
  expect(pages).toEqual([
    { fields: [], models: [], status: 200, url: "https://api.openai.com/v1/models" },
  ]);
  expect(safeError(new Error("secret upstream diagnostic"))).toBe(
    "Request or response validation failed",
  );
});

test("probe captures bounded metadata and returns the body to catalogue validation", async () => {
  const pages: ProbePage[] = [];
  const original = { data: [{ id: "glm-5.3", object: "model" }], object: "list" };
  const response = await inspectPage("https://api.z.ai/api/paas/v4/models", {}, pages, async () => {
    await Promise.resolve();
    return Response.json(original);
  });
  expect(await response.json()).toEqual(original);
  expect(pages[0]?.models).toEqual(original.data);
});

test("probe rejects malformed UTF-8 without metadata capture", async () => {
  const pages: ProbePage[] = [];
  await expect(
    inspectPage("https://api.openai.com/v1/models", {}, pages, async () => {
      await Promise.resolve();
      return new Response(new Uint8Array([255]));
    }),
  ).rejects.toThrow();
  expect(pages[0]?.models).toEqual([]);
});
