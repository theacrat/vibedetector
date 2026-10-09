import { expect, test } from "@playwright/test";

import { adminProviders, claudeId, chatgptId, models } from "./identity-fixtures";

test("provider dashboard opens UUID screens and unknown links do not select a provider", async ({
  page,
}) => {
  await page.route("**/api/admin/**", async (route) => {
    await route.fulfill({
      json: route.request().url().endsWith("/providers")
        ? adminProviders
        : models(["Claude model"]),
    });
  });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { exact: true, name: "Providers" })).toBeFocused();
  await expect(page.locator(".admin-providers b")).toHaveText(["ChatGPT", "Claude"]);
  await expect(page.getByRole("button", { name: /Move .* provider/u })).toHaveCount(0);
  await expect(page.getByLabel("Provider name")).toHaveCount(0);
  await expect(page.getByLabel("Model name", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Edit Claude" }).click();
  await expect(page).toHaveURL(`/admin/providers/${claudeId}`);
  await expect(page.getByRole("heading", { name: "Edit Claude" })).toBeFocused();
  await expect(page.locator("summary")).toHaveCount(0);
  await expect(page.getByLabel("Rename Claude model")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Archive Claude model" })).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Edit Claude model" }).press("Enter");
  await expect(page.getByLabel("Rename Claude model")).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Save Claude model" }).press("Enter");
  await expect(page.getByLabel("Provider name")).toHaveValue("Claude");
  await expect(page.locator(".admin-models b")).toHaveText(["Claude model"]);
  await expect(page.getByLabel("Provider", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Edit Claude" })).toBeFocused();
  await page.getByRole("link", { name: "All providers" }).click();
  await page.getByRole("link", { name: "Edit ChatGPT" }).click();
  await expect(page.locator(".admin-models b")).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("heading", { exact: true, name: "Providers" })).toBeFocused();
  await page.goto("/admin/providers/10000000-0000-4000-8000-000000000099");
  await expect(page.getByRole("heading", { name: "Provider not found" })).toBeFocused();
  await expect(page.getByLabel("Provider name")).toHaveCount(0);
  await expect(page.getByLabel("Model name", { exact: true })).toHaveCount(0);
});

