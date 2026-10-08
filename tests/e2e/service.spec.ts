import { expect, test } from "@playwright/test";

test("homepage links to every provider and provider pages survive reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await Promise.all(
    ["claude", "chatgpt", "gemini", "copilot", "grok", "mistral", "deepseek", "cursor"].map(
      async (id) => expect(page.locator(`main a[href="/${id}"]`).first()).toBeVisible(),
    ),
  );
  await page.locator('main a[href="/claude"]').first().click();
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

test("report API rejects cross-origin and unverified submissions", async ({ request }) => {
  const foreign = await request.post("/api/reports/claude", {
    data: { category: "slow", token: "invalid" },
    headers: { Origin: "https://attacker.example" },
  });
  expect(foreign.status()).toBe(403);
  const unverified = await request.post("/api/reports/claude", {
    data: { category: "slow", token: "" },
    headers: { Origin: "http://127.0.0.1:41873" },
  });
  expect(unverified.ok()).toBe(false);
});
