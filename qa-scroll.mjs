import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://127.0.0.1:5173/world", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.evaluate(() => window.scrollTo(0, 700));
await page.waitForTimeout(1200);
console.log(
  JSON.stringify(
    await page.evaluate(() =>
      [...document.querySelectorAll("[data-reveal]")].slice(0, 5).map((e) => ({
        top: Math.round(e.getBoundingClientRect().top),
        isIn: e.classList.contains("is-in"),
        opacity: getComputedStyle(e).opacity,
      }))
    ),
    null,
    2
  )
);
const panels = await page.evaluate(() =>
  [...document.querySelectorAll(".module-panel")].slice(0, 3).map((e) => ({
    cls: String(e.className).slice(0, 45),
    isIn: e.closest("[data-reveal]")?.classList.contains("is-in"),
    opacity: getComputedStyle(e).opacity,
    anim: getComputedStyle(e).animationName,
  }))
);
console.log("PANELS", JSON.stringify(panels, null, 2));
await browser.close();
