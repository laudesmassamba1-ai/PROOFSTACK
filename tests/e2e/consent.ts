import type { Page } from "@playwright/test";

/**
 * Dismiss the cookie card that covers the workspace on a first visit.
 *
 * The card is mounted with the lazy app shell, so it can appear several seconds after
 * the URL changes — on a phone, past the 3 s a one-shot probe used to allow. A probe
 * that gives up leaves the card open, and it then intercepts clicks meant for the page.
 *
 * This waits for the real card, accepts it, and waits until it is detached so the next
 * click is not swallowed by its 240 ms fade. In a context that already stored consent,
 * the card never opens and this is a no-op.
 */
export async function dismissConsent(page: Page): Promise<void> {
  const consent = page.getByRole("dialog", { name: /cookies/i });
  const opened = await consent
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) return;
  await consent.getByRole("button", { name: /autoriser|allow/i }).click();
  await consent.waitFor({ state: "detached" });
}
