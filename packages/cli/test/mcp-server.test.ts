import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PROOFCORE_MCP_INSTRUCTIONS, ProofcoreMcpServer } from "../src/mcp-server.js";

/**
 * The MCP server is PROOFCORE's contract with external AI agents. These tests
 * pin the protocol surface (initialize handshake, tools/list, tools/call) and
 * the honesty rules: a tool that cannot run answers with an error result, never
 * with invented output; a tool that fails at the protocol layer gets a JSON-RPC
 * error; notifications get no response.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "proofcore-mcp-"));
  await writeFile(
    join(dir, "proofcore.config.json"),
    JSON.stringify({ project: { name: "Fixture App", baseUrl: "https://fixture.example" } }),
    "utf8"
  );
});

function server(): ProofcoreMcpServer {
  return new ProofcoreMcpServer({ cwd: dir });
}

async function call(
  instance: ProofcoreMcpServer,
  id: number,
  method: string,
  params?: Record<string, unknown>
): Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string } }> {
  const raw = await instance.handleMessage(
    JSON.stringify(params ? { jsonrpc: "2.0", id, method, params } : { jsonrpc: "2.0", id, method })
  );
  expect(raw).not.toBeNull();
  return JSON.parse(raw ?? "{}");
}

describe("proofcore MCP server", () => {
  it("negotiates the protocol and identifies itself", async () => {
    const response = await call(server(), 1, "initialize", {
      protocolVersion: "2025-06-18",
      clientInfo: { name: "test", version: "0" },
    });
    expect(response.result?.protocolVersion).toBe("2025-06-18");
    const capabilities = response.result?.capabilities as Record<string, unknown> | undefined;
    expect(capabilities).toEqual({
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
    });
    const info = response.result?.serverInfo as { name: string; version: string };
    expect(info).toBeTruthy();
    expect(info.name).toBe("proofcore");
    expect(info.version).toBeTruthy();
    expect(response.result?.instructions).toBe(PROOFCORE_MCP_INSTRUCTIONS);
  });

  it("downgrades to the newest version it speaks for an unknown protocol version", async () => {
    const response = await call(server(), 1, "initialize", { protocolVersion: "2999-01-01" });
    expect(response.result?.protocolVersion).toBe("2025-06-18");
  });

  it("returns no response for notifications", async () => {
    const raw = await server().handleMessage(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    );
    expect(raw).toBeNull();
  });

  it("answers malformed JSON with a protocol error, then keeps serving", async () => {
    const instance = server();
    const bad = JSON.parse((await instance.handleMessage("not json")) ?? "{}");
    expect(bad.error?.code).toBe(-32602);
    const good = await call(instance, 2, "tools/list");
    expect(Array.isArray(good.result?.tools)).toBe(true);
  });

  it("serves the code tools over the protocol, not just in the descriptor list", async () => {
    const listed = await call(server(), 1, "tools/call", {
      name: "list_files",
      arguments: { depth: 1, limit: 5 },
    });
    const listPayload = listed.result?.content?.[0]?.text ?? "";
    expect(listed.result?.isError).not.toBe(true);
    expect(listPayload).toContain("entries");

    // write_file without apply must describe a change and change nothing.
    const diff = await call(server(), 2, "tools/call", {
      name: "write_file",
      arguments: { path: ".proofcore-mcp-dry-run.txt", content: "x" },
    });
    const diffPayload = JSON.parse(diff.result?.content?.[0]?.text ?? "{}") as {
      applied: boolean;
      diff: string;
      created: boolean;
    };
    expect(diffPayload.applied).toBe(false);
    expect(diffPayload.created).toBe(true);
    expect(diffPayload.diff).toContain("+++ b/.proofcore-mcp-dry-run.txt");
    expect(existsSync(join(dir, ".proofcore-mcp-dry-run.txt"))).toBe(false);
  });

  it("lists exactly the advertised tools with schemas", async () => {
    const response = await call(server(), 1, "tools/list");
    const toolsRaw = response.result?.tools;
    expect(Array.isArray(toolsRaw)).toBe(true);
    const tools = toolsRaw as { name: string; inputSchema: object }[];
    expect(tools.map((t) => t.name)).toEqual([
      // PROOFCORE's own analysis surface
      "project_summary",
      "doctor",
      "validate_config",
      "run_tests",
      "last_report",
      // codebase, runtime and git: what lets the assistant work on code instead of
      // speculating about it
      "list_files",
      "read_file",
      "search_code",
      "map_architecture",
      "write_file",
      "apply_patch",
      // filesystem beyond whole-file writes
      "edit_file",
      "delete_path",
      "move_path",
      "copy_path",
      "make_directory",
      "path_info",
      "list_directory",
      "run_command",
      "run_shell",
      "run_sandboxed",
      "http_request",
      "web_fetch",
      // code intelligence, browser surface, assets and debugging
      "build_semantic_index",
      "semantic_search",
      "complete_code",
      "browser_open",
      "browser_goto",
      "browser_snapshot",
      "browser_interact",
      "browser_eval",
      "browser_screenshot",
      "browser_pdf",
      "browser_cookies",
      "browser_pages",
      "browser_close",
      "inspect_page",
      "analyze_image",
      "generate_svg",
      "debug_script",
      // git
      "git_status",
      "git_diff",
      "git_log",
      "git_commit",
      "git_branch",
      "git_show",
      "git_blame",
      "git_stage",
      "git_unstage",
      "system_info",
    ]);
    for (const tool of tools) expect(Object.keys(tool.inputSchema).length).toBeGreaterThan(0);
  });

  it("rejects unknown methods with -32601", async () => {
    const response = await call(server(), 1, "sampling/createMessage");
    expect(response.error?.code).toBe(-32601);
  });

  it("project_summary reflects the real configuration", async () => {
    const response = await call(server(), 1, "tools/call", {
      name: "project_summary",
      arguments: {},
    });
    expect(response.result?.isError).toBe(false);
    const content = response.result?.content as { type: string; text: string }[] | undefined;
    expect(Array.isArray(content)).toBe(true);
    const text = content[0].text;
    const data = JSON.parse(text) as { project: { name: string }; enabledModules: string[] };
    expect(data.project.name).toBe("Fixture App");
    expect(data.enabledModules).toContain("world");
  });

  it("doctor runs real checks against the fixture project", async () => {
    const response = await call(server(), 1, "tools/call", { name: "doctor", arguments: {} });
    const content = response.result?.content as { text: string }[] | undefined;
    expect(Array.isArray(content)).toBe(true);
    const data = JSON.parse(content[0].text) as {
      checks: { name: string; status: string }[];
      problems: number;
    };
    const names = data.checks.map((c) => c.name);
    expect(names).toContain("node");
    expect(names).toContain("config");
    expect(names).toContain("module:world");
  });

  it("validate_config passes the fixture and reports its warnings", async () => {
    const response = await call(server(), 1, "tools/call", {
      name: "validate_config",
      arguments: {},
    });
    const content = response.result?.content as { text: string }[] | undefined;
    expect(Array.isArray(content)).toBe(true);
    const data = JSON.parse(content[0].text) as {
      ok: boolean;
      project?: string;
      errors?: unknown[];
    };
    expect(data.ok).toBe(true);
    expect(data.project).toBe("Fixture App");
    expect(data.errors).toBeUndefined();
  });

  it("last_report answers with an explicit error when nothing has run", async () => {
    const response = await call(server(), 1, "tools/call", { name: "last_report", arguments: {} });
    // A missing report is a *result* (isError) the agent can read, not a crash.
    expect(response.result?.isError).toBe(true);
    const content = response.result?.content as { text: string }[] | undefined;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].text).toContain("no_report");
  });

  it("unknown tool calls fail as tool results the agent can read", async () => {
    const response = await call(server(), 1, "tools/call", {
      name: "does_not_exist",
      arguments: {},
    });
    expect(response.result?.isError).toBe(true);
    const content = response.result?.content as { text: string }[] | undefined;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].text).toContain("unknown_tool");
  });
});
