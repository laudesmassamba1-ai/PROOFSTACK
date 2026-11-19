import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Finding a Chromium that is already on the machine.
 *
 * The engine deliberately does not bundle a browser and does not depend on an automation
 * framework. A browser is a large, fast-moving binary that every desktop already has one of:
 * Chrome, Chromium, Edge or Brave. Downloading a second copy to drive it, or paying a
 * service to render a page, is a dependency where none is needed.
 *
 * The search order is deliberate, and every path it tried is reported when it fails:
 *
 * 1. An explicit choice: `options.executablePath`, then `PROOFCORE_CHROMIUM`, `CHROME_PATH`,
 *    `CHROME_BIN`, `PUPPETEER_EXECUTABLE_PATH`. Someone who pinned a build gets that build.
 * 2. The platform's installed browsers, via `PATH` and the well-known install directories.
 * 3. The browser caches Playwright or Puppeteer already populated. They are a convenience,
 *    never a requirement: nothing here imports either package.
 *
 * There is no "install a browser silently" step. A missing browser is reported, with the
 * list of paths, and the caller decides what to do.
 */

export interface ChromiumLookup {
  /** Absolute path to a Chromium-based browser. */
  executable: string;
  /** Where the path came from: an env var, PATH, a known directory, a cache. */
  source: string;
  /** Every path checked, in order. Present so a failure can be diagnosed. */
  tried: string[];
}

export interface ChromiumDiscoveryOptions {
  /** Explicit executable, from a tool argument or the app that hosts the engine. */
  executablePath?: string;
  /** Extra environment, injected by tests instead of mutating `process.env`. */
  env?: Record<string, string | undefined>;
  /** Extra directories to search first, e.g. an app's own Chromium build. */
  extraPaths?: string[];
  /** Locale-system home. Overridable so tests do not read the real cache. */
  home?: string;
}

const ENV_KEYS = [
  "PROOFCORE_CHROMIUM",
  "CHROME_PATH",
  "CHROME_BIN",
  "PUPPETEER_EXECUTABLE_PATH",
  "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
];

/** Browser command names, in preference order. */
const COMMAND_NAMES: Record<string, string[]> = {
  linux: [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "microsoft-edge-stable",
    "brave-browser",
    "brave",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Chromium\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  ],
};

const LINUX_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "/opt/google/chrome/chrome",
  "/usr/bin/microsoft-edge",
  "/usr/bin/brave-browser",
];

function isRunnable(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function comparable(path: string): string {
  return platform() === "win32" ? path.toLowerCase() : path;
}

function unique(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const key = comparable(path);
    if (!path || seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

/** Every `name` found in PATH, in directory order. */
function fromPath(name: string, env: Record<string, string | undefined>): string[] {
  const raw = env.PATH ?? env.Path ?? "";
  const extensions =
    platform() === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean) : [""];
  const found: string[] = [];
  for (const directory of raw.split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, name.endsWith(extension) ? name : `${name}${extension}`);
      found.push(candidate);
    }
  }
  return found;
}

/** Version-sorted cache entries, newest first: `chromium-1255` beats `chromium-1208`. */
function cachedDirectories(root: string, prefix: string): string[] {
  try {
    return readdirSync(root)
      .filter((entry) => entry.startsWith(prefix))
      .sort((a, b) => {
        const na = Number(a.slice(prefix.length).match(/\d+/)?.[0] ?? 0);
        const nb = Number(b.slice(prefix.length).match(/\d+/)?.[0] ?? 0);
        return nb - na;
      })
      .map((entry) => join(root, entry));
  } catch {
    return [];
  }
}

/** Playwright and Puppeteer caches, as convenience only. */
function cachePaths(home: string): string[] {
  const out: string[] = [];
  for (const directory of cachedDirectories(join(home, ".cache", "ms-playwright"), "chromium-")) {
    out.push(join(directory, "chrome-linux", "chrome"));
    out.push(join(directory, "chrome-linux64", "chrome"));
    out.push(join(directory, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"));
    out.push(join(directory, "chrome-win", "chrome.exe"));
  }
  const puppeteerRoot = join(home, ".cache", "puppeteer", "chrome");
  for (const directory of cachedDirectories(puppeteerRoot, "")) {
    out.push(join(directory, "chrome-linux64", "chrome"));
    out.push(
      join(
        directory,
        "chrome-mac-x64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing"
      )
    );
    out.push(join(directory, "chrome-win64", "chrome.exe"));
  }
  return out;
}

/**
 * Returns the first usable Chromium, or `undefined` with the tried paths.
 *
 * `tried` is part of the result, not a log line: the error a tool returns names every path
 * it looked at, so "no browser" can be fixed in one step instead of guessed at.
 */
export function findChromium(options: ChromiumDiscoveryOptions = {}): ChromiumLookup | undefined {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const tried: string[] = [];

  const explicit = [options.executablePath, ...ENV_KEYS.map((key) => env[key])].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  for (const candidate of explicit) {
    tried.push(candidate);
    if (isRunnable(candidate)) {
      return { executable: candidate, source: "configured", tried };
    }
  }

  const extras = options.extraPaths ?? [];
  for (const candidate of extras) {
    tried.push(candidate);
    if (isRunnable(candidate)) return { executable: candidate, source: "application", tried };
  }

  const os = platform();
  const names = COMMAND_NAMES[os] ?? COMMAND_NAMES.linux ?? [];
  for (const name of names) {
    const candidates =
      os === "linux"
        ? [...fromPath(name, env), name]
        : os === "win32"
          ? [name, ...fromPath(name, env)]
          : [name];
    for (const candidate of candidates) {
      tried.push(candidate);
      // A bare command name is resolved by the OS at spawn time; only treat it as found
      // when PATH actually contains it, otherwise every launch would start a shell.
      const resolved = candidate.includes("/") || candidate.includes("\\") ? candidate : undefined;
      if (resolved ? isRunnable(resolved) : fromPath(candidate, env).some(isRunnable)) {
        return {
          executable: resolved ?? candidate,
          source: os === "darwin" ? "application bundle" : "PATH",
          tried,
        };
      }
    }
    if (os === "linux") {
      for (const candidate of LINUX_PATHS) {
        tried.push(candidate);
        if (isRunnable(candidate))
          return { executable: candidate, source: "known location", tried };
      }
    }
  }

  for (const candidate of cachePaths(home)) {
    tried.push(candidate);
    if (isRunnable(candidate)) return { executable: candidate, source: "browser cache", tried };
  }

  return undefined;
}

/** The error message for a machine with no Chromium: every path, and how to fix it. */
export function chromiumMissingMessage(lookup: { tried: string[] } | string[]): string {
  const tried = Array.isArray(lookup) ? lookup : lookup.tried;
  const sample = unique(tried).slice(-8);
  return [
    "No Chromium-based browser was found on this machine.",
    "Install Chrome, Chromium, Edge or Brave, or point the engine at one:",
    "  PROOFCORE_CHROMIUM=/path/to/chrome",
    `Paths checked: ${sample.join(", ")}`,
  ].join("\n");
}
