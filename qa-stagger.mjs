import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);
console.log(
  JSON.stringify(
    await page.evaluate(() =>
      [...document.querySelectorAll(".hero-title .m-word-inner")].slice(0, 10).map((e) => ({
        text: e.textContent,
        delay: getComputedStyle(e).transitionDelay,
        transform: getComputedStyle(e).transform,
      }))
    ),
    null,
    2
  )
);
await page.close();
const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await p2.goto("http://127.0.0.1:5173/world", { waitUntil: "domcontentloaded" });
await p2.waitForTimeout(2600);
console.log(
  "WORLD",
  JSON.stringify(
    await p2.evaluate(() =>
      [...document.querySelectorAll("[data-reveal]")].map((e) => ({
        cls: String(e.className).slice(0, 40),
        top: Math.round(e.getBoundingClientRect().top),
        isIn: e.classList.contains("is-in"),
        opacity: getComputedStyle(e).opacity,
      }))
    ),
    null,
    2
  )
);
await browser.close();
