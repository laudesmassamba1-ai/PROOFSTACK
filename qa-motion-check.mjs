import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  reducedMotion: "reduce",
});
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const result = await page.evaluate(() => {
  const h = document.querySelector(".hero-title");
  const w = document.querySelector(".m-word-inner");
  const r = document.querySelector("[data-reveal]");
  const t = document.querySelector("[data-tilt]");
  return {
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    heroOpacity: getComputedStyle(h).opacity,
    wordTransform: getComputedStyle(w).transform,
    wordOpacity: getComputedStyle(w).opacity,
    revealOpacity: getComputedStyle(r).opacity,
    revealFilter: getComputedStyle(r).filter,
    revealIsIn: r.classList.contains("is-in"),
    tiltTransform: getComputedStyle(t).transform,
    tiltArmed: t.dataset.tiltArmed ?? null,
    docScrollW: document.documentElement.scrollWidth,
  };
});
console.log(JSON.stringify({ result, errors }, null, 2));
await browser.close();
