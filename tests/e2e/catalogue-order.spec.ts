import { expect, test } from "@playwright/test";

import { claudeId, savedId, draftId, nextId } from "./identity-fixtures";

test("public selectors preserve active order and graph filters omit archived entries", async ({
  page,
}) => {
  await page.clock.install();
  const models = [
    { active: true, id: draftId, name: "Second before first", provider: claudeId },
    { active: false, id: savedId, name: "Saved archived model", provider: claudeId },
    { active: true, id: nextId, name: "First after second", provider: claudeId },
  ];
  await page.route(`**/api/session/${claudeId}`, async (route) => {
    await route.fulfill({
      json: {
        category: "slow",
        model: savedId,
        models: models.filter((model) => model.active),
        savedModel: {
          active: false,
          id: savedId,
          name: "Saved archived model",
          provider: claudeId,
        },
        siteKey: "test-site-key",
        window: Math.floor(Date.now() / 3_600_000),
      },
    });
  });
  await page.route(`**/api/providers/${claudeId}?*`, async (route) => {
    const response = await route.fetch();
    const dashboard: unknown = await response.json();
    if (typeof dashboard !== "object" || dashboard === null) {
      throw new Error("Expected a provider dashboard.");
    }
    await route.fulfill({ json: { ...dashboard, models } });
  });
  await page.goto(`/claude?model=${savedId}`);
  const filter = page.getByRole("combobox", { name: "Filter reports by model" });
  await expect(filter).toHaveValue("");
  await expect(page).not.toHaveURL(new RegExp(`model=${savedId}`, "u"));
  const report = page.getByRole("combobox", { exact: true, name: "Report model" });
  await expect(report).toBeEnabled();
  await expect(report).toHaveValue(savedId);
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
  await expect(report).toHaveValue(savedId);
  await expect(report.locator(`option[value="${savedId}"]`)).toBeDisabled();
  await page.getByRole("button", { name: /^slow/iu }).click();
  await expect(page.getByText("Verifying before removing your report.")).toBeVisible();
});

test("automatic catalogue refresh replaces active ordering without manual movement controls", async ({
  page,
}) => {
  await page.clock.install();
  let refreshed = false;
  await page.route(`**/api/session/${claudeId}`, async (route) => {
    await route.fulfill({
      json: {
        category: "slow",
        model: savedId,
        models: refreshed
          ? [
              { active: true, id: nextId, name: "API first model", provider: claudeId },
              { active: true, id: draftId, name: "API second model", provider: claudeId },
            ]
          : [{ active: true, id: savedId, name: "Previous model", provider: claudeId }],
        savedModel: { active: !refreshed, id: savedId, name: "Previous model", provider: claudeId },
        siteKey: "test-site-key",
        window: Math.floor(Date.now() / 3_600_000),
      },
    });
  });
  await page.goto("/claude");
  const report = page.getByRole("combobox", { exact: true, name: "Report model" });
  await expect(report.locator("option")).toHaveText(["model", "Previous model"]);
  refreshed = true;
  await page.clock.fastForward(60_001);
  await expect(report.locator("option")).toHaveText([
    "model",
    "API first model",
    "API second model",
    "Previous model (archived)",
  ]);
  await expect(report.locator(`option[value="${savedId}"]`)).toBeDisabled();
  await expect(page.getByRole("button", { name: /Move (?:up|down)/u })).toHaveCount(0);
});
