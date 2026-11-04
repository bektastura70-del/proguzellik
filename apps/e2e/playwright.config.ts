import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import { apiEnv, API_PORT, BASE_URL, WEB_PORT } from "./env";

/**
 * Tarayıcı testleri: sistemdeki Google Chrome kullanılır (tarayıcı indirmesi yok).
 * API ve web, E2E veritabanına bağlı ayrı portlarda başlatılır.
 */
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    channel: "chrome",
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "desktop", dependencies: ["setup"], testIgnore: [/auth\.setup\.ts/, /pwa\.spec\.ts/], use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } } },
    {
      name: "tablet",
      dependencies: ["setup"],
      testMatch: /responsive\.spec\.ts|zz-shots\.spec\.ts/,
      use: { viewport: { width: 820, height: 1180 }, hasTouch: true, channel: "chrome" },
    },
    {
      name: "mobile",
      dependencies: ["setup"],
      testMatch: /responsive\.spec\.ts|booking\.spec\.ts|pwa\.spec\.ts|zz-shots\.spec\.ts/,
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, channel: "chrome" },
    },
  ],
  webServer: [
    {
      command: "node dist/main.js",
      cwd: resolve(__dirname, "../api"),
      env: apiEnv,
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx next start --port ${WEB_PORT}`,
      cwd: resolve(__dirname, "../web"),
      env: { API_URL: `http://localhost:${API_PORT}` },
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
