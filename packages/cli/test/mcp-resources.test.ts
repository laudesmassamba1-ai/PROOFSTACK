import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getMcpPrompt,
  mcpPromptDescriptors,
  mcpResourceDescriptors,
  ProofcoreMcpServer,
  readMcpResource,
} from "../src/mcp-server.js";

/**
 * The read-only half of the MCP surface.
 *
 * Resources let a client attach the project state or the last report; prompts give it a
 * protocol to follow instead of a bare tool list. Both are held to the same honesty rule
 * as the tools: a report that does not exist is an error, never empty content.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "proofcore-mcp-res-"));
  await writeFile(
    join(dir, "proofcore.config.json"),
    JSON.stringify({
      project: { name: "Fixture App", baseUrl: "https://fixture.example" },
      output: { dir: "reports", formats: ["json"] },
    }),
    "utf8"
  );
});

function server(): ProofcoreMcpServer {
  return new ProofcoreMcpServer({ cwd: dir });
}

async function call(
  instance: ProofcoreMcpServer,
  method: string,
  params?: Record<string, unknown>
): Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string } }> {
  const raw = await instance.handleMessage(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) })
  );
  return JSON.parse(raw ?? "{}");
}

describe("MCP resources", () => {
  it("advertises resources and prompts during the handshake", async () => {
    const response = await call(server(), "initialize", { protocolVersion: "2025-06-18" });
    const capabilities = response.result?.capabilities as Record<string, unknown>;
    expect(capabilities.tools).toBeDefined();
    expect(capabilities.resources).toBeDefined();
    expect(capabilities.prompts).toBeDefined();
  });

  it("lists the three resources a client can attach", async () => {
    const response = await call(server(), "resources/list");
    const resources = response.result?.resources as { uri: string }[];
    expect(resources.map((resource) => resource.uri)).toEqual([
      "proofcore://project/summary",
      "proofcore://report/latest",
      "proofcore://instructions",
    ]);
    expect(mcpResourceDescriptors().every((resource) => resource.mimeType.length > 0)).toBe(true);
  });

  it("reads the project summary from the real configuration", async () => {
    const response = await call(server(), "resources/read", {
      uri: "proofcore://project/summary",
    });
    const contents = response.result?.contents as { text: string }[];
    const summary = JSON.parse(contents[0]?.text ?? "{}") as {
      project: { name: string };
    };
    expect(summary.project.name).toBe("Fixture App");
  });

  it("serves the stored report once it exists, and refuses before that", async () => {
    const missing = await call(server(), "resources/read", {
      uri: "proofcore://report/latest",
    });
    expect(missing.error?.code).toBe(-32602);

    await mkdir(join(dir, "reports"), { recursive: true });
    await writeFile(
      join(dir, "reports", "run.json"),
      JSON.stringify({ status: "PASSED", findings: [] }),
      "utf8"
    );
    const response = await call(server(), "resources/read", {
      uri: "proofcore://report/latest",
    });
    const contents = response.result?.contents as { text: string }[];
    expect(JSON.parse(contents[0]?.text ?? "{}")).toMatchObject({ status: "PASSED" });
  });

  it("refuses an unknown resource by uri", async () => {
    const response = await call(server(), "resources/read", { uri: "proofcore://secrets" });
    expect(response.error?.code).toBe(-32602);
  });

  it("returns no resource templates rather than inventing one", async () => {
    const response = await call(server(), "resources/templates/list");
    expect(response.result?.resourceTemplates).toEqual([]);
  });
});

describe("MCP prompts", () => {
  it("lists the four guided workflows", async () => {
    const response = await call(server(), "prompts/list");
    const prompts = response.result?.prompts as { name: string }[];
    expect(prompts.map((prompt) => prompt.name)).toEqual([
      "audit_target",
      "explain_findings",
      "fix_finding",
      "release_check",
    ]);
    expect(mcpPromptDescriptors().every((prompt) => prompt.description.length > 0)).toBe(true);
  });

  it("fills audit_target with the requested target and modules", async () => {
    const prompt = await getMcpPrompt(
      "audit_target",
      { target: "https://shop.example", modules: "world,flow" },
      dir
    );
    expect(prompt.messages[0]?.content.text).toContain("https://shop.example");
    expect(prompt.messages[0]?.content.text).toContain("world,flow");
  });

  it("refuses fix_finding without naming a finding", async () => {
    const response = await call(server(), "prompts/get", { name: "fix_finding", arguments: {} });
    expect(response.error?.code).toBe(-32602);
  });

  it("refuses an unknown prompt", async () => {
    const response = await call(server(), "prompts/get", { name: "do_everything" });
    expect(response.error?.code).toBe(-32602);
  });

  it("never turns a skipped check into a pass in the release protocol", async () => {
    const prompt = await getMcpPrompt("release_check", {}, dir);
    expect(prompt.messages[0]?.content.text).toContain("never a pass");
  });
});
