/**
 * The full-screen hub: alternate screen, autocompletion, arrows, history.
 *
 * The other coding CLIs take over the terminal, and that is not decoration: a prompt that
 * stays in the scrollback collides with the output of the command you just ran, you lose
 * your place, and you cannot put a menu under the line you are typing. So this module owns
 * the screen (alternate buffer, `\x1b[?1049h`), redraws a frame on every keystroke, and
 * hands the terminal back exactly as it found it.
 *
 * Two decisions worth stating:
 *
 * - No dependency. readline gives history but not a menu under the prompt, and a menu is
 *   what makes twenty commands usable. The editor here is a string plus a cursor; the key
 *   decoder is a switch over the escapes a terminal actually sends.
 * - The frame is redrawn whole rather than patched. The alternate screen makes a full
 *   redraw free of flicker and impossible to get out of sync, which is the bug you would
 *   otherwise chase in a diffing renderer.
 *
 * Command output is captured, not printed: during a run, `process.stdout.write` is routed
 * into the transcript. That keeps the streaming of the agent intact - it prints as it
 * goes - without teaching every command about this file.
 */

import { HUB_COMMANDS, type HubAction, parseHubLine } from "./hub.js";

const ESC = String.fromCharCode(27);
const ALT_SCREEN_ON = `${ESC}[?1049h`;
const ALT_SCREEN_OFF = `${ESC}[?1049l`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

/** Biome and any reader deserve a name rather than a bare escape sequence. */
const ANSI = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, "g");
const SGR_LINE = new RegExp(`^${ESC}\\[[0-9;]*m`);
const ANSI_ANYWHERE = new RegExp(`^${ESC}\\[[0-9;]*[A-Za-z]`);

export function visibleWidth(text: string): number {
  return text.replace(ANSI, "").length;
}

/**
 * Hard-wraps a coloured line to `width` visible columns, carrying the active SGR sequence
 * across the break so a colour never bleeds into the next line or dies mid-word.
 */
export function wrapAnsi(line: string, width: number): string[] {
  if (width <= 0) return [line];
  if (visibleWidth(line) <= width) return [line];
  const out: string[] = [];
  let current = "";
  let visible = 0;
  let sgr = "";
  let index = 0;
  while (index < line.length) {
    const rest = line.slice(index);
    const sequence = SGR_LINE.exec(rest);
    if (sequence) {
      current += sequence[0];
      sgr = sequence[0] === `${ESC}[0m` ? "" : `${sgr}${sequence[0]}`;
      index += sequence[0].length;
      continue;
    }
    const char = line[index] ?? "";
    if (visible === width) {
      out.push(sgr ? `${current}${ESC}[0m` : current);
      current = sgr;
      visible = 0;
    }
    current += char;
    visible += 1;
    index += 1;
  }
  out.push(current);
  return out;
}

export type Key =
  | { kind: "text"; value: string }
  | { kind: "enter" }
  | { kind: "tab" }
  | { kind: "escape" }
  | { kind: "backspace" }
  | { kind: "delete" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "home" }
  | { kind: "end" }
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "pageup" }
  | { kind: "pagedown" }
  | { kind: "interrupt" }
  | { kind: "eof" }
  | { kind: "clear" }
  | { kind: "killline" }
  | { kind: "killword" }
  | { kind: "none" };

