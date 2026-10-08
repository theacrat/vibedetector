import { expect, test } from "@playwright/test";
import type { Page, Route, APIResponse } from "@playwright/test";

// This fake implements only Turnstile's documented render/execute/remove surface.
// Its dummy token still reaches the local Worker's real Siteverify test-key path.
const challengeScript = `
const widgets = new Map();
let serial = 0;
window.challengeMode = 'interactive';
window.challengeCallbacks = [];
window.challengeWidgetCount = () => widgets.size;
window.turnstile = {
  render(container, options) {
    if (options.execution !== 'execute' || options.appearance !== 'interaction-only') {
      throw new Error('Challenge must execute on demand with interaction-only appearance');
    }
    const id = String(++serial);
    widgets.set(id, { container, options });
    window.challengeCallbacks.push(options.callback);
    return id;
  },
  execute(id) {
    const { container, options } = widgets.get(id);
    if (window.challengeMode === 'throw') {
      throw new Error('Test execution failed');
    }
    if (window.challengeMode === 'silent') {
      queueMicrotask(() => options.callback('XXXX.DUMMY.TOKEN.XXXX'));
      return;
    }
    const check = document.createElement('button');
    check.textContent = 'Complete test verification';
    check.onclick = () => {
      options.callback('XXXX.DUMMY.TOKEN.XXXX');
      options.callback('XXXX.DUMMY.TOKEN.XXXX');
    };
    const fail = document.createElement('button');
    fail.textContent = 'Fail test verification';
    fail.onclick = () => options['error-callback']();
    container.append(check, fail);
  },
  remove(id) {
    const widget = widgets.get(id);
    if (widget) widget.container.replaceChildren();
    widgets.delete(id);
  },
  reset() { throw new Error('Each mutation needs a fresh challenge'); }
};
`;

async function setup(page: Page, address: string) {
  const writes: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
    }
    await route.continue({
      headers: { ...route.request().headers(), "cf-connecting-ip": address },
    });
  });
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", async (route) => {
    await route.fulfill({ body: challengeScript, contentType: "application/javascript" });
  });
  await page.goto("/cursor");
  await expect(page.getByRole("button", { name: /^slow/iu })).toBeEnabled();
  return writes;
}

test("cancel ignores stale tokens, retry retains intent, and change/undo use fresh challenges", async ({
  page,
}, testInfo) => {
  const writes = await setup(
    page,
    testInfo.project.name === "desktop" ? "198.51.100.61" : "198.51.100.62",
  );
  const slow = page.getByRole("button", { name: /^slow/iu });
  const dialog = page.getByRole("dialog", { name: "Verifying your report" });
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('script[src*="challenges.cloudflare.com"]')).toHaveCount(0);
  await slow.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Complete test verification" })).toBeVisible();
  await dialog.getByRole("button", { exact: true, name: "Cancel" }).click();
  await expect(slow).toBeFocused();
  await page.evaluate("window.challengeCallbacks[0]('XXXX.DUMMY.TOKEN.XXXX')");
  await slow.click();
  await dialog.getByRole("button", { name: "Fail test verification" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Verification failed. Please retry verification.",
  );
  await dialog.getByRole("button", { name: "Retry verification" }).click();
  await dialog.getByRole("button", { name: "Complete test verification" }).click();
  await expect(slow).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  await expect(dialog).toHaveCount(0);
  expect(writes).toEqual([
    { category: "slow", token: "XXXX.DUMMY.TOKEN.XXXX", window: expect.any(Number) },
  ]);
  const broken = page.getByRole("button", { name: /^broken/iu });
  await broken.click();
  await dialog.getByRole("button", { name: "Complete test verification" }).click();
  await expect(broken).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  await broken.click();
  await expect(dialog.getByText("Verifying before removing your report.")).toBeVisible();
  await dialog.getByRole("button", { name: "Complete test verification" }).click();
  await expect(broken).toHaveAttribute("aria-pressed", "false", { timeout: 20_000 });
  expect(writes).toEqual([
    { category: "slow", token: "XXXX.DUMMY.TOKEN.XXXX", window: expect.any(Number) },
    { category: "broken", token: "XXXX.DUMMY.TOKEN.XXXX", window: expect.any(Number) },
    // JSON null retracts the contribution.
    // oxlint-disable-next-line unicorn/no-null
    { category: null, token: "XXXX.DUMMY.TOKEN.XXXX", window: expect.any(Number) },
  ]);
});

