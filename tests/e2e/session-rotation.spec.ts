import { expect, type Page, test } from "@playwright/test";
import { dismissConsent } from "./consent";

/**
 * Password change in a real browser.
 *
 * The screen must stay usable: the person who just changed their password is handed a new
 * session cookie and remains signed in, while the token that asked for the change is gone.
 * The API tests prove the server side; this proves the browser path — form, request,
 * Set-Cookie, reload — actually does it.
 */

const PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "another-correct-horse";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("e2e.localePinned")) {
      window.localStorage.setItem("proofcore.locale", "fr");
      window.sessionStorage.setItem("e2e.localePinned", "1");
    }
  });
});

async function signUp(page: Page): Promise<void> {
  const email = `rotation.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
  await page.goto("/signup");
  await page.locator("#auth-name").fill("Ada Rotation");
  await page.locator("#auth-workspace").fill("Espace rotation");
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
  await dismissConsent(page);
}

const sessionToken = async (page: Page): Promise<string | undefined> =>
  (await page.context().cookies()).find((cookie) => cookie.name === "ps_session")?.value;

test("changing the password rotates the session token and stays signed in", async ({ page }) => {
  await signUp(page);
  await page.goto("/app/settings");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const before = await sessionToken(page);
  expect(before, "the browser must hold a session cookie before the change").toBeTruthy();

  await page.getByLabel("Mot de passe actuel").fill(PASSWORD);
  await page.getByLabel("Nouveau mot de passe (10 caractères min.)").fill(NEW_PASSWORD);
  await page.getByLabel("Confirmer le nouveau mot de passe").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Changer le mot de passe" }).click();
  await expect(page.getByText(/Mot de passe modifié/)).toBeVisible({ timeout: 15_000 });

  const after = await sessionToken(page);
  expect(after, "the response must hand back a new session cookie").toBeTruthy();
  expect(after).not.toBe(before);

  // The new cookie is the one the browser uses: a reload keeps the person signed in.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/settings$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await sessionToken(page)).toBe(after);
});
