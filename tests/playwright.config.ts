import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration.
 *
 * The suite runs the real stack: the API on Node with an in-memory SQLite database, and
 * the web app served by Vite. Nothing is mocked, because the point of these tests is to
 * catch the class of bug that unit tests structurally cannot — a route that is not
 * registered, a cookie that is not sent, a CORS header that is missing.
 *
 * Two deliberate choices:
 *
 *   - **`localhost`, not `127.0.0.1`.** The API allows exactly one web origin. Using
 *     the other spelling makes every request fail CORS, which looks like a broken app
 *     rather than a misconfigured test.
 *   - **A fresh database per run.** `DATA_PATH=:memory:` means a test that creates an
 *     account cannot collide with a developer's local data, and a failed run leaves no
 *     residue.
 */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174);
const API_PORT = Number(process.env.E2E_API_PORT ?? 8788);

export default defineConfig({
  testDir: "./e2e",
  // A run that leaves a server behind is worse than a slow run.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // The dashboard has to work on a phone; billing and settings are the pages a
    // customer opens on one.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],

  webServer: [
    {
      command: `node --experimental-sqlite --import tsx/esm src/node.ts`,
      cwd: "../api",
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        DATA_PATH: ":memory:",
        PORT: String(API_PORT),
        API_ORIGIN: `http://localhost:${API_PORT}`,
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        NODE_ENV: "test",
      },
    },
    {
      command: `npx vite --host localhost --port ${WEB_PORT} --strictPort`,
      cwd: "../web",
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: String(WEB_PORT),
        // The dev proxy target: without it, a web process that receives PORT would
        // proxy /api back to itself.
        API_PORT: String(API_PORT),
        VITE_API_URL: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
