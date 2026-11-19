import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProofCoreError } from "@proofcore/core";
import { browserWebSocketUrl, CdpConnection } from "./cdp.js";
import { type ChromiumLookup, chromiumMissingMessage, findChromium } from "./discovery.js";

/**
 * Starting a browser.
 *
 * `--remote-debugging-port=0` asks Chromium for a free port and prints the resulting
 * WebSocket URL on stderr; parsing that line is the only supported way to learn where a
 * headless browser listens when the port is chosen by the OS.
 *
 * The profile lives in a temporary directory. A fresh profile means no extension, no
 * logged-in account and no saved password is reachable from a page an agent opened — and
 * `PROOFCORE_BROWSER_PROFILE` opts into a durable one when the point is to stay signed in.
 */

export interface LaunchedBrowser {
  connection: CdpConnection;
  executable: string;
  source: string;
  wsUrl: string;
  userDataDir: string;
  /** True when the engine attached to a browser it did not start. */
  attached: boolean;
  close: () => Promise<void>;
}

export interface LaunchOptions {
  executablePath?: string;
  headless?: boolean;
  width?: number;
  height?: number;
  userDataDir?: string;
  /** Attach to an existing DevTools endpoint instead of launching. */
  endpoint?: string;
  env?: Record<string, string | undefined>;
  extraPaths?: string[];
  timeoutMs?: number;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const START_TIMEOUT_MS = 25_000;

function chromeArgs(options: LaunchOptions, profile: string): string[] {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const args = [
    options.headless === false ? "" : "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-search-engine-choice-screen",
    "--disable-component-update",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-extensions",
    "--metrics-recording-only",
    "--mute-audio",
    "--hide-crash-restore-bubble",
    `--window-size=${width},${height}`,
  ].filter(Boolean);
  // Containers and CI images run as root, where Chromium refuses to start its sandbox.
  // This is a deliberate, visible exception: it is the caller's own process, not a page.
  if (typeof process.getuid === "function" && process.getuid() === 0) args.push("--no-sandbox");
  if (process.platform === "linux") args.push("--disable-dev-shm-usage");
  if (process.env.PROOFCORE_BROWSER_ARGS) {
    args.push(...process.env.PROOFCORE_BROWSER_ARGS.split(/\s+/).filter(Boolean));
  }
  return args;
}

/** Waits for "DevTools listening on ws://…" on stderr, or for the process to die. */
function waitForDevTools(
  child: ChildProcess,
  timeoutMs: number,
  collect: () => string
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const finish = (error?: Error, url?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(url ?? "");
    };
    const timer = setTimeout(() => {
      finish(
        new ProofCoreError({
          message: `The browser started but never exposed a DevTools endpoint within ${timeoutMs} ms.\n${collect().slice(-1500)}`,
          category: "NETWORK",
          code: "browser_launch_timeout",
        })
      );
    }, timeoutMs);

    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const match = /DevTools listening on (wss?:\/\/\S+)/.exec(buffer);
      if (match?.[1]) finish(undefined, match[1]);
    };
    child.stderr?.on("data", onData);
    child.stdout?.on("data", onData);
    child.once("error", (error) => {
      finish(
        new ProofCoreError({
          message: `Could not start the browser: ${error.message}`,
          category: "CONFIGURATION",
          code: "browser_launch_failed",
          cause: error,
        })
      );
    });
    child.once("exit", (code, signal) => {
      if (!settled) {
        finish(
          new ProofCoreError({
            message: `The browser exited before it was ready (code ${code ?? "null"}, signal ${signal ?? "none"}).\n${collect().slice(-1500)}`,
            category: "CONFIGURATION",
            code: "browser_launch_failed",
          })
        );
      }
    });
  });
}

export async function launchBrowser(options: LaunchOptions = {}): Promise<LaunchedBrowser> {
  const endpoint = options.endpoint ?? process.env.PROOFCORE_BROWSER_URL;
  if (endpoint) {
    const wsUrl = await browserWebSocketUrl(endpoint);
    const connection = await CdpConnection.connect(wsUrl, {
      timeoutMs: options.timeoutMs ?? START_TIMEOUT_MS,
    });
    return {
      connection,
      executable: endpoint,
      source: "existing endpoint",
      wsUrl,
      userDataDir: "",
      attached: true,
      close: async () => connection.close(),
    };
  }

  let lookup: ChromiumLookup | undefined;
  if (options.executablePath || options.env || options.extraPaths) {
    lookup = findChromium({
      ...(options.executablePath ? { executablePath: options.executablePath } : {}),
      ...(options.env ? { env: options.env } : {}),
      ...(options.extraPaths ? { extraPaths: options.extraPaths } : {}),
    });
  } else {
    lookup = findChromium();
  }
  if (!lookup) {
    throw new ProofCoreError({
      message: chromiumMissingMessage(findChromium(options)?.tried ?? []),
      category: "CONFIGURATION",
      code: "browser_missing",
    });
  }

  const profile =
    options.userDataDir ??
    process.env.PROOFCORE_BROWSER_PROFILE ??
    (await mkdtemp(join(tmpdir(), "proofcore-browser-")));
  const ownsProfile = !options.userDataDir && !process.env.PROOFCORE_BROWSER_PROFILE;

  let output = "";
  const child = spawn(lookup.executable, chromeArgs(options, profile), {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    // A browser must not inherit the test runner's Node flags; NODE_OPTIONS has no meaning
    // to Chromium and has broken launches in environments that set it globally.
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8").slice(0, 200_000);
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8").slice(0, 200_000);
  });

  let wsUrl: string;
  try {
    wsUrl = await waitForDevTools(child, options.timeoutMs ?? START_TIMEOUT_MS, () => output);
  } catch (error) {
    child.kill("SIGKILL");
    if (ownsProfile) await rm(profile, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  let connection: CdpConnection;
  try {
    connection = await CdpConnection.connect(wsUrl, {
      timeoutMs: options.timeoutMs ?? START_TIMEOUT_MS,
    });
  } catch (error) {
    child.kill("SIGKILL");
    if (ownsProfile) await rm(profile, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    connection.close();
    if (!child.killed) child.kill("SIGKILL");
    if (ownsProfile) {
      await rm(profile, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  // A browser left behind by a crash keeps a profile directory and a process. The exit
  // hook is best-effort but removes the common case.
  process.once("exit", () => {
    if (!child.killed) child.kill("SIGKILL");
    if (ownsProfile && existsSync(profile)) {
      void rm(profile, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  return {
    connection,
    executable: lookup.executable,
    source: lookup.source,
    wsUrl,
    userDataDir: profile,
    attached: false,
    close,
  };
}
