import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.HARBOR_WEB_E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;
const isCi = Boolean(process.env.CI);

/**
 * Smoke-level end-to-end config. A single dev server is started on a dedicated
 * port and exercised at both a desktop and a mobile viewport so the shell's
 * responsive layout is covered when browsers are available.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  reporter: isCi ? "line" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    // Chromium cannot use its setuid sandbox inside restricted CI/containers.
    launchOptions: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: `pnpm dev --port ${port}`,
    url: baseURL,
    reuseExistingServer: !isCi,
    timeout: 120_000,
  },
});
