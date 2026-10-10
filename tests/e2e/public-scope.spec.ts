import { expect, test } from "@playwright/test";

test("unauthenticated model choices disclose official catalogue scope", async ({ page }) => {
  await page.goto("/cursor");
  await expect(
    page.getByText("Cloud Agent models. Not the complete Cursor IDE catalogue.", { exact: true }),
  ).toBeVisible();
  await page.goto("/claude");
  await expect(
    page.getByText(
      "Official API-discovered models available to the configured account. Not an exhaustive consumer catalogue.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.goto("/zai");
  await expect(
    page.getByText("Provider reporting only. No supported model listing API.", { exact: true }),
  ).toBeVisible();
});
