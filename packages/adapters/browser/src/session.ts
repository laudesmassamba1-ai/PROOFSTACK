import { ProofCoreError } from "@proofcore/core";
import { type CdpConnection, CdpError } from "./cdp.js";
import {
  buildResolveExpression,
  buildSetValueExpression,
  buildSnapshotExpression,
  KEY_MAP,
  type PageSnapshot,
  type SnapshotOptions,
} from "./page-script.js";

/**
 * One page, driven through the DevTools Protocol.
 *
 * Everything here maps to something a person does: a mouse press at a point, text inserted
 * at the focus, a key pressed, a wheel turned. That matters because sites react to events,
 * not to DOM assignments: setting `input.value` leaves React's state untouched, and calling
 * `element.click()` skips the focus and hover sequence a real click produces. Using the
 * input domain is what makes the agent's actions indistinguishable from a user's.
 *
 * Where a DOM operation *is* the right tool (selecting an option, checking a box through its
 * own click handler, reading a value), the page executes a small, explicit script instead —
 * but it dispatches the same `input`/`change` events the browser would.
 */

export interface ConsoleEntry {
  type: string;
  text: string;
  url?: string;
}

export interface NetworkEntry {
  url: string;
  method: string;
  status: number;
  type: string;
  mimeType?: string;
  failed?: boolean;
}

export interface InteractiveState {
  ok: boolean;
  reason?: string;
  x: number;
  y: number;
  tag: string | null;
  name: string | null;
  disabled: boolean;
  width: number;
  height: number;
  point: boolean;
}

export interface PageState {
  url: string;
  title: string;
  readyState: string;
  status: number | null;
  canGoBack: boolean;
  canGoForward: boolean;
}

export type InteractionTarget = {
  ref?: string;
  selector?: string;
  x?: number;
  y?: number;
};

