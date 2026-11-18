import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderReport } from "@proofcore/adapter-reporting";
import { type LoadedConfig, loadConfig } from "@proofcore/config";
import type { ModuleId, ReportFormat, TestRun } from "@proofcore/contracts";
import { Logger, ProofCoreError, stableStringify } from "@proofcore/core";
import { ENGINE_VERSION, runEngine } from "@proofcore/engine";
import {
  applyPatch,
  gitCommit,
  gitDiff,
  gitLog,
  gitStatus,
  listFiles,
  mapArchitecture,
  readFileSlice,
  runCommand,
  searchCode,
  type ToolContext,
  writeFileWithDiff,
} from "./code-tools.js";
import { assembleProviders, blockingSafetyWarnings } from "./providers.js";

/**
 * PROOFCORE's MCP server: `proofcore mcp`.
 *
 * Exposes the same analysis surface the CLI uses to an external AI client —
 * Claude Code, the Gemini CLI, any MCP-speaking agent. One JSON-RPC message per
 * line on stdio, the transport the MCP spec prescribes and our own client
 * (packages/adapters/ai/src/mcp.ts) already speaks.
 *
 * The design rules are the product's rules:
 * - **Honesty.** Every tool result comes from actually running the doctor, the
 *   validator or the engine. A tool that cannot run answers with an error, not
 *   with invented output.
 * - **Least authority.** The server is read-mostly. Its one stateful tool,
 *   `run_tests`, executes checks against the configured target — which is the
 *   product's purpose — and is annotated as non-read-only so a client can ask
 *   the user before calling it. It writes reports only under the project's own
 *   output directory. No other file writes, no network beyond the configured
 *   target, no secrets read beyond what the check itself needs.
 * - **The decision belongs to the human.** `serverInfo.instructions` carries the
 *   analysis protocol for the AI; approval behaviour stays the client's choice.
 */

export const PROOFCORE_MCP_SERVER_NAME = "proofcore";
export const PROOFCORE_MCP_SERVER_VERSION = "0.1.0";
export const PROOFCORE_MCP_INSTRUCTIONS = [
  "PROOFCORE analyses software quality and reliability through three modules:",
  "WORLD (global compatibility), FLOW (transaction/journey reliability),",
  "EXIT (data portability and export integrity).",
  "",
  "Analysis protocol:",
  "1. Start with `project_summary` to learn what is configured.",
  "2. Run `doctor` for runtime and wiring problems.",
  "3. Use `validate_config` when configuration issues are suspected.",
  "4. Only run `run_tests` when the user asked for a check — it sends real",
  "   requests to the configured target. Report findings verbatim, including",
  "   the ones that passed, and never claim a check ran that did not.",
  "5. Use `last_report` for the most recent stored run.",
].join("\n");

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL = -32603;

