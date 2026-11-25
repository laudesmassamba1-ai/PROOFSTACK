import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (const ms of [200, 600, 1000, 1600, 2400, 3600]) {
  await page.waitForTimeout(
    ms === 200
      ? 200
      : ms - (ms === 600 ? 200 : ms === 1000 ? 600 : ms === 1600 ? 1000 : ms === 2400 ? 1600 : 2400)
  );
  const r = await page.evaluate(() => {
    const h = document.querySelector(".hero-title");
    const w = document.querySelector(".m-word-inner");
    return {
      heroIsIn: h?.classList.contains("is-in"),
      heroArmed: h?.dataset.motionArmed,
      wordOpacity: w ? getComputedStyle(w).opacity : null,
      wordTransform: w ? getComputedStyle(w).transform : null,
      wordDelay: w ? getComputedStyle(w).transitionDelay : null,
      heroTop: Math.round(h?.getBoundingClientRect().top ?? -1),
      heroBottom: Math.round(h?.getBoundingClientRect().bottom ?? -1),
    };
  });
  console.log(ms, JSON.stringify(r));
}
await browser.close();
