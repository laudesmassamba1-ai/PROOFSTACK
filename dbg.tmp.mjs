import { chromium, devices } from "@playwright/test";
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
const email = `dbg.${Date.now()}@example.test`;

page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE ERR:", m.text().slice(0,200)); });
page.on("response", (r) => {
  if (r.url().includes("/api/auth")) console.log("RESP", r.status(), r.url());
});

await page.goto("http://localhost:5174/signup");
await page.getByLabel(/your name/i).fill("Ada Lovelace");
await page.getByLabel(/workspace name/i).fill("Ada workspace");
await page.getByLabel(/e-?mail/i).fill(email);
await page.getByLabel(/mot de passe|password/i).fill("correct-horse-battery-staple");
const btn = page.getByRole("button", { name: /create account/i });
console.log("visible:", await btn.isVisible(), "enabled:", await btn.isEnabled());
await btn.click();
await page.waitForTimeout(3000);
console.log("URL now:", page.url());
const status = await page.locator("[role=status]").first().textContent().catch(() => null);
console.log("status:", status);
await browser.close();
