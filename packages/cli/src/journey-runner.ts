import { BrowserManager } from "@proofcore/adapter-browser";
import type { ProofCoreConfig } from "@proofcore/contracts";
import {
  executeJourney,
  type FlowJourney,
  type JourneyPage,
  type JourneyRunner,
} from "@proofcore/module-flow";

/**
 * Browser-backed FLOW journeys.
 *
 * This is the engine path the configuration was missing: `proofcore test --module flow`
 * now opens the project in the local Chromium, performs the configured steps and fails
 * the run on the exact step that broke. It is deliberately local: the API Worker has no
 * browser and reports the journeys as skipped rather than pretending.
 */
export function createBrowserJourneyRunner(config: ProofCoreConfig): JourneyRunner {
  const manager = new BrowserManager();
  const browser = config.modules.flow.browser;

  return async (journey: FlowJourney, context) => {
    const opened = await manager.open({
      headless: browser.headless,
      ...(browser.channel ? { channel: browser.channel } : {}),
      width: browser.viewport.width,
      height: browser.viewport.height,
    });
    const page = opened.page;
    const timeout = (ms: number) => Math.min(Math.max(ms, 1_000), 120_000);

    const adapter: JourneyPage = {
      navigate: async (url, timeoutMs) => {
        await page.navigate(url, { timeoutMs: timeout(timeoutMs), settle: true });
      },
      click: async (selector, timeoutMs) => {
        await page.click({ selector }, { settle: true });
        void timeoutMs;
      },
      fill: async (selector, value) => {
        await page.type({ selector }, value, { clear: true, settle: true });
      },
      select: async (selector, value) => {
        await page.select({ selector }, [value]);
      },
      submit: async (selector) => {
        if (selector) {
          await page.click({ selector }, { settle: true });
        } else {
          await page.press("Enter");
        }
      },
      waitFor: async (input, timeoutMs) => {
        const result = await page.waitFor({ ...input, timeoutMs: timeout(timeoutMs) });
        if (!result.matched) {
          throw new Error(`Timed out after ${timeout(timeoutMs)}ms waiting for the page.`);
        }
      },
      text: async () => {
        const text = await page.evaluateScript("document.body?.innerText ?? ''");
        return typeof text === "string" ? text : "";
      },
      url: async () => (await page.state()).url,
      screenshot: async () => (await page.screenshot()).data,
      api: async (url, timeoutMs) => {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeout(timeoutMs)) });
        return response.status;
      },
    };

    try {
      return await executeJourney(journey, adapter, context);
    } finally {
      await manager.close(opened.id).catch(() => undefined);
    }
  };
}
