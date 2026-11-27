import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { dismissConsent } from "./consent";

/**
 * WCAG 2.2 AA audit, run by axe-core inside a real Chromium.
 *
 * The tag list is the conformance target, not a sample: wcag2a, wcag2aa, wcag21aa and
 * wcag22aa. axe cannot judge every criterion (focus order, meaningful sequence), so a
 * green run is a floor, not a certificate — but every rule it can check is checked on
 * the pages a customer actually opens.
 */
const require = createRequire(import.meta.url);
const AXE_SOURCE = require.resolve("axe-core/axe.min.js");

const PAGES = [
  { path: "/", name: "home" },
  { path: "/pricing", name: "pricing" },
  { path: "/signin", name: "signin" },
  { path: "/app", name: "app" },
  { path: "/app/start", name: "start" },
  { path: "/app/analyses", name: "analyses" },
  { path: "/app/flow", name: "flow" },
  { path: "/app/settings", name: "settings" },
  { path: "/app/ai", name: "assistant" },
] as const;

const PASSWORD = "correct-horse-battery-staple";

test.skip(({ isMobile }) => isMobile, "the audit runs once per page, not per device project");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("e2e.localePinned")) {
      window.localStorage.setItem("proofcore.locale", "en");
      window.localStorage.setItem("proofcore.da", "dark");
      window.sessionStorage.setItem("e2e.localePinned", "1");
    }
  });
  // Audit the settled rendering. The app fades blocks in with an opacity animation, and
  // axe samples whatever frame it lands on: a section caught mid-fade fails 1.4.3 at
  // 4.34:1 even though its final text is above 7:1. The stylesheet already removes those
  // animations under prefers-reduced-motion, so the audit asks for that preference and
  // measures the colours a reader actually reads.
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function signUp(page: import("@playwright/test").Page, email: string): Promise<void> {
  await page.goto("/signup");
  await page.locator("#auth-name").fill("A11y Tester");
  await page.locator("#auth-workspace").fill("A11y workspace");
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
  await dismissConsent(page);
}

test("the public and workspace pages have no WCAG 2.2 AA violation", async ({ page }) => {
  test.setTimeout(300_000);
  const outDir = "test-results/a11y";
  await mkdir(outDir, { recursive: true });
  await signUp(page, `a11y.${Date.now()}@example.test`);

  const report: { page: string; violations: number; details: string[] }[] = [];
  for (const target of PAGES) {
    await page.goto(target.path, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page
      .waitForFunction(
        () => !/loading your workspace/i.test(document.body.textContent ?? ""),
        undefined,
        {
          timeout: 20_000,
        }
      )
      .catch(() => undefined);
    await page.waitForTimeout(300);
    await page.addScriptTag({ path: AXE_SOURCE });

    const result = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: {
            run: (
              context: Document,
              options: unknown
            ) => Promise<{
              violations: {
                id: string;
                impact: string | null;
                help: string;
                nodes: { target: string[]; html: string; failureSummary: string }[];
              }[];
            }>;
          };
        }
      ).axe;
      // The ascii illustration is aria-hidden decoration, but axe 4.14 still measures its
      // contrast. Excluding it is not a waiver on content: it carries no information.
      return axe.run(
        { include: [document], exclude: [["[aria-hidden='true'] .ascii-empty-art"]] },
        {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
          },
        }
      );
    });

    const details = result.violations.map(
      (violation) =>
        `${violation.id} [${violation.impact}] ${violation.help} :: ${violation.nodes
          .slice(0, 4)
          .map(
            (node) =>
              `${node.target.join(" ")} <${node.html.slice(0, 120)}> — ${node.failureSummary.replaceAll("\n", " ")}`
          )
          .join(" | ")}`
    );
    report.push({ page: target.path, violations: result.violations.length, details });
    if (result.violations.length > 0) {
      await page.screenshot({
        path: `${outDir}/${target.name}.png`,
        fullPage: true,
      });
    }
  }

  await writeFile(`${outDir}/report.json`, JSON.stringify(report, null, 2), "utf8");
  const failing = report.filter((entry) => entry.violations > 0);
  expect(
    failing,
    failing.map((entry) => `${entry.page}\n  ${entry.details.join("\n  ")}`).join("\n\n")
  ).toEqual([]);
});
