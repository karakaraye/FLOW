import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= ".cache/ms-playwright";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 12000 },
  reporter: [
    ["list"],
    ["json", { outputFile: ".cache/e2e-results.json" }],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL: process.env.TEST_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1600, height: 1100 },
      },
    },
  ],
});
