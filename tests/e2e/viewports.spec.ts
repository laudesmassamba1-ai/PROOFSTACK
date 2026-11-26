import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

/**
 * The thirteen-viewport sweep.
 *
 * A preview window is one size. This test drives a real Chromium at every width the
 * product promises to support, loads the pages a customer actually opens, and fails on
 * the two defects a screenshot cannot argue with: a page wider than its viewport, and a
 * console error. Screenshots are written next to the report for a human to look at;
 * they are evidence, not the assertion.
 *
 * Widths come from the support matrix in docs/PROOFCORE_UI_SYSTEM.md. 320 is the
 * narrowest phone still in use; 2560 is a full desktop panel.
 */
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

const PAGES = [
  { path: "/", name: "home" },
  { path: "/app", name: "app" },
  { path: "/app/start", name: "start" },
  { path: "/app/analyses", name: "analyses" },
  { path: "/app/flow", name: "flow" },
  { path: "/app/modules", name: "modules" },
] as const;

const PASSWORD = "correct-horse-battery-staple";

// The mobile project's phone viewport would be overwritten on the first iteration; the
// matrix is the same list for every device, so running it twice only doubles the wait.
test.skip(({ isMobile }) => isMobile, "the sweep sets its own viewport for every width");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("e2e.localePinned")) {
      window.localStorage.setItem("proofcore.locale", "en");
      window.localStorage.setItem("proofcore.da", "dark");
      window.sessionStorage.setItem("e2e.localePinned", "1");
    }
    // Measure the settled layout, not a frame mid-animation.
    window.matchMedia("(prefers-reduced-motion: reduce)");
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

/**
 * Bring the page to the state a person sees after landing and scrolling.
 *
 * Two traps this closes. Entrance reveals leave a section at opacity 0 until it enters
 * the viewport, so a full-page screenshot taken at the top is mostly black. And the app
 * shell fetches the session before it renders, so an immediate capture is the loading
 * screen, not the page.
 */
async function settle(page: import("@playwright/test").Page): Promise<void> {
  await page
    .waitForFunction(
      // innerText on purpose: only the text a person can see counts as "still loading".
      // biome-ignore lint/performance/useDomNodeTextContent: visible text is what matters here
      () => !/loading your workspace/i.test(document.body.innerText),
      undefined,
      { timeout: 20_000 }
    )
    .catch(() => undefined);
  await page.evaluate(async () => {
    const step = Math.max(240, window.innerHeight * 0.75);
    const height = () => document.documentElement.scrollHeight;
    for (let y = 0; y < height(); y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(300);
}

async function signUp(page: import("@playwright/test").Page, email: string): Promise<void> {
  await page.goto("/signup");
  await page.locator("#auth-name").fill("Viewport Tester");
  await page.locator("#auth-workspace").fill("Viewport workspace");
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
  const consent = page.getByRole("dialog", { name: /cookies/i });
  const opened = await consent
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (opened) await consent.getByRole("button", { name: /allow|autoriser/i }).click();
}

test("every supported viewport renders without horizontal overflow or console errors", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const outDir = "test-results/viewports";
  await mkdir(outDir, { recursive: true });
  const report: {
    viewport: string;
    page: string;
    overflowPx: number;
    consoleErrors: string[];
    screenshot: string;
  }[] = [];

  // One account for the whole sweep: sign-up is not what this test measures.
  await signUp(page, `viewports.${Date.now()}@example.test`);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const target of PAGES) {
      const errors: string[] = [];
      const onConsole = (message: import("@playwright/test").ConsoleMessage) => {
        if (message.type() === "error") errors.push(message.text());
      };
      const onPageError = (error: Error) => errors.push(error.message);
      page.on("console", onConsole);
      page.on("pageerror", onPageError);

      await page.goto(target.path, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await settle(page);

      const metrics = await page.evaluate(() => {
        const root = document.documentElement;
        return {
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          bodyScrollWidth: document.body.scrollWidth,
        };
      });
      const overflowPx = Math.max(
        metrics.scrollWidth - metrics.clientWidth,
        metrics.bodyScrollWidth - metrics.clientWidth
      );

      const file = `${outDir}/${viewport.width}x${viewport.height}-${target.name}.png`;
      await page.screenshot({ path: file, fullPage: true });
      report.push({
        viewport: `${viewport.width}x${viewport.height}`,
        page: target.path,
        overflowPx,
        consoleErrors: [...errors],
        screenshot: file,
      });

      page.off("console", onConsole);
      page.off("pageerror", onPageError);

      expect(
        overflowPx,
        `${target.path} is ${overflowPx}px wider than the ${viewport.width}px viewport`
      ).toBeLessThanOrEqual(1);
      expect(errors, `${target.path} at ${viewport.width}px logged: ${errors.join(" | ")}`).toEqual(
        []
      );
    }
  }

  await writeFile(`${outDir}/report.json`, JSON.stringify(report, null, 2), "utf8");
  expect(report).toHaveLength(VIEWPORTS.length * PAGES.length);
});
