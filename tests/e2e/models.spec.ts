import { expect, test } from "@playwright/test";

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
  await reportModel.selectOption("GPT-6.1 Sol");
  expect(writes).toEqual([]);
  await slow.click();
  await expect(verify).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Cancel" }).click();
  await expect(reportModel).toHaveValue("GPT-6.1 Sol");
  expect(writes).toEqual([]);
  await page.reload();
  await expect(reportModel).toHaveValue("");
  await reportModel.selectOption("GPT-6.1 Sol");
  await slow.click();
  await verify.click();
  await expect(slow).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(reportModel).toHaveValue("GPT-6.1 Sol");
  await reportModel.selectOption("Claude Opus 5.5");
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
    { category: "slow", model: "GPT-6.1 Sol" },
    { category: "slow", model: "Claude Opus 5.5" },
  ]);
  await page.reload();
  await expect(reportModel).toHaveValue("Claude Opus 5.5");
  const hourly = await page.locator(".sub").textContent();
  const verdict = await page.locator(".verdict").textContent();
  await filter.selectOption("GPT-6.1 Sol");
  await expect(page).toHaveURL(/model=GPT-6\.1(?:%20|\+)Sol/u);
  await expect(
    page.getByText("Filtered reports; provider verdict uses all models.", { exact: false }),
  ).toBeVisible();
  await expect(reportModel).toHaveValue("Claude Opus 5.5");
  await expect(page.locator(".sub")).toHaveText(hourly ?? "");
  await expect(page.locator(".verdict")).toHaveText(verdict ?? "");
  await page.getByRole("button", { exact: true, name: "7d" }).click();
  await expect(page).toHaveURL(/range=7d/u);
  await expect(filter).toHaveValue("GPT-6.1 Sol");
  await page.reload();
  await expect(filter).toHaveValue("GPT-6.1 Sol");
  await expect(reportModel).toHaveValue("Claude Opus 5.5");
  await slow.click();
  await expect(page.getByText("Verifying before removing your report.")).toBeVisible();
  await verify.click();
  await expect(slow).toHaveAttribute("aria-pressed", "false");
  // JSON null retracts the contribution without replacing its model metadata.
  // oxlint-disable-next-line unicorn/no-null
  expect(writes.at(-1)).toMatchObject({ category: null, model: "Claude Opus 5.5" });
});

for (const model of ["invented-model", "GLM-5.3"]) {
  test(`invalid model ${model} normalizes to all models`, async ({ page }) => {
    const response = await page.goto(`/claude?model=${encodeURIComponent(model)}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("combobox", { name: "Filter reports by model" })).toHaveValue("");
    await expect(page).not.toHaveURL(new RegExp(encodeURIComponent(model), "u"));
  });
}
