import { expect, type Page, test } from "@playwright/test";
import { dismissConsent } from "./consent";

/**
 * The finding panel offers a verified patch, and copies it.
 *
 * The API work behind the button is covered by `apps/api/test/finding-patch.test.ts`.
 * What only a browser can prove is the panel itself: the diff is shown, the copy button
 * exists, and a click actually puts the patch on the clipboard. The AI route is mocked
 * here so the test does not need a provider key; the shape is the route's real response.
 */

const PASSWORD = "correct-horse-battery-staple";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("proofcore.locale", "en");
    window.localStorage.setItem("proofcore.da", "dark");
  });
});

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/signup");
  await page.locator("#auth-name").fill("Patch Tester");
  await page.locator("#auth-workspace").fill("Patch workspace");
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
  await dismissConsent(page);
}

const ANALYSIS = {
  id: "ana_patch_e2e",
  source: "WEB",
  targetType: "PAGE",
  target: "https://shop.example/",
  scope: "PAGE",
  status: "completed",
  engine: "scan",
  engineVersion: "1",
  environment: "server",
  coverage: {
    requestedModules: ["fail"],
    applicableModules: ["fail"],
    measuredModules: ["fail"],
    skipped: [],
    ratio: 1,
    label: "complete",
  },
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  durationMs: 1200,
  createdAt: new Date().toISOString(),
};

const FINDING = {
  key: "fail:hsts:https://shop.example/",
  analysisId: ANALYSIS.id,
  module: "fail",
  controlId: "hsts",
  title: "Strict-Transport-Security is missing",
  status: "FAILED",
  severity: "high",
  priority: "P1",
  cause: "response_header_missing",
  confidence: "high",
  url: "https://shop.example/",
  explanation: {
    fact: "The response carries no Strict-Transport-Security header.",
    meaning: "A downgrade to HTTP is not refused by the browser.",
    impact: "Session cookies can travel over plain HTTP.",
    scope: "Every page of the origin.",
    verification: "Re-read the response headers after the change.",
    fix: "Send the header with a long max-age.",
  },
  evidence: { method: "response headers", observed: "absent", expected: "max-age=31536000" },
};

test("the finding panel prepares a patch and copies the diff", async ({ page, context }) => {
  await signUp(page, `patch.${Date.now()}@example.test`);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });

  await page.route(/\/api\/v1\/analyses\?/, (route) =>
    route.fulfill({
      json: { items: [ANALYSIS], total: 1, limit: 50, offset: 0 },
    })
  );
  await page.route(/\/api\/v1\/analyses\/ana_patch_e2e\/findings\?/, (route) =>
    route.fulfill({
      json: { findings: { items: [FINDING], total: 1, limit: 100, offset: 0 } },
    })
  );
  await page.route(/\/api\/v1\/remediations\?/, (route) =>
    route.fulfill({
      json: { remediations: { items: [], total: 0, limit: 100, offset: 0 } },
    })
  );
  await page.route(/\/api\/v1\/ai\/patch$/, (route) =>
    route.fulfill({
      json: {
        patch: {
          diff: [
            "--- a/src/server.ts",
            "+++ b/src/server.ts",
            "@@ -1,4 +1,5 @@",
            ' import express from "express";',
            " const app = express();",
            "+app.use(helmet());",
            " app.get('/', (_req, res) => res.send('ok'));",
            " app.listen(3000);",
          ].join("\n"),
          path: "src/server.ts",
          sourceId: "src_patch",
          sourceName: "uploaded-repo",
          line: 2,
          linesAdded: 1,
          linesRemoved: 0,
          rationale: "Adds the missing HSTS middleware.",
        },
        finding: {},
        ai: { mode: "personal", provider: "custom", model: "test-model" },
        applied: false,
        saved: false,
      },
    })
  );

  const verifyBodies: Record<string, unknown>[] = [];
  await page.route(/\/api\/v1\/analyses\/ana_patch_e2e\/verify-patch$/, (route) => {
    verifyBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      json: {
        analysisId: "ana_verify_e2e",
        analysis: { id: "ana_verify_e2e" },
        outcome: "verified",
        reason: "The re-measured HSTS control passes.",
        verified: true,
        remediation: {
          id: "rem_e2e",
          workspaceId: "ws_e2e",
          projectId: "prj_e2e",
          analysisId: ANALYSIS.id,
          findingKey: FINDING.key,
          status: "verified",
          severity: "high",
          priority: "P1",
          cause: FINDING.cause,
          steps: [
            { step: "read_finding", at: new Date().toISOString() },
            { step: "verify_evidence", at: new Date().toISOString() },
            { step: "gather_context", at: new Date().toISOString() },
          ],
          nextStep: "prepare_fix",
          fix: "Send the header with a long max-age.",
          verification: "Re-read the response headers after the change.",
          proof: "high",
          verificationAnalysisId: "ana_verify_e2e",
          verificationOutcome: "verified",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    });
  });

  await page.goto(`/app/analyses?analysis=${ANALYSIS.id}`);
  await expect(page.getByText(FINDING.title)).toBeVisible();

  await page.getByRole("button", { name: "Prepare a patch" }).click();

  await expect(page.getByText("Proposal — nothing is applied.")).toBeVisible();
  await expect(page.getByText("src/server.ts:2")).toBeVisible();
  await expect(page.getByText("+app.use(helmet());")).toBeVisible();

  await page.getByRole("button", { name: "Copy the diff" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();

  // The clipboard is the point of the button: assert its content, not just the label.
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("+app.use(helmet());");
  expect(clipboard).toContain("--- a/src/server.ts");

  // Applying is the person's action; the panel says so, then chains the verification.
  await page.getByRole("button", { name: "Apply the patch" }).click();
  await expect(page.getByText(/PROOFCORE cannot write to your target/)).toBeVisible();
  const confirm = page.getByRole("button", { name: "Confirm and verify" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("I have applied this diff to the target.").check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  expect(verifyBodies[0]).toMatchObject({ findingKey: FINDING.key, applied: true });

  await expect(page.getByText(/Verified by analysis/)).toBeVisible();
  await expect(page.getByText("ana_verify_e2e")).toBeVisible();
  // The diff survives the parent switching from "no remediation" to "verified".
  await expect(page.getByText("+app.use(helmet());")).toBeVisible();
  await expect(page.getByText("rem_e2e")).toBeVisible();
});