/** Decodes one input chunk into keys. Exported: the decoder is the part worth testing. */
export function decodeKeys(chunk: string): Key[] {
  const keys: Key[] = [];
  let index = 0;
  while (index < chunk.length) {
    const char = chunk[index] ?? "";
    if (char === ESC) {
      const rest = chunk.slice(index);
      // A prefix table beats a regex literal here: the sequences contain a control
      // character, and comparing strings keeps the decoder readable.
      const sequences: [string, Key][] = [
        [`${ESC}[A`, { kind: "up" }],
        [`${ESC}[B`, { kind: "down" }],
        [`${ESC}[C`, { kind: "right" }],
        [`${ESC}[D`, { kind: "left" }],
        [`${ESC}[H`, { kind: "home" }],
        [`${ESC}[F`, { kind: "end" }],
        [`${ESC}[3~`, { kind: "delete" }],
        [`${ESC}[5~`, { kind: "pageup" }],
        [`${ESC}[6~`, { kind: "pagedown" }],
      ];
      const match = sequences.find(([sequence]) => rest.startsWith(sequence));
      if (match) {
        keys.push(match[1]);
        index += match[0].length;
        continue;
      }
      // A CSI chunk split across reads (the rest of the sequence is not here yet): swallow
      // it rather than typing "[A" into the prompt.
      const partial = rest.slice(1);
      if (partial.length > 0 && /^\[[0-9;]*$/.test(partial)) {
        keys.push({ kind: "none" });
        index = chunk.length;
        continue;
      }
      keys.push({ kind: "escape" });
      index += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      keys.push({ kind: "enter" });
      index += 1;
      continue;
    }
    if (char === "\t") {
      keys.push({ kind: "tab" });
      index += 1;
      continue;
    }
    if (char === "\u007f" || char === "\b") {
      keys.push({ kind: "backspace" });
      index += 1;
      continue;
    }
    if (char === "\u0003") {
      keys.push({ kind: "interrupt" });
      index += 1;
      continue;
    }
    if (char === "\u0004") {
      keys.push({ kind: "eof" });
      index += 1;
      continue;
    }
    if (char === "\u000c") {
      keys.push({ kind: "clear" });
      index += 1;
      continue;
    }
    if (char === "\u0015") {
      keys.push({ kind: "killline" });
      index += 1;
      continue;
    }
    if (char === "\u0017") {
      keys.push({ kind: "killword" });
      index += 1;
      continue;
    }
    if (char === "\u0001") {
      keys.push({ kind: "home" });
      index += 1;
      continue;
    }
    if (char === "\u0005") {
      keys.push({ kind: "end" });
      index += 1;
      continue;
    }
    if (char < " ") {
      index += 1;
      continue;
    }
    keys.push({ kind: "text", value: char });
    index += 1;
  }
  return keys;
}

export interface TuiDeps {
  /** Coloured header lines, rendered on demand so a login is visible immediately. */
  header: () => string[];
  /** Colour helpers, so this file never invents its own palette. */
  dim: (text: string) => string;
  bold: (text: string) => string;
  accent: (text: string) => string;
  ok: (text: string) => string;
  warn: (text: string) => string;
  dispatch: (argv: string[]) => Promise<number>;
  agent: (prompt: string) => Promise<number>;
  help: () => string[];
  /** Runs an action that is neither a command nor an agent prompt (web links). */
  onUnknown: (command: string) => string;
}

interface MenuItem {
  command: string;
  description: string;
}

/** Prefix matches for what is being typed. Pure, so completion can be tested. */
export function completionsFor(buffer: string, commands = HUB_COMMANDS): MenuItem[] {
  if (!buffer.startsWith("/") || buffer.includes(" ")) return [];
  const needle = buffer.toLowerCase();
  return commands
    .filter((item) => item.command.toLowerCase().startsWith(needle))
    .map((item) => ({ command: item.command, description: item.description }));
}

export class HubTui {
  private buffer = "";
  private cursor = 0;
  private transcript: string[] = [];
  private pending = "";
  private history: string[] = [];
  private historyIndex = -1;
  private draft = "";
  private menuIndex = 0;
  private scroll = 0;
  private busy = false;
  private spinnerFrame = 0;
  private running = false;
  private renderTimer: NodeJS.Timeout | null = null;
  private spinnerTimer: NodeJS.Timeout | null = null;
  private interrupts = 0;
  private originalStdoutWrite: typeof process.stdout.write;
  private originalStderrWrite: typeof process.stderr.write;

  constructor(private readonly deps: TuiDeps) {
    this.originalStdoutWrite = process.stdout.write.bind(process.stdout);
    this.originalStderrWrite = process.stderr.write.bind(process.stderr);
  }

  private get rows(): number {
    // A pty can report 0x0 before the first resize; treat that as "unknown", not as a
    // zero-height screen, or the frame comes out empty.
    const value = process.stdout.rows;
    return value && value > 0 ? value : 24;
  }

  private get columns(): number {
    const value = process.stdout.columns;
    return value && value > 0 ? value : 80;
  }

  private get menu(): MenuItem[] {
    return completionsFor(this.buffer).slice(0, 6);
  }

  private get menuRows(): number {
    return this.menu.length ? this.menu.length + 1 : 0;
  }

  private get transcriptHeight(): number {
    return Math.max(3, this.rows - this.deps.header().length - 3 - this.menuRows);
  }

  /** Runs the loop until `/exit`, Ctrl+D or end of input. */
  async run(): Promise<number> {
    this.running = true;
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    process.stdout.write(ALT_SCREEN_ON + HIDE_CURSOR);

    // Everything a command prints lands in the transcript instead of the terminal.
    const capture = (chunk: unknown) => {
      this.append(chunk === null ? "" : String(chunk));
      return true;
    };
    process.stdout.write = capture as typeof process.stdout.write;
    process.stderr.write = capture as typeof process.stderr.write;

    const onResize = () => this.render();
    process.stdout.on("resize", onResize);
    const onData = (chunk: string) => {
      for (const key of decodeKeys(chunk)) this.handle(key);
    };
    stdin.on("data", onData);
    // End of input is a normal way to finish (a piped script, a closed terminal): without
    // this the loop waits for a key that will never come.
    const onEnd = () => this.quit();
    stdin.on("end", onEnd);

    this.push(
      this.deps.dim("  /help for the commands, Tab completes, ↑↓ history, Ctrl+C interrupts.")
    );
    this.render();

    try {
      await new Promise<void>((resolve) => {
        this.finish = resolve;
      });
    } finally {
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      process.stdout.off("resize", onResize);
      process.stdout.write = this.originalStdoutWrite;
      process.stderr.write = this.originalStderrWrite;
      if (this.renderTimer) clearTimeout(this.renderTimer);
      if (this.spinnerTimer) clearInterval(this.spinnerTimer);
      process.stdout.write(SHOW_CURSOR + ALT_SCREEN_OFF);
      if (!wasRaw) stdin.setRawMode?.(false);
      stdin.pause();
      this.running = false;
    }
    return 0;
  }

  private finish: () => void = () => undefined;

  private quit(): void {
    this.finish();
  }

  private append(chunk: string): void {
    this.pending += chunk;
    const parts = this.pending.split("\n");
    this.pending = parts.pop() ?? "";
    for (const line of parts) this.push(line);
    this.scheduleRender();
  }

  private push(line: string): void {
    const width = Math.max(20, this.columns - 2);
    for (const wrapped of wrapAnsi(line, width)) this.transcript.push(wrapped);
    this.scroll = 0;
  }

  private scheduleRender(): void {
    // Coalesce bursts: a command writing a hundred lines should not repaint a hundred times.
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, 16);
  }

  private handle(key: Key): void {
    if (this.busy && key.kind !== "interrupt") {
      // The run owns the screen; only an interrupt is meaningful while it is working.
      return;
    }
    this.interrupts = key.kind === "interrupt" ? this.interrupts + 1 : 0;
    switch (key.kind) {
      case "text": {
        this.buffer = `${this.buffer.slice(0, this.cursor)}${key.value}${this.buffer.slice(this.cursor)}`;
        this.cursor += key.value.length;
        this.menuIndex = 0;
        break;
      }
      case "backspace": {
        if (this.cursor === 0) break;
        this.buffer = `${this.buffer.slice(0, this.cursor - 1)}${this.buffer.slice(this.cursor)}`;
        this.cursor -= 1;
        this.menuIndex = 0;
        break;
      }
      case "delete": {
        if (this.cursor >= this.buffer.length) break;
        this.buffer = `${this.buffer.slice(0, this.cursor)}${this.buffer.slice(this.cursor + 1)}`;
        break;
      }
      case "left":
        this.cursor = Math.max(0, this.cursor - 1);
        break;
      case "right":
        this.cursor = Math.min(this.buffer.length, this.cursor + 1);
        break;
      case "home":
        this.cursor = 0;
        break;
      case "end":
        this.cursor = this.buffer.length;
        break;
      case "killline":
        this.buffer = this.buffer.slice(this.cursor);
        this.cursor = 0;
        break;
      case "killword": {
        const head = this.buffer.slice(0, this.cursor).replace(/\s*\S*$/, "");
        this.buffer = head + this.buffer.slice(this.cursor);
        this.cursor = head.length;
        break;
      }
      case "escape":
        this.buffer = "";
        this.cursor = 0;
        this.menuIndex = 0;
        break;
      case "tab": {
        const menu = this.menu;
        if (!menu.length) break;
        // Complete the highlighted entry. With a single match there is nothing to choose.
        const chosen = menu[Math.min(this.menuIndex, menu.length - 1)];
        if (!chosen) break;
        this.buffer = `${chosen.command} `;
        this.cursor = this.buffer.length;
        this.menuIndex = 0;
        break;
      }
      case "up": {
        const menu = this.menu;
        if (menu.length) {
          this.menuIndex = (this.menuIndex - 1 + menu.length) % menu.length;
          break;
        }
        if (!this.history.length) break;
        if (this.historyIndex === -1) {
          this.draft = this.buffer;
          this.historyIndex = this.history.length - 1;
        } else {
          this.historyIndex = Math.max(0, this.historyIndex - 1);
        }
        this.buffer = this.history[this.historyIndex] ?? "";
        this.cursor = this.buffer.length;
        break;
      }
      case "down": {
        const menu = this.menu;
        if (menu.length) {
          this.menuIndex = (this.menuIndex + 1) % menu.length;
          break;
        }
        if (this.historyIndex === -1) break;
        if (this.historyIndex >= this.history.length - 1) {
          this.historyIndex = -1;
          this.buffer = this.draft;
        } else {
          this.historyIndex += 1;
          this.buffer = this.history[this.historyIndex] ?? "";
        }
        this.cursor = this.buffer.length;
        break;
      }
      case "pageup":
        this.scroll = Math.min(
          Math.max(0, this.transcript.length - this.transcriptHeight),
          this.scroll + this.transcriptHeight
        );
        break;
      case "pagedown":
        this.scroll = Math.max(0, this.scroll - this.transcriptHeight);
        break;
      case "clear": {
        this.transcript = [];
        this.pending = "";
        this.scroll = 0;
        break;
      }
      case "eof":
        if (this.buffer.length === 0) {
          this.quit();
          return;
        }
        break;
      case "interrupt":
        if (this.buffer.length > 0) {
          this.buffer = "";
          this.cursor = 0;
          this.interrupts = 0;
          break;
        }
        if (this.interrupts >= 2) {
          this.quit();
          return;
        }
        this.push(this.deps.warn("  Ctrl+C again to leave."));
        break;
      case "enter":
        this.submit();
        return;
      case "none":
        break;
    }
    this.render();
  }

  private submit(): void {
    const line = this.buffer.trim();
    this.buffer = "";
    this.cursor = 0;
    this.menuIndex = 0;
    this.scroll = 0;
    if (!line) return;
    this.history.push(line);
    this.historyIndex = -1;
    this.push(`${this.deps.accent("❯")} ${line}`);

    const action = parseHubLine(line);
    if (action.kind === "empty") return;
    if (action.kind === "exit") {
      this.quit();
      return;
    }
    if (action.kind === "help") {
      for (const helpLine of this.deps.help()) this.push(helpLine);
      this.render();
      return;
    }
    void this.execute(action);
  }

  private async execute(action: HubAction): Promise<void> {
    if (action.kind === "unknown") {
      this.push(this.deps.onUnknown(action.command));
      this.render();
      return;
    }
    if (action.kind === "dispatch" && action.argv[0] === "__clear__") {
      this.transcript = [];
      this.pending = "";
      this.render();
      return;
    }

    this.busy = true;
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame += 1;
      this.render();
    }, 100);
    this.render();
    try {
      if (action.kind === "agent") {
        await this.deps.agent(action.prompt);
      } else if (action.kind === "dispatch") {
        await this.deps.dispatch(action.argv);
      }
    } catch (error) {
      this.push(this.deps.warn(`  ${error instanceof Error ? error.message : String(error)}`));
    } finally {
      if (this.spinnerTimer) clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
      this.busy = false;
      if (this.pending) {
        this.push(this.pending);
        this.pending = "";
      }
      this.render();
    }
  }

  /** Draws the whole frame. Called on every keystroke, so it allocates one string. */
  render(): void {
    if (!this.running) return;
    const columns = this.columns;
    const rows = this.rows;
    const rule = this.deps.dim("─".repeat(columns));
    const out: string[] = [];

    // Header: identity first, state second. Two rows, always in the same place.
    const state = this.busy
      ? this.deps.accent(
          `${["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"][this.spinnerFrame % 10]} working`
        )
      : this.deps.ok("●");
    const header = this.deps.header();
    out.push(this.fit(`${state} ${header[0] ?? ""}`, columns));
    out.push(this.fit(`${header[1] ?? ""}`, columns));
    out.push(rule);

    const height = this.transcriptHeight;
    const end = Math.max(0, this.transcript.length - this.scroll);
    const start = Math.max(0, end - height);
    const visible = this.transcript.slice(start, end);
    for (const line of visible) out.push(this.fit(line, columns));
    for (let index = visible.length; index < height; index += 1) out.push("");

    out.push(rule);
    const prompt = `${this.deps.accent("❯")} ${this.buffer}`;
    out.push(this.fit(prompt, columns));

    const menu = this.menu;
    if (menu.length) {
      for (const [index, item] of menu.entries()) {
        const selected = index === Math.min(this.menuIndex, menu.length - 1);
        const bullet = selected ? this.deps.accent("▸") : this.deps.dim(" ");
        const name = selected ? this.deps.bold(item.command) : item.command;
        out.push(this.fit(`  ${bullet} ${name} ${this.deps.dim(item.description)}`, columns));
      }
    }

    while (out.length < rows) out.push("");

    // One write per frame: cursor home, then every line cleared and painted.
    const frame = `${ESC}[H${out
      .slice(0, rows)
      .map((line) => `${ESC}[2K${line}`)
      .join("\n")}`;
    // Cursor sits after the typed text, not at the home position.
    const cursorRow = header.length + 3 + height;
    const cursorColumn = Math.min(columns - 1, 2 + this.cursor);
    this.originalStdoutWrite(`${frame}${ESC}[${cursorRow};${cursorColumn}H`);
  }

  private fit(line: string, columns: number): string {
    const width = visibleWidth(line);
    if (width <= columns) return line;
    // Slice by visible width, keeping the escapes that came before the cut.
    let result = "";
    let counted = 0;
    for (let index = 0; index < line.length && counted < columns; index += 1) {
      const sequence = ANSI_ANYWHERE.exec(line.slice(index));
      if (sequence) {
        result += sequence[0];
        index += sequence[0].length - 1;
        continue;
      }
      result += line[index];
      counted += 1;
    }
    return `${result}${ESC}[0m`;
  }
}
