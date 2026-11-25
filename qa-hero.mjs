import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:5173/?da=light", { waitUntil: "load" });
await page.waitForTimeout(5000);
await page.evaluate(() => document.querySelector(".da-comparer")?.remove());
await page.waitForTimeout(900);
const t = await page.evaluate(() =>
  document.querySelector(".lh-hero-title")?.innerText.replace(/\n/g, "|")
);
console.log("title:", t);
await page.screenshot({ path: "/tmp/light-hero2.png" });
await browser.close();
