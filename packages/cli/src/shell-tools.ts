import { spawn } from "node:child_process";

/**
 * One shell command, with no allowlist.
 *
 * `run_command` is the safe tool: an allowlist, no shell, arguments kept as an array. It is
 * the right default, and it cannot run `pnpm lint && pnpm typecheck`, a pipeline, an
 * environment assignment, or a project-specific script.
 *
 * This is the other tool. It runs a line through the platform's shell, and it is honest
 * about what that means: the command can do anything the user can do. That is why it is
 * marked as mutating, why the agent asks before calling it, and why the two obvious
 * catastrophes (`rm -rf /`, a fork bomb) are refused even here. A refusal for those two is
 * not a security boundary — it is a guard against a model that typed a placeholder without
 * reading it.
 */

export interface ShellResult {
  shell: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface ShellOptions {
  command: string;
  cwd: string;
  timeoutMs?: number;
  maxBytes?: number;
  env?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BYTES = 200_000;

const CATASTROPHIC = [
  /rm\s+(-[a-z]*[rf][a-z]*\s+)+(\/|\/\*|~)(\s|$)/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  /mkfs\.[a-z0-9]+\s+\/dev\//i,
  /dd\s+[^\n]*of=\/dev\/(sd|nvme|hd)/i,
];

export function runShell(options: ShellOptions): Promise<ShellResult> {
  const command = options.command.trim();
  if (!command) {
    return Promise.reject(
      new Error("run_shell needs a command line. Use run_command for a single program.")
    );
  }
  if (CATASTROPHIC.some((pattern) => pattern.test(command))) {
    return Promise.reject(
      new Error("This command is refused: it is destructive at the system level.")
    );
  }
  const isWindows = process.platform === "win32";
  const shell = isWindows
    ? (process.env.COMSPEC ?? "C:\\Windows\\System32\\cmd.exe")
    : process.env.SHELL && /(bash|zsh|fish|sh)$/.test(process.env.SHELL)
      ? process.env.SHELL
      : "/bin/sh";
  const args = isWindows ? ["/d", "/s", "/c", command] : ["-lc", command];
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 600_000);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const started = Date.now();

  return new Promise<ShellResult>((resolvePromise) => {
    const child = spawn(shell, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
        FORCE_COLOR: "0",
        // Raw output is quoted into a report or a model turn; keep it stable and unlocalised.
        LC_ALL: "C",
        LANG: "C",
      },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;

    const append = (target: "out" | "err", chunk: Buffer): void => {
      const current = target === "out" ? stdout : stderr;
      if (current.length >= maxBytes) {
        truncated = true;
        return;
      }
      const text = chunk.toString("utf8").slice(0, maxBytes);
      if (target === "out") stdout += text;
      else stderr += text;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      // The shell is the process group leader; killing it stops the command it spawned,
      // while a subprocess that daemonised itself is deliberately left alone.
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => append("out", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("err", chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({
        shell,
        command,
        cwd: options.cwd,
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        durationMs: Date.now() - started,
        timedOut,
        truncated,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        shell,
        command,
        cwd: options.cwd,
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
        truncated,
      });
    });
  });
}
