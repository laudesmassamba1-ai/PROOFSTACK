import { spawn } from "node:child_process";
import { ProofCoreError } from "@proofcore/core";

/**
 * Container isolation for commands the agent runs.
 *
 * The allowlist in `run_command` is a safety net, not a boundary: a permitted binary can
 * still touch anything the user can touch. When Docker is available, `run_sandboxed`
 * executes the command inside a throwaway container with no network, a read-only root, a
 * size-limited tmpfs and no capabilities.
 *
 * The result always states which of the two it actually was. Reporting `isolation:
 * "container"` for an allowlist check would be a lie, and a security lie is the worst kind.
 */

export interface SandboxRun {
  command: string;
  args: string[];
  timeoutMs?: number;
  image?: string;
  /** Mount the workspace read-write. Off by default: reads are the common case. */
  writable?: boolean;
  /** Allow outbound network. Off by default. */
  network?: boolean;
}

export interface SandboxResult {
  isolation: "container" | "unavailable";
  image?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Why the container path was not used, when it was not. */
  reason?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 40_000;

function dockerBinary(): string {
  return process.env.PROOFCORE_DOCKER ?? "docker";
}

/** Whether a container runtime can actually run something, not merely whether the CLI exists. */
export async function dockerAvailable(): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn(dockerBinary(), ["version", "--format", "{{.Server.Version}}"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 8000,
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", () => resolvePromise(false));
    child.on("close", (code) => resolvePromise(code === 0 && output.trim().length > 0));
  });
}

export async function runInSandbox(root: string, input: SandboxRun): Promise<SandboxResult> {
  const started = Date.now();
  const image = input.image ?? process.env.PROOFCORE_SANDBOX_IMAGE ?? "node:22-alpine";
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000), 600_000);

  if (!(await dockerAvailable())) {
    throw new ProofCoreError({
      message: [
        "Container isolation is not available: Docker did not answer `docker version`.",
        "Nothing was executed — refusing to run the command unsandboxed under a sandbox request.",
        "Install/start Docker, or use run_command knowingly (allowlist only, no isolation).",
      ].join(" "),
      category: "UNSUPPORTED",
      code: "sandbox_unavailable",
    });
  }

  const dockerArgs = [
    "run",
    "--rm",
    "--init",
    // No new privileges, no capabilities, bounded processes and memory: a runaway script
    // degrades to a container failure instead of taking the machine down.
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--pids-limit",
    "256",
    "--memory",
    process.env.PROOFCORE_SANDBOX_MEMORY ?? "1g",
    "--network",
    input.network ? "bridge" : "none",
    "-v",
    `${root}:/work${input.writable ? "" : ":ro"}`,
    "-w",
    "/work",
    "--tmpfs",
    "/tmp:rw,size=64m",
    "-e",
    "HOME=/tmp",
    "-e",
    "LC_ALL=C",
    // `--entrypoint` bypasses the image's own entrypoint. Without it, an image like
    // `postgres` runs its init script instead of the requested command, and drops to a
    // non-root user — so a read-only mount owned by the developer becomes unreadable and
    // the command fails for a reason that has nothing to do with the command.
    "--entrypoint",
    input.command,
  ];

  // Run as the invoking user, so a writable mount produces files the developer owns rather
  // than root-owned leftovers. Skipped where getuid is unavailable (Windows).
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (typeof uid === "number" && typeof gid === "number") {
    dockerArgs.push("--user", `${uid}:${gid}`);
  }
  dockerArgs.push(image, ...input.args);

  const result = await new Promise<SandboxResult>((resolvePromise) => {
    const child = spawn(dockerBinary(), dockerArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let finished = false;
    const finish = (exitCode: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolvePromise({
        isolation: "container",
        image,
        exitCode,
        stdout: stdout.slice(0, MAX_OUTPUT_CHARS),
        stderr: stderr.slice(0, MAX_OUTPUT_CHARS),
        durationMs: Date.now() - started,
      });
    };
    const timer = setTimeout(() => {
      stderr += `\n[sandbox timeout after ${timeoutMs} ms: container removed]`;
      child.kill("SIGKILL");
      finish(null);
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      stderr += `\n${error.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });

  return result;
}

/** One line for the CLI and for the agent's tool result. */
export function describeSandbox(result: SandboxResult): string {
  return `${result.isolation} · ${result.image ?? "?"} · exit ${result.exitCode ?? "killed"} in ${result.durationMs} ms`;
}
