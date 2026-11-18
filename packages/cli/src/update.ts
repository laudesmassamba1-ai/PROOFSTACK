/**
 * Automatic updates.
 *
 * The rule this file follows: an update must never be able to leave someone with a broken
 * or replaced-by-nothing tool. So, in order:
 *
 * 1. the manifest comes from the release itself, and every file in it carries a sha256;
 * 2. the download is verified **before** anything on disk is touched;
 * 3. the current executable is renamed aside, not deleted, and only then is the new one
 *    moved into place - so a failure at any step leaves the old binary runnable;
 * 4. nothing here runs on a path that does not own its executable: an npm install is
 *    updated by npm, and the message says so instead of fighting the package manager.
 *
 * The check is cheap and silent: cached for a few hours, three-second timeout, and any
 * network failure is simply "no news" rather than an error in the middle of someone's work.
 */

import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const REPOSITORY = "laudesmassamba1-ai/PROOFSTACK";
export const DEFAULT_MANIFEST_URL = `https://github.com/${REPOSITORY}/releases/latest/download/manifest.json`;

/** How long a successful check is trusted before asking again. */
const CHECK_TTL_MS = 6 * 60 * 60 * 1000;

export type Channel = "stable" | "beta";

export interface ManifestFile {
  /** File name inside the release, resolved against the manifest URL. */
  binary: string;
  sha256: string;
  size: number;
}

export interface Manifest {
  version: string;
  channel?: Channel;
  publishedAt?: string;
  notes?: string;
  files: Record<string, ManifestFile>;
}

export interface UpdateState {
  checkedAt: string;
  currentVersion: string;
  latestVersion: string | null;
  channel: Channel;
  /** Filled when the check itself could not run; never shown as "up to date". */
  error?: string;
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const [core, pre] = value.replace(/^v/, "").split("-", 2);
    const numbers = (core ?? "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
    while (numbers.length < 3) numbers.push(0);
    return { numbers, pre: pre ?? "" };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  // A release with no suffix is newer than the same version with one (1.0.0 > 1.0.0-rc1).
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  return a.pre > b.pre ? 1 : -1;
}

/** The key used in the manifest, e.g. `linux-x64`. */
export function platformKey(platform = process.platform, arch = process.arch): string {
  const name = platform === "win32" ? "win" : platform;
  return `${name}-${arch}`;
}

/**
 * What this installation can do about an update.
 *
 * `binary` is the only case we can replace ourselves. `npm` is managed by npm, `source` is
 * a checkout, and pretending otherwise would corrupt someone's global packages.
 */
export function installKind(
  execPath = process.execPath,
  argv1 = process.argv[1] ?? ""
): "binary" | "npm" | "source" {
  // Split on both separators: a Windows path inspected on another platform (or by a test)
  // must not be mistaken for a checkout.
  const name = (execPath.split(/[\\/]/).pop() ?? "").toLowerCase();
  if (name === "proofcore" || name === "proofcore.exe" || name.startsWith("proofcore-")) {
    return "binary";
  }
  if (argv1.includes(`${"node_modules"}`)) return "npm";
  return "source";
}

/** Picks the file for this machine, or explains why there is none. */
export function planFor(
  manifest: Manifest,
  target = platformKey(),
  kind: "binary" | "npm" | "source" = "binary"
): { ok: true; file: ManifestFile; url: string } | { ok: false; reason: string } {
  if (kind !== "binary") {
    const command = kind === "npm" ? "npm install -g proofcore@latest" : "git pull && pnpm install";
    return { ok: false, reason: `this installation is updated with \`${command}\`` };
  }
  const file = manifest.files[target];
  if (!file) {
    return { ok: false, reason: `no build for ${target} in release ${manifest.version}` };
  }
  if (!/^[a-f0-9]{64}$/i.test(file.sha256 ?? "")) {
    return {
      ok: false,
      reason: `release ${manifest.version} publishes no usable checksum for ${target}`,
    };
  }
  // Assets sit next to the manifest, so resolving against it works for a release, a mirror
  // and a local file server without a second base URL to keep in sync.
  return { ok: true, file, url: new URL(file.binary, manifestUrl()).toString() };
}

export function manifestUrl(): string {
  return process.env.PROOFCORE_UPDATE_URL?.trim() || DEFAULT_MANIFEST_URL;
}

function statePath(): string {
  const base =
    process.env.PROOFCORE_CONFIG_HOME?.trim() ||
    (process.platform === "win32"
      ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "proofcore")
      : join(homedir(), ".config", "proofcore"));
  return join(base, "update.json");
}

