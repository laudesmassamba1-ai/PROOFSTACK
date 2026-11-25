import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector("#modules")?.scrollIntoView());
await page.waitForTimeout(1600);
console.log(
  "WALL",
  JSON.stringify(
    await page.evaluate(() =>
      [...document.querySelectorAll(".module-panel")].slice(0, 6).map((e) => ({
        cls: String(e.className).split(" ").slice(0, 2).join(" "),
        parentIn: e.closest("[data-reveal]")?.classList.contains("is-in") ?? null,
        opacity: getComputedStyle(e).opacity,
        anim: getComputedStyle(e).animationName,
        delay: getComputedStyle(e).animationDelay,
      }))
    ),
    null,
    2
  )
);
await page.close();
const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await p2.goto("http://127.0.0.1:5173/?da=light", { waitUntil: "domcontentloaded" });
await p2.waitForTimeout(1800);
console.log(
  "LIGHT",
  JSON.stringify(
    await p2.evaluate(() => ({
      da: document.querySelector(".brand-shell")?.dataset.da,
      heroFont: getComputedStyle(document.querySelector(".lh-hero-title")).fontFamily,
      charTransform: getComputedStyle(document.querySelector(".m-char-inner")).transform,
      scrollW: document.documentElement.scrollWidth,
    })),
    null,
    2
  )
);
await browser.close();
