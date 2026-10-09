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
  localSql(
    `INSERT INTO models(provider,name,active,position) VALUES('kimi','${name}',1,999) ON CONFLICT(provider,name) DO UPDATE SET active=1`,
  );
  const active = await request.get("/api/models/kimi");
  expect(await active.text()).toContain(name);
  localSql(`UPDATE models SET active=0 WHERE provider='kimi' AND name='${name}'`);
  const rendered = await request.get(`/kimi?model=${encodeURIComponent(name)}`);
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
      .locator(`option[value="${name}"]`),
  ).toHaveCount(0);
  await page.goto(`/kimi?model=${encodeURIComponent(name)}`);
  await expect(page.getByRole("combobox", { name: "Filter reports by model" })).toHaveValue("");
  await expect(page).not.toHaveURL(new RegExp(encodeURIComponent(name), "u"));
});
