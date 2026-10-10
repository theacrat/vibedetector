import { expect, test } from "@playwright/test";

import type { SyncStatus } from "@/server/catalogue-sync";

import { adminProviders, claudeId, chatgptId, models } from "./identity-fixtures";

const initialStatuses: SyncStatus[] = adminProviders.map((provider) => ({
  attemptedAt: 0,
  configured: false,
  modelCount: 0,
  pending: false,
  provider: provider.id,
  scope: "Official API-discovered models available to the configured account",
  status: "API key not configured",
  succeededAt: 0,
}));

function catalogueResponse(
  path: string,
  catalogue: unknown,
  statuses: unknown = initialStatuses,
): unknown {
  if (path.endsWith("/providers")) {
    return adminProviders;
  }
  if (path.endsWith("/sync")) {
    return statuses;
  }
  return catalogue;
}

test("admin key stays out of URLs and storage while provider sync refreshes the readonly catalogue", async ({
  page,
}) => {
  const key = "test-only-key-not-a-real-secret-123456";
  let authenticated = false;
  let catalogue = models(["Fresh model"], chatgptId);
  let statuses = structuredClone(initialStatuses);
  const writes: unknown[] = [];
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    expect(route.request().url()).not.toContain(key);
    const body: unknown =
      route.request().method() === "POST" ? route.request().postDataJSON() : undefined;
    if (path.endsWith("/login")) {
      authenticated = Boolean(
        body && typeof body === "object" && "key" in body && body.key === key,
      );
    }
    if (path.endsWith("/logout")) {
      authenticated = false;
      await route.fulfill({ json: { authenticated: false } });
      return;
    }
    if (!authenticated) {
      await route.fulfill({ json: { error: "Sign in required." }, status: 401 });
      return;
    }
    if (path.endsWith("/sync") && body) {
      writes.push(body);
      catalogue = models(["Discovered model"], chatgptId);
      statuses = statuses.map((status) => ({
        ...status,
        configured: true,
        modelCount: status.provider === chatgptId ? 1 : 0,
        status: "Synced",
        succeededAt: 1_800_000_000_000,
      }));
    }
    await route.fulfill({
      json: path.endsWith("/login")
        ? { authenticated: true }
        : catalogueResponse(path, catalogue, statuses),
    });
  });
  await page.goto("/admin");
  const input = page.getByLabel("Administrator key");
  await expect(input).toHaveAttribute("type", "password");
  await expect(input).toBeEnabled();
  await input.fill("wrong-key");
  await page.getByRole("button", { exact: true, name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Sign in required.");
  await expect(input).toHaveValue("");
  await input.fill(key);
  await page.getByRole("button", { exact: true, name: "Sign in" }).click();
  await expect(page.getByRole("heading", { exact: true, name: "Providers" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Catalogue sync" })).toBeVisible();
  const chatgpt = page
    .locator(".admin-providers > li")
    .filter({ has: page.getByRole("heading", { exact: true, name: "ChatGPT" }) });
  await expect(chatgpt).toContainText("API key not configured");
  await expect(chatgpt).toContainText("Last success: Never. Models: 0.");
  await chatgpt.getByRole("link", { name: "View catalogue" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/providers/${chatgptId}$`, "u"));
  await expect(page.getByText("Fresh model", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Model name", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^(?:Add|Edit|Archive|Reactivate|Move|Save) /u }),
  ).toHaveCount(0);
  await page.getByRole("button", { exact: true, name: "Refresh provider" }).click();
  await expect(page.getByText("Discovered model", { exact: true })).toBeVisible();
  await expect(page.locator(".admin-providers")).toContainText("Synced");
  expect(writes).toEqual([{ provider: chatgptId }]);
  await page.reload();
  await expect(page.getByText("Discovered model", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "All providers" }).click();
  await page.getByRole("button", { exact: true, name: "Refresh all providers" }).click();
  await expect(
    page.getByRole("button", { exact: true, name: "Refresh all providers" }),
  ).toBeEnabled();
  expect(writes).toEqual([{ provider: chatgptId }, {}]);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");
  const storage = await page.evaluate(() =>
    [localStorage, sessionStorage].map((store) =>
      Array.from({ length: store.length }, (_unused, index) => {
        const name = store.key(index);
        return [name, name ? store.getItem(name) : ""];
      }),
    ),
  );
  expect(JSON.stringify(storage)).not.toContain(key);
  expect(JSON.stringify(storage)).not.toContain("wrong-key");
  expect(await page.content()).not.toContain(key);
  expect(page.url()).not.toContain(key);
});

test("admin configuration errors are visible", async ({ page }) => {
  await page.route("**/api/admin/**", async (route) => {
    await route.fulfill({
      json: { error: "Administration is unavailable. Configure ADMIN_KEY." },
      status: 503,
    });
  });
  await page.goto("/admin");
  await expect(page.getByRole("alert")).toHaveText(
    "Administration is unavailable. Configure ADMIN_KEY.",
  );
});

for (const catalogue of [
  { models: [] },
  [
    {
      active: "true",
      id: "20000000-0000-4000-8000-000000000001",
      name: "Invalid",
      provider: claudeId,
    },
  ],
  [{ active: true, id: "bad", name: "Invalid", provider: claudeId }],
  [{ active: true, id: "20000000-0000-4000-8000-000000000001", name: 123, provider: claudeId }],
]) {
  test(`malformed catalogue ${JSON.stringify(catalogue)} shows a recoverable error`, async ({
    page,
  }) => {
    await page.route("**/api/admin/**", async (route) => {
      await route.fulfill({
        json: route.request().url().endsWith("/providers") ? adminProviders : catalogue,
      });
    });
    await page.goto("/admin");
    await expect(page.getByRole("alert")).toHaveText(
      "Could not load the model catalogue. Please try again.",
    );
    await expect(page.getByLabel("Administrator key")).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Catalogue sync" })).toHaveCount(0);
  });
}

test("logout clears catalogue without follow-up reads", async ({ page }) => {
  let loggedOut = false;
  let readsAfterLogout = 0;
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/logout")) {
      loggedOut = true;
      await route.fulfill({ json: { authenticated: false } });
      return;
    }
    if (loggedOut) {
      readsAfterLogout += 1;
      await route.fulfill({ json: { error: "Catalogue unavailable." }, status: 503 });
      return;
    }
    await route.fulfill({
      json: catalogueResponse(path, models(["Live model"]), initialStatuses),
    });
  });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { exact: true, name: "Providers" })).toBeFocused();
  await expect(page.getByText("API key not configured").first()).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Administrator key")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Catalogue sync" })).toHaveCount(0);
  expect(readsAfterLogout).toBe(0);
});

test("expired authentication during refresh returns focus to the key input", async ({ page }) => {
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill(
      route.request().method() === "POST"
        ? { json: { error: "Session expired." }, status: 401 }
        : {
            json: catalogueResponse(path, models(["Live model"]), initialStatuses),
          },
    );
  });
  await page.goto(`/admin/providers/${claudeId}`);
  await expect(page.getByText("Live model", { exact: true })).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Refresh provider" }).click();
  await expect(page.getByLabel("Administrator key")).toBeFocused();
  await expect(page.getByRole("alert")).toHaveText("Session expired.");
});

test("provider catalogue shows archived names, account scope and successful sync metadata", async ({
  page,
}) => {
  const catalogue = models(["Live model", "Old model"]);
  const [, archived] = catalogue;
  if (!archived) {
    throw new Error("Missing archived model fixture");
  }
  archived.active = false;
  const statuses = initialStatuses.map((status) => ({
    ...status,
    configured: true,
    modelCount: 1,
    scope: "Cloud Agent models",
    status: "Synced",
    succeededAt: 1_800_000_000_000,
  }));
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: catalogueResponse(path, catalogue, statuses),
    });
  });
  await page.goto(`/admin/providers/${claudeId}`);
  await expect(page.locator(".admin-providers > li")).toHaveCount(1);
  await expect(page.getByText("Live model", { exact: true })).toBeVisible();
  await expect(page.getByText("Old model (archived)", { exact: true })).toBeVisible();
  await expect(page.getByText("Cloud Agent models", { exact: true })).toBeVisible();
  await expect(page.locator(".admin-providers")).toContainText("Models: 1.");
  await expect(page.locator(".admin-providers")).not.toContainText("Last success: Never");
  await expect(
    page.getByRole("button", { name: /^(?:Add|Edit|Archive|Reactivate|Move|Save) /u }),
  ).toHaveCount(0);
});

test("refresh waits for authoritative catalogue and failure keeps previous rows", async ({
  page,
}) => {
  let catalogue = models(["Previous model"]);
  const { promise: gate, resolve: release } = Promise.withResolvers<undefined>();
  let rejectRefresh = true;
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/sync") && route.request().method() === "POST") {
      await gate;
      if (rejectRefresh) {
        await route.fulfill({ json: { error: "Could not refresh catalogue." }, status: 503 });
      } else {
        catalogue = models(["Discovered model"]);
        await route.fulfill({ json: initialStatuses });
      }
      return;
    }
    await route.fulfill({
      json: catalogueResponse(path, catalogue, initialStatuses),
    });
  });
  await page.goto(`/admin/providers/${claudeId}`);
  await expect(page.getByText("Previous model", { exact: true })).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Refresh provider" }).click();
  await expect(page.getByRole("button", { exact: true, name: "Refreshing..." })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeDisabled();
  await expect(page.getByText("Previous model", { exact: true })).toBeVisible();
  release(undefined);
  await expect(page.getByRole("alert")).toHaveText("Could not refresh catalogue.");
  await expect(page.getByRole("button", { exact: true, name: "Refresh provider" })).toBeEnabled();
  await expect(page.getByText("Previous model", { exact: true })).toBeVisible();
  rejectRefresh = false;
  await page.getByRole("button", { exact: true, name: "Refresh provider" }).click();
  await expect(page.getByText("Discovered model", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("legacy new-provider route is a sync view without a creation form", async ({ page }) => {
  const statuses = initialStatuses.map((status) => ({
    ...status,
    scope: "Provider reporting only. No supported model listing API.",
    status: "Provider reporting only",
  }));
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: catalogueResponse(path, models(["Live model"]), statuses),
    });
  });
  await page.goto("/admin/providers/new");
  await expect(page.getByRole("heading", { name: "Catalogue sync" })).toBeVisible();
  await expect(
    page.getByRole("button", { exact: true, name: "Refresh all providers" }),
  ).toBeEnabled();
  await expect(page.getByText("Provider reporting only", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Provider name", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "Add provider" })).toHaveCount(0);
});

for (const status of [{ invalid: true }, [{ ...initialStatuses[0], pending: "yes" }]]) {
  test(`malformed sync status ${JSON.stringify(status)} reports a visible error`, async ({
    page,
  }) => {
    await page.route("**/api/admin/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      await route.fulfill({
        json: catalogueResponse(path, models(["Live model"]), status),
      });
    });
    await page.goto("/admin");
    await expect(page.getByRole("alert")).toHaveText("Could not load sync status.");
    await expect(
      page.getByRole("button", { exact: true, name: "Refresh all providers" }),
    ).toBeEnabled();
  });
}
