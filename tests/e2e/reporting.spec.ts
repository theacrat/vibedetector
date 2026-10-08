import { expect, test } from "@playwright/test";

test("a challenged report persists, switches category and can be undone", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/mistral");
  const slow = page.getByRole("button", { exact: true, name: "slow" });
  await slow.click();
  await expect(slow).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  await page.reload();
  await expect(slow).toHaveAttribute("aria-pressed", "true");
  const broken = page.getByRole("button", { exact: true, name: "broken" });
  await broken.click();
  await expect(broken).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  await expect(slow).toHaveAttribute("aria-pressed", "false");
  await broken.click();
  await expect(broken).toHaveAttribute("aria-pressed", "false", { timeout: 20_000 });
  await page.reload();
  await expect(broken).toHaveAttribute("aria-pressed", "false");
  await expect(slow).toHaveAttribute("aria-pressed", "false");
});
