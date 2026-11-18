import { ProofCoreError, shortId } from "@proofcore/core";
import { Hono } from "hono";
import { z } from "zod";
import { clientAddress, HttpError, RateLimiter } from "../http/errors.js";
import { readBody } from "../http/guards.js";
import type { AppEnv, Services } from "../http/services.js";

/**
 * The interactive browser, beside the chat.
 *
 * A Worker cannot hand a live DOM to the page, and an `<iframe>` is refused by most real
 * sites (X-Frame-Options, frame-ancestors). So the browser runs here, on Cloudflare's own
 * Chromium, and the app shows what it sees: the viewport as an image, driven by explicit
 * actions — navigate, click, type, key, scroll, back, reload.
 *
 * That is a real browser, not a preview of one: the page executes its JavaScript, cookies
 * and redirects behave, and a click lands where the user clicked because the coordinates are
 * mapped through the same viewport the screenshot was taken from.
 *
 * Sessions survive between requests through the Browser Rendering session id (keep_alive),
 * row-scoped to the user who opened it. A session id alone is not enough: every request
 * checks the owner in D1, so a leaked id cannot drive somebody else's browser.
 */

const VIEWPORT = { width: 1280, height: 800 };
const ACTION_TIMEOUT_MS = 25_000;
const KEEP_ALIVE_MS = 120_000;

const startSchema = z.object({
  url: z.string().min(1).max(2048).optional(),
  workspaceId: z.string().min(1).max(64),
});

const actionSchema = z.object({
  sessionId: z.string().min(1).max(120),
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("navigate"), url: z.string().min(1).max(2048) }),
    z.object({
      kind: z.literal("click"),
      x: z.number().min(0).max(VIEWPORT.width),
      y: z.number().min(0).max(VIEWPORT.height),
    }),
    z.object({ kind: z.literal("type"), text: z.string().max(2000) }),
    z.object({ kind: z.literal("key"), key: z.string().min(1).max(20) }),
    z.object({ kind: z.literal("scroll"), dy: z.number().min(-5000).max(5000) }),
    z.object({ kind: z.literal("back") }),
    z.object({ kind: z.literal("reload") }),
  ]),
});

const closeSchema = z.object({ sessionId: z.string().min(1).max(120) });

interface BrowserState {
  url: string;
  title: string;
  screenshot?: string;
  console: { type: string; text: string }[];
  viewport: { width: number; height: number };
}

/** Minimal shape of the parts of Puppeteer this route uses. */
interface PageLike {
  goto: (
    url: string,
    options?: Record<string, unknown>
  ) => Promise<{ status?: () => number } | null>;
  title: () => Promise<string>;
  url: () => string;
  screenshot: (options: Record<string, unknown>) => Promise<string | Uint8Array>;
  mouse: {
    click: (x: number, y: number) => Promise<void>;
    wheel: (options: { deltaY: number }) => Promise<void>;
  };
  keyboard: { press: (key: string) => Promise<void>; type: (text: string) => Promise<void> };
  goBack: (options?: Record<string, unknown>) => Promise<unknown>;
  reload: (options?: Record<string, unknown>) => Promise<unknown>;
  setViewport: (viewport: { width: number; height: number }) => Promise<void>;
  evaluate?: (expression: string) => Promise<unknown>;
  waitForNetworkIdle?: (options?: { timeout?: number }) => Promise<void>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
}

interface BrowserLike {
  pages: () => Promise<PageLike[]>;
  newPage: () => Promise<PageLike>;
  close: () => Promise<void>;
  disconnect?: () => Promise<void>;
  sessionId?: () => string;
}

