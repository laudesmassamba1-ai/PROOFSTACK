import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  browsers,
  fetchReadable,
  normalizeBrowserUrl,
  type PageSnapshot,
  type PageState,
} from "@proofcore/adapter-browser";
import { ProofCoreError } from "@proofcore/core";

/**
 * The browser tools an agent calls.
 *
 * Each one is a thin, honest wrapper over the engine in `@proofcore/adapter-browser`:
 * `browser_open` starts a page, `browser_snapshot` returns what a person would see,
 * `browser_interact` acts on it, `browser_eval` is the escape hatch when a site needs
 * something the named actions do not cover.
 *
 * The split is deliberate. A single "browser" tool with an action union would be shorter,
 * but a model that must choose between `click` and `evaluate` writes different code than one
 * given a generic "run this script": the narrow tools keep the common path safe and make the
 * uncommon one explicit. Every call returns the page state afterwards, so the next decision
 * is grounded in what actually happened rather than in what was expected.
 */

const SNAPSHOT_TEXT_LIMIT = 14_000;

export interface BrowserToolContext {
  root: string;
}

function screenshotPath(root: string, name?: string): string {
  const safe = (name ?? `shot-${Date.now()}`).replace(/[^a-zA-Z0-9._-]+/g, "-");
  const file =
    safe.endsWith(".png") || safe.endsWith(".jpg") || safe.endsWith(".jpeg") ? safe : `${safe}.png`;
  return resolve(root, ".proofcore", "browser", file);
}

export async function browserOpen(
  context: BrowserToolContext,
  input: {
    url?: string;
    width?: number;
    height?: number;
    executablePath?: string;
    waitMs?: number;
    includeText?: boolean;
  }
): Promise<{
  pageId: string;
  engine: { executable: string; source: string };
  state: PageState;
  snapshot: Omit<PageSnapshot, "text"> & { text?: string };
  console: { type: string; text: string }[];
}> {
  const { id, page, engine } = await browsers.open({
    ...(input.url ? { url: input.url } : { url: "about:blank" }),
    ...(input.width ? { width: input.width } : {}),
    ...(input.height ? { height: input.height } : {}),
    ...(input.executablePath ? { executablePath: input.executablePath } : {}),
  });
  if (input.waitMs && input.waitMs > 0) {
    await page.waitFor({ expression: "true", timeoutMs: Math.min(input.waitMs, 30_000) });
  }
  const snapshot = await page.snapshot({ maxText: SNAPSHOT_TEXT_LIMIT });
  const { text, ...rest } = snapshot;
  return {
    pageId: id,
    engine,
    state: await page.state(),
    // Text is the largest field by far. It is included by default because a model that has
    // to ask for it next turn costs a round trip; `includeText:false` keeps it out.
    snapshot: { ...rest, ...(input.includeText === false ? {} : { text }) },
    console: page.console.filter((entry) => entry.type === "error").slice(-10),
  };
}

export async function browserGoto(
  context: BrowserToolContext,
  input: { page?: string; url?: string; back?: boolean; forward?: boolean; reload?: boolean }
): Promise<{ pageId: string; state: PageState; title: string }> {
  void context;
  const { id, page } = browsers.get(input.page);
  let state: PageState;
  if (input.back) state = await page.goBack();
  else if (input.forward) state = await page.goForward();
  else if (input.reload) state = await page.reload();
  else if (input.url) state = await page.navigate(input.url);
  else {
    throw new ProofCoreError({
      message: "browser_goto needs a url, back:true, forward:true or reload:true.",
      category: "VALIDATION",
      code: "goto_action_required",
    });
  }
  return { pageId: id, state, title: state.title };
}

export async function browserSnapshot(
  context: BrowserToolContext,
  input: {
    page?: string;
    text?: boolean;
    maxElements?: number;
    includeHidden?: boolean;
  } = {}
): Promise<{
  pageId: string;
  state: PageState;
  snapshot: Omit<PageSnapshot, "text"> & { text?: string };
  console: { type: string; text: string }[];
  networkErrors: { url: string; method: string; status: number; type: string }[];
  dialogs: { type: string; message: string; at: string }[];
}> {
  void context;
  const { id, page } = browsers.get(input.page);
  const snapshot = await page.snapshot({
    maxText: SNAPSHOT_TEXT_LIMIT,
    ...(input.maxElements ? { maxElements: input.maxElements } : {}),
    ...(input.includeHidden ? { includeHidden: true } : {}),
  });
  const { text, ...rest } = snapshot;
  return {
    pageId: id,
    state: await page.state(),
    snapshot: input.text === false ? rest : { ...rest, text },
    console: page.console.slice(-20),
    networkErrors: page.network
      .filter((entry) => entry.failed || entry.status >= 400)
      .slice(-15)
      .map((entry) => ({
        url: entry.url,
        method: entry.method,
        status: entry.status,
        type: entry.type,
      })),
    dialogs: page.dialogLog.slice(-5),
  };
}

