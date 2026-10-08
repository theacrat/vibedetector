import { expect, test } from "@playwright/test";

test("a challenged report persists, switches category and can be undone", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.route("**/api/**", async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        "cf-connecting-ip": testInfo.project.name === "desktop" ? "198.51.100.21" : "198.51.100.22",
      },
    });
  });
  await page.goto("/mistral");
  const slow = page.getByRole("button", { name: /^slow/iu });
  await slow.click();
  await expect(slow).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  await page.reload();
  await expect(slow).toHaveAttribute("aria-pressed", "true");
  const broken = page.getByRole("button", { name: /^broken/iu });
  await broken.click();
  await expect(broken).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  await expect(slow).toHaveAttribute("aria-pressed", "false");
  await broken.click();
  await expect(broken).toHaveAttribute("aria-pressed", "false", { timeout: 20_000 });
  await page.reload();
  await expect(broken).toHaveAttribute("aria-pressed", "false");
  await expect(slow).toHaveAttribute("aria-pressed", "false");
});
