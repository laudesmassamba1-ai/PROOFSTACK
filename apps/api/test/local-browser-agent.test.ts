import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { browsers, findChromium } from "@proofcore/adapter-browser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalBrowserAgent } from "../src/local-browser-agent.js";

/**
 * The browser tool, driven for real.
 *
 * A stub proves the wiring; this proves the thing wiring calls. It starts the machine's
 * Chromium, serves a page on loopback, clicks it and reads the result back — or skips
 * honestly on a machine with no browser, never pretending the interaction happened.
 */
let hasChromium = true;
try {
  findChromium({});
} catch {
  hasChromium = false;
}

describe.skipIf(!hasChromium)("local browser agent", () => {
  let origin = "";
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>Agent fixture</title></head><body>
      <h1>Agent fixture</h1>
      <button id="go" onclick="document.getElementById('out').textContent='clicked'">Go</button>
      <input id="name" aria-label="Name" />
      <p id="out">waiting</p>
    </body></html>`);
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}/`;
  });

  afterAll(async () => {
    // Chromium keeps its sockets alive; close them so the fixture server can stop.
    await browsers.dispose().catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }, 30_000);

  it("opens, clicks, types, reads and closes a real page", async () => {
    const agent = createLocalBrowserAgent();
    const view = await agent.open({ userId: "usr_test", workspaceId: "ws_test", url: origin });
    try {
      expect(view.engine).toBe("local-chromium");
      expect(view.title).toBe("Agent fixture");
      expect(view.text).toContain("waiting");
      expect(view.screenshot).toMatch(/^data:image\/jpeg;base64,/);
      const clickable = view.elements.find((element) => element.selector === "#go");
      expect(clickable, JSON.stringify(view.elements)).toBeTruthy();

      const afterClick = await agent.act({
        userId: "usr_test",
        sessionId: view.sessionId,
        action: { kind: "click", selector: "#go" },
      });
      expect(afterClick.text).toContain("clicked");

      const afterType = await agent.act({
        userId: "usr_test",
        sessionId: view.sessionId,
        action: { kind: "type", selector: "#name", text: "Ada" },
      });
      expect(afterType.engine).toBe("local-chromium");

      const reread = await agent.read({ userId: "usr_test", sessionId: view.sessionId });
      expect(reread.url).toBe(origin);

      await expect(
        agent.read({ userId: "someone_else", sessionId: view.sessionId })
      ).rejects.toThrow(/session not found/i);
    } finally {
      await agent.close({ userId: "usr_test", sessionId: view.sessionId });
    }
  }, 90_000);
});
