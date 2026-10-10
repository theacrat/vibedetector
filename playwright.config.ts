import { defineConfig, devices } from "@playwright/test";

const port = process.env["PLAYWRIGHT_PORT"] ?? "41873";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  testDir: "./tests/e2e",
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: `bunx vite --host 127.0.0.1 --port ${port} --strictPort`,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
    url: baseURL,
  },
  workers: 1,
});
