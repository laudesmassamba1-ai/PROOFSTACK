import { ProofCoreError, shortId } from "@proofcore/core";
import type { AppStore } from "./store/app-store.js";

/**
 * The assistant's hands in the browser.
 *
 * `browse_url` reads a page once. These sessions do what a person does: open, look,
 * click, type, press, scroll, look again. Two real engines back them — Cloudflare's
 * Browser Rendering binding on the Worker, the machine's own Chromium on the Node
 * server — because a browser tool that only works in development is a demo, not a tool.
 *
 * A session belongs to the user who opened it. The Worker path stores the owner in D1
 * next to Cloudflare's session id, so a leaked id cannot drive somebody else's browser.
 */

export const AGENT_VIEWPORT = { width: 1280, height: 800 } as const;
const KEEP_ALIVE_MS = 120_000;
const NAVIGATION_TIMEOUT_MS = 25_000;
const MAX_TEXT = 6_000;
const MAX_ELEMENTS = 80;

export interface AgentElement {
  ref: string;
  role: string;
  name: string;
  selector: string;
}

export interface AgentView {
  sessionId: string;
  url: string;
  title: string;
  text: string;
  elements: AgentElement[];
  screenshot?: string;
  engine: "cloudflare" | "local-chromium";
}

export type AgentAction =
  | { kind: "navigate"; url: string }
  | { kind: "click"; selector: string }
  | { kind: "type"; selector: string; text: string; submit?: boolean }
  | { kind: "press"; key: string }
  | { kind: "scroll"; dy: number };

export interface BrowserAgent {
  open(input: { userId: string; workspaceId: string; url: string }): Promise<AgentView>;
  act(input: { userId: string; sessionId: string; action: AgentAction }): Promise<AgentView>;
  read(input: { userId: string; sessionId: string }): Promise<AgentView>;
  close(input: { userId: string; sessionId: string }): Promise<void>;
}

type RawSnapshot = {
  url?: string;
  title?: string;
  text?: string;
  elements?: { ref?: string; role?: string; name?: string; selector?: string }[];
};

/**
 * One expression for both engines, so the model sees the same shape whichever one ran.
 * It returns a stable CSS selector per interactive element: a ref the model can pass
 * straight back is worth more than a pretty accessibility tree it has to translate.
 */
export const SNAPSHOT_SCRIPT = `(() => {
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  const cssPath = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      const name = node.getAttribute('name');
      if (name) part += '[name="' + name.replace(/"/g, '\\"') + '"]';
      else {
        const siblings = Array.from(node.parentElement ? node.parentElement.children : []).filter((s) => s.tagName === node.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  const nodes = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]')).slice(0, 200);
  const elements = [];
  nodes.forEach((el, index) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
    const selector = cssPath(el);
    if (!selector || !document.querySelector(selector)) return;
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const name = clean(el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('alt') || el.getAttribute('title'));
    elements.push({ ref: 'e' + (index + 1), role, name, selector });
  });
  return {
    url: location.href,
    title: document.title,
    text: (document.body ? document.body.innerText : '').slice(0, ${MAX_TEXT}),
    elements: elements.slice(0, ${MAX_ELEMENTS}),
  };
})()`;

function normalise(
  raw: RawSnapshot,
  sessionId: string,
  engine: AgentView["engine"],
  screenshot?: string
): AgentView {
  return {
    sessionId,
    url: String(raw.url ?? ""),
    title: String(raw.title ?? "").slice(0, 300),
    text: String(raw.text ?? "").slice(0, MAX_TEXT),
    elements: (raw.elements ?? []).slice(0, MAX_ELEMENTS).map((element, index) => ({
      ref: String(element.ref ?? `e${index + 1}`),
      role: String(element.role ?? ""),
      name: String(element.name ?? ""),
      selector: String(element.selector ?? ""),
    })),
    ...(screenshot ? { screenshot } : {}),
    engine,
  };
}

interface CloudflarePage {
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
  url: () => string;
  title: () => Promise<string>;
  evaluate: <T>(expression: string) => Promise<T>;
  screenshot: (options: Record<string, unknown>) => Promise<string | Uint8Array>;
  click: (selector: string) => Promise<void>;
  type: (selector: string, text: string, options?: Record<string, unknown>) => Promise<void>;
  keyboard: { press: (key: string) => Promise<void> };
  mouse: { wheel: (options: { deltaY: number }) => Promise<void> };
  waitForNetworkIdle?: (options?: { timeout?: number }) => Promise<void>;
  setViewport?: (viewport: { width: number; height: number }) => Promise<void>;
}