export function readState(): UpdateState | null {
  try {
    const path = statePath();
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as UpdateState;
  } catch {
    return null;
  }
}

function writeState(state: UpdateState): void {
  try {
    const path = statePath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch {
    // A cache that cannot be written must not break the command that is running.
  }
}

/** Accepts anything, keeps what has the shape of a manifest, and rejects the rest. */
export function parseManifest(value: unknown): Manifest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== "string" || !/^\d+\.\d+\.\d+/.test(record.version)) return null;
  const files = record.files;
  if (!files || typeof files !== "object") return null;
  const cleaned: Record<string, ManifestFile> = {};
  for (const [key, entry] of Object.entries(files as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const file = entry as Record<string, unknown>;
    if (typeof file.binary !== "string" || typeof file.sha256 !== "string") continue;
    cleaned[key] = {
      binary: file.binary,
      sha256: file.sha256,
      size: typeof file.size === "number" ? file.size : 0,
    };
  }
  if (!Object.keys(cleaned).length) return null;
  return {
    version: record.version,
    channel: record.channel === "beta" ? "beta" : "stable",
    ...(typeof record.publishedAt === "string" ? { publishedAt: record.publishedAt } : {}),
    ...(typeof record.notes === "string" ? { notes: record.notes } : {}),
    files: cleaned,
  };
}

export interface CheckOptions {
  currentVersion: string;
  channel?: Channel;
  maxAgeMs?: number;
  /** Set to force a network call even when a fresh cached answer exists. */
  force?: boolean;
  timeoutMs?: number;
}

/**
 * Returns what is known about updates, from the cache when it is fresh enough.
 *
 * Never throws: the caller is usually a prompt someone is typing into.
 */
export async function checkForUpdate(options: CheckOptions): Promise<UpdateState> {
  const channel = options.channel ?? "stable";
  const cached = readState();
  const fresh =
    cached &&
    !options.force &&
    cached.channel === channel &&
    cached.currentVersion === options.currentVersion &&
    Date.now() - Date.parse(cached.checkedAt) < (options.maxAgeMs ?? CHECK_TTL_MS);

  if (fresh && cached) return cached;

  const fallback: UpdateState = {
    checkedAt: new Date().toISOString(),
    currentVersion: options.currentVersion,
    latestVersion: cached?.latestVersion ?? null,
    channel,
  };

  try {
    const response = await fetch(manifestUrl(), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
      redirect: "follow",
    });
    if (!response.ok) {
      const state = { ...fallback, error: `manifest returned ${response.status}` };
      writeState(state);
      return state;
    }
    const manifest = parseManifest(await response.json());
    if (!manifest) {
      const state = { ...fallback, error: "manifest is not readable" };
      writeState(state);
      return state;
    }
    const state: UpdateState = {
      checkedAt: new Date().toISOString(),
      currentVersion: options.currentVersion,
      latestVersion: manifest.version,
      channel,
    };
    writeState(state);
    return state;
  } catch (error) {
    const state = {
      ...fallback,
      error: error instanceof Error ? error.message : String(error),
    };
    writeState(state);
    return state;
  }
}

/** True when the state says a newer release exists. */
export function updateAvailable(state: UpdateState | null): string | null {
  if (!state?.latestVersion) return null;
  return compareVersions(state.latestVersion, state.currentVersion) > 0
    ? state.latestVersion
    : null;
}

export interface ApplyOptions {
  currentVersion: string;
  target?: string;
  kind?: "binary" | "npm" | "source";
  timeoutMs?: number;
  onProgress?: (message: string) => void;
}