/** Loads @cloudflare/puppeteer once per isolate; it is only present in a Worker. */
async function puppeteerModule(): Promise<{
  launch: (binding: unknown, options?: Record<string, unknown>) => Promise<BrowserLike>;
  connect: (binding: unknown, sessionId: string) => Promise<BrowserLike>;
}> {
  const module = (await import("@cloudflare/puppeteer")) as unknown as {
    default: {
      launch: (binding: unknown, options?: Record<string, unknown>) => Promise<BrowserLike>;
      connect: (binding: unknown, sessionId: string) => Promise<BrowserLike>;
    };
  };
  return module.default;
}

function assertPublicUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProofCoreError({
      message: "invalid URL",
      category: "VALIDATION",
      code: "invalid_url",
    });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ProofCoreError({
      message: "only http(s) URLs are supported",
      category: "VALIDATION",
      code: "unsupported_scheme",
    });
  }
  // The browser runs inside the deployment's network: loopback and private ranges would
  // turn it into a probe of the platform itself.
  const host = parsed.hostname.toLowerCase();
  const blocked =
    /^(localhost|127\.|0\.0\.0\.0|::1|\[::1\]|169\.254\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      host
    ) ||
    [".local", ".internal", ".localhost", ".home.arpa"].some((suffix) => host.endsWith(suffix));
  if (blocked) {
    throw new ProofCoreError({
      message: "that host is not reachable from the browser service",
      category: "VALIDATION",
      code: "blocked_host",
    });
  }
  return parsed;
}

/** Adds `https://` when someone types `example.com` in the address bar. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed)
    throw new ProofCoreError({ message: "empty URL", category: "VALIDATION", code: "empty_url" });
  return /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Maps a click in the panel onto the page.
 *
 * The screenshot is CSS pixels of the viewport, and the click is sent in the same units, so
 * the mapping is the identity — but the ratio is explicit here because a future device-pixel
 * ratio would break every click silently if it were assumed.
 */
export function mapClick(
  point: { x: number; y: number },
  rendered: { width: number; height: number }
): { x: number; y: number } {
  const scaleX = VIEWPORT.width / Math.max(rendered.width, 1);
  const scaleY = VIEWPORT.height / Math.max(rendered.height, 1);
  return {
    x: Math.min(VIEWPORT.width - 1, Math.max(0, Math.round(point.x * scaleX))),
    y: Math.min(VIEWPORT.height - 1, Math.max(0, Math.round(point.y * scaleY))),
  };
}

async function capture(
  page: PageLike,
  logs: { type: string; text: string }[]
): Promise<BrowserState> {
  const shot = await page.screenshot({ type: "jpeg", quality: 70, encoding: "base64" });
  const base64 = typeof shot === "string" ? shot : Buffer.from(shot).toString("base64");
  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    screenshot: `data:image/jpeg;base64,${base64}`,
    console: logs.slice(-25),
    viewport: VIEWPORT,
  };
}

