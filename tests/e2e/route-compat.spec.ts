import { expect, type Page, test } from "@playwright/test";
import { dismissConsent } from "./consent";

/**
 * Legacy URLs must not dead-end.
 *
 * `/legal`, `/app/account` and `/app/local-agent` were reachable (bookmarks, old
 * emails) but rendered the not-found page. They now redirect to the real screens;
 * this test fixes that behaviour with a real session, so a later route reshuffle
 * cannot silently bring the 404s back.
 */

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page): Promise<void> {
  const email = `routes.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
  await page.goto("/signup");
  await page.locator("#auth-name").fill("Ada Routes");
  await page.locator("#auth-workspace").fill("Espace routes");
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
  await dismissConsent(page);
}

test("legacy URLs redirect to the real screens", async ({ page }) => {
  await page.goto("/legal");
  await expect(page).toHaveURL(/\/legal\/terms$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/introuvable|not found/i)).toHaveCount(0);

  await signUp(page);

  await page.goto("/app/account");
  await expect(page).toHaveURL(/\/app\/settings$/);
  await expect(page.getByText(/introuvable|not found/i)).toHaveCount(0);

  await page.goto("/app/local-agent");
  await expect(page).toHaveURL(/\/app\/ai\/local$/);
  await expect(page.getByText(/introuvable|not found/i)).toHaveCount(0);
});
