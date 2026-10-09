"use strict";

const { defineConfig, devices } = require("@playwright/test");

const PORT = 4173;

module.exports = defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // No retries: a test that passes on a second attempt is a flaky test, and
  // retries would hide it.
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node serve-dist.js",
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
});