interface CloudflareBrowser {
  pages: () => Promise<CloudflarePage[]>;
  newPage: () => Promise<CloudflarePage>;
  close: () => Promise<void>;
  disconnect?: () => Promise<void>;
  sessionId?: () => string;
}

async function puppeteerModule(): Promise<{
  launch: (binding: unknown, options?: Record<string, unknown>) => Promise<CloudflareBrowser>;
  connect: (binding: unknown, sessionId: string) => Promise<CloudflareBrowser>;
}> {
  const module = (await import("@cloudflare/puppeteer")) as unknown as {
    default: {
      launch: (binding: unknown, options?: Record<string, unknown>) => Promise<CloudflareBrowser>;
      connect: (binding: unknown, sessionId: string) => Promise<CloudflareBrowser>;
    };
  };
  return module.default;
}

async function cloudflareView(page: CloudflarePage, sessionId: string): Promise<AgentView> {
  const raw = await page.evaluate<RawSnapshot>(SNAPSHOT_SCRIPT);
  const shot = await page.screenshot({ type: "jpeg", quality: 60, encoding: "base64" });
  const base64 = typeof shot === "string" ? shot : Buffer.from(shot).toString("base64");
  const bytes = Buffer.byteLength(base64, "base64");
  return normalise(
    raw,
    sessionId,
    "cloudflare",
    bytes <= 180_000 ? `data:image/jpeg;base64,${base64}` : undefined
  );
}

async function settle(page: CloudflarePage): Promise<void> {
  await page.waitForNetworkIdle?.({ timeout: 2_000 }).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 250));
}

export function createCloudflareAgent(binding: unknown, store: AppStore): BrowserAgent {
  const connect = async (userId: string, sessionId: string) => {
    const record = await store.getBrowserSession(userId, sessionId);
    if (!record) {
      throw new ProofCoreError({
        message: "Browser session not found. Open the page again with browser_open.",
        category: "VALIDATION",
        code: "browser_session_not_found",
      });
    }
    const puppeteer = await puppeteerModule();
    const browser = await puppeteer.connect(binding, record.targetSessionId);
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    return { browser, page, record };
  };

  return {
    async open({ userId, workspaceId, url }) {
      const puppeteer = await puppeteerModule();
      const browser = await puppeteer.launch(binding, {
        keep_alive: KEEP_ALIVE_MS,
        defaultViewport: AGENT_VIEWPORT,
      });
      const page = await browser.newPage();
      await page.setViewport?.(AGENT_VIEWPORT);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      await settle(page);
      const sessionId = `bas_${shortId(18)}`;
      const targetSessionId = browser.sessionId?.() ?? "";
      if (!targetSessionId) {
        await browser.close().catch(() => undefined);
        throw new ProofCoreError({
          message: "The browser did not return a resumable session.",
          category: "NETWORK",
          code: "browser_session_failed",
        });
      }
      await store.createBrowserSession({
        id: sessionId,
        userId,
        workspaceId,
        targetSessionId,
        url,
      });
      const view = await cloudflareView(page, sessionId);
      await browser.disconnect?.();
      return view;
    },

    async act({ userId, sessionId, action }) {
      const { browser, page } = await connect(userId, sessionId);
      try {
        if (action.kind === "navigate") {
          await page.goto(action.url, {
            waitUntil: "domcontentloaded",
            timeout: NAVIGATION_TIMEOUT_MS,
          });
        } else if (action.kind === "click") {
          await page.click(action.selector);
        } else if (action.kind === "type") {
          await page.click(action.selector);
          await page.type(action.selector, action.text);
          if (action.submit) await page.keyboard.press("Enter");
        } else if (action.kind === "press") {
          await page.keyboard.press(action.key);
        } else {
          await page.mouse.wheel({ deltaY: action.dy });
        }
        await settle(page);
        const view = await cloudflareView(page, sessionId);
        await store.touchBrowserSession(userId, sessionId, view.url);
        return view;
      } finally {
        await browser.disconnect?.();
      }
    },

    async read({ userId, sessionId }) {
      const { browser, page } = await connect(userId, sessionId);
      try {
        return await cloudflareView(page, sessionId);
      } finally {
        await browser.disconnect?.();
      }
    },

    async close({ userId, sessionId }) {
      const { browser } = await connect(userId, sessionId).catch(() => ({
        browser: null,
        page: null,
        record: null,
      }));
      await browser?.close().catch(() => undefined);
      await store.deleteBrowserSession(userId, sessionId);
    },
  };
}