test("static creation route opens the newly created provider UUID", async ({ page }) => {
  const providers = structuredClone(adminProviders);
  const id = "10000000-0000-4000-8000-000000000003";
  const writes: unknown[] = [];
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      const body: unknown = route.request().postDataJSON();
      writes.push(body);
      if (path.endsWith("/update")) {
        if (
          !body ||
          typeof body !== "object" ||
          !("name" in body) ||
          typeof body.name !== "string"
        ) {
          throw new Error("Expected provider rename.");
        }
        const provider = providers.find((entry) => entry.id === id);
        if (!provider) {
          throw new Error("Missing created provider.");
        }
        provider.name = body.name;
        await route.fulfill({ json: providers });
        return;
      }
      providers.push({
        active: true,
        id,
        logo: "",
        maker: "New maker",
        name: "New provider",
        slug: "new-provider",
        status: "https://status.example.com",
        statusLabel: "Service status",
      });
      await route.fulfill({ json: providers });
      return;
    }
    await route.fulfill({ json: path.endsWith("/providers") ? providers : [] });
  });
  await page.goto("/admin");
  await page.getByRole("link", { name: "Add provider" }).click();
  await expect(page).toHaveURL("/admin/providers/new");
  await expect(page.getByRole("heading", { exact: true, name: "Add provider" })).toBeFocused();
  await page.reload();
  await page.getByLabel("Provider name").fill("New provider");
  await page.getByLabel("URL slug").fill("new-provider");
  await page.getByLabel("Maker", { exact: true }).fill("New maker");
  await page.getByLabel("Official status URL").fill("https://status.example.com");
  await page.getByLabel("Status link label").fill("Service status");
  await page.getByRole("button", { exact: true, name: "Add provider" }).click();
  await expect(page).toHaveURL(`/admin/providers/${id}`);
  await expect(page.getByRole("heading", { name: "Edit New provider" })).toBeFocused();
  await expect(page.getByLabel("Provider name")).toHaveValue("New provider");
  await expect(page.getByRole("heading", { name: "Model catalogue" })).toBeVisible();
  expect(writes).toEqual([
    {
      logo: "",
      maker: "New maker",
      name: "New provider",
      slug: "new-provider",
      status: "https://status.example.com",
      statusLabel: "Service status",
    },
  ]);
  await page.getByLabel("Provider name").fill("Renamed provider");
  await page.getByRole("button", { name: "Save provider" }).click();
  await expect(page.getByRole("heading", { name: "Edit Renamed provider" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Provider name")).toHaveValue("Renamed provider");
  await page.getByRole("link", { name: "All providers" }).click();
  await page.goBack();
  await expect(page.getByLabel("Provider name")).toHaveValue("Renamed provider");
  await page.goForward();
  await expect(page.getByRole("heading", { exact: true, name: "Providers" })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("Provider name")).toHaveValue("Renamed provider");
});

test("a delayed creation cannot navigate after leaving the creation screen", async ({ page }) => {
  const id = "10000000-0000-4000-8000-000000000004";
  const { promise: release, resolve } = Promise.withResolvers<undefined>();
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      await release;
      await route.fulfill({
        json: [{ ...adminProviders[0], id, name: "Delayed provider", slug: "delayed-provider" }],
      });
      return;
    }
    await route.fulfill({ json: path.endsWith("/providers") ? adminProviders : [] });
  });
  await page.goto("/admin/providers/new");
  await page.getByLabel("Provider name").fill("Delayed provider");
  await page.getByLabel("URL slug").fill("delayed-provider");
  await page.getByLabel("Maker", { exact: true }).fill("Maker");
  await page.getByLabel("Official status URL").fill("https://status.example.com");
  await page.getByLabel("Status link label").fill("Service status");
  await page.getByRole("button", { exact: true, name: "Add provider" }).click();
  await page.getByRole("link", { name: "All providers" }).click();
  const completed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/api/admin/providers"),
  );
  resolve(undefined);
  await completed;
  await page.getByRole("link", { name: "Edit Claude" }).click();
  await page.getByRole("link", { name: "All providers" }).click();
  await expect(page).toHaveURL("/admin");
  await expect(page.getByRole("heading", { exact: true, name: "Providers" })).toBeVisible();
});

test("a successful provider write opens its editor when catalogue refresh fails", async ({
  page,
}) => {
  const id = "10000000-0000-4000-8000-000000000005";
  let created = false;
  let name = "Refresh failure";
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      created = true;
      if (path.endsWith("/update")) {
        const body: unknown = route.request().postDataJSON();
        if (
          !body ||
          typeof body !== "object" ||
          !("name" in body) ||
          typeof body.name !== "string"
        ) {
          throw new Error("Expected saved provider name.");
        }
        ({ name } = body);
      }
      await route.fulfill({
        json: [{ ...adminProviders[0], id, name, slug: "refresh-failure" }],
      });
      return;
    }
    if (created && path.endsWith("/providers")) {
      await route.fulfill({ json: { error: "Refresh unavailable." }, status: 503 });
      return;
    }
    await route.fulfill({ json: path.endsWith("/providers") ? adminProviders : [] });
  });
  await page.goto("/admin/providers/new");
  await page.getByLabel("Provider name").fill("Refresh failure");
  await page.getByLabel("URL slug").fill("refresh-failure");
  await page.getByLabel("Maker", { exact: true }).fill("Maker");
  await page.getByLabel("Official status URL").fill("https://status.example.com");
  await page.getByLabel("Status link label").fill("Service status");
  await page.getByRole("button", { exact: true, name: "Add provider" }).click();
  await expect(page).toHaveURL(`/admin/providers/${id}`);
  await expect(page.getByRole("heading", { name: "Edit Refresh failure" })).toBeFocused();
  await expect(page.getByRole("alert")).toHaveText("Provider saved but catalogue refresh failed.");
  await page.getByLabel("Provider name").fill("Edited refresh failure");
  await page.getByRole("button", { name: "Save provider" }).click();
  await expect(page.getByRole("heading", { name: "Edit Edited refresh failure" })).toBeVisible();
  await expect(page.getByLabel("Provider name")).toHaveValue("Edited refresh failure");
  await page.reload();
  await expect(page.getByLabel("Administrator key")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("Refresh unavailable.");
  await expect(page.getByLabel("Provider name")).toHaveCount(0);
  await page.goBack();
  await expect(page.getByLabel("Provider name")).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(`/admin/providers/${id}`);
  await expect(page.getByRole("alert")).toHaveText("Refresh unavailable.");
  await expect(page.getByLabel("Provider name")).toHaveCount(0);
});

