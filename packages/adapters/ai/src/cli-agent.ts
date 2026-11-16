import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { ProofstackError } from "@proofstack/core";
import { expandEnv } from "./mcp.js";

const exec = promisify(execFile);

/**
 * External CLI agents.
 *
 * Teams already have a coding agent they trust: a local model runner, a vendor CLI, a
 * script. This adapter hands that agent a prompt and reads its answer, without
 * reimplementing it and without pretending PROOFSTACK is the agent.
 *
 * Two rules that matter:
 *
 *   1. **argv, never a shell string.** `execFile` with an array cannot be injected into
 *      by a filename containing a semicolon.
 *   2. **The prompt goes on stdin by default.** Putting a multi-kilobyte prompt in argv
 *      hits the OS argument limit on Windows and is visible in `ps` on Unix.
 *
 * An agent that writes files is refused unless the config says so, because handing a
 * failing test suite to an agent that can edit the suite is how a green build gets
 * faked.
 */

export interface CliAgentOptions {
  name: string;
  /** argv array. `{prompt}` is substituted when promptDelivery is "arg". */
  command: string[];
  promptDelivery?: "stdin" | "arg";
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  allowFileWrites?: boolean;
}

export interface CliAgentResult {
  agent: string;
  answer: string;
  exitCode: number;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export class CliAgent {
  readonly name: string;
  readonly allowFileWrites: boolean;

  constructor(private readonly options: CliAgentOptions) {
    this.name = options.name;
    this.allowFileWrites = options.allowFileWrites ?? false;
  }

  /**
   * Run the agent with a prompt.
   *
   * A non-zero exit is not an exception: it is a result the caller reports. An agent
   * that fails is information, and turning it into a thrown error would lose its
   * stderr, which is usually the only explanation available.
   */
  async run(prompt: string, signal?: AbortSignal): Promise<CliAgentResult> {
    const delivery = this.options.promptDelivery ?? "stdin";
    const argv = this.options.command.map((arg) => expandEnv(arg));

    let args = argv.slice(1);
    let stdin: string | undefined;

    if (delivery === "arg") {
      const placeholderIndex = args.findIndex((arg) => arg.includes("{prompt}"));
      if (placeholderIndex >= 0) {
        args = args.map((arg) => arg.replaceAll("{prompt}", prompt));
      } else {
        args = [...args, prompt];
      }
    } else {
      stdin = prompt;
    }

    const file = argv[0];
    if (!file) {
      throw new ProofstackError({
        message: `CLI agent "${this.name}" has an empty command`,
        category: "CONFIGURATION",
        code: "agent_command_empty",
      });
    }

    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    for (const [key, value] of Object.entries(this.options.env ?? {})) {
      env[key] = expandEnv(value);
    }

    const startedAt = Date.now();

    // `execFile` has no stdin option, so a stdin-delivered prompt needs `spawn`. Doing
    // it properly matters: the whole point of stdin delivery is that a multi-kilobyte
    // prompt does not travel through argv, where it hits the OS limit and shows up in
    // `ps` on a shared machine.
    if (stdin !== undefined) {
      return this.runWithStdin(file, args, env, stdin, startedAt, signal);
    }

    try {
      const result = await exec(file, args, {
        ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
        env,
        timeout: this.options.timeoutMs ?? 300_000,
        maxBuffer: 32 * 1024 * 1024,
        encoding: "utf8",
        ...(signal ? { signal } : {}),
      });

      return {
        agent: this.name,
        answer: asText(result.stdout).trim(),
        exitCode: 0,
        stderr: asText(result.stderr).trim(),
        durationMs: Date.now() - startedAt,
        timedOut: false,
      };
    } catch (error) {
      const failed = error as {
        code?: number | string;
        stdout?: string;
        stderr?: string;
        killed?: boolean;
        signal?: string;
      };
      const timedOut = failed.killed === true || failed.signal === "SIGTERM";
      return {
        agent: this.name,
        answer: asText(failed.stdout).trim(),
        exitCode: typeof failed.code === "number" ? failed.code : 1,
        stderr: asText(
          failed.stderr ?? (error instanceof Error ? error.message : String(error))
        ).trim(),
        durationMs: Date.now() - startedAt,
        timedOut,
      };
    }
  }

  /**
   * Spawn the agent, write the prompt to its stdin, and collect stdout/stderr.
   *
   * The child is killed on timeout or cancellation, and the promise always resolves:
   * an agent that hangs must not hang the CLI.
   */
  private runWithStdin(
    file: string,
    args: string[],
    env: Record<string, string>,
    prompt: string,
    startedAt: number,
    signal?: AbortSignal
  ): Promise<CliAgentResult> {
    return new Promise<CliAgentResult>((resolve) => {
      const child = spawn(file, args, {
        ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
        env,
        stdio: ["pipe", "pipe", "pipe"],
        // argv, never a shell string.
        shell: false,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const finish = (exitCode: number): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve({
          agent: this.name,
          answer: stdout.trim(),
          exitCode,
          stderr: stderr.trim(),
          durationMs: Date.now() - startedAt,
          timedOut,
        });
      };

      const kill = (): void => {
        try {
          child.kill("SIGTERM");
        } catch {
          // Already gone.
        }
        // Escalate if it ignores SIGTERM.
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // Already gone.
          }
        }, 2_000).unref?.();
      };

      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, this.options.timeoutMs ?? 300_000);

      const onAbort = (): void => {
        kill();
        finish(1);
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (error) => {
        stderr += error.message;
        finish(1);
      });

      child.on("close", (code) => finish(code ?? 1));

      // A child that exits before reading stdin is not an error worth failing on.
      child.stdin.on("error", () => undefined);
      // Write the prompt and close stdin so the child sees EOF and can start work.
      child.stdin.end(prompt);
    });
  }
}

/** execFile can hand back a Buffer even with encoding set; normalise to text. */
function asText(value: string | Buffer | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : value.toString("utf8");
}

/**
 * Build the argv for an agent, resolving the prompt placeholder.
 *
 * Exported so a test can assert the argv without spawning anything: the substitution is
 * the part that can go wrong, and it is pure.
 */
export function buildAgentArgv(
  command: readonly string[],
  prompt: string,
  delivery: "stdin" | "arg"
): { file: string; args: string[]; stdin?: string } {
  const [file, ...rest] = command;
  if (!file) {
    throw new ProofstackError({
      message: "agent command is empty",
      category: "CONFIGURATION",
      code: "agent_command_empty",
    });
  }
  if (delivery === "stdin") return { file, args: [...rest], stdin: prompt };
  const hasPlaceholder = rest.some((arg) => arg.includes("{prompt}"));
  return {
    file,
    args: hasPlaceholder
      ? rest.map((arg) => arg.replaceAll("{prompt}", prompt))
      : [...rest, prompt],
  };
}
