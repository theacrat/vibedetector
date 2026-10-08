import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:41873", trace: "retain-on-failure" },
  webServer: {
    command: "bun run dev",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
    url: "http://127.0.0.1:41873",
  },
});
