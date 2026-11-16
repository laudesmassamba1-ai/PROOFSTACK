import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

/**
 * Visual QA capture.
 *
 * Requires the web dev server on http://localhost:5173 and the API on
 * http://localhost:8787. The session cookie is supplied through the environment;
 * no password is embedded in this file.
 */
const base = process.env.PS_QA_BASE_URL ?? "http://localhost:5173";
const cookie = process.env.PS_QA_COOKIE;
const output = "docs/design/screenshots";

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox"] });
const errors = [];

async function context(options = {}) {
  const created = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "dark",
    deviceScaleFactor: 1,
    ...options,
  });
  if (cookie) {
    await created.addCookies([
      { name: "ps_session", value: cookie, domain: "localhost", path: "/" },
    ]);
  }
  return created;
}

async function open(page, path) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto(`${base}${path}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
}

// 1. Home, wave state and formed logo.
{
  const ctx = await context();
  const page = await ctx.newPage();
  await open(page, "/");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${output}/home-wave.png` });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${output}/home-desktop.png` });
  await page.screenshot({ path: `${output}/home-full.png`, fullPage: true });
  await ctx.close();
}

// 2. Mobile home.
{
  const ctx = await context({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await open(page, "/");
  await page.waitForTimeout(4200);
  await page.screenshot({ path: `${output}/home-mobile.png` });
  await ctx.close();
}

// 3. Reduced motion must show the static SVG immediately and stay readable.
{
  const ctx = await context({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await open(page, "/");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/home-reduced-motion.png` });
  await ctx.close();
}

// 4. Authenticated dashboard and CLI onboarding.
if (cookie) {
  const ctx = await context({ colorScheme: "light" });
  const page = await ctx.newPage();
  await open(page, "/app");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${output}/dashboard.png` });
  await open(page, "/app/cli");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${output}/cli-onboarding.png` });
  await ctx.close();
}

await browser.close();

if (errors.length > 0) {
  console.error("Browser diagnostics:");
  for (const error of errors.slice(0, 20)) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Visual QA screenshots written without console/page errors.");
}
