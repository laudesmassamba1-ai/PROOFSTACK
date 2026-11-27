import { expect, type Page, request, test } from "@playwright/test";
import { dismissConsent } from "./consent";

/**
 * The browser half of the CSRF double-submit.
 *
 * The API tests prove the server rule with hand-built cookies. This proves the real
 * path the web app takes: the readable `ps_csrf` cookie exists, the session cookie stays
 * HttpOnly, and a Settings write (closing another session) succeeds because `apiFetch`
 * echoes the token. The same write without the echo must be refused, which is the
 * attack a cross-site page can actually mount.
 */

const PASSWORD = "correct-horse-battery-staple";
const API = `http://localhost:${process.env.E2E_API_PORT ?? 8788}`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("e2e.localePinned")) {
      window.localStorage.setItem("proofcore.locale", "fr");
      window.sessionStorage.setItem("e2e.localePinned", "1");
    }
  });
});

async function signUp(page: Page): Promise<string> {
  const email = `csrf.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
  await page.goto("/signup");
  await page.locator("#auth-name").fill("Ada Csrf");
  await page.locator("#auth-workspace").fill("Espace csrf");
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
  await dismissConsent(page);
  return email;
}

test("a settings write echoes the token and a write without it is refused", async ({ page }) => {
  const email = await signUp(page);

  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === "ps_session");
  const csrf = cookies.find((cookie) => cookie.name === "ps_csrf");
  expect(session?.httpOnly, "the session cookie stays out of JavaScript").toBe(true);
  expect(csrf?.httpOnly, "the CSRF cookie must be readable by the app").toBe(false);
  expect(await page.evaluate(() => document.cookie)).toContain("ps_csrf=");

  // A second session, created outside the browser, gives the list something to close.
  const elsewhere = await request.newContext({ baseURL: API });
  const signIn = await elsewhere.post("/api/auth/sign-in/email", {
    data: { email, password: PASSWORD },
  });
  expect(signIn.ok()).toBeTruthy();
  await elsewhere.dispose();

  await page.goto("/app/settings");
  await expect(page.getByText("Sessions ouvertes", { exact: true })).toBeVisible();
  const close = page.getByRole("button", { name: "Fermer" });
  await expect(close).toHaveCount(1);
  await close.click();
  await expect(page.getByText("Session fermée.")).toBeVisible();
  await expect(close).toHaveCount(0);

  // The cookies are present, but the page does not echo them: this is what a cross-site
  // page can send. It must be refused before any session is touched.
  const forged = await page.request.delete(`${API}/api/account/sessions/none`);
  expect(forged.status()).toBe(403);
  const body = (await forged.json()) as { error: { code: string } };
  expect(body.error.code).toBe("csrf_token_required");
});
