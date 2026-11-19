import { describe, expect, it } from "vitest";
import { HUB_COMMANDS, hubWebPath, parseHubLine, runHub, splitArgs } from "../src/hub.js";

/**
 * The hub's parser and loop.
 *
 * Pure by design: what a typed line means is decided here, not in the terminal, so the
 * mapping can be tested without a TTY — and so `/search "a b"` cannot quietly become two
 * arguments.
 */

describe("splitArgs", () => {
  it("keeps a quoted query together", () => {
    expect(splitArgs('/search "double charge retry"')).toEqual(["/search", "double charge retry"]);
  });
  it("drops the quotes and keeps the rest", () => {
    expect(splitArgs('/audit fail "https://a.b/c?d=1"')).toEqual([
      "/audit",
      "fail",
      "https://a.b/c?d=1",
    ]);
  });
  it("collapses runs of spaces", () => {
    expect(splitArgs("  /map   src  ")).toEqual(["/map", "src"]);
  });
});

describe("parseHubLine", () => {
  it("treats an empty line as nothing to do", () => {
    expect(parseHubLine("   ")).toEqual({ kind: "empty" });
  });

  it("leaves on exit, /exit, quit and /quit", () => {
    for (const line of ["exit", "/exit", "quit", "/quit"]) {
      expect(parseHubLine(line)).toEqual({ kind: "exit" });
    }
  });

  it("answers help for /help, /? and ?", () => {
    for (const line of ["/help", "/?", "?"]) expect(parseHubLine(line)).toEqual({ kind: "help" });
  });

  it("opens the session history locally", () => {
    expect(parseHubLine("/history")).toEqual({ kind: "history" });
  });

  it("maps a slash command to the real CLI argv", () => {
    expect(parseHubLine("/test --only WORLD")).toEqual({
      kind: "dispatch",
      argv: ["test", "--only", "WORLD"],
    });
    expect(parseHubLine("/audit fail https://x.dev")).toEqual({
      kind: "dispatch",
      argv: ["audit", "fail", "https://x.dev"],
    });
  });

  it("sends plain text to the agent instead of guessing a command", () => {
    expect(parseHubLine("résume ce dépôt")).toEqual({ kind: "agent", prompt: "résume ce dépôt" });
  });

  it("reports an unknown command rather than running something close", () => {
    expect(parseHubLine("/frobnicate")).toEqual({ kind: "unknown", command: "/frobnicate" });
  });

  it("is case-insensitive on the command", () => {
    expect(parseHubLine("/WHOAMI")).toEqual({ kind: "dispatch", argv: ["whoami"] });
  });

  it("only routes the billing page to the browser", () => {
    expect(hubWebPath("/billing")).toBe("/app/billing");
    // Modules are local commands; sending them to a missing web route was the bug.
    expect(hubWebPath("/modules")).toBeUndefined();
    expect(hubWebPath("/test")).toBeUndefined();
  });

  it("maps module shortcuts to local runs, not to the site", () => {
    expect(parseHubLine("/world")).toEqual({
      kind: "dispatch",
      argv: ["test", "--module", "world"],
    });
    expect(parseHubLine("/flow --only FLOW-1")).toEqual({
      kind: "dispatch",
      argv: ["test", "--module", "flow", "--only", "FLOW-1"],
    });
    expect(parseHubLine("/module exit")).toEqual({
      kind: "dispatch",
      argv: ["module", "exit"],
    });
    expect(parseHubLine("/modules")).toEqual({ kind: "dispatch", argv: ["modules"] });
  });
});

describe("command list", () => {
  it("documents every command it accepts, including the modules and billing", () => {
    const names = HUB_COMMANDS.map((entry) => entry.command);
    for (const required of [
      "/help",
      "/agent",
      "/serve",
      "/history",
      "/test",
      "/modules",
      "/world",
      "/flow",
      "/module",
      "/audit",
      "/billing",
      "/logout",
    ]) {
      expect(names).toContain(required);
    }
    // A command in the list that the parser cannot dispatch would be a lie in /help.
    for (const name of names) {
      const action = parseHubLine(name);
      const routable =
        action.kind === "dispatch" ||
        action.kind === "help" ||
        action.kind === "history" ||
        action.kind === "exit" ||
        hubWebPath(name);
      expect(Boolean(routable)).toBe(true);
    }
  });
});

describe("runHub", () => {
  function harness(lines: (string | null)[]) {
    const written: string[] = [];
    const dispatched: string[][] = [];
    const agents: string[] = [];
    let help = 0;
    const io = {
      ask: async () => lines.shift() ?? null,
      write: (text: string) => written.push(text),
    };
    const deps = {
      dispatch: async (argv: string[]) => {
        dispatched.push(argv);
        return 0;
      },
      agent: async (prompt: string) => {
        agents.push(prompt);
        return 0;
      },
      help: () => {
        help += 1;
      },
      openWeb: (path: string) => written.push(`web:${path}`),
      clear: () => written.push("clear"),
      onError: (message: string) => written.push(`err:${message}`),
    };
    return { io, deps, written, dispatched, agents, stats: () => ({ help }) };
  }

  it("runs commands, agents and the web pages, then stops at the end of input", async () => {
    const h = harness(["", "/whoami", "résume ce code", "/billing", "/help", "/nope", null]);
    const code = await runHub(h.io, h.deps);
    expect(code).toBe(0);
    expect(h.dispatched).toEqual([["whoami"]]);
    expect(h.agents).toEqual(["résume ce code"]);
    expect(h.written).toContain("web:/app/billing");
    expect(h.stats().help).toBe(1);
    expect(h.written.some((line) => line.startsWith("err:Unknown command /nope"))).toBe(true);
  });

  it("leaves immediately on /exit, without running anything else", async () => {
    const h = harness(["/exit", "/whoami"]);
    await runHub(h.io, h.deps);
    expect(h.dispatched).toEqual([]);
  });

  it("survives a command that throws", async () => {
    const h = harness(["/test", "/whoami", null]);
    h.deps.dispatch = async (argv) => {
      h.dispatched.push(argv);
      throw new Error("boom");
    };
    const code = await runHub(h.io, h.deps);
    expect(code).toBe(0);
    expect(h.written.some((line) => line.includes("boom"))).toBe(true);
    expect(h.dispatched).toHaveLength(2);
  });
});
