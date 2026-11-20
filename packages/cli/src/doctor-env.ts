/**
 * Environment checks: the conflicts that actually happen, detected rather than guessed.
 *
 * A "doctor" that prints green checkmarks for things it never tested is decoration. Every
 * check here runs a real command or reads a real file, has three possible outcomes, and
 * carries the fix in the same line - because "Docker is not reachable" without "start it,
 * or install it this way" is a puzzle, not a diagnosis.
 *
 * Two families:
 *
 * - **machine**: platform, Node, disk, terminal, git, Docker, an installed Chromium;
 * - **permissions**: whether this user can write the config directory, whether the session
 *   file is private, whether the executable's folder is writable (which decides if the
 *   self-update can work at all).
 */

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { findChromium } from "@proofcore/adapter-browser";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  /** What to do about it. Always concrete: a command, or a setting. */
  fix?: string;
}

/** Runs a command with a hard timeout; never throws, never hangs the doctor. */
export function commandVersion(command: string, args: string[], timeoutMs = 2500): string | null {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    // The PATH of the doctor is the user's PATH: nothing is added or removed here.
  });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n")[0] ?? "";
}

export function configDirectory(): string {
  if (process.env.PROOFCORE_CONFIG_HOME?.trim()) return process.env.PROOFCORE_CONFIG_HOME.trim();
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "proofcore");
  }
  return join(homedir(), ".config", "proofcore");
}

export function fileMode(path: string): number | null {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return null;
  }
}

/**
 * One `proofcore` executable found on PATH.
 *
 * Duplicate installs are the single most confusing failure mode this CLI has: the desktop
 * app installs a binary in `/opt`, an npm global install writes another into the Node bin
 * directory, and `proofcore` runs whichever comes first on PATH. The reports then disagree
 * with each other and the version number stops meaning anything.
 */
export interface InstallCandidate {
  /** The path as PATH resolved it (what the shell would run). */
  path: string;
  /** The file it really is, after symlinks: two links to one binary are one install. */
  realPath: string;
  /** `desktop`, `npm`, `standalone`, or `unknown` — how it was installed. */
  kind: string;
}

function classifyInstall(realPath: string): string {
  // The desktop package keeps an Electron app next to a `sidecar` binary.
  if (realPath.includes("/opt/") && existsSync(join(realPath, "..", "resources", "app.asar"))) {
    return "desktop";
  }
  if (realPath.includes("node_modules")) return "npm";
  if (realPath.includes(".local/share") || realPath.includes("sidecar")) return "standalone";
  return "unknown";
}

/**
 * Every distinct `proofcore` on PATH, in PATH order.
 *
 * Deliberately does not execute them: on this machine one of them is the desktop app, and
 * asking it for `--version` would open a window. Installation shape is inferred from the
 * paths instead, which cannot have side effects.
 */
export function findInstalls(): InstallCandidate[] {
  const names = process.platform === "win32" ? ["proofcore.exe", "proofcore.cmd"] : ["proofcore"];
  const seen = new Set<string>();
  const found: InstallCandidate[] = [];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = join(directory, name);
      let realPath: string;
      try {
        if (!existsSync(candidate)) continue;
        realPath = realpathSync(candidate);
      } catch {
        continue;
      }
      if (seen.has(realPath)) continue;
      seen.add(realPath);
      found.push({ path: candidate, realPath, kind: classifyInstall(realPath) });
    }
  }
  return found;
}

export interface MachineFacts {
  platform: string;
  arch: string;
  nodeVersion: string;
  isGitRepo: boolean;
  gitVersion: string | null;
  dockerVersion: string | null;
  browserPath: string | null;
  browserSource: string | null;
  configDir: string;
  configWritable: boolean | null;
  sessionMode: number | null;
  freeDiskBytes: number | null;
  executableDir: string;
  executableDirWritable: boolean | null;
  columns: number;
  colorEnabled: boolean;
  /** Every distinct install found on PATH; one entry is the healthy case. */
  installs?: InstallCandidate[];
}

