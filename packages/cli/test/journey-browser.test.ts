import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { findChromium } from "@proofcore/adapter-browser";
import { proofcoreConfigSchema } from "@proofcore/contracts";
import { Logger } from "@proofcore/core";
import { runEngine } from "@proofcore/engine";
import { createFlowProvider } from "@proofcore/module-flow";
import { describe, expect, it } from "vitest";
import { createBrowserJourneyRunner } from "../src/journey-runner.js";

/**
 * A FLOW journey on a real Chromium.
 *
 * The API proves the schema, persistence and history; it has no browser, so its
 * journeys are SKIPPED with a reason. This test covers the other half: the exact
 * journey shape the assistant saves, executed by the same engine and runner the CLI
 * uses, against a page that only works if the click and the DOM update happened.
 */

const chromium = findChromium();

async function page(): Promise<{ base: string; close: () => void }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
      <title>Checkout fixture</title></head><body>
      <h1>Checkout</h1>
      <button id="pay" onclick="document.getElementById('out').textContent='Commande confirmée'">
        Payer
      </button>
      <p id="out">En attente</p>
      </body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

describe.skipIf(!chromium)("FLOW journey in a real browser", () => {
  it("executes click, wait and text assertion from the saved journey shape", async () => {
    const fixture = await page();
    try {
      const config = proofcoreConfigSchema.parse({
        project: { name: "Journey fixture", baseUrl: fixture.base },
        environment: "local",
        enabledModules: ["flow"],
        modules: {
          world: { enabled: false, target: { kind: "none" } },
          flow: {
            enabled: true,
            paymentMode: "simulated",
            scenarios: [],
            journeys: [
              {
                id: "confirm",
                name: "Confirmer le paiement",
                startUrl: fixture.base,
                steps: [
                  { id: "open", action: "navigate", target: fixture.base },
                  { id: "pay", action: "click", target: "#pay" },
                  { id: "wait", action: "waitFor", value: "Commande confirmée" },
                  { id: "assert", action: "assertText", value: "Commande confirmée" },
                ],
              },
            ],
          },
          exit: { enabled: false },
        },
      });

      const provider = createFlowProvider({ journeyRunner: createBrowserJourneyRunner(config) });
      const result = await runEngine({
        config,
        providers: [provider],
        only: ["flow"],
        onlyCases: ["flow/journey/confirm"],
        projectId: "proj_journey",
        workspaceId: "ws_journey",
        logger: new Logger({ level: "error" }),
      });

      const testCase = result.run.moduleRuns[0]?.cases[0];
      expect(testCase?.id).toBe("flow/journey/confirm");
      expect(testCase?.status, testCase?.failure?.message).toBe("PASSED");
      expect(result.run.status).toBe("COMPLETED");
    } finally {
      fixture.close();
    }
  }, 60_000);
});
