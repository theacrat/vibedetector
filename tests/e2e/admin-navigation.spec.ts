import { expect, test } from "@playwright/test";

import { adminProviders, claudeId, chatgptId, models } from "./identity-fixtures";

const statuses = adminProviders.map((provider) => ({
  attemptedAt: 0,
  configured: false,
  modelCount: 0,
  pending: false,
  provider: provider.id,
  scope:
    "Official API-discovered models available to the configured account. Not an exhaustive consumer catalogue.",
  status: "API key not configured",
  succeededAt: 0,
}));

function response(path: string): unknown {
  if (path.endsWith("/providers")) {
    return adminProviders;
  }
  if (path.endsWith("/sync")) {
    return statuses;
  }
  return models(["Claude model"]);
}

test("provider dashboard opens readonly UUID catalogues and unknown links select no provider", async ({
  page,
}) => {
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({ json: response(path) });
  });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { exact: true, name: "Providers" })).toBeFocused();
  await expect(page.locator(".admin-providers h3")).toHaveText(["Claude", "ChatGPT"]);
  await expect(page.getByLabel("Provider name")).toHaveCount(0);
  await expect(page.getByLabel("Model name", { exact: true })).toHaveCount(0);
  const claude = page
    .locator(".admin-providers > li")
    .filter({ has: page.getByRole("heading", { exact: true, name: "Claude" }) });
  await claude.getByRole("link", { name: "View catalogue" }).click();
  await expect(page).toHaveURL(`/admin/providers/${claudeId}`);
  await expect(page.getByRole("heading", { name: "Claude catalogue" })).toBeFocused();
  await expect(page.getByText("Claude model", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^(?:Add|Edit|Archive|Reactivate|Move|Save) /u }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Claude catalogue" })).toBeFocused();
  await page.getByRole("link", { name: "All providers" }).click();
  await page
    .locator(".admin-providers > li")
    .filter({ has: page.getByRole("heading", { exact: true, name: "ChatGPT" }) })
    .getByRole("link", { name: "View catalogue" })
    .click();
  await expect(page.getByRole("heading", { name: "ChatGPT catalogue" })).toBeFocused();
  await expect(page.getByText("Claude model", { exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("heading", { exact: true, name: "Providers" })).toBeFocused();
  await page.goto("/admin/providers/10000000-0000-4000-8000-000000000099");
  await expect(page.getByRole("heading", { name: "Provider not found" })).toBeFocused();
  await expect(page.locator(".admin-providers > li")).toHaveCount(0);
});

test("legacy provider creation route redirects to the sync dashboard", async ({ page }) => {
  const writes: string[] = [];
  await page.route("**/api/admin/**", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().url());
    }
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({ json: response(path) });
  });
  await page.goto("/admin/providers/new");
  await expect(page).toHaveURL("/admin");
  await expect(page.getByRole("heading", { exact: true, name: "Providers" })).toBeFocused();
  await expect(
    page.getByRole("button", { exact: true, name: "Refresh all providers" }),
  ).toBeEnabled();
  await expect(page.getByLabel("Provider name")).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("authentication preserves the requested catalogue route", async ({ page }) => {
  let authenticated = false;
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/login")) {
      authenticated = true;
      await route.fulfill({ json: { authenticated: true } });
      return;
    }
    if (!authenticated) {
      await route.fulfill({ json: { error: "Sign in required." }, status: 401 });
      return;
    }
    await route.fulfill({ json: response(path) });
  });
  await page.goto(`/admin/providers/${chatgptId}`);
  await expect(page.getByLabel("Administrator key")).toBeFocused();
  await page.getByLabel("Administrator key").fill("test-only-key");
  await page.getByRole("button", { exact: true, name: "Sign in" }).click();
  await expect(page).toHaveURL(`/admin/providers/${chatgptId}`);
  await expect(page.getByRole("heading", { name: "ChatGPT catalogue" })).toBeFocused();
});

test("sync completion cannot navigate back after leaving a provider catalogue", async ({
  page,
}) => {
  const { promise: gate, resolve: release } = Promise.withResolvers<undefined>();
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      await gate;
    }
    await route.fulfill({ json: response(path) });
  });
  await page.goto(`/admin/providers/${claudeId}`);
  await expect(page.getByText("Claude model", { exact: true })).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Refresh provider" }).click();
  await page.getByRole("link", { name: "All providers" }).click();
  const completed = page.waitForResponse(
    (result) => result.request().method() === "POST" && result.url().endsWith("/api/admin/sync"),
  );
  release(undefined);
  await completed;
  await expect(page).toHaveURL("/admin");
  await expect(page.getByRole("heading", { exact: true, name: "Providers" })).toBeVisible();
});

test("successful sync with failed catalogue refresh retains previous rows and reports the failure", async ({
  page,
}) => {
  let refreshed = false;
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      refreshed = true;
      await route.fulfill({ json: statuses });
      return;
    }
    if (refreshed && path.endsWith("/models")) {
      await route.fulfill({ json: { error: "Refresh unavailable." }, status: 503 });
      return;
    }
    await route.fulfill({ json: response(path) });
  });
  await page.goto(`/admin/providers/${claudeId}`);
  await expect(page.getByText("Claude model", { exact: true })).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Refresh provider" }).click();
  await expect(page.getByRole("alert")).toHaveText("Refresh unavailable.");
  await expect(page.getByText("Claude model", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Refresh provider" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
