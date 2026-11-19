import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { delimiter, join } from "node:path";

/**
 * The integrated terminal.
 *
 * A terminal is a process attached to a pseudo-terminal, not a text box that runs commands.
 * Line editing, colours, prompts, Ctrl+C and full-screen programs all come from the PTY; a
 * pipe would give none of them.
 *
 * The product already ships a browser engine it does not download; the terminal follows the
 * same rule. On Linux and macOS, `script(1)` is part of the base system and allocates a PTY
 * around the user's own shell. On Windows there is no such utility, so the session falls
 * back to a line-buffered shell and says so — the alternative would be shipping a native
 * module built per Electron ABI, which is exactly the dependency this app avoids.
 *
 * Output is multiplexed to the page over Server-Sent Events, base64-encoded so a partial
 * UTF-8 sequence is never split. Keystrokes go back over a POST, which keeps the transport
 * plain HTTP: same origin, same per-run cookie, no WebSocket handshake to re-implement.
 */

export interface TerminalInfo {
  id: string;
  shell: string;
  mode: "pty" | "pipe";
  cwd: string;
  cols: number;
  rows: number;
  pid: number | null;
}

interface TerminalSession extends TerminalInfo {
  child: ChildProcessWithoutNullStreams;
  listeners: Set<(event: string, payload: unknown) => void>;
  history: Buffer[];
  historyBytes: number;
  lineBuffer: string;
  exited: { code: number | null; signal: string | null } | null;
  resizeTimer?: ReturnType<typeof setTimeout>;
}

const MAX_HISTORY_BYTES = 256 * 1024;
const MAX_SESSIONS = 3;

function findExecutable(name: string): string | undefined {
  const path = process.env.PATH ?? "";
  for (const directory of path.split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    if (!existsSync(candidate)) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not executable.
    }
  }
  return undefined;
}

function shellFor(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC ?? "C:\\Windows\\System32\\cmd.exe";
  }
  const shell = process.env.SHELL;
  if (shell && existsSync(shell)) return shell;
  return existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
}

export class TerminalHub {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly log: (line: string) => void;

  constructor(options: { log?: (line: string) => void } = {}) {
    this.log = options.log ?? (() => undefined);
  }

  list(): TerminalInfo[] {
    return [...this.sessions.values()].map((session) => this.info(session));
  }

