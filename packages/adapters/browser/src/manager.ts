import { ProofCoreError } from "@proofcore/core";
import { chromiumMissingMessage, findChromium } from "./discovery.js";
import { type LaunchedBrowser, type LaunchOptions, launchBrowser } from "./launch.js";
import { BrowserPage } from "./session.js";

/**
 * The sessions an agent holds open.
 *
 * One browser process, many pages. Launching a process per tool call would make every click
 * half a second slower and lose the page's JavaScript state between two calls, so `open`
 * starts the engine once and `page` addresses an existing tab. Ids are stable and short
 * (`page-1`), because they travel through JSON tool calls.
 *
 * The engine closes itself after ten idle minutes. An agent that browsed once and moved on
 * should not leave a Chromium (and its profile directory) running until the machine reboots.
 */

export interface OpenPageOptions extends LaunchOptions {
  url?: string;
}

export interface BrowserPageSummary {
  id: string;
  url: string;
  title: string;
  readyState: string;
  consoleErrors: number;
}

const IDLE_CLOSE_MS = 10 * 60_000;

export class BrowserManager {
  private launched: Promise<LaunchedBrowser> | undefined;
  private readonly pages = new Map<string, BrowserPage>();
  private readonly titles = new Map<string, string>();
  private counter = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | undefined;

  /** The engine, started on first use and reused afterwards. */
  async engine(options: LaunchOptions = {}): Promise<LaunchedBrowser> {
    if (!this.launched) {
      this.launched = launchBrowser(options).catch((error: unknown) => {
        // A failed launch must not be cached: the next call retries instead of replaying an
        // error that may since have been fixed (a browser installed, a profile unlocked).
        this.launched = undefined;
        throw error;
      });
    }
    const engine = await this.launched;
    if (engine.connection.closed) {
      this.launched = undefined;
      return this.engine(options);
    }
    this.unsubscribe ??= engine.connection.on((event) => {
      if (event.method !== "Target.targetDestroyed") return;
      const targetId = String(event.params.targetId ?? "");
      for (const [id, page] of this.pages) {
        if (page.targetId === targetId) {
          this.pages.delete(id);
          this.titles.delete(id);
        }
      }
    });
    return engine;
  }

  async open(options: OpenPageOptions = {}): Promise<{
    id: string;
    page: BrowserPage;
    engine: { executable: string; source: string };
  }> {
    this.cancelIdleClose();
    const engine = await this.engine(options);
    const created = await engine.connection.send<{ targetId?: string }>("Target.createTarget", {
      url: "about:blank",
    });
    const targetId = created.targetId;
    if (!targetId) {
      throw new ProofCoreError({
        message: "The browser did not create a tab.",
        category: "NETWORK",
        code: "browser_tab_failed",
      });
    }
    const attached = await engine.connection.send<{ sessionId?: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    if (!attached.sessionId) {
      throw new ProofCoreError({
        message: "The browser refused to attach to the new tab.",
        category: "NETWORK",
        code: "browser_attach_failed",
      });
    }
    const page = new BrowserPage(engine.connection, targetId, attached.sessionId);
    await page.init();
    if (options.width && options.height) {
      await page.setViewport({ width: options.width, height: options.height });
    }
    const id = `page-${++this.counter}`;
    this.pages.set(id, page);
    if (options.url) {
      const state = await page.navigate(options.url, { settle: true });
      this.titles.set(id, state.title || state.url);
    }
    return { id, page, engine: { executable: engine.executable, source: engine.source } };
  }

  /** Resolves a page id; with one open page, no id is fine. Ambiguity is an error. */
  get(id?: string): { id: string; page: BrowserPage } {
    if (id) {
      const page = this.pages.get(id);
      if (!page) {
        throw new ProofCoreError({
          message: `No browser page "${id}". Open pages: ${[...this.pages.keys()].join(", ") || "none"}.`,
          category: "VALIDATION",
          code: "browser_page_not_found",
          details: { open: [...this.pages.keys()] },
        });
      }
      return { id, page };
    }
    if (this.pages.size === 0) {
      throw new ProofCoreError({
        message: "No browser page is open. Call browser_open first.",
        category: "VALIDATION",
        code: "browser_not_open",
      });
    }
    if (this.pages.size > 1) {
      throw new ProofCoreError({
        message: `Several pages are open; name one: ${[...this.pages.keys()].join(", ")}.`,
        category: "VALIDATION",
        code: "browser_page_required",
        details: { open: [...this.pages.keys()] },
      });
    }
    const entry = [...this.pages.entries()][0];
    if (!entry) {
      throw new ProofCoreError({
        message: "No browser page is open. Call browser_open first.",
        category: "VALIDATION",
        code: "browser_not_open",
      });
    }
    return { id: entry[0], page: entry[1] };
  }

  async summaries(): Promise<BrowserPageSummary[]> {
    const out: BrowserPageSummary[] = [];
    for (const [id, page] of this.pages) {
      const state = await page.state().catch(() => null);
      out.push({
        id,
        url: state?.url ?? page.url,
        title: state?.title ?? this.titles.get(id) ?? "",
        readyState: state?.readyState ?? "unknown",
        consoleErrors: page.console.filter((entry) => entry.type === "error").length,
      });
    }
    return out;
  }

  async close(id?: string): Promise<{ closed: string[] }> {
    if (!id) {
      const ids = [...this.pages.keys()];
      await this.closeAll();
      return { closed: ids };
    }
    const { page } = this.get(id);
    await page.close();
    this.pages.delete(id);
    this.titles.delete(id);
    if (this.pages.size === 0) this.scheduleIdleClose();
    return { closed: [id] };
  }

  async closeAll(): Promise<void> {
    const pages = [...this.pages.values()];
    this.pages.clear();
    this.titles.clear();
    await Promise.all(pages.map((page) => page.close().catch(() => undefined)));
    this.scheduleIdleClose();
  }

  /** Stops the browser process entirely. */
  async dispose(): Promise<void> {
    this.cancelIdleClose();
    await this.closeAll();
    const enginePromise = this.launched;
    this.launched = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (enginePromise) {
      const engine = await enginePromise.catch(() => undefined);
      await engine?.close().catch(() => undefined);
    }
  }

  /** Whether a browser exists on this machine, without starting one. */
  status(): {
    available: boolean;
    executable?: string;
    source?: string;
    running: boolean;
    pages: string[];
    error?: string;
  } {
    const lookup = findChromium();
    return {
      available: Boolean(lookup) || Boolean(process.env.PROOFCORE_BROWSER_URL),
      ...(lookup ? { executable: lookup.executable, source: lookup.source } : {}),
      running: Boolean(this.launched),
      pages: [...this.pages.keys()],
      ...(lookup
        ? {}
        : {
            error: chromiumMissingMessage(findChromium()?.tried ?? []),
          }),
    };
  }

  private scheduleIdleClose(): void {
    this.cancelIdleClose();
    this.idleTimer = setTimeout(() => {
      void this.dispose();
    }, IDLE_CLOSE_MS);
    // Node keeps the process alive for a pending timer; an idle browser is not a reason to.
    this.idleTimer.unref?.();
  }

  private cancelIdleClose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }
}

/** The process-wide manager. Tools share it; each CLI invocation still owns one browser. */
export const browsers = new BrowserManager();