/** Tools the server advertises. `annotations` follow the MCP hints. */
export function mcpToolDescriptors(): McpToolDescriptor[] {
  return [
    {
      name: "project_summary",
      description:
        "What PROOFCORE is configured to analyse here: project name, target URL, environment, enabled modules and their wiring.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: "doctor",
      description:
        "Runtime and wiring diagnostics: Node version, configuration file, per-module target status, AI integration state. Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: "validate_config",
      description:
        "Validate proofcore.config strictly and return every problem found, or an explicit pass.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: "run_tests",
      description:
        "Run PROOFCORE modules (world, flow, exit) against the configured target and return the per-case results and findings. Sends real requests to the target — use when the user asked for a check.",
      inputSchema: {
        type: "object",
        properties: {
          modules: {
            type: "array",
            items: { type: "string", enum: ["world", "flow", "exit"] },
            description: "Subset of modules to run. Defaults to the enabled ones.",
          },
          onlyCases: {
            type: "array",
            items: { type: "string" },
            description: "Restrict to cases whose id, category or name matches.",
          },
          seed: { type: "integer", description: "Deterministic seed for the run." },
          profiles: {
            type: "array",
            items: { type: "string" },
            description: "WORLD locale profile ids (e.g. fr-FR, ar-EG).",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    {
      name: "last_report",
      description:
        "The most recent stored run report (JSON), rendered by `run_tests` or the CLI. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["json", "junit", "text", "html"] },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    // ------------------------------------------------------------ codebase
    {
      name: "list_files",
      description:
        "Project tree (directories first, node_modules/build output excluded). Use before guessing where anything lives. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Subdirectory, relative to the workspace root." },
          depth: { type: "integer", minimum: 1, maximum: 8 },
          limit: { type: "integer", minimum: 1, maximum: 2000 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "read_file",
      description:
        "Read a file with line numbers (paginated). Refuses binary files and paths outside the workspace. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          startLine: { type: "integer", minimum: 1 },
          endLine: { type: "integer", minimum: 1 },
        },
        required: ["path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "search_code",
      description:
        "Search the workspace for a literal string or a regular expression, returning file, line and text. This is real file search, not a similarity guess. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          regex: { type: "boolean", description: "Treat the query as a regular expression." },
          caseSensitive: { type: "boolean" },
          glob: { type: "string", description: "Only files ending with this suffix, e.g. .ts" },
          maxResults: { type: "integer", minimum: 1, maximum: 500 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "map_architecture",
      description:
        "Build the import graph of the project and render it as a Mermaid diagram, plus the most used external packages. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          maxFiles: { type: "integer", minimum: 1, maximum: 1000 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },

    // --------------------------------------------------------------- edits
    {
      name: "write_file",
      description:
        "Write a file. Without apply:true it writes NOTHING and returns a unified diff to review. Call again with apply:true to commit the change.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          apply: { type: "boolean", description: "Actually write. Default false (diff only)." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "apply_patch",
      description:
        "Apply a unified diff. Refused entirely when a hunk context does not match the file — it never guesses. Without apply:true it only validates.",
      inputSchema: {
        type: "object",
        properties: {
          patch: { type: "string", description: "Unified diff (---/+++/@@)." },
          apply: { type: "boolean", description: "Actually write. Default false (validate only)." },
        },
        required: ["patch"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },

    // ------------------------------------------------------------- runtime
    {
      name: "run_command",
      description:
        "Run one allowlisted command (node, pnpm, npm, python, pytest, cargo, docker, tsc, vitest, git, grep…) without a shell, with a timeout and capped output. Use it to compile, test, and read the real error.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string" },
          args: { type: "array", items: { type: "string" } },
          cwd: { type: "string" },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 },
        },
        required: ["command"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },

    // ----------------------------------------------------------------- git
    {
      name: "git_status",
      description: "Branch and working-tree state (git status --short --branch). Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: "git_diff",
      description: "Working-tree or staged diff, optionally for one path. Read-only.",
      inputSchema: {
        type: "object",
        properties: { staged: { type: "boolean" }, path: { type: "string" } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "git_log",
      description: "Recent commits, one line each. Read-only.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "git_commit",
      description:
        "Create a branch and commit an explicit list of files. Staging everything is refused. Without apply:true it returns the command it would run.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string" },
          paths: { type: "array", items: { type: "string" }, minItems: 1 },
          branch: { type: "string" },
          apply: { type: "boolean" },
        },
        required: ["message", "paths"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
  ];
}

/** One tool invocation, returning JSON-safe data or throwing a typed error. */
export type McpToolHandler = (
  args: Record<string, unknown>,
  context: { cwd: string }
) => Promise<unknown>;

export async function handleMcpToolCall(
  name: string,
  args: Record<string, unknown>,
  context: { cwd: string }
): Promise<unknown> {
  switch (name) {
    case "project_summary":
      return projectSummary(context.cwd);
    case "doctor":
      return doctor(context.cwd);
    case "validate_config":
      return validateConfig(context.cwd);
    case "run_tests":
      return runTests(args, context.cwd);
    case "last_report":
      return lastReport(args, context.cwd);
    case "list_files":
      return listFiles(toolContext(context.cwd), {
        ...(typeof args.path === "string" ? { path: args.path } : {}),
        ...(typeof args.depth === "number" ? { depth: args.depth } : {}),
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      });
    case "read_file":
      return readFileSlice(toolContext(context.cwd), {
        path: String(args.path ?? ""),
        ...(typeof args.startLine === "number" ? { startLine: args.startLine } : {}),
        ...(typeof args.endLine === "number" ? { endLine: args.endLine } : {}),
      });
    case "search_code":
      return searchCode(toolContext(context.cwd), {
        query: String(args.query ?? ""),
        ...(args.regex === true ? { regex: true } : {}),
        ...(args.caseSensitive === true ? { caseSensitive: true } : {}),
        ...(typeof args.glob === "string" ? { glob: args.glob } : {}),
        ...(typeof args.maxResults === "number" ? { maxResults: args.maxResults } : {}),
      });
    case "map_architecture":
      return mapArchitecture(toolContext(context.cwd), {
        ...(typeof args.path === "string" ? { path: args.path } : {}),
        ...(typeof args.maxFiles === "number" ? { maxFiles: args.maxFiles } : {}),
      });
    case "write_file":
      return writeFileWithDiff(toolContext(context.cwd), {
        path: String(args.path ?? ""),
        content: String(args.content ?? ""),
        ...(args.apply === true ? { apply: true } : {}),
      });
    case "apply_patch":
      return applyPatch(toolContext(context.cwd), {
        patch: String(args.patch ?? ""),
        ...(args.apply === true ? { apply: true } : {}),
      });
    case "run_command":
      return runCommand(toolContext(context.cwd), {
        command: String(args.command ?? ""),
        ...(Array.isArray(args.args) ? { args: args.args.map(String) } : {}),
        ...(typeof args.cwd === "string" ? { cwd: args.cwd } : {}),
        ...(typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {}),
      });
    case "git_status":
      return gitStatus(toolContext(context.cwd));
    case "git_diff":
      return gitDiff(toolContext(context.cwd), {
        ...(args.staged === true ? { staged: true } : {}),
        ...(typeof args.path === "string" ? { path: args.path } : {}),
      });
    case "git_log":
      return gitLog(toolContext(context.cwd), {
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      });
    case "git_commit":
      return gitCommit(toolContext(context.cwd), {
        message: String(args.message ?? ""),
        paths: Array.isArray(args.paths) ? args.paths.map(String) : [],
        ...(typeof args.branch === "string" ? { branch: args.branch } : {}),
        ...(args.apply === true ? { apply: true } : {}),
      });
    default:
      throw new ProofCoreError({
        message: `Unknown tool: ${name}`,
        category: "CONFIGURATION",
        code: "unknown_tool",
        details: { name },
      });
  }
}

/** One context for every code tool: the workspace root is the process cwd. */
function toolContext(cwd: string): ToolContext {
  return { root: cwd };
}

async function loadConfigFor(cwd: string): Promise<LoadedConfig> {
  return loadConfig({ cwd, skipValidation: true });
}

async function projectSummary(cwd: string): Promise<unknown> {
  const loaded = await loadConfigFor(cwd);
  const { config } = loaded;
  return {
    project: config.project,
    environment: config.environment,
    enabledModules: config.enabledModules,
    sync: config.sync?.enabled ? "enabled" : "disabled",
    output: config.output.dir,
    warnings: loaded.warnings,
    proofcoreVersion: PROOFCORE_MCP_SERVER_VERSION,
    engineVersion: ENGINE_VERSION,
  };
}

async function doctor(cwd: string): Promise<unknown> {
  const checks: { name: string; status: "ok" | "warn" | "fail"; detail: string }[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node",
    status: nodeMajor >= 22 ? "ok" : "fail",
    detail: nodeMajor >= 22 ? `Node ${process.versions.node}` : "Node >= 22 required",
  });

  let loaded: LoadedConfig | null = null;
  try {
    loaded = await loadConfigFor(cwd);
    checks.push({ name: "config", status: "ok", detail: loaded.path });
  } catch (error) {
    checks.push({
      name: "config",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  if (loaded) {
    const { config } = loaded;
    checks.push({
      name: "project",
      status: "ok",
      detail: `"${config.project.name}" → ${config.project.baseUrl}`,
    });
    for (const moduleId of config.enabledModules) {
      const hasTarget =
        moduleId === "world"
          ? config.modules.world.target.kind !== "none"
          : moduleId === "flow"
            ? Boolean((config.modules.flow as { target?: unknown }).target)
            : Boolean((config.modules.exit as { target?: unknown }).target);
      checks.push({
        name: `module:${moduleId}`,
        status: hasTarget ? "ok" : "warn",
        detail: hasTarget ? "wired" : "no usable target configured",
      });
    }
    if (config.ai.enabled) {
      checks.push({
        name: "ai",
        status: "ok",
        detail: `autonomy=${config.ai.autonomy}, ${config.ai.providers.length} provider(s), ${config.ai.mcpServers.length} MCP server(s)`,
      });
    }
  }

  return { checks, problems: checks.filter((c) => c.status === "fail").length };
}

async function validateConfig(cwd: string): Promise<unknown> {
  try {
    const loaded = await loadConfig({ cwd, skipValidation: false });
    return {
      ok: true,
      path: loaded.path,
      project: loaded.config.project.name,
      enabledModules: loaded.config.enabledModules,
      warnings: loaded.warnings,
    };
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof ProofCoreError ? { details: error.details } : {}),
        },
      ],
    };
  }
}

interface RunTestsResult {
  run: {
    id: string;
    status: TestRun["status"];
    startedAt: string;
    durationMs: number;
    totals: { total: number; passed: number; failed: number; warnings: number; skipped: number };
  };
  findings: {
    id: string;
    module: string;
    severity: string;
    title: string;
    detail: string;
  }[];
  exitCode: number;
  reports: string[];
}

async function runTests(args: Record<string, unknown>, cwd: string): Promise<RunTestsResult> {
  const loaded = await loadConfigFor(cwd);
  const { config } = loaded;

  const requested = Array.isArray(args.modules) ? (args.modules as string[]) : [];
  const modules: ModuleId[] = requested.filter((m): m is ModuleId =>
    ["world", "flow", "exit"].includes(m)
  );
  const onlyCases = Array.isArray(args.onlyCases) ? (args.onlyCases as string[]) : [];
  const profiles = Array.isArray(args.profiles) ? (args.profiles as string[]) : [];
  const seed = typeof args.seed === "number" && Number.isInteger(args.seed) ? args.seed : undefined;

  const unsafe = blockingSafetyWarnings(loaded.warnings);
  if (unsafe.length > 0) {
    throw new ProofCoreError({
      message: `Refusing to run: the configuration is unsafe (${unsafe.join("; ")}). Fix proofcore.config.ts first.`,
      category: "CONFIGURATION",
      code: "unsafe_configuration",
      details: { unsafe },
    });
  }

  const effectiveConfig =
    seed === undefined ? config : { ...config, engine: { ...config.engine, seed } };
  const selected = modules.length > 0 ? modules : config.enabledModules;
  const providers = await assembleProviders(loaded, selected, { profiles });

  const result = await runEngine({
    config: effectiveConfig,
    providers,
    only: selected,
    ...(onlyCases.length === 0 ? {} : { onlyCases }),
    ...(profiles.length === 0 ? {} : { profiles }),
    logger: new Logger({ level: "error" }),
    projectId: `local:${config.project.name}`,
    workspaceId: "local",
    cliVersion: PROOFCORE_MCP_SERVER_VERSION,
    host: {
      platform: process.platform,
      nodeVersion: process.versions.node,
      ci: Boolean(process.env.CI),
    },
  });

  const totals = runTotalsOf(result.run);
  const outputDir = resolve(loaded.root, config.output.dir);
  const reports: string[] = [];
  for (const format of config.output.formats as ReportFormat[]) {
    const fileName =
      format === "json"
        ? config.output.jsonFile
        : format === "junit"
          ? config.output.junitFile
          : format === "html"
            ? config.output.htmlFile
            : `run-${result.run.id}.txt`;
    const path = join(outputDir, fileName);
    await writeFileSafe(
      path,
      renderReport(result.run, format, { projectName: config.project.name })
    );
    reports.push(path);
  }

  return {
    run: {
      id: result.run.id,
      status: result.run.status,
      startedAt: result.run.startedAt,
      durationMs: result.run.durationMs,
      totals,
    },
    findings: (result.run.findings ?? []).map((finding) => ({
      id: finding.id,
      module: finding.module,
      severity: finding.severity,
      title: finding.title,
      detail: finding.detail,
    })),
    exitCode: exitCodeOf(result.run),
    reports,
  };
}

function runTotalsOf(run: TestRun): RunTestsResult["run"]["totals"] {
  // Case results live per module run; the run-level numbers are their sum.
  return run.moduleRuns.reduce(
    (acc, moduleRun) => ({
      total: acc.total + moduleRun.totals.total,
      passed: acc.passed + moduleRun.totals.passed,
      failed: acc.failed + moduleRun.totals.failed + moduleRun.totals.errors,
      warnings: acc.warnings + moduleRun.totals.warnings,
      skipped: acc.skipped + moduleRun.totals.skipped,
    }),
    { total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0 }
  );
}

function exitCodeOf(run: TestRun): number {
  const failed = run.moduleRuns.reduce(
    (sum, moduleRun) => sum + moduleRun.totals.failed + moduleRun.totals.errors,
    0
  );
  return failed > 0 ? 1 : 0;
}

async function writeFileSafe(path: string, content: string): Promise<void> {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function lastReport(args: Record<string, unknown>, cwd: string): Promise<unknown> {
  const loaded = await loadConfigFor(cwd);
  const format = (typeof args.format === "string" ? args.format : "json") as ReportFormat;
  const { config } = loaded;
  const fileName =
    format === "json"
      ? config.output.jsonFile
      : format === "junit"
        ? config.output.junitFile
        : format === "html"
          ? config.output.htmlFile
          : undefined;
  if (!fileName) {
    throw new ProofCoreError({
      message: "text format has no fixed filename; request the json report instead",
      category: "CONFIGURATION",
      code: "unsupported_report_format",
    });
  }
  const path = resolve(loaded.root, config.output.dir, fileName);
  try {
    await stat(path);
  } catch {
    throw new ProofCoreError({
      message: `No stored report at ${path}. Run run_tests or \`proofcore test\` first.`,
      category: "CONFIGURATION",
      code: "no_report",
      details: { path },
    });
  }
  return { path, content: await readFile(path, "utf8") };
}

/**
 * The protocol loop, injectable for tests: `handleMessage` is pure against the
 * JSON-RPC surface, `serve()` only binds it to stdio.
 */
export class ProofcoreMcpServer {
  private readonly cwd: string;

  constructor(options: { cwd?: string } = {}) {
    this.cwd = options.cwd ?? process.cwd();
  }

  async handleMessage(raw: string): Promise<string | null> {
    let message: JsonRpcRequest;
    try {
      message = JSON.parse(raw) as JsonRpcRequest;
    } catch {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: ERR_INVALID_PARAMS, message: "Invalid JSON-RPC message." },
      } satisfies JsonRpcResponse);
    }
    if (message.method.startsWith("notifications/")) return null;
    if (message.id === undefined) return null; // notification without id

    try {
      const result = await this.dispatch(message);
      return JSON.stringify({
        jsonrpc: "2.0",
        id: message.id ?? null,
        result,
      } satisfies JsonRpcResponse);
    } catch (error) {
      const known = error instanceof ProofCoreError;
      return JSON.stringify({
        jsonrpc: "2.0",
        id: message.id ?? null,
        error: {
          code: error instanceof McpProtocolError ? error.code : ERR_INTERNAL,
          message: error instanceof Error ? error.message : String(error),
          ...(known ? { data: { code: error.code, category: error.category } } : {}),
        },
      } satisfies JsonRpcResponse);
    }
  }

  private async dispatch(message: JsonRpcRequest): Promise<unknown> {
    const params = message.params ?? {};
    switch (message.method) {
      case "initialize":
        return {
          protocolVersion: acceptProtocolVersion(params.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: PROOFCORE_MCP_SERVER_NAME,
            version: PROOFCORE_MCP_SERVER_VERSION,
          },
          instructions: PROOFCORE_MCP_INSTRUCTIONS,
        };
      case "ping":
        return {};
      case "tools/list":
        return { tools: mcpToolDescriptors() };
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        if (!name) {
          throw new McpProtocolError(ERR_INVALID_PARAMS, "tools/call needs a tool name.");
        }
        const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
        try {
          const data = await handleMcpToolCall(name, toolArgs, { cwd: this.cwd });
          return {
            content: [{ type: "text", text: stableStringify(data, 2) }],
            isError: false,
          };
        } catch (error) {
          // A tool that ran and failed is a *result* the model can read, not a
          // protocol error: report it with isError so the agent can react.
          return {
            content: [
              {
                type: "text",
                text: stableStringify(
                  {
                    error: error instanceof Error ? error.message : String(error),
                    ...(error instanceof ProofCoreError
                      ? { code: error.code, category: error.category }
                      : {}),
                  },
                  2
                ),
              },
            ],
            isError: true,
          };
        }
      }
      default:
        throw new McpProtocolError(ERR_METHOD_NOT_FOUND, `Unknown method: ${message.method}`);
    }
  }
}

class McpProtocolError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "McpProtocolError";
    this.code = code;
  }
}

const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"];

function acceptProtocolVersion(requested: unknown): string {
  if (typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return requested;
  }
  // The newest version this server speaks; a compliant client negotiates down.
  return "2025-06-18";
}

/** Serve MCP over stdio. One JSON message per line, responses in order. */
export async function serveMcpStdio(server: ProofcoreMcpServer): Promise<void> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, terminal: false });
  const write = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    void server.handleMessage(trimmed).then((response) => {
      if (response !== null) write(response);
    });
  });
  // stdio lifecycle is the client's; no timeout here by design.
  await new Promise<void>((resolve) => {
    rl.on("close", () => resolve());
    process.stdin.on("end", () => resolve());
  });
}