test("authentication preserves the requested edit route", async ({ page }) => {
  let authenticated = false;
  await page.route("**/api/admin/**", async (route) => {
    if (route.request().url().endsWith("/login")) {
      authenticated = true;
    }
    if (!authenticated) {
      await route.fulfill({ json: { error: "Sign in required." }, status: 401 });
      return;
    }
    let json: unknown = [];
    if (route.request().method() === "POST") {
      json = { ok: true };
    } else if (route.request().url().endsWith("/providers")) {
      json = adminProviders;
    }
    await route.fulfill({ json });
  });
  await page.goto(`/admin/providers/${chatgptId}`);
  await expect(page.getByLabel("Administrator key")).toBeFocused();
  await page.getByLabel("Administrator key").fill("test-only-key");
  await page.getByRole("button", { exact: true, name: "Sign in" }).click();
  await expect(page).toHaveURL(`/admin/providers/${chatgptId}`);
  await expect(page.getByRole("heading", { name: "Edit ChatGPT" })).toBeFocused();
});

test("successful creation survives refresh authentication expiry without duplicate creation", async ({
  page,
}) => {
  const id = "10000000-0000-4000-8000-000000000006";
  const providers = structuredClone(adminProviders);
  let authenticated = true;
  let creations = 0;
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/login")) {
      authenticated = true;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (route.request().method() === "POST" && path.endsWith("/providers")) {
      creations += 1;
      providers.push({
        ...adminProviders[0],
        active: true,
        id,
        logo: "",
        maker: "Maker",
        name: "Committed provider",
        slug: "committed-provider",
        status: "https://status.example.com",
        statusLabel: "Service status",
      });
      authenticated = false;
      await route.fulfill({ json: providers });
      return;
    }
    if (!authenticated) {
      await route.fulfill({ json: { error: "Session expired." }, status: 401 });
      return;
    }
    await route.fulfill({ json: path.endsWith("/providers") ? providers : [] });
  });
  await page.goto("/admin/providers/new");
  await page.getByLabel("Provider name").fill("Committed provider");
  await page.getByLabel("URL slug").fill("committed-provider");
  await page.getByLabel("Maker", { exact: true }).fill("Maker");
  await page.getByLabel("Official status URL").fill("https://status.example.com");
  await page.getByLabel("Status link label").fill("Service status");
  await page.getByRole("button", { exact: true, name: "Add provider" }).click();
  await expect(page).toHaveURL(`/admin/providers/${id}`);
  await expect(page.getByLabel("Administrator key")).toBeFocused();
  await expect(page.getByLabel("Provider name")).toHaveCount(0);
  await page.getByLabel("Administrator key").fill("test-only-key");
  await page.getByRole("button", { exact: true, name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Edit Committed provider" })).toBeFocused();
  await expect(page.getByLabel("Provider name")).toHaveValue("Committed provider");
  expect(creations).toBe(1);
});

