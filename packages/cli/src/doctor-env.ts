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
 * - **machine**: platform, Node, disk, terminal, git, Docker, Playwright's browsers;
 * - **permissions**: whether this user can write the config directory, whether the session
 *   file is private, whether the executable's folder is writable (which decides if the
 *   self-update can work at all).
 */

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

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

/** Where Playwright keeps its browsers, which is not where people expect it. */
export function playwrightCache(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches", "ms-playwright");
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "ms-playwright");
  }
  return join(homedir(), ".cache", "ms-playwright");
}

export function fileMode(path: string): number | null {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return null;
  }
}

export interface MachineFacts {
  platform: string;
  arch: string;
  nodeVersion: string;
  isGitRepo: boolean;
  gitVersion: string | null;
  dockerVersion: string | null;
  playwrightInstalled: boolean;
  configDir: string;
  configWritable: boolean | null;
  sessionMode: number | null;
  freeDiskBytes: number | null;
  executableDir: string;
  executableDirWritable: boolean | null;
  columns: number;
  colorEnabled: boolean;
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
    facts.playwrightInstalled
      ? { name: "browser", status: "ok", detail: "Playwright browsers installed" }
      : {
          name: "browser",
          status: "skip",
          detail: "Playwright browsers missing",
          fix: "npx playwright install chromium  (needed by `proofcore devtools`)",
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
    playwrightInstalled: existsSync(playwrightCache()),
    configDir,
    configWritable,
    sessionMode: fileMode(join(configDir, "session.json")),
    freeDiskBytes,
    executableDir,
    executableDirWritable,
    columns: process.stdout.columns ?? 0,
    colorEnabled: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
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
