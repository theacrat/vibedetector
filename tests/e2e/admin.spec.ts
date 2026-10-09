import { expect, test } from "@playwright/test";

function field(raw: object, name: string) {
  return name in raw && typeof Reflect.get(raw, name) === "string"
    ? String(Reflect.get(raw, name))
    : "";
}

test("admin key stays out of URLs and storage while catalogue changes persist", async ({
  page,
}) => {
  const key = "test-only-key-not-a-real-secret-123456";
  let authenticated = false;
  const models = [{ active: true, name: "Fresh model", provider: "chatgpt" }];
  const writes: unknown[] = [];
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    expect(route.request().url()).not.toContain(key);
    const raw: unknown =
      route.request().method() === "POST" ? route.request().postDataJSON() : undefined;
    const body =
      raw && typeof raw === "object"
        ? {
            active: "active" in raw && raw.active === true,
            key: field(raw, "key"),
            name: field(raw, "name"),
            provider: field(raw, "provider"),
          }
        : undefined;
    if (body) {
      writes.push(raw);
    }
    if (path.endsWith("/login")) {
      authenticated = body?.key === key;
    } else if (path.endsWith("/logout")) {
      authenticated = false;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (!authenticated) {
      await route.fulfill({ json: { error: "Sign in required." }, status: 401 });
      return;
    }
    if (path.endsWith("/state") && body) {
      const model = models.find((entry) => entry.name === body.name);
      if (model) {
        model.active = body.active;
      }
    } else if (path.endsWith("/models") && body) {
      models.push({ active: true, name: body.name, provider: body.provider });
    }
    await route.fulfill({ json: path.endsWith("/models") && !body ? models : { ok: true } });
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
  await expect(page.getByRole("heading", { name: "Model catalogue" })).toBeVisible();
  expect(await page.getByLabel("Provider").locator("option").count()).toBe(10);
  await page.getByLabel("Provider").selectOption("chatgpt");
  await page.getByLabel("Model name").fill("New database model");
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
  expect(writes).toContainEqual({ active: false, name: "New database model", provider: "chatgpt" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Model catalogue" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(input).toBeEnabled();
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
  await page.route("**/api/admin/models", async (route) => {
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
