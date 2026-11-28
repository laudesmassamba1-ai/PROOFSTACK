import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentSession,
  clearStoredProvider,
  keyFingerprint,
  loadSession,
  loadStoredProvider,
  providerFilePath,
  resolveProvider,
  saveSession,
  saveStoredProvider,
  sessionId,
} from "../src/agent-runtime.js";

/**
 * The local agent loop.
 *
 * A real HTTP server stands in for the model, so these tests exercise the actual wire
 * format (tool calls in, tool results back) rather than a mocked function. The point of
 * each test is the guard rail, not the happy path: a refusal must leave the disk
 * untouched, and a write must never happen before its diff was shown.
 */

let root: string;
let home: string;
let server: Server;
let baseUrl: string;
let replies: unknown[] = [];
let received: unknown[] = [];

function startFakeModel(): Promise<void> {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push(JSON.parse(body || "{}"));
      const next = replies.shift() ?? { text: "done" };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(next));
      // `text` replies are wrapped in the OpenAI envelope by the helper below.
    });
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolvePromise();
    });
  });
}

/** An OpenAI-compatible reply carrying one tool call. */
function toolCallReply(name: string, args: unknown, text = "") {
  return {
    choices: [
      {
        message: {
          content: text,
          tool_calls: [
            {
              id: `call_${name}`,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

function textReply(text: string) {
  return { choices: [{ message: { content: text } }], usage: {} };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "proofcore-agentloop-"));
  home = await mkdtemp(join(tmpdir(), "proofcore-home-"));
  process.env.PROOFCORE_CONFIG_HOME = home;
  delete process.env.PROOFCORE_AI_BASE_URL;
  delete process.env.PROOFCORE_AI_MODEL;
  delete process.env.PROOFCORE_AI_KEY;
  replies = [];
  received = [];
  await startFakeModel();
});

afterEach(async () => {
  server.close();
  delete process.env.PROOFCORE_CONFIG_HOME;
  delete process.env.PROOFCORE_AI_BASE_URL;
  delete process.env.PROOFCORE_AI_MODEL;
  delete process.env.PROOFCORE_AI_KEY;
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

const storedModel = {
  baseUrl: "https://api.example/v1",
  model: "m",
  apiKey: "sk_live_secret_value",
};

describe("provider store", () => {
  it("writes a file only its owner can read", async () => {
    const path = await saveStoredProvider(storedModel);
    expect(path).toBe(providerFilePath());
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await loadStoredProvider()).model).toBe("m");
  });

  it("keeps the key out of the file name and out of the environment", async () => {
    await saveStoredProvider(storedModel);
    expect(process.env.PROOFCORE_AI_KEY).toBeUndefined();
    expect(providerFilePath()).not.toContain("sk_live");
  });

  it("treats a corrupt file as unconfigured rather than crashing", async () => {
    await saveStoredProvider(storedModel);
    await writeFile(providerFilePath(), "{not json", "utf8");
    await expect(loadStoredProvider()).resolves.toEqual({});
  });

  it("clears the stored provider and keeps the restrictive mode", async () => {
    await saveStoredProvider(storedModel);
    await clearStoredProvider();
    expect(await loadStoredProvider()).toEqual({});
    expect((await stat(providerFilePath())).mode & 0o777).toBe(0o600);
  });

  it("shows only the tail of a key, never the key", () => {
    expect(keyFingerprint("sk_live_secret_value")).toBe("…alue");
    expect(keyFingerprint("ab")).toBe("…");
  });
});

describe("provider resolution", () => {
  it("names every missing variable instead of guessing a provider", async () => {
    await expect(resolveProvider()).rejects.toThrow(
      /PROOFCORE_AI_BASE_URL.*PROOFCORE_AI_MODEL.*PROOFCORE_AI_KEY/
    );
  });

  it("prefers the environment over the stored profile", async () => {
    await saveStoredProvider({
      baseUrl: "https://stored.example/v1",
      model: "stored-model",
      apiKey: "k1",
    });
    process.env.PROOFCORE_AI_BASE_URL = "https://env.example/v1";
    process.env.PROOFCORE_AI_MODEL = "env-model";
    process.env.PROOFCORE_AI_KEY = "k2";
    const provider = await resolveProvider();
    expect(provider.baseUrl).toBe("https://env.example/v1");
    expect(provider.model).toBe("env-model");
  });

  it("treats an exported empty variable as unset instead of hiding the stored model", async () => {
    await saveStoredProvider({
      baseUrl: "https://stored.example/v1",
      model: "stored-model",
      apiKey: "stored-key",
    });
    process.env.PROOFCORE_AI_BASE_URL = "";
    process.env.PROOFCORE_AI_MODEL = "";
    process.env.PROOFCORE_AI_KEY = "";
    const provider = await resolveProvider();
    expect(provider.baseUrl).toBe("https://stored.example/v1");
    expect(provider.model).toBe("stored-model");
  });

  it("keeps the relay cookie and account metadata from a synced profile", async () => {
    await saveStoredProvider({
      baseUrl: "https://site.example/api/v1/ai/relay",
      model: "account-model",
      apiKey: "",
      relay: true,
      sessionCookie: "ps_session=account-cookie",
      source: "account",
      accountApiUrl: "https://site.example",
      providerLabel: "Groq",
    });
    const provider = await resolveProvider();
    expect(provider).toMatchObject({
      relay: true,
      sessionCookie: "ps_session=account-cookie",
      source: "account",
      providerLabel: "Groq",
    });
  });

  it("does not carry the relay cookie to an explicit local provider", async () => {
    await saveStoredProvider({
      baseUrl: "https://site.example/api/v1/ai/relay",
      model: "account-model",
      apiKey: "",
      relay: true,
      sessionCookie: "ps_session=account-cookie",
    });
    const provider = await resolveProvider({
      baseUrl: "http://localhost:8765/v1",
      model: "local",
      apiKey: "local-key",
    });
    expect(provider.relay).toBeUndefined();
    expect(provider.sessionCookie).toBeUndefined();
  });
});

describe("agent loop", () => {
  const provider = () => ({ baseUrl, model: "test-model", apiKey: "test-key" });

  it("runs a read-only tool without asking and feeds the result back", async () => {
    await writeFile(join(root, "hello.ts"), "export const answer = 42;\n", "utf8");
    replies = [
      toolCallReply("read_file", { path: "hello.ts" }),
      textReply("The file exports answer."),
    ];
    const approvals: string[] = [];
    const session = new AgentSession({
      root,
      provider: provider(),
      approve: async (request) => {
        approvals.push(request.tool);
        return true;
      },
    });

    const result = await session.send("What does hello.ts export?");

    expect(result.toolCalls).toBe(1);
    expect(approvals).toEqual([]);
    expect(result.text).toContain("answer");
    const toolMessage = result.messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("export const answer = 42");
  });

  it("does not write a file the developer refused", async () => {
    replies = [
      toolCallReply("write_file", { path: "danger.ts", content: "oops", apply: true }),
      textReply("Understood, I will not write it."),
    ];
    const session = new AgentSession({ root, provider: provider(), approve: async () => false });

    const result = await session.send("Create danger.ts");

    expect(result.refused).toBe(1);
    await expect(readFile(join(root, "danger.ts"), "utf8")).rejects.toThrow();
    const refusal = result.messages.find((message) => message.role === "tool");
    expect(refusal?.content).toContain("refused");
  });

  it("shows the real diff before the write is approved", async () => {
    await writeFile(join(root, "target.ts"), "const a = 1;\n", "utf8");
    replies = [
      toolCallReply("write_file", { path: "target.ts", content: "const a = 2;\n", apply: true }),
      textReply("Updated."),
    ];
    let previewed = "";
    const session = new AgentSession({
      root,
      provider: provider(),
      approve: async (request) => {
        previewed = request.preview ?? "";
        return true;
      },
    });

    await session.send("Change a to 2");

    expect(previewed).toContain("-const a = 1;");
    expect(previewed).toContain("+const a = 2;");
    expect(await readFile(join(root, "target.ts"), "utf8")).toBe("const a = 2;\n");
  });

  it("refuses an unknown tool name and tells the model why", async () => {
    replies = [toolCallReply("rm_rf", { path: "/" }), textReply("I cannot do that.")];
    const session = new AgentSession({ root, provider: provider(), approve: async () => true });

    const result = await session.send("Delete everything");

    const message = result.messages.find((entry) => entry.role === "tool");
    expect(message?.content).toContain('Unknown tool "rm_rf"');
  });

  it("keeps a path outside the workspace out of reach even when approved", async () => {
    replies = [toolCallReply("read_file", { path: "../../../etc/passwd" }), textReply("Denied.")];
    const session = new AgentSession({ root, provider: provider(), approve: async () => true });

    const result = await session.send("Read /etc/passwd");
    const message = result.messages.find((entry) => entry.role === "tool");
    // The refusal comes from the runner, not from the prompt: approval cannot widen it.
    expect(message?.content).toMatch(/escapes|outside|Cannot read/i);
  });

  it("sends the tool schemas to the model, so it knows what exists", async () => {
    replies = [textReply("Nothing to do.")];
    const session = new AgentSession({ root, provider: provider(), approve: async () => true });
    await session.send("hello");
    const body = received[0] as { tools?: { function: { name: string } }[] };
    const names = (body.tools ?? []).map((tool) => tool.function.name);
    expect(names).toContain("read_file");
    expect(names).toContain("apply_patch");
    expect(names).toContain("inspect_page");
    expect(names.length).toBeGreaterThanOrEqual(23);
  });

  it("stops calling tools after the step budget instead of looping forever", async () => {
    // A model that always asks for one more read would otherwise never return.
    replies = Array.from({ length: 40 }, () => toolCallReply("list_files", {}));
    const session = new AgentSession({
      root,
      provider: provider(),
      approve: async () => true,
      maxSteps: 3,
    });

    const result = await session.send("loop");
    expect(result.toolCalls).toBeLessThanOrEqual(3);
  });
});

describe("anthropic wire format", () => {
  it("parses tool_use blocks and sends input_schema", async () => {
    await writeFile(join(root, "notes.md"), "# Notes\n", "utf8");
    replies = [
      {
        content: [
          { type: "text", text: "Let me look." },
          { type: "tool_use", id: "tu_1", name: "read_file", input: { path: "notes.md" } },
        ],
        usage: { input_tokens: 12, output_tokens: 4 },
      },
      { content: [{ type: "text", text: "It is a heading." }], usage: {} },
    ];
    const session = new AgentSession({
      root,
      provider: { baseUrl, model: "claude-test", apiKey: "k", kind: "anthropic" },
      approve: async () => true,
    });

    const result = await session.send("Read notes.md");

    expect(result.text).toContain("heading");
    const body = received[0] as { tools?: { input_schema?: unknown }[]; system?: string };
    expect(body.tools?.[0]).toHaveProperty("input_schema");
    expect(body.system).toContain("PROOFCORE");
    const toolMessage = result.messages.find((entry) => entry.role === "tool");
    expect(toolMessage?.toolCallId).toBe("tu_1");
  });
});

describe("sessions", () => {
  it("resumes a conversation with its history intact", async () => {
    const id = sessionId("first prompt");
    const messages = [
      { role: "system" as const, content: "rules" },
      { role: "user" as const, content: "first prompt" },
      { role: "assistant" as const, content: "done" },
    ];
    await saveSession(root, id, messages, { model: "test-model" });
    const loaded = await loadSession(root, id);
    expect(loaded).toEqual(messages);
  });

  it("returns undefined for an unknown session instead of inventing a history", async () => {
    await expect(loadSession(root, "does-not-exist")).resolves.toBeUndefined();
  });

  it("derives the session id from the prompt, not from the clock", () => {
    expect(sessionId("same")).toBe(sessionId("same"));
    expect(sessionId("same")).not.toBe(sessionId("other"));
  });
});

describe("sub-agents", () => {
  const provider = () => ({ baseUrl, model: "test-model", apiKey: "test-key" });

  it("runs a real nested session and returns its report, not a narrated promise", async () => {
    await writeFile(join(root, "hello.ts"), "export const hello = 1;\n", "utf8");

    // Turn 1: the parent delegates instead of doing the reading itself.
    replies.push(
      toolCallReply("delegate", { question: "What does hello.ts export?", scope: "hello.ts" }),
      // Turn 2 (inside the sub-agent): it reads the file for real.
      toolCallReply("read_file", { path: "hello.ts" }),
      // Turn 3 (inside the sub-agent): it reports.
      textReply("hello.ts exports `hello = 1` at line 1."),
      // Turn 4 (parent): answers from the report.
      textReply("The sub-agent confirms hello.ts exports hello = 1.")
    );

    const session = new AgentSession({ root, provider: provider(), approve: async () => true });
    const result = await session.send("Check what hello.ts exports.");

    // The nested session really called the model: four round trips, not one.
    expect(received).toHaveLength(4);
    const report = result.messages.find(
      (message) => message.role === "tool" && message.content.includes("Rapport du sous-agent")
    );
    expect(report?.content).toContain("exports `hello = 1`");
    expect(result.text).toContain("confirms");
    // The sub-agent receives its question once, not once as history and again as the
    // turn being sent.
    const subRequest = received[1] as { messages: { role: string; content: string }[] };
    expect(subRequest.messages.filter((message) => message.role === "user")).toHaveLength(1);
  });

  it("refuses every mutation inside a sub-agent, so it reviews instead of editing", async () => {
    replies.push(
      toolCallReply("delegate", { question: "Rewrite hello.ts to use let." }),
      // The sub-agent tries to write. It must be refused without asking a human.
      toolCallReply("write_file", { path: "hello.ts", content: "export let hello = 1;\n" }),
      textReply("I cannot edit; the file is unchanged."),
      textReply("Sub-agent finished.")
    );

    const approvals: string[] = [];
    const session = new AgentSession({
      root,
      provider: provider(),
      approve: async (request) => {
        approvals.push(request.tool);
        return true;
      },
    });

    await session.send("Please rewrite hello.ts.");
    // The parent was never asked to approve the sub-agent's write.
    expect(approvals).toEqual([]);
    await expect(readFile(join(root, "hello.ts"), "utf8")).rejects.toThrow();
  });

  it("lets the agent decide to remember a fact, and writes it where the next session reads it", async () => {
    replies.push(
      toolCallReply("remember", {
        kind: "convention",
        text: "All amounts are stored in XOF, never as floats.",
      }),
      textReply("Noted.")
    );

    const session = new AgentSession({ root, provider: provider(), approve: async () => true });
    await session.send("We charge in XOF.");

    const memory = JSON.parse(await readFile(join(root, ".proofcore", "memory.json"), "utf8")) as {
      facts: { kind: string; text: string }[];
    };
    expect(memory.facts).toHaveLength(1);
    expect(memory.facts[0]?.kind).toBe("convention");
    expect(memory.facts[0]?.text).toContain("XOF, never as floats");
  });

  it("does not let a sub-agent start its own sub-agent", async () => {
    replies.push(
      toolCallReply("delegate", { question: "Investigate the config." }),
      toolCallReply("delegate", { question: "Go deeper." }),
      textReply("No delegation from here."),
      textReply("Done.")
    );

    const session = new AgentSession({ root, provider: provider(), approve: async () => true });
    const result = await session.send("Investigate.");

    // Depth is capped: the nested session asked for a sub-agent, was refused, and still
    // reported — one report reached the parent, never a second level.
    expect(received).toHaveLength(4);
    const reports = result.messages.filter(
      (message) => message.role === "tool" && message.content.includes("Rapport du sous-agent")
    );
    expect(reports).toHaveLength(1);
    // And the nested turn did not itself contain a nested report.
    expect(reports[0]?.content?.match(/Rapport du sous-agent/g)).toHaveLength(1);
  });
});
