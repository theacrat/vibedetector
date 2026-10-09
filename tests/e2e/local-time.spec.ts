import { expect, test } from "@playwright/test";

test("chart times follow the device timezone without hydration errors", async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: "Pacific/Honolulu" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("/claude");
    const response = await context.request.get("/api/providers/claude?range=24h");
    const data: unknown = await response.json();
    if (
      typeof data !== "object" ||
      data === null ||
      !("buckets" in data) ||
      !Array.isArray(data.buckets)
    ) {
      throw new Error("Dashboard buckets unavailable");
    }
    const latest: unknown = data.buckets.at(-1);
    if (
      typeof latest !== "object" ||
      latest === null ||
      !("t" in latest) ||
      typeof latest.t !== "number"
    ) {
      throw new Error("Latest report interval unavailable");
    }
    const expected = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Pacific/Honolulu",
    }).format(latest.t - 24 * 3_600_000);
    await expect(page.locator(".chart .axis").filter({ hasText: expected })).toHaveCount(1);
    await expect(page.locator(".now")).toHaveCount(0);
    await expect(page.locator(".chart-note")).toContainText("local timezone");
    expect(errors).toEqual([]);
    await expect(page.locator(".mono-tile img")).toHaveAttribute("src", "/logos/claude.svg");
    await page.getByRole("button", { exact: true, name: "7d" }).click();
    await page.locator(".chart").hover();
    await expect(page.locator(".tip .timestamp")).toHaveText(
      /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2}:\d{2}$/u,
    );
  } finally {
    await context.close();
  }
});