export interface InteractInput {
  page?: string;
  action:
    | "click"
    | "type"
    | "press"
    | "scroll"
    | "hover"
    | "select"
    | "check"
    | "uncheck"
    | "set_value"
    | "upload"
    | "wait"
    | "focus";
  ref?: string;
  selector?: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  value?: string;
  values?: string[];
  files?: string[];
  clear?: boolean;
  submit?: boolean;
  /** Expression evaluated on every poll, for `wait`. */
  expression?: string;
  dy?: number;
  dx?: number;
  timeoutMs?: number;
  button?: "left" | "right" | "middle";
  clickCount?: number;
}

export async function browserInteract(
  context: BrowserToolContext,
  input: InteractInput
): Promise<{ pageId: string; action: string; state: PageState; result?: unknown }> {
  const { id, page } = browsers.get(input.page);
  const target = {
    ...(input.ref ? { ref: input.ref } : {}),
    ...(input.selector ? { selector: input.selector } : {}),
  };

  switch (input.action) {
    case "click": {
      const clicked = await page.click({
        ...target,
        ...(input.x !== undefined ? { x: input.x } : {}),
        ...(input.y !== undefined ? { y: input.y } : {}),
        ...(input.button ? { button: input.button } : {}),
        ...(input.clickCount ? { clickCount: input.clickCount } : {}),
      });
      return {
        pageId: id,
        action: input.action,
        state: clicked.state,
        result: { target: clicked.clicked.name, tag: clicked.clicked.tag },
      };
    }
    case "type": {
      if (input.text === undefined) {
        throw new ProofCoreError({
          message: "browser_interact type needs `text`.",
          category: "VALIDATION",
          code: "text_required",
        });
      }
      const typed = await page.type(
        target.ref || target.selector ? target : undefined,
        input.text,
        {
          ...(input.clear ? { clear: true } : {}),
          ...(input.submit ? { submit: true } : {}),
        }
      );
      return {
        pageId: id,
        action: input.action,
        state: typed.state,
        result: { typed: typed.typed, value: typed.value },
      };
    }
    case "press": {
      if (!input.key) {
        throw new ProofCoreError({
          message: "browser_interact press needs `key` (e.g. Enter, Control+a).",
          category: "VALIDATION",
          code: "key_required",
        });
      }
      const state = await page.press(input.key);
      return { pageId: id, action: input.action, state };
    }
    case "scroll": {
      const state = await page.scroll({
        ...target,
        ...(input.x !== undefined ? { x: input.x } : {}),
        ...(input.y !== undefined ? { y: input.y } : {}),
        ...(input.dy !== undefined ? { dy: input.dy } : {}),
        ...(input.dx !== undefined ? { dx: input.dx } : {}),
      });
      return { pageId: id, action: input.action, state };
    }
    case "hover": {
      const point = await page.hover(target);
      return {
        pageId: id,
        action: input.action,
        state: await page.state(),
        result: { target: point.name, tag: point.tag },
      };
    }
    case "select": {
      const values = input.values ?? (input.value !== undefined ? [input.value] : []);
      const result = await page.select(target, values);
      return { pageId: id, action: input.action, state: await page.state(), result };
    }
    case "check":
    case "uncheck": {
      const result = await page.setChecked(target, input.action === "check");
      return { pageId: id, action: input.action, state: await page.state(), result };
    }
    case "set_value": {
      if (input.value === undefined) {
        throw new ProofCoreError({
          message: "browser_interact set_value needs `value`.",
          category: "VALIDATION",
          code: "value_required",
        });
      }
      const result = await page.setValue(target, input.value);
      return { pageId: id, action: input.action, state: await page.state(), result };
    }
    case "upload": {
      const files = (input.files ?? []).map((file) => resolve(context.root, file));
      const result = await page.upload(target, files);
      return { pageId: id, action: input.action, state: await page.state(), result };
    }
    case "wait": {
      const result = await page.waitFor({
        ...(input.selector ? { selector: input.selector } : {}),
        ...(input.text ? { text: input.text } : {}),
        ...(input.expression ? { expression: input.expression } : {}),
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      });
      return {
        pageId: id,
        action: input.action,
        state: await page.state(),
        result,
      };
    }
    case "focus": {
      await page.click(target, { settle: false });
      return { pageId: id, action: input.action, state: await page.state() };
    }
    default:
      throw new ProofCoreError({
        message: `Unknown browser action: ${String(input.action)}`,
        category: "VALIDATION",
        code: "unknown_browser_action",
      });
  }
}