test("silent verification submits the staged report without showing an interactive widget", async ({
  page,
}, testInfo) => {
  const writes = await setup(
    page,
    testInfo.project.name === "desktop" ? "198.51.100.63" : "198.51.100.64",
  );
  const slow = page.getByRole("button", { name: /^slow/iu });
  await slow.click();
  const dialog = page.getByRole("dialog", { name: "Verifying your report" });
  await expect(dialog.getByRole("button", { name: "Complete test verification" })).toBeVisible();
  await dialog.getByRole("button", { exact: true, name: "Cancel" }).click();
  await page.evaluate("window.challengeMode = 'silent'");
  await slow.click();
  await expect(slow).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  await expect(dialog).toHaveCount(0);
  expect(writes).toEqual([
    { category: "slow", token: "XXXX.DUMMY.TOKEN.XXXX", window: expect.any(Number) },
  ]);
  await slow.click();
  await expect(slow).toHaveAttribute("aria-pressed", "false", { timeout: 20_000 });
});

test("a window conflict refreshes selection and retry verifies the original intent again", async ({
  page,
}, testInfo) => {
  await setup(page, testInfo.project.name === "desktop" ? "198.51.100.65" : "198.51.100.66");
  let conflict = true;
  await page.route("**/api/reports/cursor", async (route) => {
    if (conflict) {
      conflict = false;
      await route.fulfill({
        contentType: "application/json",
        json: { error: "The reporting window changed." },
        status: 409,
      });
    } else {
      await route.fallback();
    }
  });
  const slow = page.getByRole("button", { name: /^slow/iu });
  const dialog = page.getByRole("dialog", { name: "Verifying your report" });
  await slow.click();
  await dialog.getByRole("button", { name: "Complete test verification" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "The reporting window changed. Your selection was refreshed. Please submit again.",
  );
  await dialog.getByRole("button", { name: "Retry verification" }).click();
  await dialog.getByRole("button", { name: "Complete test verification" }).click();
  await expect(slow).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  await slow.click();
  await dialog.getByRole("button", { name: "Complete test verification" }).click();
  await expect(slow).toHaveAttribute("aria-pressed", "false", { timeout: 20_000 });
});

test("execution failure removes its widget and retry records exactly one report", async ({
  page,
}, testInfo) => {
  const writes = await setup(
    page,
    testInfo.project.name === "desktop" ? "198.51.100.67" : "198.51.100.68",
  );
  const slow = page.getByRole("button", { name: /^slow/iu });
  const dialog = page.getByRole("dialog", { name: "Verifying your report" });
  await slow.click();
  await expect(dialog.getByRole("button", { name: "Complete test verification" })).toBeVisible();
  await dialog.getByRole("button", { exact: true, name: "Cancel" }).click();
  await page.evaluate("window.challengeMode = 'throw'");
  await slow.click();
  await expect(dialog.getByRole("alert")).toHaveText("Test execution failed");
  expect(await page.evaluate("window.challengeWidgetCount()")).toBe(0);
  await page.evaluate("window.challengeMode = 'interactive'");
  await dialog.getByRole("button", { name: "Retry verification" }).click();
  expect(await page.evaluate("window.challengeWidgetCount()")).toBe(1);
  await dialog.getByRole("button", { name: "Complete test verification" }).click();
  await expect(slow).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  expect(writes).toEqual([
    { category: "slow", token: "XXXX.DUMMY.TOKEN.XXXX", window: expect.any(Number) },
  ]);
  expect(await page.evaluate("window.challengeWidgetCount()")).toBe(0);
  await slow.click();
  await dialog.getByRole("button", { name: "Complete test verification" }).click();
  await expect(slow).toHaveAttribute("aria-pressed", "false", { timeout: 20_000 });
});

test("a delayed hourly refresh cannot replace a successfully saved selection", async ({
  page,
}, testInfo) => {
  await page.clock.install();
  await setup(page, testInfo.project.name === "desktop" ? "198.51.100.69" : "198.51.100.70");
  let delayed: { route: Route; response: APIResponse } | undefined;
  await page.route("**/api/session/cursor", async (route) => {
    const response = await route.fetch();
    delayed = { response, route };
  });
  await page.clock.fastForward(3_600_000);
  await expect.poll(() => delayed !== undefined).toBe(true);
  const slow = page.getByRole("button", { name: /^slow/iu });
  const dialog = page.getByRole("dialog", { name: "Verifying your report" });
  await slow.click();
  await page.clock.setSystemTime(new Date());
  await dialog.getByRole("button", { name: "Complete test verification" }).click();
  await expect(slow).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  if (!delayed) {
    throw new Error("Hourly refresh was not captured");
  }
  // Session JSON uses null for an unselected category.
  // oxlint-disable-next-line unicorn/no-null
  expect(await delayed.response.json()).toMatchObject({ category: null });
  await delayed.route.fulfill({ response: delayed.response });
  await page.getByRole("button", { exact: true, name: "7d" }).click();
  await expect(page.getByRole("img", { name: /Reports over 7d/iu })).toBeVisible();
  await expect(slow).toHaveAttribute("aria-pressed", "true");
  await slow.click();
  await dialog.getByRole("button", { name: "Complete test verification" }).click();
  await expect(slow).toHaveAttribute("aria-pressed", "false", { timeout: 20_000 });
});
