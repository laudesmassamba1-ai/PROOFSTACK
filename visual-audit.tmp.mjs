/**
 * Automated DOM audit: finds unreadable text and broken layout across the app.
 *
 * It signs in once with a real account, visits every dashboard route at several
 * viewports, and reports concrete defects: horizontal overflow, clipped text, elements
 * outside the viewport, tiny text, and low-contrast text. It does not take a screenshot
 * and claim it inspected it — every finding is a measurement from the live DOM.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:5174";
const EMAIL = process.env.AUDIT_EMAIL ?? "visual@example.test";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "correct-horse-battery";

const ROUTES = [
  "/app",
  "/app/projects",
  "/app/start",
  "/app/guide",
  "/app/modules",
  "/app/modules/world",
  "/app/modules/flow",
  "/app/modules/exit",
  "/app/modules/fail",
  "/app/modules/clean",
  "/app/cli",
  "/app/interact",
  "/app/notifications",
  "/app/billing",
  "/app/settings",
  "/app/workspace",
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "phone", width: 390, height: 844 },
  { name: "small-phone", width: 375, height: 812 },
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORTS[0] });
const page = await context.newPage();

await page.goto(`${BASE}/signin`);
await page.locator("#auth-email").fill(EMAIL);
await page.locator("#auth-password").fill(PASSWORD);
await page.locator('form button[type="submit"]').click();
await page.waitForURL(/\/app/, { timeout: 20_000 });

const defects = [];

for (const viewport of VIEWPORTS) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(250);

    const result = await page.evaluate(() => {
      const out = { overflow: 0, clipped: [], tiny: [], lowContrast: [], offscreen: [] };
      const doc = document.documentElement;
      out.overflow = doc.scrollWidth - doc.clientWidth;

      const parse = (value) => {
        const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value ?? "");
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
      };
      const lum = (rgb) => {
        const [r, g, b] = rgb.map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a, b) => {
        const x = lum(a),
          y = lum(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };

      const nodes = [...document.querySelectorAll("body *")].slice(0, 1200);
      for (const el of nodes) {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
        if (!text) continue;

        // Only leaf-ish text nodes, to avoid reporting the same text on every ancestor.
        const hasTextChild = [...el.children].some((c) => (c.textContent ?? "").trim());
        if (hasTextChild) continue;

        if (
          el.scrollWidth > el.clientWidth + 3 &&
          style.overflowX !== "auto" &&
          style.overflowX !== "scroll"
        ) {
          out.clipped.push({
            text,
            tag: el.tagName,
            scroll: el.scrollWidth,
            client: el.clientWidth,
          });
        }
        const size = parseFloat(style.fontSize);
        if (size < 10) out.tiny.push({ text, size });

        const fg = parse(style.color);
        let bg = null;
        let node = el;
        while (node && !bg) {
          const candidate = parse(getComputedStyle(node).backgroundColor);
          if (candidate && !/rgba\(0, 0, 0, 0\)/.test(getComputedStyle(node).backgroundColor))
            bg = candidate;
          node = node.parentElement;
        }
        if (fg && bg) {
          const r = ratio(fg, bg);
          if (r < 3 && size >= 18)
            out.lowContrast.push({ text, ratio: Number(r.toFixed(2)), size });
          if (r < 4.5 && size < 18)
            out.lowContrast.push({ text, ratio: Number(r.toFixed(2)), size });
        }
        if (rect.right > window.innerWidth + 2 || rect.left < -2) {
          out.offscreen.push({ text, left: Math.round(rect.left), right: Math.round(rect.right) });
        }
      }
      return out;
    });

    if (result.overflow > 2)
      defects.push({ viewport: viewport.name, route, type: "overflow", value: result.overflow });
    for (const c of result.clipped.slice(0, 4))
      defects.push({ viewport: viewport.name, route, type: "clipped", ...c });
    for (const t of result.tiny.slice(0, 4))
      defects.push({ viewport: viewport.name, route, type: "tiny", ...t });
    for (const c of result.lowContrast.slice(0, 4))
      defects.push({ viewport: viewport.name, route, type: "lowContrast", ...c });
    for (const o of result.offscreen.slice(0, 4))
      defects.push({ viewport: viewport.name, route, type: "offscreen", ...o });
  }
}

await browser.close();

const byType = {};
for (const d of defects) byType[d.type] = (byType[d.type] ?? 0) + 1;
console.log("DEFECT COUNTS", JSON.stringify(byType));
for (const d of defects.slice(0, 80)) console.log(JSON.stringify(d));
console.log("TOTAL", defects.length);
