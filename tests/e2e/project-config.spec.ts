import { expect, type Page, test } from "@playwright/test";
import { dismissConsent } from "./consent";

/**
 * The configuration editor validates before it writes.
 *
 * The PUT already refuses a dangerous configuration, but only after the save attempt:
 * the person used to learn about the blocker from a failed request. The form now calls
 * the read-only preflight first, keeps the typed values, and stores nothing when a
 * blocker is reported. This test fixes both halves: a blocked save leaves the project
 * on its defaults, and the same save goes through once the setting is corrected.
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
  await page.locator("#auth-name").fill("Config Tester");
  await page.locator("#auth-workspace").fill("Config workspace");
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
  await dismissConsent(page);
}

async function createProject(page: Page): Promise<{ workspaceId: string; projectId: string }> {
  const session = (await (await page.request.get("/api/auth/session")).json()) as {
    workspaceId: string;
  };
  const created = await page.request.post("/api/v1/projects", {
    data: {
      workspaceId: session.workspaceId,
      name: "Config project",
      baseUrl: "https://shop.example",
      environment: "staging",
    },
  });
  expect(created.ok()).toBe(true);
  const body = (await created.json()) as { project: { id: string } };
  return { workspaceId: session.workspaceId, projectId: body.project.id };
}

async function storedSource(page: Page, workspaceId: string, projectId: string): Promise<string> {
  const response = await page.request.get(
    `/api/v1/projects/${projectId}/config?workspaceId=${workspaceId}`
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { source: string }).source;
}

test("a blocked configuration is refused before saving, and nothing is written", async ({
  page,
}) => {
  await signUp(page, `config.${Date.now()}@example.test`);
  const { workspaceId, projectId } = await createProject(page);
  await page.goto(`/app/projects/${projectId}/config`);
  await expect(page.getByRole("heading", { name: "EXIT", exact: true })).toBeVisible();

  const dataType = page.getByLabel("Data type");
  await dataType.selectOption("production");
  await page.getByRole("button", { name: /^save$/i }).click();

  // The preflight refused it: the form says nothing was written, and the issues card
  // switches from "saved, but check this" to "fix before saving".
  await expect(page.getByRole("alert")).toContainText("Nothing was saved");
  await expect(page.getByText("Fix before saving")).toBeVisible();
  expect(await storedSource(page, workspaceId, projectId)).toBe("defaults");

  // Correcting the setting makes the same save pass the preflight and store the config.
  await dataType.selectOption("synthetic");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByText("Configuration saved and validated.")).toBeVisible();
  expect(await storedSource(page, workspaceId, projectId)).toBe("saved");
});
