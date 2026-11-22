import { describe, expect, it } from "vitest";
import { CONTROLS, controlFor, explain } from "../src/controls.js";
import { type ScanModule, scanPage } from "../src/page-scan.js";

/**
 * The registry is the product's promise that every finding can be explained without a
 * model. These tests keep that promise from drifting: a control added to the scan without
 * its entry here fails CI instead of reaching a user as a bare id.
 */

const SCAN_MODULES: ScanModule[] = ["fail", "clean", "flow", "world", "exit"];

/** A page that triggers as many controls as possible without network access. */
const HOSTILE_HTML = `<!doctype html>
<html>
  <head>
    <title>Boutique</title>
    <script src="https://js.stripe.com/v3/"></script>
  </head>
  <body>
    <h2>Sans h1</h2>
    <img src="/a.png" />
    <form action="/checkout" method="post">
      <input name="card" />
    </form>
    <a href="/cart">Panier</a>
    <a href="/export.csv" download>Export</a>
    <p>Total 12,50 € · €12.50 — 12/31/2024</p>
    <div style="color:red">Alerte : stack trace on line 42</div>
    <script type="application/ld+json">{ not json }</script>
  </body>
</html>`;

async function scan(): Promise<{ module: ScanModule; id: string }[]> {
  const result = await scanPage("https://example.com", {
    allowPrivate: true,
    fetchImpl: (async () =>
      new Response(HOSTILE_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "set-cookie": "sid=1" },
      })) as unknown as typeof fetch,
  });
  return result.findings.map((item) => ({ module: item.module, id: item.id }));
}

describe("control registry", () => {
  it("has one entry per control id, with no duplicate", () => {
    const keys = CONTROLS.map((control) => `${control.module}:${control.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(CONTROLS.length).toBeGreaterThanOrEqual(46);
  });

  it("explains every control a real scan can emit, in both languages", async () => {
    const emitted = await scan();
    const unknown = emitted.filter((item) => controlFor(item.module, item.id) === undefined);
    // A scan must never report an id this file cannot explain.
    expect(unknown).toEqual([]);
  });

  it("emits every scan module, so the scan above actually covers the registry", async () => {
    const emitted = await scan();
    const modules = new Set(emitted.map((item) => item.module));
    for (const module of SCAN_MODULES) expect(modules.has(module)).toBe(true);
  });

  it("gives each control an objective, a consequence, a fix and a way to verify", () => {
    for (const control of CONTROLS) {
      for (const [locale, copy] of [
        ["fr", control.fr],
        ["en", control.en],
      ] as const) {
        const where = `${control.module}:${control.id} (${locale})`;
        expect(copy.title.length, where).toBeGreaterThan(2);
        // One sentence, two at most: an explanation that needs a paragraph is not one.
        expect(copy.objective.length, where).toBeGreaterThan(20);
        expect(copy.consequence.length, where).toBeGreaterThan(30);
        expect(copy.fix.length, where).toBeGreaterThan(20);
        expect(copy.verify.length, where).toBeGreaterThan(20);
        expect(copy.consequence, where).not.toMatch(/garantit|guarantees/);
      }
    }
  });

  it("states a method and a result shape for every control", () => {
    for (const control of CONTROLS) {
      const where = `${control.module}:${control.id}`;
      expect(control.method.length, where).toBeGreaterThan(15);
      expect(control.result.length, where).toBeGreaterThan(3);
      expect(["low", "medium", "high"], where).toContain(control.complexity);
      expect(["low", "medium", "high"], where).toContain(control.risk);
    }
  });

  it("gives a fix example for every control that has a fix", () => {
    // The clickjacking cross-check is an alias: its fix is the one of `frame_ancestors`.
    for (const control of CONTROLS) {
      const where = `${control.module}:${control.id}`;
      if (control.aliasOf) {
        expect(controlFor(control.module, control.aliasOf), where).toBeDefined();
        continue;
      }
      expect(control.fixes.length, where).toBeGreaterThan(0);
      for (const fix of control.fixes) {
        expect(fix.stack.length, where).toBeGreaterThan(1);
        expect(fix.code.length, where).toBeGreaterThan(5);
      }
    }
  });

  it("answers with the reader's language", () => {
    const fr = explain("fail", "hsts", "fr");
    const en = explain("fail", "hsts", "en");
    expect(fr?.copy.fix).toContain("Strict-Transport-Security");
    expect(en?.copy.consequence).toMatch(/first request/);
    expect(explain("fail", "nope", "fr")).toBeUndefined();
  });
});
