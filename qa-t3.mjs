import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript(() => localStorage.removeItem("proofcore.da"));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3400);
const s1 = await page.evaluate(() => ({
  comparer: !!document.querySelector(".da-comparer"),
  toggle: (() => {
    const t = document.querySelector(".da-toggle");
    return t ? { text: t.textContent.trim(), display: getComputedStyle(t).display } : "none";
  })(),
}));
console.log("mobile:", JSON.stringify(s1));
await browser.close();
