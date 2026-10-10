// This fixture modifies only the local D1 emulator used by the browser gate.
// oxlint-disable-next-line import/no-nodejs-modules
import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

function localSql(sql: string) {
  // Wrangler fixture setup must finish before the browser reads the actual Worker database.
  // oxlint-disable-next-line node/no-sync
  execFileSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--command", sql],
    { stdio: "pipe" },
  );
}

test("real archived D1 entries are excluded from SSR and server-function transport", async ({
  page,
  request,
}, testInfo) => {
  const name = `Archived transport ${testInfo.project.name}`;
  const id = crypto.randomUUID();
  localSql(
    `INSERT INTO models(id,provider,name,active,position,external_id) VALUES('${id}','10000000-0000-4000-8000-000000000010','${name}',1,999,'transport-${id}')`,
  );
  const active = await request.get("/api/models/kimi");
  expect(await active.text()).toContain(name);
  localSql(`UPDATE models SET active=0 WHERE id='${id}'`);
  const rendered = await request.get(`/kimi?model=${id}`);
  expect(await rendered.text()).not.toContain(name);
  await page.goto("/kimi");
  await expect(page.getByRole("combobox", { exact: true, name: "Report model" })).toBeEnabled();
  const transport = page.waitForResponse(async (response) => {
    if (!response.url().includes("/_serverFn/") || response.request().method() !== "GET") {
      return false;
    }
    const payload = await response.text();
    return payload.includes('"s":"7d"');
  });
  await page.getByRole("button", { exact: true, name: "7d" }).click();
  const transported = await transport;
  const payload = await transported.text();
  expect(payload).toContain("Kimi");
  expect(payload).toContain("7d");
  expect(payload).not.toContain(name);
  await expect(
    page
      .getByRole("combobox", { name: "Filter reports by model" })
      .locator(`option[value="${id}"]`),
  ).toHaveCount(0);
  await page.goto(`/kimi?model=${id}`);
  await expect(page.getByRole("combobox", { name: "Filter reports by model" })).toHaveValue("");
  await expect(page).not.toHaveURL(new RegExp(id, "u"));
});

test("real archived report metadata stays owner-scoped and can be retracted but not recreated", async ({
  page,
  request,
}, testInfo) => {
  const provider = "10000000-0000-4000-8000-000000000010";
  const id = crypto.randomUUID();
  const name = `Archived owner ${testInfo.project.name}`;
  localSql(
    `INSERT INTO models(id,provider,name,active,position,external_id) VALUES('${id}','${provider}','${name}',1,999,'owner-${id}')`,
  );
  await page.route("**/api/**", async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        "cf-connecting-ip": testInfo.project.name === "desktop" ? "198.51.100.91" : "198.51.100.92",
      },
    });
  });
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", async (route) => {
    await route.fulfill({
      body: `window.turnstile = {
        render(container, options) {
          const button = document.createElement('button');
          button.textContent = 'Verify owner report';
          button.onclick = () => options.callback('XXXX.DUMMY.TOKEN.XXXX');
          container.append(button);
          return 'owner-test';
        },
        execute() {},
        remove() {}
      };`,
      contentType: "application/javascript",
    });
  });
  await page.goto("/kimi");
  const select = page.getByRole("combobox", { exact: true, name: "Report model" });
  const slow = page.getByRole("button", { name: /^slow/iu });
  const broken = page.getByRole("button", { name: /^broken/iu });
  await expect(select).toBeEnabled();
  await select.selectOption(id);
  await slow.click();
  await page.getByRole("button", { name: "Verify owner report" }).click();
  await expect(slow).toHaveAttribute("aria-pressed", "true");
  localSql(`UPDATE models SET active=0 WHERE id='${id}'`);
  await page.reload();
  await expect(select).toHaveValue(id);
  await expect(select.locator(`option[value="${id}"]`)).toHaveText(`${name} (archived)`);
  await expect(select.locator(`option[value="${id}"]`)).toBeDisabled();
  const stranger = await request.get(`/api/session/${provider}`);
  expect(stranger.status()).toBe(200);
  const strangerBody: unknown = await stranger.json();
  expect(strangerBody).not.toHaveProperty("savedModel");
  await broken.click();
  await page.getByRole("button", { name: "Verify owner report" }).click();
  await expect(broken).toHaveAttribute("aria-pressed", "true");
  await broken.click();
  await page.getByRole("button", { name: "Verify owner report" }).click();
  await expect(broken).toHaveAttribute("aria-pressed", "false");
  await broken.click();
  await expect(page.getByRole("alert")).toHaveText(
    "This model is archived. Choose an active model for a new report.",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
