/**
 * Opening the application.
 *
 * The desktop icon and `proofcore ui` should land in the same place, and that place should
 * look like the product rather than like a browser with a URL bar. Chromium-based browsers
 * have had `--app=` for a decade: it is a real window with its own icon in the task bar,
 * no tab strip, no address bar - the same look as the site, without shipping a second
 * browser engine (Electron) or a native toolchain (Tauri).
 *
 * When no Chromium is installed, opening the default browser is the honest fallback, and the
 * caller says so instead of pretending a window was created.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export const DEFAULT_SITE = "https://proofstack-iota.vercel.app";

/**
 * Where the application lives. A configured base URL wins, because a self-hosted or local
 * deployment is the case where guessing the public site would be actively wrong.
 */
export function resolveUiUrl(options: {
  flag?: string;
  env?: string;
  configBase?: string;
}): string {
  const raw = (options.flag ?? options.env ?? options.configBase ?? DEFAULT_SITE).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    url = new URL(DEFAULT_SITE);
  }
  // The marketing site and the application share a deployment: the app is under /app.
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/app";
  return url.toString();
}

export interface Command {
  file: string;
  args: string[];
}

const WINDOWS_BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

const LINUX_BROWSERS = [
  ["google-chrome", ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"]],
  ["chromium", ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"]],
  ["microsoft-edge", ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"]],
  ["brave-browser", ["/usr/bin/brave-browser"]],
  ["vivaldi", ["/usr/bin/vivaldi", "/usr/bin/vivaldi-stable"]],
] as const;

const MAC_BROWSERS: [string, string][] = [
  ["Google Chrome", "/Applications/Google Chrome.app"],
  ["Microsoft Edge", "/Applications/Microsoft Edge.app"],
  ["Brave Browser", "/Applications/Brave Browser.app"],
  ["Chromium", "/Applications/Chromium.app"],
];

/**
 * The command that opens `url` in its own window, or null when no Chromium-based browser is
 * installed (the caller then falls back to the default browser).
 */
export function appModeCommand(
  url: string,
  platform: string = process.platform,
  exists: (path: string) => boolean = existsSync
): Command | null {
  const has = (path: string) => exists(path);

  if (platform === "win32") {
    const browser = firstExistingWith(WINDOWS_BROWSERS, has);
    return browser
      ? { file: browser, args: [`--app=${url}`, "--window-size=1280,880", "--user-data-dir="] }
      : null;
  }

  if (platform === "darwin") {
    const app = MAC_BROWSERS.find(([, path]) => has(path));
    return app
      ? { file: "open", args: ["-na", app[0], "--args", `--app=${url}`, "--window-size=1280,880"] }
      : null;
  }

  for (const [, candidates] of LINUX_BROWSERS) {
    const browser = firstExistingWith(candidates, has);
    if (browser) {
      return {
        file: browser,
        args: [`--app=${url}`, "--window-size=1280,880", "--class=proofcore"],
      };
    }
  }
  return null;
}

function firstExistingWith(
  paths: readonly string[],
  exists: (path: string) => boolean
): string | null {
  for (const path of paths) if (exists(path)) return path;
  return null;
}

/** Spawns detached, so closing the terminal does not close the window. */
export async function launchDetached(command: Command): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", reject);
    child.unref();
    // Give the spawn a turn of the event loop so `error` (ENOENT) fires before we return.
    setTimeout(resolve, 120);
  });
}

export function defaultBrowserCommand(url: string, platform: string = process.platform): Command {
  if (platform === "win32") return { file: "cmd.exe", args: ["/c", "start", "", url] };
  if (platform === "darwin") return { file: "open", args: [url] };
  return { file: "xdg-open", args: [url] };
}

/** Absolute path helper kept here so tests can build platform paths without a real disk. */
export function browserPathCandidates(platform: string): string[] {
  if (platform === "win32") return WINDOWS_BROWSERS;
  if (platform === "darwin") return MAC_BROWSERS.map(([, path]) => path);
  return LINUX_BROWSERS.flatMap(([, paths]) => [...paths]);
}
