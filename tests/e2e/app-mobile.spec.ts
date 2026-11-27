import { expect, type Page, test } from "@playwright/test";
import { dismissConsent } from "./consent";

/**
 * The simple mobile shell.
 *
 * A phone user has no visible top navigation: the menu is the only route to the guide
 * and to expert mode. This test fixes the language to French so a regression that
 * reintroduces an English label is caught at the same time as a broken link.
 */

const PASSWORD = "correct-horse-battery-staple";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("e2e.localePinned")) {
      window.localStorage.setItem("proofcore.locale", "fr");
      window.sessionStorage.setItem("e2e.localePinned", "1");
    }
  });
});

async function signUp(page: Page): Promise<void> {
  const email = `mobile.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
  await page.goto("/signup");
  await page.locator("#auth-name").fill("Ada Mobile");
  await page.locator("#auth-workspace").fill("Espace mobile");
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
  await dismissConsent(page);
}

test("mobile menu opens the guide in French and exposes expert mode", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "phone navigation only");
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page);
  // The shell is mounted only after the post-signup session refresh. Clicking during
  // that transition opens the sheet and the pathname effect immediately closes it.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");

  const menu = page.getByRole("button", { name: "Menu" });
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  const sheet = page.getByRole("dialog", { name: "Menu" });
  await expect(sheet).toBeVisible();

  // French labels, not the English route names.
  for (const label of ["Vue d'ensemble", "Projets", "Analyser", "Guide"]) {
    await expect(sheet.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(sheet.getByRole("link", { name: "Scan", exact: true })).toHaveCount(0);
  await expect(sheet.getByRole("link", { name: "Overview", exact: true })).toHaveCount(0);

  await sheet.getByRole("link", { name: "Guide", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/guide$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("GUIDE PROOFCORE.");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, `guide overflows by ${overflow}px`).toBeLessThanOrEqual(2);

  await menu.click();
  const reopened = page.getByRole("dialog", { name: "Menu" });
  const expert = reopened.getByRole("button", { name: "Afficher le mode expert" });
  await expect(expert).toBeVisible();
  await expert.click();
  await expect(reopened.getByRole("button", { name: "Revenir au mode simple" })).toBeVisible();
});

test("the assistant fits a 320px phone and shows the real catalogue", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "phone layout only");
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 320, height: 700 });
  await signUp(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/app/ai");
  await expect(page.locator(".chat-composer-input")).toBeVisible({ timeout: 20_000 });

  // The context gauge is visible, and it is a gauge, not a sentence the reader has to
  // parse: the progressbar carries the value for assistive technology.
  const meter = page.getByRole("progressbar", { name: "Contexte utilisé" });
  await expect(meter).toBeVisible();
  const used = Number(await meter.getAttribute("aria-valuenow"));
  expect(used).toBeGreaterThanOrEqual(0);
  expect(used).toBeLessThanOrEqual(100);

  // The catalogue comes from the server: a tool added there must be visible on a phone.
  await page.getByRole("button", { name: "Outils de l'assistant" }).click();
  const dialog = page.getByRole("dialog", { name: "Outils" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("browser_open", { exact: true })).toBeVisible();
  await expect(dialog.getByText("browser_act", { exact: true })).toBeVisible();
  await expect(dialog.getByText("analyse", { exact: true }).first()).toBeVisible();
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, `assistant overflows by ${overflow}px`).toBeLessThanOrEqual(2);
});

test("a non-technical phone user follows the guide and analyses a site in French", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "phone journey only");
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");

  const menu = page.getByRole("button", { name: "Menu" });
  await menu.click();
  await page
    .getByRole("dialog", { name: "Menu" })
    .getByRole("link", { name: "Guide", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/guide$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("GUIDE PROOFCORE.");

  // The guide's own call to action is the path a beginner follows; no route knowledge
  // or CLI command is needed.
  await page.getByRole("link", { name: "Analyser une adresse", exact: true }).first().click();
  await expect(page).toHaveURL(/\/app\/start$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("UNE ADRESSE");
  // The page title used to climb to ~50px at this width and push the URL field
  // off the first screen. It must stay a heading, not a poster.
  const titleSize = await page
    .getByRole("heading", { level: 1 })
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(titleSize, `page title is ${titleSize}px`).toBeLessThanOrEqual(36);

  await page.locator("#start-url").fill("https://example.com");
  await page.getByRole("button", { name: "Voir le résultat" }).click();

  // A real server-side scan of a public site, not a mocked response. The result must
  // arrive in French and offer the full report; AI interpretation is optional and may
  // legitimately say that no provider is configured.
  await expect(page.getByText(/HTTP \d{3}/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Voir le rapport complet" })).toBeVisible();
  await expect(page.getByText("See the result", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Scanning…", { exact: true })).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, `scan result overflows by ${overflow}px`).toBeLessThanOrEqual(2);

  // Billing and settings are the pages a customer opens on a phone. The member
  // table has to become a stacked list (label above value) instead of a 460px
  // table the reader has to drag sideways.
  await page.goto("/app/settings");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const members = page.locator("table.app-table-stack").first();
  await expect(members).toBeVisible();
  expect(await members.evaluate((el) => getComputedStyle(el).display)).toBe("block");
  const cellLabel = await members
    .locator("td")
    .first()
    .evaluate((el) => getComputedStyle(el, "::before").content);
  expect(cellLabel).toContain("Membre");

  const settingsOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(settingsOverflow, `settings overflows by ${settingsOverflow}px`).toBeLessThanOrEqual(2);
});
