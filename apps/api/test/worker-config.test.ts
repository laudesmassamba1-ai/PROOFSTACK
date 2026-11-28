import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The browser binding is only usable when the Worker can load `@cloudflare/puppeteer`.
 * That package imports `node:fs`/`node:path`; without `nodejs_compat` the bundle deploys
 * but `browser_open` fails at runtime, which is exactly the failure users saw. This test
 * keeps the config contract next to the code instead of in a deployment memory.
 */
describe("production Worker configuration", () => {
  const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

  it("keeps the Browser Rendering binding", () => {
    expect(config).toMatch(/\[browser\]\s*\nbinding = "BROWSER"/);
  });

  it("enables Node compatibility for @cloudflare/puppeteer", () => {
    expect(config).toContain('compatibility_flags = ["nodejs_compat"]');
  });
});