test("successful model writes retain authoritative names when refresh fails", async ({ page }) => {
  const catalogue = models(["Original model"]);
  let written = false;
  await page.route("**/api/admin/**", async (route) => {
    if (route.request().method() === "POST") {
      const body: unknown = route.request().postDataJSON();
      if (
        !body ||
        typeof body !== "object" ||
        !("name" in body) ||
        typeof body.name !== "string" ||
        !catalogue[0]
      ) {
        throw new Error("Expected model rename.");
      }
      catalogue[0].name = body.name;
      written = true;
      await route.fulfill({ json: catalogue });
      return;
    }
    if (written) {
      await route.fulfill({ json: { error: "Refresh unavailable." }, status: 503 });
      return;
    }
    await route.fulfill({
      json: route.request().url().endsWith("/providers") ? adminProviders : catalogue,
    });
  });
  await page.goto(`/admin/providers/${claudeId}`);
  await page.getByRole("button", { exact: true, name: "Edit Original model" }).click();
  await page.getByLabel("Rename Original model").fill("Saved model");
  await page.getByRole("button", { exact: true, name: "Save Original model" }).click();
  await expect(page.locator(".admin-models b")).toHaveText("Saved model");
  await expect(page.getByRole("alert")).toHaveText("Model saved but catalogue refresh failed.");
});

test("model operations retain unsaved fields and failed writes retain edits", async ({ page }) => {
  let rejectWrites = false;
  const catalogue = models(["First model", "Second model"]);
  await page.route("**/api/admin/**", async (route) => {
    if (route.request().method() === "POST") {
      if (rejectWrites) {
        await route.fulfill({ json: { error: "Write failed." }, status: 503 });
        return;
      }
      const body: unknown = route.request().postDataJSON();
      const entry =
        body && typeof body === "object" && "id" in body
          ? catalogue.find((model) => model.id === body.id)
          : undefined;
      if (entry && body && typeof body === "object") {
        if ("active" in body && typeof body.active === "boolean") {
          entry.active = body.active;
        }
        if ("name" in body && typeof body.name === "string") {
          entry.name = body.name;
        }
      }
      await route.fulfill({ json: catalogue });
      return;
    }
    await route.fulfill({
      json: route.request().url().endsWith("/providers") ? adminProviders : catalogue,
    });
  });
  await page.goto(`/admin/providers/${claudeId}`);
  await page.getByRole("button", { exact: true, name: "Edit First model" }).click();
  await page.getByLabel("Provider name").fill("Unsaved provider");
  await page.getByLabel("Rename First model").fill("Unsaved model");
  await page.getByLabel("Model name", { exact: true }).fill("Unsaved addition");
  await page.getByRole("button", { exact: true, name: "Archive Second model" }).click();
  await expect(
    page.getByRole("button", { exact: true, name: "Reactivate Second model" }),
  ).toBeFocused();
  await expect(page.getByLabel("Provider name")).toHaveValue("Unsaved provider");
  await expect(page.getByLabel("Rename First model")).toHaveValue("Unsaved model");
  await expect(page.getByLabel("Model name", { exact: true })).toHaveValue("Unsaved addition");
  await expect(page.getByLabel("Provider name")).toHaveValue("Unsaved provider");
  await expect(page.getByLabel("Model name", { exact: true })).toHaveValue("Unsaved addition");
  rejectWrites = true;
  await page.getByRole("button", { name: "Save provider" }).click();
  await expect(page.getByRole("alert")).toHaveText("Write failed.");
  await expect(page.getByLabel("Provider name")).toHaveValue("Unsaved provider");
  await page
    .locator(".admin-model-row")
    .filter({ has: page.getByLabel("Rename First model") })
    .getByRole("button", { exact: true, name: "Save First model" })
    .click();
  await expect(page.getByLabel("Rename First model")).toHaveValue("Unsaved model");
  rejectWrites = false;
  await page
    .locator(".admin-model-row")
    .filter({ has: page.getByLabel("Rename First model") })
    .getByRole("button", { exact: true, name: "Save First model" })
    .click();
  await expect(page.getByRole("button", { exact: true, name: "Edit Unsaved model" })).toBeFocused();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Provider name")).toHaveValue("Unsaved provider");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
