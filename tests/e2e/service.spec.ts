import { expect, test } from "@playwright/test";

test("homepage links to every provider and provider pages survive reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".card b")).toHaveText([
    "ChatGPT",
    "Claude",
    "Cursor",
    "DeepSeek",
    "Gemini",
    "Grok",
    "Kimi",
    "Mistral",
    "Z.AI",
  ]);
  await Promise.all(
    ["claude", "chatgpt", "gemini", "grok", "mistral", "deepseek", "cursor", "zai", "kimi"].map(
      async (id) => expect(page.locator(`main a[href^="/${id}?"]`).first()).toBeVisible(),
    ),
  );
  await page.getByRole("link", { name: "View Claude reports" }).click();
  await expect(page.getByRole("heading", { name: "How's Claude feeling?" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "How's Claude feeling?" })).toBeVisible();
  await expect(page.getByText("insufficient community data", { exact: true })).toBeVisible();
  await page.getByRole("button", { exact: true, name: "7d" }).click();
  await expect(page.getByRole("img", { name: /reports/iu })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("unknown providers return a not found page", async ({ page }) => {
  const response = await page.goto("/not-a-provider");
  expect(response?.status()).toBe(404);
  await expect(page.getByText(/not found/iu).first()).toBeVisible();
});

test("retired Copilot links return not found and do not appear on the homepage", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "View Claude reports" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View Copilot reports" })).toHaveCount(0);
  const response = await page.goto("/copilot");
  expect(response?.status()).toBe(404);
  await expect(page.getByText(/not found/iu).first()).toBeVisible();
});

test("idle reporting controls do not continuously reload the session", async ({ page }) => {
  let sessions = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/session/10000000-0000-4000-8000-000000000005") {
      sessions += 1;
    }
  });
  await page.goto("/grok");
  await expect(page.getByRole("button", { exact: true, name: "slow" })).toBeEnabled();
  await expect.poll(() => sessions).toBeGreaterThan(0);
  const initialSessions = sessions;
  expect(initialSessions).toBeLessThanOrEqual(2);
  await page.getByRole("button", { exact: true, name: "7d" }).click();
  await expect(page.getByRole("img", { name: /Reports over 7d/iu })).toBeVisible();
  expect(sessions).toBe(initialSessions);
});

test("all provider paths return server-rendered content without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await Promise.all(
      ["claude", "chatgpt", "gemini", "grok", "mistral", "deepseek", "cursor", "zai", "kimi"].map(
        async (id) => {
          const response = await context.request.get(`/${id}`);
          expect(response.status()).toBe(200);
          expect(await response.text()).toContain("issue reports this hour");
        },
      ),
    );
    await page.goto("/gemini");
    await expect(page.getByRole("heading", { name: "How's Gemini feeling?" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("report API rejects cross-origin and unverified submissions", async ({ request }) => {
  const foreign = await request.post("/api/reports/claude", {
    data: { category: "slow", token: "invalid" },
    headers: { Origin: "https://attacker.example" },
  });
  expect(foreign.status()).toBe(403);
  const unverified = await request.post("/api/reports/claude", {
    data: { category: "slow", token: "" },
    headers: { Origin: String(test.info().project.use.baseURL) },
  });
  expect(unverified.ok()).toBe(false);
});
