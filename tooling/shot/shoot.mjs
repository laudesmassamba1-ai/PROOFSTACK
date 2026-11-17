import { chromium } from "playwright";

/**
 * Visual QA capture tool. Usage:
 *   node shoot.mjs '[["home","http://localhost:5173/",3000,false],...]'
 * Each entry is [name, url, waitMs, fullPage]. Screenshots land in /tmp/ps_<name>.png.
 */
const shots = JSON.parse(process.argv[2] ?? `[]`);
const viewport = JSON.parse(process.argv[3] ?? `{"width":1600,"height":1000}`);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
for (const [name, url, wait, full] of shots) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `/tmp/ps_${name}.png`, fullPage: full ?? false });
  console.log("shot", name);
}
console.log(errors.length ? errors.join("\n") : "no console/page errors");
await browser.close();
