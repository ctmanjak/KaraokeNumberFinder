import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BETTER_AUTH_URL ?? "https://127.0.0.1:3443";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["line"],
    ["html", { open: "never", outputFolder: "playwright-report" }]
  ],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "off",
    video: "off"
  },
  webServer: {
    command: "npm run e2e:serve",
    url: `${baseURL}/api/providers`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
