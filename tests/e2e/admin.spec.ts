import { expect, test } from "@playwright/test";

import { adminProviders, claudeId, chatgptId, models } from "./identity-fixtures";

function field(raw: object, name: string) {
  return name in raw && typeof Reflect.get(raw, name) === "string"
    ? String(Reflect.get(raw, name))
    : "";
}

test("admin key stays out of URLs and storage while UUID catalogue changes persist", async ({
  page,
}) => {
  const key = "test-only-key-not-a-real-secret-123456";
  let authenticated = false;
  const catalogue = models(["Fresh model"], chatgptId);
  const writes: unknown[] = [];
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    expect(route.request().url()).not.toContain(key);
    const raw: unknown =
      route.request().method() === "POST" ? route.request().postDataJSON() : undefined;
    const body = raw && typeof raw === "object" ? raw : undefined;
    if (body) {
      writes.push(body);
    }
    if (path.endsWith("/login")) {
      authenticated = Boolean(body && field(body, "key") === key);
    }
    if (path.endsWith("/logout")) {
      authenticated = false;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (!authenticated) {
      await route.fulfill({ json: { error: "Sign in required." }, status: 401 });
      return;
    }
    if (path.endsWith("/state") && body) {
      const model = catalogue.find((entry) => entry.id === field(body, "id"));
      if (model) {
        model.active = "active" in body && body.active === true;
      }
    } else if (path.endsWith("/update") && body) {
      const model = catalogue.find((entry) => entry.id === field(body, "id"));
      if (model) {
        model.name = field(body, "name");
      }
    } else if (path.endsWith("/models") && body) {
      catalogue.push({
        active: true,
        id: "30000000-0000-4000-8000-000000000001",
        name: field(body, "name"),
        provider: field(body, "provider"),
      });
    }
    const catalogueResponse = path.endsWith("/providers") ? adminProviders : catalogue;
    await route.fulfill({ json: body ? { ok: true } : catalogueResponse });
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
  await expect(page.getByRole("heading", { name: "Model catalogue" })).toBeFocused();
  expect(await page.getByLabel("Provider", { exact: true }).locator("option").count()).toBe(2);
  await page.getByLabel("Provider", { exact: true }).selectOption(chatgptId);
  await page.getByLabel("Model name", { exact: true }).fill("New database model");
  await page.getByRole("button", { name: "Add model" }).click();
  await expect(
    page.getByRole("button", { exact: true, name: "Archive New database model" }),
  ).toBeEnabled();
  await page.getByRole("button", { exact: true, name: "Archive New database model" }).click();
  await expect(page.getByRole("button", { name: "Reactivate New database model" })).toBeEnabled();
  await page.getByRole("button", { name: "Reactivate New database model" }).click();
  await expect(
    page.getByRole("button", { exact: true, name: "Archive New database model" }),
  ).toBeEnabled();
  expect(writes).toContainEqual({ active: false, id: "30000000-0000-4000-8000-000000000001" });
  await page.getByLabel("Rename New database model").fill("Corrected model");
  await page
    .locator(".admin-rename")
    .filter({ has: page.getByLabel("Rename New database model") })
    .getByRole("button")
    .click();
  await expect(
    page.getByRole("button", { exact: true, name: "Archive Corrected model" }),
  ).toBeEnabled();
  expect(writes).toContainEqual({
    id: "30000000-0000-4000-8000-000000000001",
    name: "Corrected model",
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Model catalogue" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Model catalogue" })).toHaveCount(0);
  });
}

test("logout clears catalogue without follow-up reads", async ({ page }) => {
  let loggedOut = false;
  let readsAfterLogout = 0;
  await page.route("**/api/admin/**", async (route) => {
    if (route.request().url().endsWith("/logout")) {
      loggedOut = true;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (loggedOut) {
      readsAfterLogout += 1;
      await route.fulfill({ json: { error: "Catalogue unavailable." }, status: 503 });
      return;
    }
    await route.fulfill({
      json: route.request().url().endsWith("/providers") ? adminProviders : models(["Live model"]),
    });
  });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Model catalogue" })).toBeFocused();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Administrator key")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Model catalogue" })).toHaveCount(0);
  expect(readsAfterLogout).toBe(0);
});

test("expired authentication returns focus to the key input", async ({ page }) => {
  await page.route("**/api/admin/**", async (route) => {
    await route.fulfill(
      route.request().method() === "POST"
        ? { json: { error: "Session expired." }, status: 401 }
        : {
            json: route.request().url().endsWith("/providers")
              ? adminProviders
              : models(["Live model"]),
          },
    );
  });
  await page.goto("/admin");
  await page.getByRole("button", { exact: true, name: "Archive Live model" }).click();
  await expect(page.getByLabel("Administrator key")).toBeFocused();
  await expect(page.getByRole("alert")).toHaveText("Session expired.");
});