/** Turns facts into verdicts. Pure: the tests build the facts, not the machine. */
export function evaluate(facts: MachineFacts): Check[] {
  const checks: Check[] = [];

  const supported = /^(linux|darwin|win32)-(x64|arm64)$/.test(`${facts.platform}-${facts.arch}`);
  checks.push({
    name: "platform",
    status: supported ? "ok" : "warn",
    detail: `${facts.platform}-${facts.arch}`,
    ...(supported
      ? {}
      : {
          fix: "Prebuilt binaries exist for linux/darwin/win32 on x64 and arm64; on another architecture use `npm install -g proofcore`.",
        }),
  });

  const nodeMajor = Number(facts.nodeVersion.split(".")[0]);
  checks.push({
    name: "node",
    status: nodeMajor >= 20 ? "ok" : nodeMajor >= 18 ? "warn" : "fail",
    detail: facts.nodeVersion,
    ...(nodeMajor >= 20
      ? {}
      : {
          fix: "Install Node 20 or newer (nvm install 22), or use the standalone installer which bundles the runtime.",
        }),
  });

  if (facts.configWritable === false) {
    checks.push({
      name: "config",
      status: "fail",
      detail: `${facts.configDir} is not writable`,
      fix: `chown -R $(id -u):$(id -g) ${facts.configDir}`,
    });
  } else {
    checks.push({ name: "config", status: "ok", detail: facts.configDir });
  }

  // A second install is why "it works" and "it fails" can both be true on one machine.
  const installs = facts.installs ?? [];
  checks.push({
    name: "install",
    status: installs.length <= 1 ? "ok" : "warn",
    detail:
      installs.length === 0
        ? "not found on PATH"
        : installs.map((item) => `${item.kind} ${item.realPath}`).join(" · "),
    ...(installs.length > 1
      ? {
          fix: `Remove all but one, otherwise the version depends on PATH order. Keep the desktop install and run \`npm uninstall -g proofcore\`, or delete the other binary: ${installs
            .slice(1)
            .map((item) => item.realPath)
            .join(", ")}`,
        }
      : {}),
  });

  if (facts.sessionMode !== null) {
    // A session token readable by other users on the machine is a leak, not a preference.
    const tooOpen = (facts.sessionMode & 0o077) !== 0;
    checks.push({
      name: "session permissions",
      status: tooOpen ? "warn" : "ok",
      detail: `0${facts.sessionMode.toString(8)}`,
      ...(tooOpen ? { fix: `chmod 600 ${join(facts.configDir, "session.json")}` } : {}),
    });
  }

  checks.push({
    name: "executable",
    status: facts.executableDirWritable === false ? "warn" : "ok",
    detail:
      facts.executableDirWritable === false
        ? `${facts.executableDir} is read-only: self-update will refuse`
        : facts.executableDir,
    ...(facts.executableDirWritable === false
      ? { fix: "Reinstall with the installer (user scope), or update as root." }
      : {}),
  });

  checks.push(
    facts.isGitRepo
      ? { name: "git", status: "ok", detail: facts.gitVersion ?? "present" }
      : {
          name: "git",
          status: "skip",
          detail: "not a repository",
          fix: "git-based tools are unavailable here",
        }
  );

  checks.push(
    facts.dockerVersion
      ? { name: "docker", status: "ok", detail: facts.dockerVersion }
      : {
          name: "docker",
          status: "skip",
          detail: "not reachable",
          fix: "`proofcore exec` will refuse instead of running unisolated: install Docker and start it.",
        }
  );

  checks.push(
    facts.browserPath
      ? {
          name: "browser",
          status: "ok",
          detail: `${facts.browserPath}${facts.browserSource ? ` (${facts.browserSource})` : ""}`,
        }
      : {
          name: "browser",
          status: "skip",
          detail: "no Chromium found",
          fix: "Install Chrome, Chromium, Edge or Brave, or set PROOFCORE_CHROMIUM=/path/to/chrome.",
        }
  );

  if (facts.freeDiskBytes !== null) {
    const gigabytes = facts.freeDiskBytes / 1024 ** 3;
    checks.push({
      name: "disk",
      status: gigabytes < 1 ? "warn" : "ok",
      detail: `${gigabytes.toFixed(1)} GB free`,
      ...(gigabytes < 1
        ? { fix: "The semantic index and reports need some room; free a gigabyte." }
        : {}),
    });
  }

  checks.push({
    name: "terminal",
    status: facts.colorEnabled ? "ok" : "warn",
    detail: facts.colorEnabled
      ? `${facts.columns} columns, colour`
      : "no colour (NO_COLOR or a pipe)",
  });

  return checks;
}

/** Collects the facts by running the checks for real. */
export async function inspectMachine(options: { cwd: string }): Promise<MachineFacts> {
  const configDir = configDirectory();
  let configWritable: boolean | null = null;
  try {
    const probe = join(configDir, `.probe-${process.pid}`);
    const { mkdirSync, rmSync, writeFileSync } = await import("node:fs");
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    writeFileSync(probe, "");
    rmSync(probe, { force: true });
    configWritable = true;
  } catch {
    configWritable = false;
  }

  const lookup = findChromium();
  const executableDir = process.execPath ? join(process.execPath, "..") : options.cwd;
  let executableDirWritable: boolean | null = null;
  try {
    const { writeFileSync, rmSync } = await import("node:fs");
    const probe = join(executableDir, `.probe-${process.pid}`);
    writeFileSync(probe, "");
    rmSync(probe, { force: true });
    executableDirWritable = true;
  } catch {
    executableDirWritable = false;
  }

  let freeDiskBytes: number | null = null;
  try {
    const { statfs } = await import("node:fs/promises");
    const stats = await statfs(existsSync(options.cwd) ? options.cwd : tmpdir());
    freeDiskBytes = Number(stats.bavail) * Number(stats.bsize);
  } catch {
    freeDiskBytes = null;
  }

  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    isGitRepo: existsSync(join(options.cwd, ".git")),
    gitVersion: commandVersion("git", ["--version"]),
    dockerVersion: commandVersion("docker", ["--version"]),
    browserPath: lookup?.executable ?? null,
    browserSource: lookup?.source ?? null,
    configDir,
    configWritable,
    sessionMode: fileMode(join(configDir, "session.json")),
    freeDiskBytes,
    executableDir,
    executableDirWritable,
    columns: process.stdout.columns ?? 0,
    colorEnabled: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
    installs: findInstalls(),
  };
}

export function summarize(checks: Check[]): {
  ok: number;
  warn: number;
  fail: number;
  skip: number;
} {
  return {
    ok: checks.filter((check) => check.status === "ok").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
    skip: checks.filter((check) => check.status === "skip").length,
  };
}