export async function browserEval(
  context: BrowserToolContext,
  input: { page?: string; expression: string; awaitPromise?: boolean }
): Promise<{ pageId: string; value: unknown; state: PageState }> {
  void context;
  const { id, page } = browsers.get(input.page);
  if (!input.expression?.trim()) {
    throw new ProofCoreError({
      message: "browser_eval needs an expression.",
      category: "VALIDATION",
      code: "expression_required",
    });
  }
  const value = await page.evaluateScript(input.expression);
  return { pageId: id, value, state: await page.state() };
}

export async function browserScreenshot(
  context: BrowserToolContext,
  input: { page?: string; path?: string; fullPage?: boolean; format?: "png" | "jpeg" } = {}
): Promise<{ pageId: string; path: string; bytes: number; mimeType: string; url: string }> {
  const { id, page } = browsers.get(input.page);
  const shot = await page.screenshot({
    ...(input.fullPage ? { fullPage: true } : {}),
    ...(input.format ? { format: input.format } : {}),
  });
  const path = input.path ? resolve(context.root, input.path) : screenshotPath(context.root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, shot.data);
  return {
    pageId: id,
    path,
    bytes: shot.data.byteLength,
    mimeType: shot.mimeType,
    url: page.url,
  };
}

export async function browserPdf(
  context: BrowserToolContext,
  input: { page?: string; path?: string } = {}
): Promise<{ pageId: string; path: string; bytes: number; url: string }> {
  const { id, page } = browsers.get(input.page);
  const data = await page.pdf();
  const path = input.path
    ? resolve(context.root, input.path)
    : screenshotPath(context.root, `page-${Date.now()}.pdf`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return { pageId: id, path, bytes: data.byteLength, url: page.url };
}

export async function browserCookies(
  context: BrowserToolContext,
  input: {
    page?: string;
    action?: "get" | "set" | "clear";
    cookies?: {
      name: string;
      value: string;
      domain?: string;
      url?: string;
      path?: string;
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: "Strict" | "Lax" | "None";
      expires?: number;
    }[];
  } = {}
): Promise<unknown> {
  void context;
  const action = input.action ?? "get";
  if (action === "get") {
    const { id, page } = browsers.get(input.page);
    const cookies = await page.cookies();
    return {
      pageId: id,
      count: cookies.length,
      cookies: cookies.slice(0, 100),
    };
  }
  const { page } = browsers.get(input.page);
  if (action === "clear") {
    await page.clearCookies();
    return { cleared: true, note: "All cookies in this engine's profile were removed." };
  }
  if (!input.cookies || input.cookies.length === 0) {
    throw new ProofCoreError({
      message: "browser_cookies set needs at least one cookie.",
      category: "VALIDATION",
      code: "cookies_required",
    });
  }
  return page.setCookies(input.cookies);
}

export async function browserPages(context: BrowserToolContext): Promise<{
  engine: ReturnType<typeof browsers.status>;
  pages: Awaited<ReturnType<typeof browsers.summaries>>;
}> {
  void context;
  return { engine: browsers.status(), pages: await browsers.summaries() };
}

export async function browserClose(
  context: BrowserToolContext,
  input: { page?: string; all?: boolean } = {}
): Promise<{ closed: string[]; engine: string }> {
  void context;
  if (input.all) {
    const ids = (await browsers.summaries()).map((summary) => summary.id);
    await browsers.closeAll();
    return { closed: ids, engine: "pages closed; the process stays warm for ten minutes" };
  }
  const closed = await browsers.close(input.page);
  return { ...closed, engine: "page closed" };
}

/**
 * Reading a page without a browser, exposed as a tool.
 *
 * Honest by construction: `basis` is `server_html`, so a model cannot mistake this for a
 * rendered page whose JavaScript ran.
 */
export async function webFetch(
  context: BrowserToolContext,
  input: { url: string; maxChars?: number; headers?: Record<string, string> }
): Promise<unknown> {
  void context;
  const page = await fetchReadable({
    url: normalizeBrowserUrl(input.url),
    ...(input.maxChars ? { maxChars: input.maxChars } : {}),
    ...(input.headers ? { headers: input.headers } : {}),
  });
  return {
    basis: page.basis,
    url: page.finalUrl,
    status: page.status,
    contentType: page.contentType,
    title: page.title,
    description: page.description,
    headings: page.headings,
    links: page.links.slice(0, 30),
    text: page.text,
    markdown: page.markdown,
    bytes: page.bytes,
    truncated: page.truncated,
    note: page.truncated
      ? "The response was longer than the limit; request a higher maxChars or use browser_open for a rendered view."
      : undefined,
  };
}

/** The page state as one readable line, used by CLI output. */
export function describePageState(state: PageState): string {
  return `${state.status ?? "—"} · ${state.title || "(untitled)"} · ${state.url}`;
}