export type ApplyResult =
  | { ok: true; from: string; to: string; path: string }
  | { ok: false; reason: string };

/**
 * Downloads, verifies and swaps the binary.
 *
 * The old executable is renamed, never deleted first: if the new file fails to install, the
 * old one is put back and the person still has a working `proofcore`.
 */
export async function applyUpdate(options: ApplyOptions): Promise<ApplyResult> {
  const say = options.onProgress ?? (() => undefined);
  const kind = options.kind ?? installKind();
  if (kind !== "binary") {
    return {
      ok: false,
      reason:
        kind === "npm"
          ? "this copy comes from npm: run `npm install -g proofcore@latest`"
          : "this copy runs from a checkout: update it with git",
    };
  }

  say("reading the release manifest");
  const response = await fetch(manifestUrl(), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    redirect: "follow",
  }).catch((error: unknown) => {
    throw new Error(
      `cannot reach the release manifest (${error instanceof Error ? error.message : String(error)})`
    );
  });
  if (!response.ok) throw new Error(`the release manifest returned ${response.status}`);
  const manifest = parseManifest(await response.json());
  if (!manifest) throw new Error("the release manifest is not readable");

  if (compareVersions(manifest.version, options.currentVersion) <= 0) {
    return {
      ok: true,
      from: options.currentVersion,
      to: options.currentVersion,
      path: process.execPath,
    };
  }

  const plan = planFor(manifest, options.target ?? platformKey(), kind);
  if (!plan.ok) return { ok: false, reason: plan.reason };

  const executable = process.execPath;
  const directory = dirname(executable);
  // Check before downloading: telling someone their install is read-only is useful at the
  // start, and useless after a hundred megabytes.
  const probe = join(directory, `.proofcore-write-test-${process.pid}`);
  try {
    writeFileSync(probe, "");
    rmSync(probe, { force: true });
  } catch {
    return {
      ok: false,
      reason: `${directory} is not writable (mode ${statSync(directory).mode.toString(8)}). Reinstall with the installer, or update as the user who owns it.`,
    };
  }

  say(`downloading ${plan.file.binary} (${Math.round(plan.file.size / 1024 / 1024)} MB)`);
  const download = await fetch(plan.url, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
    redirect: "follow",
  });
  if (!download.ok) throw new Error(`download failed: ${download.status}`);
  const bytes = Buffer.from(await download.arrayBuffer());

  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== plan.file.sha256.toLowerCase()) {
    throw new Error(
      `checksum mismatch: expected ${plan.file.sha256.slice(0, 12)}…, got ${digest.slice(0, 12)}…`
    );
  }

  const temporary = join(directory, `.${basename(executable)}.new-${process.pid}`);
  const backup = `${executable}.old-${options.currentVersion}`;
  writeFileSync(temporary, bytes);
  chmodSync(temporary, 0o755);

  say("replacing the executable");
  let moved = false;
  try {
    renameSync(executable, backup);
    moved = true;
    copyFileSync(temporary, executable);
    chmodSync(executable, 0o755);
    rmSync(temporary, { force: true });
    rmSync(backup, { force: true });
  } catch (error) {
    // Put the old one back: an update that fails must leave a working command.
    if (moved && !existsSync(executable)) {
      try {
        renameSync(backup, executable);
      } catch {
        return {
          ok: false,
          reason: `the new binary could not be installed and the old one is at ${backup}: move it back to ${executable}`,
        };
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    // The Windows case that actually happens: antivirus holds the file for a moment.
    const hint =
      process.platform === "win32"
        ? " (on Windows this is usually antivirus scanning the new file; retry in a moment)"
        : "";
    return { ok: false, reason: `could not replace ${executable}: ${detail}${hint}` };
  }

  say(`updated ${options.currentVersion} → ${manifest.version}`);
  writeState({
    checkedAt: new Date().toISOString(),
    currentVersion: manifest.version,
    latestVersion: manifest.version,
    channel: manifest.channel ?? "stable",
  });
  return { ok: true, from: options.currentVersion, to: manifest.version, path: executable };
}
