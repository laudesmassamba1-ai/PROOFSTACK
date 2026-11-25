import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const routes = [
  "/",
  "/product",
  "/platform",
  "/pricing",
  "/docs",
  "/world",
  "/flow",
  "/exit",
  "/fail",
  "/clean",
  "/download",
  "/changelog",
  "/security",
];
for (const route of routes) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("ERR_CONNECTION_REFUSED"))
      errors.push(m.text().slice(0, 160));
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 160)));
  await page.goto("http://127.0.0.1:5173" + route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: innerWidth,
    h1: document.querySelector("h1")?.textContent?.slice(0, 60) ?? null,
    hiddenWords: [...document.querySelectorAll(".m-word-inner")].filter(
      (e) => getComputedStyle(e).opacity === "0"
    ).length,
    words: document.querySelectorAll(".m-word-inner").length,
    hiddenReveals: [...document.querySelectorAll("[data-reveal]")].filter((e) => {
      const b = e.getBoundingClientRect();
      return b.top < innerHeight && b.bottom > 0 && getComputedStyle(e).opacity === "0";
    }).length,
  }));
  console.log(route.padEnd(12), JSON.stringify({ ...r, errors }));
  await page.close();
}
await browser.close();
