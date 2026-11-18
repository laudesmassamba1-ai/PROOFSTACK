/**
 * `proofcore` with no arguments: the hub.
 *
 * A developer who opens a terminal should not have to memorise twenty commands. The hub is
 * one prompt, one readline, and a `/help` that lists what exists — the same shape as the
 * coding CLIs people already use. Everything it runs is the ordinary command: no second
 * implementation, no hidden behaviour, identical exit codes.
 *
 * The parser is pure and exported so the mapping from a typed line to an action can be
 * tested without a terminal.
 */

export type HubAction =
  | { kind: "empty" }
  | { kind: "exit" }
  | { kind: "help" }
  | { kind: "dispatch"; argv: string[] }
  | { kind: "agent"; prompt: string }
  | { kind: "unknown"; command: string };

/** Slash commands, mapped to the CLI argv they run. `args` is for `/help` only. */
export type HubGroup = "Agent" | "Audits" | "Code" | "Account" | "Session";

export const HUB_COMMANDS: {
  command: string;
  args: string;
  description: string;
  group: HubGroup;
}[] = [
  { group: "Session", command: "/help", args: "", description: "this list" },
  { group: "Account", command: "/whoami", args: "", description: "account and model in use" },
  { group: "Account", command: "/login", args: "", description: "sign in through the browser" },
  { group: "Account", command: "/logout", args: "", description: "remove the stored session" },
  {
    group: "Agent",
    command: "/agent",
    args: "<prompt>",
    description: "coding agent: reads, edits, runs",
  },
  {
    group: "Agent",
    command: "/serve",
    args: "[--port 7317]",
    description: "local agent + page, synced to the account",
  },
  {
    group: "Account",
    command: "/projects",
    args: "",
    description: "projects in the signed-in workspace",
  },
  {
    group: "Audits",
    command: "/test",
    args: "[--only WORLD]",
    description: "run WORLD · FLOW · EXIT",
  },
  {
    group: "Audits",
    command: "/audit",
    args: "fail|clean <url>",
    description: "security or UI-quality audit",
  },
  { group: "Audits", command: "/report", args: "", description: "last run report" },
  {
    group: "Code",
    command: "/tools",
    args: "",
    description: "every agent tool and where it lives",
  },
  { group: "Code", command: "/index", args: "", description: "build the semantic index" },
  {
    group: "Code",
    command: "/search",
    args: "<query>",
    description: "concept search over the index",
  },
  { group: "Code", command: "/map", args: "[dir]", description: "architecture as a Mermaid graph" },
  {
    group: "Code",
    command: "/devtools",
    args: "<url>",
    description: "console, network, DOM, a11y",
  },
  {
    group: "Code",
    command: "/debug",
    args: "<file> --line <n>",
    description: "breakpoints and real scopes",
  },
  { group: "Code", command: "/svg", args: "<name>", description: "deterministic icon" },
  { group: "Account", command: "/billing", args: "", description: "plan, seats and usage" },
  {
    group: "Audits",
    command: "/modules",
    args: "",
    description: "WORLD · FLOW · EXIT · FAIL · CLEAN",
  },
  { group: "Session", command: "/clear", args: "", description: "clear the screen" },
  { group: "Session", command: "/exit", args: "", description: "leave the hub" },
];

/** `/billing` is a web page, not an API read: the hub opens it instead of guessing. */
const WEB_ONLY: Record<string, string> = {
  "/billing": "/app/billing",
  "/modules": "/app/modules",
};

const ALIASES: Record<string, string[]> = {
  "/help": [],
  "/?": [],
  "/whoami": ["whoami"],
  "/agent": ["agent"],
  "/serve": ["serve"],
  "/login": ["login"],
  "/logout": ["logout"],
  "/projects": ["projects"],
  "/test": ["test"],
  "/audit": ["audit"],
  "/report": ["report"],
  "/tools": ["tools"],
  "/index": ["index"],
  "/search": ["search"],
  "/map": ["map"],
  "/devtools": ["devtools"],
  "/debug": ["debug"],
  "/svg": ["svg"],
};

/** Splits a command line, honouring double quotes so `/search "a b"` stays one argument. */
export function splitArgs(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of input.trim()) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current) parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

export function parseHubLine(rawLine: string): HubAction {
  const line = rawLine.trim();
  if (!line) return { kind: "empty" };
  if (line === "exit" || line === "quit" || line === "/exit" || line === "/quit") {
    return { kind: "exit" };
  }
  if (line === "?") return { kind: "help" };
  if (!line.startsWith("/")) {
    // Anything that is not a command is a request for the agent, which is what a person
    // typing a sentence into a coding CLI expects.
    return { kind: "agent", prompt: line };
  }
  const [head, ...rest] = splitArgs(line);
  const command = (head ?? "").toLowerCase();
  if (command === "/help" || command === "/?" || command === "?") return { kind: "help" };
  if (command === "/clear") return { kind: "dispatch", argv: ["__clear__"] };
  const argv = ALIASES[command];
  if (!argv) return { kind: "unknown", command };
  return { kind: "dispatch", argv: [...argv, ...rest] };
}

/** The web page a hub command opens, when the command is a page rather than a CLI verb. */
export function hubWebPath(command: string): string | undefined {
  return WEB_ONLY[command.toLowerCase()];
}

/** `❯` in the colour of the brand, preceded by the workspace name. */
export const PROMPT = "\u001b[38;5;79m❯\u001b[0m ";

export interface HubIo {
  /** Returns null on end of input. */
  ask(prompt: string): Promise<string | null>;
  write(text: string): void;
}

export interface HubDeps {
  dispatch: (argv: string[]) => Promise<number>;
  agent: (prompt: string) => Promise<number>;
  help: () => void;
  openWeb: (path: string) => void;
  clear: () => void;
  onError: (message: string) => void;
}

export async function runHub(io: HubIo, deps: HubDeps): Promise<number> {
  for (;;) {
    const line = await io.ask(PROMPT);
    if (line === null) return 0;
    const action = parseHubLine(line);
    if (action.kind === "empty") continue;
    if (action.kind === "exit") return 0;
    if (action.kind === "help") {
      deps.help();
      continue;
    }
    if (action.kind === "unknown") {
      const webPath = hubWebPath(action.command);
      if (webPath) {
        deps.openWeb(webPath);
        io.write(`Opened ${webPath} in your browser.\n`);
        continue;
      }
      deps.onError(`Unknown command ${action.command}. Type /help for the list.`);
      continue;
    }
    if (action.kind === "agent") {
      await deps.agent(action.prompt);
      continue;
    }
    if (action.argv[0] === "__clear__") {
      deps.clear();
      continue;
    }
    try {
      // The ordinary command, with its real output and its real exit code.
      await deps.dispatch(action.argv);
    } catch (error) {
      deps.onError(error instanceof Error ? error.message : String(error));
    }
  }
}
