import { expect, test } from "@playwright/test";

import { claudeId, savedId, draftId, nextId, selectedId } from "./identity-fixtures";

test("report metadata persists independently of shareable chart filters", async ({
  page,
}, testInfo) => {
  const writes: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
    }
    await route.continue({
      headers: {
        ...route.request().headers(),
        "cf-connecting-ip": testInfo.project.name === "desktop" ? "198.51.100.81" : "198.51.100.82",
      },
    });
  });
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", async (route) => {
    await route.fulfill({
      body: `window.turnstile = {
        render(container, options) {
          const button = document.createElement('button');
          button.textContent = 'Verify test report';
          button.onclick = () => options.callback('XXXX.DUMMY.TOKEN.XXXX');
          container.append(button);
          return 'model-test';
        },
        execute() {},
        remove() {}
      };`,
      contentType: "application/javascript",
    });
  });
  await page.goto("/copilot");
  const reportModel = page.getByRole("combobox", { exact: true, name: "Report model" });
  const filter = page.getByRole("combobox", { name: "Filter reports by model" });
  const slow = page.getByRole("button", { name: /^slow/iu });
  const verify = page.getByRole("button", { name: "Verify test report" });
  await expect(reportModel).toBeEnabled();
  await expect(reportModel).toHaveValue("");
  const solId = await selectedId(page, "Report model", "GPT-6.1 Sol");
  const opusId = await selectedId(page, "Report model", "Claude Opus 5.5");
  await reportModel.selectOption(solId);
  expect(writes).toEqual([]);
  await slow.click();
  await expect(verify).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Cancel" }).click();
  await expect(reportModel).toHaveValue(solId);
  expect(writes).toEqual([]);
  await page.reload();
  await expect(reportModel).toHaveValue("");
  await reportModel.selectOption(solId);
  await slow.click();
  await verify.click();
  await expect(slow).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(reportModel).toHaveValue(solId);
  await reportModel.selectOption(opusId);
  await expect(page.locator(".hint")).toHaveText(
    "Choose a category to save the new model to your report.",
  );
  expect(writes).toHaveLength(1);
  await slow.click();
  await expect(page.getByText("A quick check before recording your report.")).toBeVisible();
  await verify.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(slow).toHaveAttribute("aria-pressed", "true");
  expect(writes).toMatchObject([
    { category: "slow", model: solId },
    { category: "slow", model: opusId },
  ]);
  await page.reload();
  await expect(reportModel).toHaveValue(opusId);
  const hourly = await page.locator(".sub").textContent();
  const verdict = await page.locator(".verdict").textContent();
  await filter.selectOption(solId);
  await expect(page).toHaveURL(new RegExp(`model=${solId}`, "u"));
  await expect(
    page.getByText("Filtered reports; provider verdict uses all models.", { exact: false }),
  ).toBeVisible();
  await expect(reportModel).toHaveValue(opusId);
  await expect(page.locator(".sub")).toHaveText(hourly ?? "");
  await expect(page.locator(".verdict")).toHaveText(verdict ?? "");
  await page.getByRole("button", { exact: true, name: "7d" }).click();
  await expect(page).toHaveURL(/range=7d/u);
  await expect(filter).toHaveValue(solId);
  await page.reload();
  await expect(filter).toHaveValue(solId);
  await expect(reportModel).toHaveValue(opusId);
  await slow.click();
  await expect(page.getByText("Verifying before removing your report.")).toBeVisible();
  await verify.click();
  await expect(slow).toHaveAttribute("aria-pressed", "false");
  // JSON null retracts the contribution without replacing its model metadata.
  // oxlint-disable-next-line unicorn/no-null
  expect(writes.at(-1)).toMatchObject({ category: null, model: opusId });
});