  start(options: { cwd: string; cols?: number; rows?: number; replace?: boolean }): TerminalInfo {
    if (options.replace) this.killAll();
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error("Trop de terminaux ouverts. Fermez-en un avant d'en ouvrir un autre.");
    }
    const cols = Math.min(Math.max(Math.round(options.cols ?? 120), 20), 400);
    const rows = Math.min(Math.max(Math.round(options.rows ?? 32), 6), 200);
    const shell = shellFor();
    const script = process.platform !== "win32" ? findExecutable("script") : undefined;
    const id = `term-${randomUUID().slice(0, 8)}`;

    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLUMNS: String(cols),
      LINES: String(rows),
      // An inherited Node flag means nothing to a shell and has broken native commands.
      NODE_OPTIONS: "",
    };

    let child: ChildProcessWithoutNullStreams;
    if (script) {
      const args =
        process.platform === "darwin"
          ? ["-q", "/dev/null", shell, "-l"]
          : ["-q", "-f", "-c", shell, "/dev/null"];
      child = spawn(script, args, {
        cwd: options.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams;
    } else {
      // Windows, and the rare POSIX box without `script`: a pipe with a local line editor.
      const args = process.platform === "win32" ? ["/d", "/q"] : ["-i"];
      child = spawn(shell, args, {
        cwd: options.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams;
    }

    const session: TerminalSession = {
      id,
      shell,
      mode: script ? "pty" : "pipe",
      cwd: options.cwd,
      cols,
      rows,
      pid: child.pid ?? null,
      child,
      listeners: new Set(),
      history: [],
      historyBytes: 0,
      lineBuffer: "",
      exited: null,
    };
    this.sessions.set(id, session);

    const push = (chunk: Buffer): void => this.push(session, chunk);
    child.stdout.on("data", (chunk: Buffer) => push(chunk));
    child.stderr.on("data", (chunk: Buffer) => push(chunk));
    child.on("error", (error) => {
      this.push(session, Buffer.from(`\r\n[terminal] ${error.message}\r\n`, "utf8"));
      session.exited = { code: null, signal: null };
      this.emit(session, "exit", { code: null, signal: null });
    });
    child.on("close", (code, signal) => {
      session.exited = { code, signal };
      this.emit(session, "exit", { code, signal });
      this.log(`terminal ${id} exited (${code ?? signal ?? "?"})`);
    });

    // The PTY starts at the terminal's advertised size. `script` has no size flag, so the
    // first stty is the only way to make the shell agree with the viewport.
    if (session.mode === "pty" && (cols !== 80 || rows !== 24)) {
      setTimeout(() => {
        if (!session.exited) child.stdin.write(`stty cols ${cols} rows ${rows} 2>/dev/null\n`);
      }, 120);
    }

    return this.info(session);
  }

  /** Streams the session to an HTTP response as Server-Sent Events. */
  attach(id: string, response: ServerResponse): void {
    const session = this.sessions.get(id);
    if (!session) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "terminal_not_found" }));
      return;
    }
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write("retry: 2000\n\n");
    const send = (event: string, payload: unknown): void => {
      if (response.writableEnded) return;
      response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    send("ready", this.info(session));
    for (const chunk of session.history) send("data", { data: chunk.toString("base64") });
    if (session.exited) {
      send("exit", session.exited);
      response.end();
      return;
    }

    const listener = (event: string, payload: unknown): void => send(event, payload);
    session.listeners.add(listener);
    const heartbeat = setInterval(() => {
      if (!response.writableEnded) response.write(": ping\n\n");
    }, 20_000);
    heartbeat.unref?.();

    const cleanup = (): void => {
      clearInterval(heartbeat);
      session.listeners.delete(listener);
    };
    response.on("close", cleanup);
    response.on("error", cleanup);
  }

  write(id: string, data: Buffer): void {
    const session = this.sessions.get(id);
    if (!session || session.exited) return;
    if (session.mode === "pty") {
      session.child.stdin.write(data);
      return;
    }
    // A pipe does not echo and does not edit. Doing both here is what makes the fallback
    // feel like a terminal instead of a one-way log.
    const text = data.toString("utf8");
    for (const character of text) {
      if (character === "\r" || character === "\n") {
        const line = session.lineBuffer;
        session.lineBuffer = "";
        this.push(session, Buffer.from("\r\n", "utf8"));
        if (!session.exited) session.child.stdin.write(`${line}\n`);
        continue;
      }
      if (character === "\x7f" || character === "\b") {
        if (session.lineBuffer.length > 0) {
          session.lineBuffer = session.lineBuffer.slice(0, -1);
          this.push(session, Buffer.from("\b \b", "utf8"));
        }
        continue;
      }
      if (character === "\x03") {
        this.push(session, Buffer.from("^C\r\n", "utf8"));
        session.lineBuffer = "";
        session.child.kill("SIGINT");
        continue;
      }
      if (character === "\t" || character === "\x1b") {
        // Arrow keys and completion would need a real PTY; ignoring them is honest.
        continue;
      }
      if (character >= " ") {
        session.lineBuffer += character;
        this.push(session, Buffer.from(character, "utf8"));
      }
    }
  }

  /** Resizes a PTY through stty; a pipe has no window size to change. */
  resize(id: string, cols: number, rows: number): TerminalInfo | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    session.cols = Math.min(Math.max(Math.round(cols), 20), 400);
    session.rows = Math.min(Math.max(Math.round(rows), 6), 200);
    if (session.mode === "pty" && !session.exited) {
      if (session.resizeTimer) clearTimeout(session.resizeTimer);
      session.resizeTimer = setTimeout(() => {
        if (!session.exited) {
          session.child.stdin.write(`stty cols ${session.cols} rows ${session.rows} 2>/dev/null\n`);
        }
      }, 250);
    }
    return this.info(session);
  }

  kill(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (!session.exited) {
      try {
        session.child.kill("SIGTERM");
        // A shell that ignores SIGTERM during a running command still has to go.
        setTimeout(() => {
          if (!session.exited) session.child.kill("SIGKILL");
        }, 1_500).unref?.();
      } catch {
        // Already gone.
      }
    }
    this.sessions.delete(id);
    this.emit(session, "exit", session.exited ?? { code: 0, signal: null });
    return true;
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }

  dispose(): void {
    this.killAll();
  }

  private info(session: TerminalSession): TerminalInfo {
    return {
      id: session.id,
      shell: session.shell,
      mode: session.mode,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      pid: session.pid,
    };
  }

  private push(session: TerminalSession, chunk: Buffer): void {
    session.history.push(chunk);
    session.historyBytes += chunk.byteLength;
    while (session.historyBytes > MAX_HISTORY_BYTES && session.history.length > 1) {
      const removed = session.history.shift();
      session.historyBytes -= removed?.byteLength ?? 0;
    }
    this.emit(session, "data", { data: chunk.toString("base64") });
  }

  private emit(session: TerminalSession, event: string, payload: unknown): void {
    for (const listener of session.listeners) {
      try {
        listener(event, payload);
      } catch {
        // A disconnected response must not stop the session.
      }
    }
  }
}
