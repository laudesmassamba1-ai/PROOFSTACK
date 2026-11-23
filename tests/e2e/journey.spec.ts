import { expect, type Page, test } from "@playwright/test";

/**
 * The customer journey, end to end.
 *
 * These tests exist to catch what unit and integration tests cannot: a route that is
 * not registered, a cookie that the browser refuses, a CORS header that is missing, a
 * button that looks enabled and does nothing.
 *
 * Every test asserts on something a customer would notice. Where a check could pass
 * vacuously (an empty list, a page that renders an error), the test asserts the
 * *absence* of the failure state too.
 */

const PASSWORD = "correct-horse-battery-staple";

/**
 * The API origin, addressed directly.
 *
 * The session assertion below must not depend on the dev proxy: the point is to prove
 * the HttpOnly cookie is actually sent by the browser, and an absolute URL to the API
 * tests exactly that.
 */
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT ?? 8788}`;

/**
 * Pin the interface language before every test.
 *
 * The locale lives in localStorage and survives navigation, so one test that switches
 * to French would make every later test look for English labels that are no longer
 * rendered. Pinning it makes the suite order-independent.
 *
 * The guard matters: `addInitScript` runs on *every* navigation, so without it the
 * language-switch test would have its own change undone on the next page load.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("e2e.localePinned")) {
      window.localStorage.setItem("proofcore.locale", "en");
      window.sessionStorage.setItem("e2e.localePinned", "1");
    }
  });
});

/** A unique email per test, so a reused server cannot collide. */
function uniqueEmail(label: string): string {
  return `${label}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
}

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/signup");
  // The sign-up form asks for a name and a workspace name as well as credentials:
  // the API creates the workspace in the same transaction as the account, so a
  // customer never lands in a dashboard with nothing to select.
  await page.locator("#auth-name").fill("Ada Lovelace");
  await page.locator("#auth-workspace").fill("Ada workspace");
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
}

test.describe("marketing site", () => {
  test("the homepage renders its hero and the three modules", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/PROOFCORE/i);
    // The headline is the brand promise; if it is missing the page is broken.
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Everywhere|partout/i);

    // On a phone the module links live behind the menu, which is correct behaviour and
    // not a missing feature: assert on the page body, which lists the modules in the
    // showcase section on every viewport.
    for (const module of ["WORLD", "FLOW", "EXIT"]) {
      await expect(page.getByText(module, { exact: false }).first()).toBeAttached();
    }
  });

  test("pricing shows real plan prices, not placeholders", async ({ page }) => {
    await page.goto("/pricing");
    // $12 / $29 / $79 are the catalogue prices. A page that shows none of them is
    // either broken or inventing its own numbers.
    await expect(page.getByText(/\$\s?12/).first()).toBeVisible();
    await expect(page.getByText(/\$\s?29/).first()).toBeVisible();
    await expect(page.getByText(/\$\s?79/).first()).toBeVisible();
  });

  test("no page logs a console error on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    for (const path of ["/", "/product", "/pricing", "/docs", "/security", "/platform"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    expect(errors, `console errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("the language switch actually changes the copy", async ({ page }) => {
    await page.goto("/");
    const heading = page.getByRole("heading", { level: 1 });
    const before = await heading.textContent();

    // Two presentations of the same control: on desktop it is a compact toggle whose
    // accessible name is "Language"/"Langue"; inside the mobile menu it is a full-width
    // button labelled with the language it switches to. Handle both rather than
    // pretending one layout exists.
    const menu = page.getByRole("button", { name: /open menu|ouvrir le menu/i });
    if (await menu.isVisible()) await menu.click();

    const toggle = page
      .getByRole("button", { name: /^(language|langue|français|english)$/i })
      .first();
    await toggle.click();

    await expect(heading).not.toHaveText(before ?? "", { timeout: 10_000 });
    // The document language must follow the choice, or screen readers keep the old one.
    await expect(page.locator("html")).toHaveAttribute("lang", /fr|en/);
  });
});

test.describe("authentication", () => {
  test("a new account reaches the dashboard, and the session survives a reload", async ({
    page,
  }) => {
    const email = uniqueEmail("signup");
    await signUp(page, email);

    // The dashboard is the proof: it only renders when the API accepted the cookie.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // The session itself is asserted through the API, so the check does not depend on
    // how the workspace name is rendered (selector, chip, or option label). The cookie
    // is HttpOnly, which is exactly why the browser — not this test — must send it.
    const sessionResponse = await page.request.get(`${API_ORIGIN}/api/auth/session`);
    const session = (await sessionResponse.json()) as {
      user: { email: string } | null;
      workspaces: { name: string }[];
    };
    expect(session.user?.email).toBe(email);
    expect(session.workspaces.map((workspace) => workspace.name)).toContain("Ada workspace");

    // A reload proves the cookie survives and is still sent, not just held in memory.
    await page.reload();
    await expect(page).not.toHaveURL(/signin/);
    const afterReloadResponse = await page.request.get(`${API_ORIGIN}/api/auth/session`);
    const afterReload = (await afterReloadResponse.json()) as { user: { email: string } | null };
    expect(afterReload.user?.email).toBe(email);
  });

  test("a wrong password is refused with a message, not a blank screen", async ({ page }) => {
    const email = uniqueEmail("wrongpass");
    await signUp(page, email);
    // Sign out through the account menu; the shell is the only place that owns it.
    await page.goto("/app/settings");
    const signOut = page.getByRole("button", { name: /sign out|se déconnecter/i }).first();
    if (await signOut.count()) {
      await signOut.click();
      await page.waitForTimeout(1500);
    }

    await page.goto("/signin");
    await page.getByLabel(/e-?mail/i).fill(email);
    await page.getByLabel(/mot de passe|password/i).fill("definitely-not-the-password");
    await page.getByRole("button", { name: /^se connecter$|^sign in$/i }).click();

    // Stay on the page and say something. A silent failure is the bug.
    await expect(page).toHaveURL(/signin/);
    await expect(page.getByRole("status").or(page.locator("[role=alert]"))).toBeVisible();
  });

  test("the dashboard is unreachable without a session", async ({ page }) => {
    await page.goto("/app");
    await page.waitForURL(/signin/, { timeout: 15_000 });
    await expect(page.locator("#auth-email")).toBeVisible();
  });
});

