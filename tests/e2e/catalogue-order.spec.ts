import { expect, test } from "@playwright/test";

test("public selectors preserve active order and graph filters omit archived entries", async ({
  page,
}) => {
  await page.clock.install();
  const models = [
    { active: true, name: "Second before first", provider: "claude" },
    { active: false, name: "Saved archived model", provider: "claude" },
    { active: true, name: "First after second", provider: "claude" },
  ];
  await page.route("**/api/session/claude", async (route) => {
    await route.fulfill({
      json: {
        category: "slow",
        model: "Saved archived model",
        models: models.filter((model) => model.active),
        siteKey: "test-site-key",
        window: Math.floor(Date.now() / 3_600_000),
      },
    });
  });
  await page.route("**/api/providers/claude?*", async (route) => {
    const response = await route.fetch();
    const dashboard: unknown = await response.json();
    if (typeof dashboard !== "object" || dashboard === null) {
      throw new Error("Expected a provider dashboard.");
    }
    await route.fulfill({ json: { ...dashboard, models } });
  });
  await page.goto("/claude?model=Saved%20archived%20model");
  const filter = page.getByRole("combobox", { name: "Filter reports by model" });
  await expect(filter).toHaveValue("");
  await expect(page).not.toHaveURL(/model=Saved/u);
  const report = page.getByRole("combobox", { exact: true, name: "Report model" });
  await expect(report).toBeEnabled();
  await expect(report).toHaveValue("Saved archived model");
  await page.clock.fastForward(60_001);
  await expect(filter.locator("option")).toHaveText([
    "All models",
    "Unspecified",
    "Second before first",
    "First after second",
  ]);
  await expect(report.locator("option")).toHaveText([
    "model",
    "Second before first",
    "First after second",
    "Saved archived model (archived)",
  ]);
  await expect(report).toHaveValue("Saved archived model");
  await expect(report.locator('option[value="Saved archived model"]')).toBeDisabled();
  await page.getByRole("button", { name: /^slow/iu }).click();
  await expect(page.getByText("Verifying before removing your report.")).toBeVisible();
});