for (const model of ["invented-model", "GLM-5.3", "ffffffff-ffff-4fff-8fff-ffffffffffff"]) {
  test(`invalid model ${model} normalizes to all models`, async ({ page }) => {
    const response = await page.goto(`/claude?range=7d&model=${encodeURIComponent(model)}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("combobox", { name: "Filter reports by model" })).toHaveValue("");
    await expect(page).not.toHaveURL(new RegExp(encodeURIComponent(model), "u"));
    await expect(page).toHaveURL(/range=7d/u);
  });
}

test("catalogue refresh preserves a draft and archived saved reports can still be undone", async ({
  page,
}) => {
  await page.clock.install();
  let refreshed = false;
  await page.route(`**/api/session/${claudeId}`, async (route) => {
    await route.fulfill({
      json: {
        category: "slow",
        model: savedId,
        models: [
          { active: false, id: savedId, name: "Saved archived model", provider: claudeId },
          {
            active: true,
            id: refreshed ? nextId : draftId,
            name: refreshed ? "New active model" : "Draft model",
            provider: claudeId,
          },
        ],
        siteKey: "test-site-key",
        window: Math.floor(Date.now() / 3_600_000),
      },
    });
  });
  await page.goto("/claude");
  const select = page.getByRole("combobox", { exact: true, name: "Report model" });
  await expect(select).toHaveValue(savedId);
  await expect(select.locator(`option[value="${savedId}"]`)).toBeDisabled();
  await page.getByRole("button", { name: /^slow/iu }).click();
  await expect(page.getByText("Verifying before removing your report.")).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Cancel" }).click();
  await select.selectOption(draftId);
  refreshed = true;
  await page.clock.fastForward(60_001);
  await expect(select.locator(`option[value="${nextId}"]`)).toHaveCount(1);
  await expect(select).toHaveValue(draftId);
  await expect(select.locator(`option[value="${draftId}"]`)).toBeDisabled();
  await page.getByRole("button", { name: /^broken/iu }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This model is archived. Choose an active model for a new report.",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("an existing archived report can change category but cannot be recreated after undo", async ({
  page,
}) => {
  let category: string | null = "slow";
  const writes: unknown[] = [];
  await page.route(`**/api/session/${claudeId}`, async (route) => {
    await route.fulfill({
      json: {
        category,
        model: savedId,
        models: [{ active: false, id: savedId, name: "Saved archived model", provider: claudeId }],
        siteKey: "test-site-key",
        window: Math.floor(Date.now() / 3_600_000),
      },
    });
  });
  await page.route(`**/api/reports/${claudeId}`, async (route) => {
    const body: unknown = route.request().postDataJSON();
    writes.push(body);
    if (body && typeof body === "object" && "category" in body) {
      // JSON null is a report retraction.
      // oxlint-disable-next-line unicorn/no-null
      category = typeof body.category === "string" ? body.category : null;
    }
    await route.fulfill({ json: { category, model: savedId } });
  });
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", async (route) => {
    await route.fulfill({
      body: `window.turnstile = {
        render(container, options) {
          const button = document.createElement('button');
          button.textContent = 'Verify archived report';
          button.onclick = () => options.callback('test-token');
          container.append(button);
          return 'archived-test';
        },
        execute() {},
        remove() {}
      };`,
      contentType: "application/javascript",
    });
  });
  await page.goto("/claude");
  const select = page.getByRole("combobox", { exact: true, name: "Report model" });
  const broken = page.getByRole("button", { name: /^broken/iu });
  await expect(select).toHaveValue(savedId);
  await broken.click();
  await page.getByRole("button", { name: "Verify archived report" }).click();
  await expect(broken).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes).toMatchObject([{ category: "broken", model: savedId }]);
  await broken.click();
  await expect(page.getByText("Verifying before removing your report.")).toBeVisible();
  await page.getByRole("button", { name: "Verify archived report" }).click();
  await expect(broken).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await broken.click();
  await expect(page.getByRole("alert")).toHaveText(
    "This model is archived. Choose an active model for a new report.",
  );
  expect(writes).toHaveLength(2);
});

test("malformed public catalogue refresh retains the current dashboard and shows an error", async ({
  page,
}) => {
  await page.clock.install();
  await page.route(`**/api/providers/${claudeId}?*`, async (route) => {
    await route.fulfill({
      json: { models: [{ active: "not-a-boolean", name: "Invalid model", provider: "claude" }] },
    });
  });
  await page.goto("/claude");
  const filter = page.getByRole("combobox", { name: "Filter reports by model" });
  await expect(page.getByRole("combobox", { exact: true, name: "Report model" })).toBeEnabled();
  await expect(filter).toBeVisible();
  const options = await filter.locator("option").allTextContents();
  const hourly = await page.locator(".sub").textContent();
  await page.clock.fastForward(60_001);
  await expect(page.getByRole("alert")).toHaveText(
    "Live updates are unavailable. Please refresh to try again.",
  );
  expect(await filter.locator("option").allTextContents()).toEqual(options);
  await expect(page.locator(".sub")).toHaveText(hourly ?? "");
  await expect(page.getByRole("heading", { name: "Couldn't load this page." })).toHaveCount(0);
});
