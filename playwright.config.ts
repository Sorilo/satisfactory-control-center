import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: { baseURL: "http://localhost:3000", trace: "on-first-retry" },
  webServer: {
    command: "npm run build && mkdir -p .next/standalone/.next && cp -R .next/static .next/standalone/.next/ && HOSTNAME=0.0.0.0 PORT=3000 node .next/standalone/server.js",
    url: "http://localhost:3000/api/health/live",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATA_MODE: "mock",
      DEFAULT_SERVER_ID: "main",
      SERVERS_JSON: JSON.stringify([
        { id: "main", displayName: "Main World", enabled: true, public: true },
        { id: "beta", displayName: "Beta World", enabled: true, public: true }
      ]),
      POWER_STREAM_ENABLED: "true"
    }
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } }
  ]
});