const NAVIGATION_TIMEOUT_MS = 30_000;
const EVALUATE_TIMEOUT_MS = 20_000;
const SETTLE_QUIET_MS = 450;
const SETTLE_TIMEOUT_MS = 6_000;
const MAX_CONSOLE = 300;
const MAX_NETWORK = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Adds https:// to a bare host, and refuses the schemes that turn a page into code. */
export function normalizeBrowserUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ProofCoreError({
      message: "An address is required.",
      category: "VALIDATION",
      code: "empty_url",
    });
  }
  if (/^javascript:/i.test(trimmed) || /^vbscript:/i.test(trimmed)) {
    throw new ProofCoreError({
      message: "javascript: and vbscript: addresses are refused.",
      category: "VALIDATION",
      code: "unsupported_scheme",
    });
  }
  if (/^(https?|file|data|about):/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function consoleText(args: unknown[]): string {
  return args
    .map((argument) => {
      if (argument && typeof argument === "object") {
        const value = argument as { value?: unknown; description?: string; type?: string };
        if (value.value !== undefined) {
          return typeof value.value === "string" ? value.value : JSON.stringify(value.value);
        }
        return value.description ?? value.type ?? "[object]";
      }
      return String(argument);
    })
    .join(" ")
    .slice(0, 1_000);
}

export class BrowserPage {
  readonly connection: CdpConnection;
  readonly targetId: string;
  readonly sessionId: string;

  private readonly consoleLog: ConsoleEntry[] = [];
  private readonly errorLog: { message: string; source?: string }[] = [];
  private readonly networkLog: NetworkEntry[] = [];
  private readonly requests = new Map<string, NetworkEntry>();
  private readonly dialogs: { type: string; message: string; at: string }[] = [];
  private inflight = 0;
  private lastStatus: number | null = null;
  private viewport = { width: 1280, height: 800 };
  private unsubscribe: (() => void) | undefined;
  private closed = false;

  constructor(connection: CdpConnection, targetId: string, sessionId: string) {
    this.connection = connection;
    this.targetId = targetId;
    this.sessionId = sessionId;
  }

  async init(): Promise<void> {
    this.unsubscribe = this.connection.on((event) => {
      if (event.sessionId !== this.sessionId) return;
      this.handleEvent(event.method, event.params);
    });
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Network.enable");
    await this.send("Log.enable").catch(() => undefined);
    await this.send("Page.setLifecycleEventsEnabled", { enabled: true }).catch(() => undefined);
    await this.send("Emulation.setDeviceMetricsOverride", {
      width: this.viewport.width,
      height: this.viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    }).catch(() => undefined);
  }

  get url(): string {
    return this.lastKnownUrl ?? "";
  }

  private lastKnownUrl: string | undefined;

  get console(): ConsoleEntry[] {
    return [...this.consoleLog];
  }

  get network(): NetworkEntry[] {
    return [...this.networkLog];
  }

  /** Uncaught exceptions, separate from `console.error`: they stopped the page. */
  get pageErrors(): { message: string; source?: string }[] {
    return [...this.errorLog];
  }

  get dialogLog(): { type: string; message: string; at: string }[] {
    return [...this.dialogs];
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private handleEvent(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case "Runtime.consoleAPICalled": {
        const type = String(params.type ?? "log");
        const args = Array.isArray(params.args) ? (params.args as unknown[]) : [];
        this.pushConsole({ type, text: consoleText(args) });
        break;
      }
      case "Runtime.exceptionThrown": {
        const details = (params.exceptionDetails ?? {}) as {
          text?: string;
          url?: string;
          lineNumber?: number;
          exception?: { description?: string };
        };
        const where = details.url ? ` (${details.url}:${(details.lineNumber ?? 0) + 1})` : "";
        const message = `${details.exception?.description ?? details.text ?? "uncaught exception"}${where}`;
        this.errorLog.push({
          message: message.slice(0, 1_000),
          ...(details.url ? { source: details.url } : {}),
        });
        if (this.errorLog.length > 50) this.errorLog.shift();
        this.pushConsole({
          type: "error",
          text: message,
          ...(details.url ? { url: details.url } : {}),
        });
        break;
      }
      case "Log.entryAdded": {
        const entry = (params.entry ?? {}) as {
          level?: string;
          text?: string;
          url?: string;
          source?: string;
        };
        if (entry.text) {
          this.pushConsole({
            type: entry.level ?? entry.source ?? "log",
            text: entry.text.slice(0, 1_000),
            ...(entry.url ? { url: entry.url } : {}),
          });
        }
        break;
      }
      case "Network.requestWillBeSent": {
        const request = (params.request ?? {}) as { url?: string; method?: string };
        const record: NetworkEntry = {
          url: String(request.url ?? "").slice(0, 500),
          method: String(request.method ?? "GET"),
          status: 0,
          type: String(params.type ?? "Other"),
        };
        this.requests.set(String(params.requestId ?? ""), record);
        // A redirect reuses the request id and reports the previous response in the same
        // event: counting it again would leave the "network idle" counter permanently > 0.
        if (!params.redirectResponse) this.inflight += 1;
        break;
      }
      case "Network.responseReceived": {
        const requestId = String(params.requestId ?? "");
        const response = (params.response ?? {}) as {
          status?: number;
          url?: string;
          mimeType?: string;
        };
        const record = this.requests.get(requestId);
        if (record) {
          record.status = Number(response.status ?? 0);
          record.mimeType = response.mimeType;
          this.lastStatus = record.status;
        }
        break;
      }
      case "Network.loadingFinished":
      case "Network.loadingFailed": {
        const requestId = String(params.requestId ?? "");
        const record = this.requests.get(requestId);
        if (record) {
          if (method === "Network.loadingFailed") {
            record.failed = true;
            record.status = 0;
          }
          this.networkLog.push(record);
          if (this.networkLog.length > MAX_NETWORK) this.networkLog.shift();
          this.requests.delete(requestId);
        }
        this.inflight = Math.max(0, this.inflight - 1);
        break;
      }
      case "Page.javascriptDialogOpening": {
        const dialog = {
          type: String(params.type ?? "alert"),
          message: String(params.message ?? "").slice(0, 500),
          at: new Date().toISOString(),
        };
        this.dialogs.push(dialog);
        if (this.dialogs.length > 20) this.dialogs.shift();
        // A dialog blocks the renderer. An agent that cannot see it would report a hung
        // page; dismissing it is recorded, so `browser_snapshot` still tells the truth.
        void this.send("Page.handleJavaScriptDialog", { accept: false }).catch(() => undefined);
        break;
      }
      case "Page.frameNavigated": {
        const frame = (params.frame ?? {}) as { url?: string; parentId?: string };
        if (!frame.parentId && frame.url) this.lastKnownUrl = frame.url;
        break;
      }
      default:
        break;
    }
  }

  private pushConsole(entry: ConsoleEntry): void {
    this.consoleLog.push(entry);
    if (this.consoleLog.length > MAX_CONSOLE) this.consoleLog.shift();
  }

  private send<T extends Record<string, unknown> = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000
  ): Promise<T> {
    return this.connection.send<T>(method, params, this.sessionId, timeoutMs);
  }

  private async evaluate<T>(expression: string, timeoutMs = EVALUATE_TIMEOUT_MS): Promise<T> {
    const response = await this.send<{
      result?: { value?: unknown; description?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true, userGesture: true },
      timeoutMs
    );
    if (response.exceptionDetails) {
      const detail =
        response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "evaluation failed";
      throw new ProofCoreError({
        message: `The page raised an error: ${detail.slice(0, 600)}`,
        category: "VALIDATION",
        code: "page_script_failed",
      });
    }
    return response.result?.value as T;
  }

  async state(): Promise<PageState> {
    const value = await this.evaluate<{
      url: string;
      title: string;
      readyState: string;
    }>("({ url: location.href, title: document.title, readyState: document.readyState })");
    const history = await this.send<{
      currentIndex?: number;
      entries?: unknown[];
    }>("Page.getNavigationHistory").catch(() => ({ currentIndex: 0, entries: [] }));
    const index = Number(history.currentIndex ?? 0);
    const total = Array.isArray(history.entries) ? history.entries.length : 1;
    this.lastKnownUrl = value.url;
    return {
      url: value.url,
      title: value.title,
      readyState: value.readyState,
      status: this.lastStatus,
      canGoBack: index > 0,
      canGoForward: index < total - 1,
    };
  }

  async navigate(
    url: string,
    options: { timeoutMs?: number; settle?: boolean } = {}
  ): Promise<PageState> {
    const target = normalizeBrowserUrl(url);
    const timeoutMs = options.timeoutMs ?? NAVIGATION_TIMEOUT_MS;
    this.consoleLog.length = 0;
    this.networkLog.length = 0;
    this.lastStatus = null;
    const result = await this.send<{ errorText?: string }>(
      "Page.navigate",
      { url: target },
      timeoutMs
    ).catch((error: unknown) => {
      if (error instanceof CdpError) {
        throw new ProofCoreError({
          message: `Navigation to ${target} failed: ${error.message}`,
          category: "NETWORK",
          code: "navigation_failed",
        });
      }
      throw error;
    });
    if (result.errorText) {
      throw new ProofCoreError({
        message: `Navigation to ${target} failed: ${result.errorText}`,
        category: "NETWORK",
        code: "navigation_failed",
      });
    }
    await this.waitForReady(timeoutMs);
    if (options.settle !== false) await this.settle();
    return this.state();
  }

  /** Waits until `document.readyState` is complete, then lets late requests finish. */
  async waitForReady(timeoutMs = NAVIGATION_TIMEOUT_MS): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const ready = await this.evaluate<string>("document.readyState").catch(() => "loading");
      if (ready === "complete") return;
      await delay(120);
    }
    // A page that never reaches `complete` is still usable; the caller gets the state and
    // the network log rather than an exception that hides everything else.
  }

  async settle(quietMs = SETTLE_QUIET_MS, timeoutMs = SETTLE_TIMEOUT_MS): Promise<void> {
    const started = Date.now();
    let quietSince = Date.now();
    let lastCount = this.inflight;
    while (Date.now() - started < timeoutMs) {
      await delay(100);
      if (this.inflight !== lastCount) {
        lastCount = this.inflight;
        quietSince = Date.now();
      }
      if (this.inflight === 0 && Date.now() - quietSince >= quietMs) return;
    }
  }

  snapshot(options: SnapshotOptions = {}): Promise<PageSnapshot> {
    return this.evaluate<PageSnapshot>(buildSnapshotExpression(options), 30_000);
  }

  private async resolve(target: InteractionTarget): Promise<InteractiveState> {
    if (target.ref === undefined && target.selector === undefined && target.x === undefined) {
      throw new ProofCoreError({
        message: "Name a target: a ref from browser_snapshot, a CSS selector, or x/y.",
        category: "VALIDATION",
        code: "target_required",
      });
    }
    const result = await this.evaluate<InteractiveState>(buildResolveExpression(target));
    if (!result?.ok) {
      throw new ProofCoreError({
        message: result?.reason ?? "The target was not found on the page.",
        category: "VALIDATION",
        code: "target_not_found",
      });
    }
    if (result.disabled) {
      throw new ProofCoreError({
        message: `The target is disabled: ${result.name ?? result.tag ?? "element"}.`,
        category: "VALIDATION",
        code: "target_disabled",
      });
    }
    return result;
  }

  async click(
    target: InteractionTarget & { button?: "left" | "right" | "middle"; clickCount?: number },
    options: { settle?: boolean } = {}
  ): Promise<{ clicked: InteractiveState; state: PageState }> {
    const point = await this.resolve(target);
    const button = target.button ?? "left";
    const clickCount = Math.min(Math.max(target.clickCount ?? 1, 1), 3);
    const base = { x: Math.round(point.x), y: Math.round(point.y), modifiers: 0 };
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...base });
    for (let count = 1; count <= clickCount; count += 1) {
      await this.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...base,
        button,
        buttons: button === "left" ? 1 : button === "right" ? 2 : 4,
        clickCount: count,
      });
      await this.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...base,
        button,
        buttons: 0,
        clickCount: count,
      });
    }
    if (options.settle !== false) await this.settle();
    return { clicked: { ...point, x: base.x, y: base.y }, state: await this.state() };
  }

  async type(
    target: InteractionTarget | undefined,
    text: string,
    options: { clear?: boolean; submit?: boolean; settle?: boolean } = {}
  ): Promise<{ typed: number; value: string | null; state: PageState }> {
    if (target) {
      await this.click(target, { settle: false });
    }
    if (options.clear) {
      const modifier = process.platform === "darwin" ? "Meta" : "Control";
      await this.press(`${modifier}+a`);
      await this.press("Backspace");
    }
    await this.send("Input.insertText", { text });
    if (options.submit) await this.press("Enter");
    if (options.settle !== false) await this.settle();
    const value = await this.evaluate<string | null>(
      "(() => { const el = document.activeElement; return el && 'value' in el ? String(el.value ?? '').slice(0, 200) : null; })()"
    ).catch(() => null);
    return { typed: text.length, value, state: await this.state() };
  }

  async press(key: string, options: { settle?: boolean } = {}): Promise<PageState> {
    const parts = key.split("+");
    const baseKey = parts.pop() ?? key;
    let modifiers = 0;
    for (const modifier of parts) {
      const lower = modifier.toLowerCase();
      if (lower === "alt") modifiers |= 1;
      else if (lower === "control" || lower === "ctrl") modifiers |= 2;
      else if (lower === "meta" || lower === "cmd" || lower === "command") modifiers |= 4;
      else if (lower === "shift") modifiers |= 8;
    }
    const named = KEY_MAP[baseKey];
    const definition = named ?? {
      key: baseKey,
      code: /^[a-z]$/i.test(baseKey) ? `Key${baseKey.toUpperCase()}` : baseKey,
      windowsVirtualKeyCode: baseKey.toUpperCase().charCodeAt(0),
    };
    const printable = baseKey.length === 1 && (modifiers & (1 | 2 | 4)) === 0;
    const text = named?.text ?? (printable ? baseKey : undefined);
    const event = {
      key: definition.key,
      code: definition.code,
      windowsVirtualKeyCode: definition.windowsVirtualKeyCode,
      nativeVirtualKeyCode: definition.windowsVirtualKeyCode,
      modifiers,
    };
    await this.send("Input.dispatchKeyEvent", {
      type: text ? "keyDown" : "rawKeyDown",
      ...event,
      ...(text ? { text, unmodifiedText: text } : {}),
    });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
    if (options.settle !== false) await this.settle();
    return this.state();
  }

  async hover(target: InteractionTarget): Promise<InteractiveState> {
    const point = await this.resolve(target);
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.round(point.x),
      y: Math.round(point.y),
    });
    return point;
  }

  async scroll(input: InteractionTarget & { dy?: number; dx?: number }): Promise<PageState> {
    const x = input.x ?? this.viewport.width / 2;
    const y = input.y ?? this.viewport.height / 2;
    if (input.ref || input.selector) {
      await this.resolve(input);
    }
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: Math.round(x),
      y: Math.round(y),
      deltaX: Math.round(input.dx ?? 0),
      deltaY: Math.round(input.dy ?? 600),
    });
    await this.settle(300, 3_000);
    return this.state();
  }

  async select(
    target: { ref?: string; selector?: string },
    values: string[]
  ): Promise<{ ok: boolean; value?: string; reason?: string }> {
    const result = await this.evaluate<{ ok: boolean; value?: string; reason?: string }>(
      buildSetValueExpression({
        ...(target.ref ? { ref: target.ref } : {}),
        ...(target.selector ? { selector: target.selector } : {}),
        values,
      })
    );
    if (!result.ok) {
      throw new ProofCoreError({
        message: result.reason ?? "Could not select the option.",
        category: "VALIDATION",
        code: "select_failed",
      });
    }
    await this.settle();
    return result;
  }

  async setChecked(
    target: { ref?: string; selector?: string },
    checked: boolean
  ): Promise<{ ok: boolean; checked?: boolean; reason?: string }> {
    const result = await this.evaluate<{ ok: boolean; checked?: boolean; reason?: string }>(
      buildSetValueExpression({ ...target, checked })
    );
    if (!result.ok) {
      throw new ProofCoreError({
        message: result.reason ?? "Could not change the checkbox.",
        category: "VALIDATION",
        code: "check_failed",
      });
    }
    await this.settle();
    return result;
  }

  async setValue(
    target: { ref?: string; selector?: string },
    value: string
  ): Promise<{ ok: boolean; value?: string; reason?: string }> {
    const result = await this.evaluate<{ ok: boolean; value?: string; reason?: string }>(
      buildSetValueExpression({ ...target, value })
    );
    if (!result.ok) {
      throw new ProofCoreError({
        message: result.reason ?? "Could not set the value.",
        category: "VALIDATION",
        code: "set_value_failed",
      });
    }
    await this.settle();
    return result;
  }

  async upload(
    target: { ref?: string; selector?: string },
    files: string[]
  ): Promise<{ uploaded: number; files: string[] }> {
    if (files.length === 0) {
      throw new ProofCoreError({
        message: "No file to upload.",
        category: "VALIDATION",
        code: "files_required",
      });
    }
    const expression = target.ref
      ? `document.querySelector('[data-pc-ref="' + CSS.escape(${JSON.stringify(target.ref)}) + '"]')`
      : `document.querySelector(${JSON.stringify(target.selector ?? "")})`;
    const response = await this.send<{
      result?: { objectId?: string };
      exceptionDetails?: unknown;
    }>("Runtime.evaluate", { expression, returnByValue: false });
    const objectId = response.result?.objectId;
    if (!objectId) {
      throw new ProofCoreError({
        message: "The upload target was not found on the page.",
        category: "VALIDATION",
        code: "target_not_found",
      });
    }
    await this.send("DOM.setFileInputFiles", { files, objectId });
    await this.settle();
    return { uploaded: files.length, files };
  }

  async waitFor(
    input: {
      selector?: string;
      text?: string;
      url?: string;
      expression?: string;
      timeoutMs?: number;
    },
    intervalMs = 150
  ): Promise<{ matched: boolean; waitedMs: number; url: string }> {
    const timeoutMs = Math.min(input.timeoutMs ?? 10_000, 120_000);
    const expression = input.selector
      ? `Boolean(document.querySelector(${JSON.stringify(input.selector)}))`
      : input.text
        ? `(document.body?.innerText ?? "").includes(${JSON.stringify(input.text)})`
        : input.url
          ? `location.href.includes(${JSON.stringify(input.url)})`
          : input.expression;
    if (!expression) {
      throw new ProofCoreError({
        message: "waitFor needs a selector, a text, a url or an expression.",
        category: "VALIDATION",
        code: "wait_condition_required",
      });
    }
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const matched = await this.evaluate<boolean>(expression).catch(() => false);
      if (matched) return { matched: true, waitedMs: Date.now() - started, url: this.url };
      await delay(intervalMs);
    }
    const state = await this.state().catch(() => ({ url: this.url }));
    return { matched: false, waitedMs: Date.now() - started, url: state.url };
  }

  async evaluateScript(expression: string): Promise<unknown> {
    return this.evaluate<unknown>(expression, 30_000);
  }

  async screenshot(
    options: { fullPage?: boolean; format?: "png" | "jpeg"; quality?: number } = {}
  ): Promise<{ data: Buffer; mimeType: string; width: number; height: number }> {
    const format = options.format ?? "png";
    let clip: Record<string, number> | undefined;
    if (options.fullPage) {
      const metrics = await this.send<{
        cssContentSize?: { width: number; height: number };
        contentSize?: { width: number; height: number };
      }>("Page.getLayoutMetrics");
      const size = metrics.cssContentSize ??
        metrics.contentSize ?? {
          width: this.viewport.width,
          height: this.viewport.height,
        };
      // An infinite-scroll page reports a height in the hundreds of thousands of pixels.
      // A screenshot that large is not useful to anyone; 20 000 px is already 25 screens.
      clip = {
        x: 0,
        y: 0,
        width: Math.max(1, Math.min(Math.ceil(size.width), 4_000)),
        height: Math.max(1, Math.min(Math.ceil(size.height), 20_000)),
        scale: 1,
      };
    }
    const response = await this.send<{ data?: string }>(
      "Page.captureScreenshot",
      {
        format,
        ...(format === "jpeg"
          ? { quality: Math.min(Math.max(options.quality ?? 75, 1), 100) }
          : {}),
        ...(clip ? { clip, captureBeyondViewport: true } : {}),
      },
      45_000
    );
    if (!response.data) {
      throw new ProofCoreError({
        message: "The browser returned an empty screenshot.",
        category: "NETWORK",
        code: "screenshot_failed",
      });
    }
    return {
      data: Buffer.from(response.data, "base64"),
      mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
      width: clip?.width ?? this.viewport.width,
      height: clip?.height ?? this.viewport.height,
    };
  }

  async pdf(): Promise<Buffer> {
    const response = await this.send<{ data?: string }>(
      "Page.printToPDF",
      { printBackground: true, preferCSSPageSize: true },
      45_000
    );
    if (!response.data) {
      throw new ProofCoreError({
        message: "The browser returned an empty PDF.",
        category: "NETWORK",
        code: "pdf_failed",
      });
    }
    return Buffer.from(response.data, "base64");
  }

  async cookies(): Promise<
    {
      name: string;
      value: string;
      domain: string;
      path: string;
      secure: boolean;
      httpOnly: boolean;
    }[]
  > {
    const response = await this.send<{
      cookies?: {
        name: string;
        value: string;
        domain: string;
        path: string;
        secure: boolean;
        httpOnly: boolean;
      }[];
    }>("Network.getCookies", {});
    return (response.cookies ?? []).slice(0, 300);
  }

  async setCookies(
    cookies: {
      name: string;
      value: string;
      domain?: string;
      url?: string;
      path?: string;
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: "Strict" | "Lax" | "None";
      expires?: number;
    }[]
  ): Promise<{ accepted: number; failed: string[] }> {
    let accepted = 0;
    const failed: string[] = [];
    for (const cookie of cookies) {
      const result = await this.send<{ success?: boolean }>("Network.setCookie", {
        ...cookie,
        path: cookie.path ?? "/",
      }).catch(() => ({ success: false }));
      if (result.success) accepted += 1;
      else failed.push(cookie.name);
    }
    return { accepted, failed };
  }

  async clearCookies(): Promise<void> {
    // Browser-wide by protocol design: it clears every cookie in this engine's profile,
    // which is why the tool documents it as a sign-out, not a per-site cleanup.
    await this.send("Network.clearBrowserCookies");
  }

  async setViewport(viewport: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
    mobile?: boolean;
  }): Promise<{ width: number; height: number }> {
    const width = Math.max(200, Math.min(Math.round(viewport.width), 3_840));
    const height = Math.max(200, Math.min(Math.round(viewport.height), 2_400));
    this.viewport = { width, height };
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
      mobile: viewport.mobile ?? false,
    });
    return { width, height };
  }

  async goBack(): Promise<PageState> {
    const history = await this.send<{
      currentIndex?: number;
      entries?: { id: number }[];
    }>("Page.getNavigationHistory");
    const index = Number(history.currentIndex ?? 0);
    const entries = history.entries ?? [];
    if (index <= 0) {
      throw new ProofCoreError({
        message: "There is no previous page in this session.",
        category: "VALIDATION",
        code: "no_history_back",
      });
    }
    await this.send("Page.navigateToHistoryEntry", { entryId: entries[index - 1]?.id });
    await this.waitForReady();
    await this.settle();
    return this.state();
  }

  async goForward(): Promise<PageState> {
    const history = await this.send<{
      currentIndex?: number;
      entries?: { id: number }[];
    }>("Page.getNavigationHistory");
    const index = Number(history.currentIndex ?? 0);
    const entries = history.entries ?? [];
    if (index >= entries.length - 1) {
      throw new ProofCoreError({
        message: "There is no next page in this session.",
        category: "VALIDATION",
        code: "no_history_forward",
      });
    }
    await this.send("Page.navigateToHistoryEntry", { entryId: entries[index + 1]?.id });
    await this.waitForReady();
    await this.settle();
    return this.state();
  }

  async reload(): Promise<PageState> {
    await this.send("Page.reload", { ignoreCache: false });
    await this.waitForReady();
    await this.settle();
    return this.state();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe?.();
    await this.connection
      .send("Target.closeTarget", { targetId: this.targetId }, undefined, 5_000)
      .catch(() => undefined);
    await this.connection
      .send("Target.detachFromTarget", { sessionId: this.sessionId }, undefined, 5_000)
      .catch(() => undefined);
  }
}