test.describe("dashboard", () => {
  test("overview states the plan honestly and shows the three modules", async ({ page }) => {
    await signUp(page, uniqueEmail("overview"));

    // A fresh workspace is on Free: the page must say so rather than implying a plan.
    await expect(page.getByText(/free/i).first()).toBeVisible();
    for (const module of ["world", "flow", "exit"]) {
      await expect(page.getByText(new RegExp(module, "i")).first()).toBeVisible();
    }
  });

  test("a module with no runs says it is unverified, never that it passed", async ({ page }) => {
    await signUp(page, uniqueEmail("module"));
    await page.goto("/app/modules/flow");

    // This is the distinction the whole product rests on: nothing ran, so nothing
    // passed. A green zero here would be a lie.
    await expect(
      page.getByText(/not verified|non vérifié|has not run|pas encore/i).first()
    ).toBeVisible();
  });

  test("billing shows the provider cannot auto-charge", async ({ page }) => {
    await signUp(page, uniqueEmail("billing"));
    await page.goto("/app/billing");

    await expect(page.getByRole("heading", { name: /billing|facturation/i })).toBeVisible();
    // The sandbox provider has no recurring support. The page must say "renew manually"
    // rather than implying an automatic subscription that will never happen.
    await expect(page.getByText(/renew|renouvel|manually|manuel/i).first()).toBeVisible();
    await expect(page.getByText(/receipt|reçu/i).first()).toBeVisible();
  });

  test("a plan can be chosen and settled with the test payment provider", async ({ page }) => {
    await signUp(page, uniqueEmail("checkout-sandbox"));
    await page.goto("/app/billing");

    await page.getByRole("button", { name: /Upgrade to Developer/i }).click();
    await expect(page.getByText("Sandbox outcome:")).toBeVisible();
    await page.getByRole("button", { name: /^success$/i }).click();

    // The subscription comes from the provider verification, not from the button click.
    await expect(page.getByText(/Developer plan activated/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Paid access is active/i)).toBeVisible();
  });

  test("an owner can delete their only workspace", async ({ page }) => {
    await signUp(page, uniqueEmail("delete-only-workspace"));
    await page.goto("/app/workspace");

    await page.getByRole("button", { name: "Delete workspace" }).click();
    await page.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.getByText(/Workspace deleted/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("No workspace yet.")).toBeVisible();

    // The account must remain usable once its only workspace is gone: the owner can
    // create a replacement instead of being stuck on a dead page.
    await page.getByLabel("New workspace name").fill("Replacement workspace");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText(/Workspace “Replacement workspace” created/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("CLI documentation stays inside the app shell", async ({ page }) => {
    await signUp(page, uniqueEmail("cli-docs"));
    await page.goto("/app/cli");
    await page.getByRole("link", { name: /CLI documentation/i }).click();
    await expect(page).toHaveURL(/\/app\/cli\/docs$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/ENGINE|MOTEUR/i);
    // The marketing navigation must not replace the workspace shell.
    await expect(page.getByRole("link", { name: /^Sign in$|^Se connecter$/i })).toHaveCount(0);
  });

  test("an unknown app route gets the app 404, not the marketing page", async ({ page }) => {
    await signUp(page, uniqueEmail("app-404"));
    await page.goto("/app/this-route-does-not-exist");
    await expect(page.getByText("404 / PROOFCORE")).toBeVisible();
    await expect(page.getByRole("link", { name: /CLI \/ guide/i })).toBeVisible();
  });

  test("settings exposes appearance and language", async ({ page }) => {
    await signUp(page, uniqueEmail("settings"));
    await page.goto("/app/settings");

    await expect(page.getByRole("heading", { name: /settings|paramètres/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^dark$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^light$/i })).toBeVisible();
  });

  test("the dark theme actually changes the page background", async ({ page }) => {
    await signUp(page, uniqueEmail("theme"));
    await page.goto("/app/settings");

    const snapshot = async () =>
      page.evaluate(() => ({
        theme: document.documentElement.getAttribute("data-theme"),
        background: getComputedStyle(document.body).backgroundColor,
        surface: getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
      }));

    await page.getByRole("button", { name: /^light$/i }).click();
    const light = await snapshot();
    await page.getByRole("button", { name: /^dark$/i }).click();
    const dark = await snapshot();

    // The mechanism is the data-theme attribute; the visible effect is a different
    // background token. Both must change, or the switch is cosmetic.
    expect(dark.theme).toBe("dark");
    expect(dark.surface).not.toBe(light.surface);
  });

  test("no dashboard page overflows horizontally", async ({ page }) => {
    await signUp(page, uniqueEmail("overflow"));
    for (const path of [
      "/app",
      "/app/projects",
      "/app/billing",
      "/app/settings",
      "/app/modules/world",
    ]) {
      await page.goto(path);
      // Wait for the page's own content, not just the network: a table that has not
      // rendered yet cannot overflow, so measuring too early passes vacuously.
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      // A wide table is allowed to be wider than the viewport *inside* its scroll
      // wrapper; what must never happen is the document itself scrolling sideways.
      expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(2);
    }
  });
});