export function browserRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // Each action is a round trip to a Chromium: keep it deliberate, not unlimited.
  const limiter = new RateLimiter(600, 60 * 60_000);

  app.use("*", async (c, next) => {
    const user = c.get("user");
    const address = clientAddress({ get: (name) => c.req.header(name) });
    const limited = limiter.check(`${address}|${user.id}`);
    if (!limited.allowed) {
      c.header("Retry-After", String(limited.retryAfterSeconds));
      throw new HttpError(
        429,
        "browser_rate_limited",
        "Trop d'actions navigateur. Réessaie dans un instant."
      );
    }
    await next();
  });

  app.post("/session", async (c) => {
    const user = c.get("user");
    const binding = c.env?.BROWSER;
    if (!binding) {
      throw new HttpError(
        503,
        "browser_unavailable",
        "Ce déploiement n'a pas de navigateur (liaison `browser` absente de wrangler.toml)."
      );
    }
    const body = await readBody(c, startSchema);
    const target = assertPublicUrl(normalizeUrl(body.url ?? "https://example.com"));

    const puppeteer = await puppeteerModule();
    const browser = await puppeteer.launch(binding, {
      keep_alive: KEEP_ALIVE_MS,
      defaultViewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    });
    const sessionId = browser.sessionId?.() ?? "";
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    await page.setViewport({ width: VIEWPORT.width, height: VIEWPORT.height });
    const logs: { type: string; text: string }[] = [];
    page.on("console", (message) => {
      const entry = message as { type?: () => string; text?: () => string };
      logs.push({ type: entry.type?.() ?? "log", text: (entry.text?.() ?? "").slice(0, 500) });
    });
    page.on("pageerror", (error) => {
      logs.push({ type: "error", text: String((error as Error)?.message ?? error).slice(0, 500) });
    });

    await page.goto(target.toString(), { waitUntil: "networkidle2", timeout: ACTION_TIMEOUT_MS });
    const state = await capture(page, logs);

    const id = `bws_${shortId(20)}`;
    await services.store.createBrowserSession({
      id,
      userId: user.id,
      workspaceId: body.workspaceId,
      targetSessionId: sessionId,
      url: state.url,
    });

    return c.json({ sessionId: id, targetSessionId: sessionId, ...state });
  });

  app.post("/action", async (c) => {
    const user = c.get("user");
    const binding = c.env?.BROWSER;
    if (!binding)
      throw new HttpError(503, "browser_unavailable", "Pas de navigateur sur ce déploiement.");
    const body = await readBody(c, actionSchema);

    // Ownership check: the row decides, never the client's claim.
    const record = await services.store.getBrowserSession(user.id, body.sessionId);
    if (!record)
      throw new HttpError(404, "session_not_found", "Cette session navigateur a expiré.");

    const puppeteer = await puppeteerModule();
    const browser = await puppeteer.connect(binding, record.targetSessionId);
    try {
      const page = (await browser.pages())[0] ?? (await browser.newPage());
      await page.setViewport({ width: VIEWPORT.width, height: VIEWPORT.height });
      const logs: { type: string; text: string }[] = [];
      page.on("console", (message) => {
        const entry = message as { type?: () => string; text?: () => string };
        logs.push({ type: entry.type?.() ?? "log", text: (entry.text?.() ?? "").slice(0, 500) });
      });

      const action = body.action;
      switch (action.kind) {
        case "navigate":
          await page.goto(assertPublicUrl(normalizeUrl(action.url)).toString(), {
            waitUntil: "networkidle2",
            timeout: ACTION_TIMEOUT_MS,
          });
          break;
        case "click":
          await page.mouse.click(action.x, action.y);
          await page.waitForNetworkIdle?.({ timeout: 5_000 }).catch(() => undefined);
          break;
        case "type":
          await page.keyboard.type(action.text);
          break;
        case "key":
          await page.keyboard.press(action.key);
          break;
        case "scroll":
          await page.mouse.wheel({ deltaY: action.dy });
          break;
        case "back":
          await page.goBack({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);
          break;
        case "reload":
          await page
            .reload({ waitUntil: "networkidle2", timeout: ACTION_TIMEOUT_MS })
            .catch(() => undefined);
          break;
      }

      // A click often starts a navigation that finishes after the click returns.
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 700));
      const state = await capture(page, logs);
      await services.store.touchBrowserSession(user.id, body.sessionId, state.url);
      return c.json({ sessionId: body.sessionId, ...state });
    } finally {
      // The session stays alive for the next action; only the connection is dropped.
      await browser.disconnect?.().catch(() => undefined);
    }
  });

  app.post("/close", async (c) => {
    const user = c.get("user");
    const body = await readBody(c, closeSchema);
    const record = await services.store.getBrowserSession(user.id, body.sessionId);
    if (record) {
      const binding = c.env?.BROWSER;
      if (binding) {
        const puppeteer = await puppeteerModule();
        const browser = await puppeteer.connect(binding, record.targetSessionId).catch(() => null);
        await browser?.close().catch(() => undefined);
      }
      await services.store.deleteBrowserSession(user.id, body.sessionId);
    }
    return c.json({ closed: true });
  });

  return app;
}