test("model UUID order includes archived rows and retains movement focus", async ({ page }) => {
  let catalogue = models(["First model", "Archived model", "Last model"]);
  const [, archived] = catalogue;
  if (!archived) {
    throw new Error("Missing archived model fixture");
  }
  archived.active = false;
  const writes: unknown[] = [];
  await page.route("**/api/admin/**", async (route) => {
    if (route.request().url().endsWith("/order")) {
      const body: unknown = route.request().postDataJSON();
      if (!body || typeof body !== "object" || !("ids" in body) || !Array.isArray(body.ids)) {
        throw new Error("Expected UUID order.");
      }
      writes.push(body);
      catalogue = body.ids.flatMap((id: unknown) => catalogue.filter((model) => model.id === id));
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({
      json: route.request().url().endsWith("/providers") ? adminProviders : catalogue,
    });
  });
  await page.goto("/admin");
  const rows = page.locator(".admin-models b");
  await expect(rows).toHaveText(["First model", "Archived model", "Last model"]);
  await expect(
    page.getByRole("button", { exact: true, name: "Move up First model" }),
  ).toBeDisabled();
  const down = page.getByRole("button", { exact: true, name: "Move down First model" });
  await down.click();
  await expect(rows).toHaveText(["Archived model", "First model", "Last model"]);
  await expect(down).toBeFocused();
  expect(writes).toEqual([
    {
      ids: [
        "20000000-0000-4000-8000-000000000002",
        "20000000-0000-4000-8000-000000000001",
        "20000000-0000-4000-8000-000000000003",
      ],
      provider: claudeId,
    },
  ]);
  await down.click();
  await expect(rows).toHaveText(["Archived model", "Last model", "First model"]);
  await expect(down).toBeDisabled();
  const up = page.getByRole("button", { exact: true, name: "Move up First model" });
  await expect(up).toBeFocused();
  await up.press("Enter");
  await expect(rows).toHaveText(["Archived model", "First model", "Last model"]);
  await page.reload();
  await expect(rows).toHaveText(["Archived model", "First model", "Last model"]);
  await page.getByLabel("Provider", { exact: true }).selectOption(chatgptId);
  await expect(rows).toHaveCount(0);
});

test("reorder waits for authoritative catalogue and errors do not move rows", async ({ page }) => {
  const catalogue = models(["First model", "Middle model", "Last model"]);
  const { promise: gate, resolve: release } = Promise.withResolvers<undefined>();
  let rejectOrder = true;
  await page.route("**/api/admin/**", async (route) => {
    if (route.request().url().endsWith("/order")) {
      await gate;
      await route.fulfill(
        rejectOrder
          ? { json: { error: "Could not save model order." }, status: 503 }
          : { json: { ok: true } },
      );
      return;
    }
    const orderedModels = rejectOrder ? catalogue : [catalogue[2], catalogue[0], catalogue[1]];
    await route.fulfill({
      json: route.request().url().endsWith("/providers") ? adminProviders : orderedModels,
    });
  });
  await page.goto("/admin");
  const rows = page.locator(".admin-models b");
  const down = page.getByRole("button", { exact: true, name: "Move down First model" });
  await down.click();
  await expect(down).toBeDisabled();
  await expect(rows).toHaveText(["First model", "Middle model", "Last model"]);
  release(undefined);
  await expect(page.getByRole("alert")).toHaveText("Could not save model order.");
  await expect(rows).toHaveText(["First model", "Middle model", "Last model"]);
  await expect(down).toBeFocused();
  rejectOrder = false;
  await down.click();
  await expect(rows).toHaveText(["Last model", "First model", "Middle model"]);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(down).toBeFocused();
});

test("provider edits preserve UUID and slug unless explicitly changed", async ({ page }) => {
  let providers = structuredClone(adminProviders);
  const writes: unknown[] = [];
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      const body: unknown = route.request().postDataJSON();
      writes.push(body);
      if (body && typeof body === "object" && path.endsWith("/update")) {
        providers = providers.map((provider) =>
          provider.id === field(body, "id")
            ? { ...provider, name: field(body, "name"), slug: field(body, "slug") }
            : provider,
        );
      }
      if (body && typeof body === "object" && path.endsWith("/state")) {
        providers = providers.map((provider) =>
          provider.id === field(body, "id")
            ? { ...provider, active: "active" in body && body.active === true }
            : provider,
        );
      }
      if (body && typeof body === "object" && "ids" in body && Array.isArray(body.ids)) {
        providers = body.ids.flatMap((id: unknown) =>
          providers.filter((provider) => provider.id === id),
        );
      }
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ json: path.endsWith("/providers") ? providers : [] });
  });
  await page.goto("/admin");
  await page.getByText("Edit Claude", { exact: true }).click();
  const form = page
    .locator(".admin-provider-form")
    .filter({ has: page.locator(`input[id="${claudeId}-name"]`) });
  await form.getByLabel("Provider name").fill("Claude corrected");
  await form.getByRole("button", { name: "Save provider" }).click();
  await expect(page.getByText("Edit Claude corrected", { exact: true })).toBeVisible();
  expect(writes[0]).toEqual({
    id: claudeId,
    logo: "/logos/claude.svg",
    maker: "Anthropic",
    name: "Claude corrected",
    slug: "claude",
    status: "https://status.claude.com",
    statusLabel: "Official status",
  });
  await form.getByLabel("URL slug").fill("claude-corrected");
  await expect(form).toContainText("Changing the URL slug stops old links from working");
  await form.getByRole("button", { name: "Save provider" }).click();
  await expect(form.getByLabel("URL slug")).toHaveValue("claude-corrected");
  await page
    .getByRole("button", { exact: true, name: "Archive provider Claude corrected" })
    .click();
  await expect(
    page.getByRole("button", { exact: true, name: "Reactivate provider Claude corrected" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { exact: true, name: "Move down provider Claude corrected" })
    .click();
  await expect(page.locator(".admin-providers b")).toHaveText(["ChatGPT", "Claude corrected"]);
  await expect(
    page.getByRole("button", { exact: true, name: "Move up provider Claude corrected" }),
  ).toBeFocused();
  expect(writes).toContainEqual({ ids: [chatgptId, claudeId] });
});
