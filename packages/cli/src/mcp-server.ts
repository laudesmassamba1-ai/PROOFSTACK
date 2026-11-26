import { readFile, stat, writeFile } from "node:fs/promises";
import { arch, cpus, homedir, hostname, platform, release, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { browsers } from "@proofcore/adapter-browser";
import { renderReport } from "@proofcore/adapter-reporting";
import { type LoadedConfig, loadConfig } from "@proofcore/config";
import type { ModuleId, ReportFormat, TestRun } from "@proofcore/contracts";
import { Logger, ProofCoreError, stableStringify } from "@proofcore/core";
import { ENGINE_VERSION, runEngine } from "@proofcore/engine";
import {
  analyzeImage,
  buildSemanticIndex,
  completeCode,
  debugScript,
  generateSvg,
  inspectPage,
  semanticSearch,
} from "./agent-extra-tools.js";
import {
  browserClose,
  browserCookies,
  browserEval,
  browserGoto,
  browserInteract,
  browserOpen,
  browserPages,
  browserPdf,
  browserScreenshot,
  browserSnapshot,
  webFetch,
} from "./browser-tools.js";
import {
  applyPatch,
  gitBlame,
  gitBranch,
  gitCommit,
  gitDiff,
  gitLog,
  gitShow,
  gitStage,
  gitStatus,
  gitUnstage,
  listFiles,
  mapArchitecture,
  readFileSlice,
  runCommand,
  searchCode,
  type ToolContext,
  writeFileWithDiff,
} from "./code-tools.js";
import {
  copyPath,
  deletePath,
  editFile,
  listDirectory,
  makeDirectory,
  movePath,
  pathInfo,
} from "./fs-tools.js";
import { httpRequest } from "./net-tools.js";
import { assembleProviders, blockingSafetyWarnings } from "./providers.js";
import { runInSandbox } from "./sandbox.js";
import { runShell } from "./shell-tools.js";

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
    {
      name: "edit_file",
      description:
        "Replace an exact string in a file. Without apply:true it writes nothing and returns the diff. Refuses an ambiguous match unless replaceAll is explicit, and never guesses where an edit belongs.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          oldString: {
            type: "string",
            description: "Exact text to replace, including indentation.",
          },
          newString: { type: "string" },
          replaceAll: { type: "boolean" },
          apply: { type: "boolean", description: "Actually write. Default false (diff only)." },
        },
        required: ["path", "oldString", "newString"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "delete_path",
      description:
        "Delete a file or directory, listing every entry that would disappear. A non-empty directory needs recursive:true; without apply:true nothing is deleted. Refuses the workspace root and .git.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          recursive: { type: "boolean" },
          apply: { type: "boolean", description: "Actually delete. Default false (preview)." },
        },
        required: ["path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "move_path",
      description:
        "Rename or move a file or directory. Shows the move first; requires apply:true. Refuses an existing destination unless overwrite:true.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          overwrite: { type: "boolean" },
          apply: { type: "boolean" },
        },
        required: ["from", "to"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "copy_path",
      description:
        "Copy a file or directory recursively. Shows the copy first; requires apply:true. Refuses an existing destination unless overwrite:true.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          overwrite: { type: "boolean" },
          apply: { type: "boolean" },
        },
        required: ["from", "to"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "make_directory",
      description: "Create a directory and its parents. Idempotent.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: "path_info",
      description:
        "Facts about a path: type, size, modification time, line count and SHA-256 for files. Read-only.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "list_directory",
      description:
        "Every entry directly under a directory, with type and size. Narrower and faster than list_files when the exact folder is known. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 2000 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
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

    {
      name: "run_shell",
      description:
        "Run a shell command line through the platform's shell: pipelines, &&, variables, project scripts. Unlike run_command it is not allowlisted; it can do anything the user can. Use it when the allowlist is too narrow.",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The command line, e.g. `pnpm lint && pnpm typecheck`.",
          },
          cwd: {
            type: "string",
            description: "Working directory, relative to the workspace root.",
          },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 },
        },
        required: ["command"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },

    {
      name: "run_sandboxed",
      description:
        "Run a command inside a throwaway container: no network, read-only root, no capabilities. Refuses rather than falling back to an unisolated run.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string" },
          args: { type: "array", items: { type: "string" } },
          writable: { type: "boolean", description: "Mount the workspace read-write." },
          network: { type: "boolean", description: "Allow outbound network." },
          image: { type: "string" },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 },
        },
        required: ["command"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
    },

    {
      name: "http_request",
      description:
        "Make an HTTP request from this machine and return status, headers and body. Reaches localhost on purpose: check a local server, test a webhook, read an API or an OpenAPI file. Any method, any headers, JSON or raw body.",
      inputSchema: {
        type: "object",
        properties: {
          method: {
            type: "string",
            enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
          },
          url: { type: "string" },
          headers: { type: "object", additionalProperties: { type: "string" } },
          body: { type: "string" },
          json: { description: "A JSON body; sets content-type when absent." },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 },
          maxBytes: { type: "integer", minimum: 1000, maximum: 20000000 },
          redirect: { type: "string", enum: ["follow", "manual", "error"] },
        },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    {
      name: "web_fetch",
      description:
        "Read a URL without a browser: the server's response as text, Markdown, headings and links. Fast and honest — it does not execute JavaScript; use browser_open when the page needs it.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          maxChars: { type: "integer", minimum: 500, maximum: 200000 },
          headers: { type: "object", additionalProperties: { type: "string" } },
        },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },

    // ------------------------------------------------- code intelligence
    {
      name: "build_semantic_index",
      description:
        "Build the local semantic index of the project (chunked TF-IDF). Required before semantic_search. Deterministic, no key, no network.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false },
    },
    {
      name: "semantic_search",
      description:
        "Ranked search over the local index: finds the code that talks about a concept even when the words differ from the identifier. Lexical ranking, reproducible, verifiable.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "complete_code",
      description:
        "Complete code at a cursor position. Uses the configured provider when a key is present, otherwise real project symbols from the index.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          line: { type: "integer", minimum: 1 },
          column: { type: "integer", minimum: 1 },
          maxCompletions: { type: "integer", minimum: 1, maximum: 5 },
        },
        required: ["path", "line"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },

    // ------------------------------------------------------- browser surface
    {
      name: "browser_open",
      description:
        "Open a page in a real Chromium (the machine's own browser, driven over the DevTools Protocol). Returns the page id and a snapshot: visible text, headings, links and every interactive control with a stable ref. Use the refs with browser_interact.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Address to open; https:// is added when missing." },
          width: { type: "integer", minimum: 200, maximum: 3840 },
          height: { type: "integer", minimum: 200, maximum: 2400 },
          includeText: {
            type: "boolean",
            description: "Include the page's visible text. Default true.",
          },
          waitMs: { type: "integer", minimum: 0, maximum: 30000 },
          executablePath: {
            type: "string",
            description: "Pin a Chromium binary instead of discovering one.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    {
      name: "browser_goto",
      description:
        "Navigate an open page: a new URL, back, forward or reload. Returns the resulting state (url, title, HTTP status, history availability).",
      inputSchema: {
        type: "object",
        properties: {
          page: {
            type: "string",
            description: "Page id from browser_open; optional with a single page.",
          },
          url: { type: "string" },
          back: { type: "boolean" },
          forward: { type: "boolean" },
          reload: { type: "boolean" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    {
      name: "browser_snapshot",
      description:
        "What the page currently shows: text, headings, links, interactive controls with refs, scroll position, alerts, console messages and failed requests. Refs are re-issued here; always snapshot after the page changes.",
      inputSchema: {
        type: "object",
        properties: {
          page: { type: "string" },
          text: { type: "boolean", description: "Include visible text. Default true." },
          maxElements: { type: "integer", minimum: 1, maximum: 600 },
          includeHidden: {
            type: "boolean",
            description: "Include hidden controls (menus, dialogs).",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    {
      name: "browser_interact",
      description:
        "Act on the page as a person would: click a ref/selector/point, type, press a key, scroll, hover, select options, check a box, set a value, upload files, or wait for a condition. Actions are real input events, so JavaScript frameworks see them.",
      inputSchema: {
        type: "object",
        properties: {
          page: { type: "string" },
          action: {
            type: "string",
            enum: [
              "click",
              "type",
              "press",
              "scroll",
              "hover",
              "select",
              "check",
              "uncheck",
              "set_value",
              "upload",
              "wait",
              "focus",
            ],
          },
          ref: { type: "string", description: "Ref from browser_snapshot, e.g. e12." },
          selector: { type: "string", description: "CSS selector, used when no ref is given." },
          x: { type: "integer" },
          y: { type: "integer" },
          text: { type: "string", description: "Text for type, or text to wait for." },
          key: { type: "string", description: "Key for press, e.g. Enter, Tab, Control+a." },
          value: { type: "string", description: "Value for set_value or select." },
          values: {
            type: "array",
            items: { type: "string" },
            description: "Option values for select.",
          },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Files to upload, relative to the workspace.",
          },
          clear: { type: "boolean", description: "Clear the field before typing." },
          submit: { type: "boolean", description: "Press Enter after typing." },
          expression: {
            type: "string",
            description: "Boolean expression to poll when action is wait.",
          },
          dy: { type: "integer" },
          dx: { type: "integer" },
          timeoutMs: { type: "integer", minimum: 100, maximum: 120000 },
          button: { type: "string", enum: ["left", "right", "middle"] },
          clickCount: { type: "integer", minimum: 1, maximum: 3 },
        },
        required: ["action"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    {
      name: "browser_eval",
      description:
        "Evaluate JavaScript in the page and return its value. The escape hatch for what the named actions do not cover; the expression runs with the page's own origin and can change the page.",
      inputSchema: {
        type: "object",
        properties: {
          page: { type: "string" },
          expression: { type: "string" },
        },
        required: ["expression"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    {
      name: "browser_screenshot",
      description:
        "Save a PNG/JPEG of the page, viewport or full page, and return its path. The image is written to disk, not inlined: a base64 screenshot would spend the turn's context on pixels.",
      inputSchema: {
        type: "object",
        properties: {
          page: { type: "string" },
          path: {
            type: "string",
            description: "Output path, relative to the workspace. Default: .proofcore/browser/.",
          },
          fullPage: { type: "boolean" },
          format: { type: "string", enum: ["png", "jpeg"] },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: "browser_pdf",
      description: "Print the current page to a PDF and return its path.",
      inputSchema: {
        type: "object",
        properties: { page: { type: "string" }, path: { type: "string" } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: "browser_cookies",
      description:
        "Read, set or clear the browser profile's cookies. Use it to carry a real session into a page, or to sign the engine out.",
      inputSchema: {
        type: "object",
        properties: {
          page: { type: "string" },
          action: { type: "string", enum: ["get", "set", "clear"] },
          cookies: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                value: { type: "string" },
                domain: { type: "string" },
                url: { type: "string" },
                path: { type: "string" },
                secure: { type: "boolean" },
                httpOnly: { type: "boolean" },
                sameSite: { type: "string", enum: ["Strict", "Lax", "None"] },
                expires: { type: "number" },
              },
              required: ["name", "value"],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: "browser_pages",
      description:
        "Open browser pages and the engine's state: whether a Chromium was found, which binary, and what is open. Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: "browser_close",
      description:
        "Close one page, or every page. The browser process stays warm briefly, then exits.",
      inputSchema: {
        type: "object",
        properties: { page: { type: "string" }, all: { type: "boolean" } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: "inspect_page",
      description:
        "Open a page in a real Chromium and return what actually happened: console messages, page errors, network statuses, DOM counts, accessibility findings, optional full-page screenshot.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          screenshotPath: { type: "string" },
          viewport: {
            type: "object",
            properties: { width: { type: "integer" }, height: { type: "integer" } },
            additionalProperties: false,
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    {
      name: "analyze_image",
      description:
        "Send a screenshot or mockup to a vision-capable model and get a description plus visible defects. Refuses text-only models.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, prompt: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    {
      name: "generate_svg",
      description:
        "Generate a deterministic SVG icon or placeholder. Same input, same bytes — reviewable in a diff, unlike model-generated markup.",
      inputSchema: {
        type: "object",
        properties: {
          shape: { type: "string", enum: ["icon", "placeholder", "spinner", "wave"] },
          name: { type: "string" },
          size: { type: "integer", minimum: 8, maximum: 2048 },
          color: { type: "string" },
          background: { type: "string" },
          label: { type: "string" },
          outPath: { type: "string", description: "Write the SVG to this file as well." },
        },
        required: ["shape"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: "debug_script",
      description:
        "Run a Node script under the inspector, stop at a breakpoint and return the real scopes. Reports usedCdp:false when it could not attach.",
      inputSchema: {
        type: "object",
        properties: {
          file: { type: "string" },
          breakpointLine: { type: "integer", minimum: 1 },
          args: { type: "array", items: { type: "string" } },
          expression: { type: "string" },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 },
        },
        required: ["file", "breakpointLine"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
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
    {
      name: "git_branch",
      description: "List branches, or create and switch to one. Read-only when listing.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "create", "switch"] },
          name: { type: "string" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: "git_show",
      description: "A commit's message, stats and diff (optionally for one path). Read-only.",
      inputSchema: {
        type: "object",
        properties: { ref: { type: "string" }, path: { type: "string" } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "git_blame",
      description: "Line attribution for a file, optionally for a line range. Read-only.",
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
      name: "git_stage",
      description: "Stage explicit paths. Staging everything is refused.",
      inputSchema: {
        type: "object",
        properties: { paths: { type: "array", items: { type: "string" }, minItems: 1 } },
        required: ["paths"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: "git_unstage",
      description: "Unstage explicit paths, keeping the working-tree change.",
      inputSchema: {
        type: "object",
        properties: { paths: { type: "array", items: { type: "string" }, minItems: 1 } },
        required: ["paths"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: "system_info",
      description:
        "The machine this agent runs on: platform, architecture, versions, CPU, memory, workspace root, available browser. Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
  ];
}

interface CookieInput {
  name: string;
  value: string;
  domain?: string;
  url?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  expires?: number;
}

/** One tool invocation, returning JSON-safe data or throwing a typed error. */
export type McpToolHandler = (
  args: Record<string, unknown>,
  context: { cwd: string }
) => Promise<unknown>;

export interface McpResourceDescriptor {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpPromptDescriptor {
  name: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
}

/**
 * Resources are the read-only half of the server: a client can attach the project state
 * or the last report to its context without spending a tool call.
 */
export function mcpResourceDescriptors(): McpResourceDescriptor[] {
  return [
    {
      uri: "proofcore://project/summary",
      name: "Project summary",
      description:
        "What this project is configured to analyse: target, environment, enabled modules, output directory and warnings.",
      mimeType: "application/json",
    },
    {
      uri: "proofcore://report/latest",
      name: "Latest report",
      description:
        "The most recent stored JSON report. Answers an error when nothing has run yet — there is no empty report to attach.",
      mimeType: "application/json",
    },
    {
      uri: "proofcore://instructions",
      name: "Analysis protocol",
      description:
        "The server's own instructions: the order in which to call the tools, and the honesty rules that apply to every answer.",
      mimeType: "text/plain",
    },
  ];
}

export function mcpPromptDescriptors(): McpPromptDescriptor[] {
  return [
    {
      name: "audit_target",
      description:
        "Analyse the configured target end to end: doctor, config validation, a real run, then a report read from disk.",
      arguments: [
        {
          name: "target",
          description: "The URL to analyse. Defaults to the configured target.",
          required: false,
        },
        {
          name: "modules",
          description: "Comma-separated module ids to focus on. Defaults to the configured set.",
          required: false,
        },
      ],
    },
    {
      name: "explain_findings",
      description:
        "Read the last stored report and explain each finding: what was observed, why it matters, what to do.",
      arguments: [
        {
          name: "audience",
          description: "Who reads the answer: developer, product or client.",
          required: false,
        },
      ],
    },
    {
      name: "fix_finding",
      description:
        "Work one finding: read its evidence, find the code that causes it, propose a fix, then re-run to prove it.",
      arguments: [
        {
          name: "finding",
          description: "The finding id or title to fix.",
          required: true,
        },
      ],
    },
    {
      name: "release_check",
      description: "Decide whether a release is safe to ship, from a real run and nothing else.",
      arguments: [],
    },
  ];
}

/** One resource, read for real. A missing report is an error, never empty content. */
export async function readMcpResource(
  uri: string,
  cwd: string
): Promise<{ uri: string; mimeType: string; text: string }> {
  const known = mcpResourceDescriptors().find((resource) => resource.uri === uri);
  if (!known) {
    throw new McpProtocolError(ERR_INVALID_PARAMS, "Unknown resource: " + uri);
  }
  if (uri === "proofcore://project/summary") {
    const summary = await projectSummary(cwd);
    return { uri, mimeType: known.mimeType, text: stableStringify(summary, 2) };
  }
  if (uri === "proofcore://report/latest") {
    try {
      const report = (await lastReport({ format: "json" }, cwd)) as { content: string };
      return { uri, mimeType: known.mimeType, text: report.content };
    } catch (error) {
      // A resource that is not there yet is a bad request from the client's point of
      // view, not an internal bug: say so with the reason it can act on.
      throw new McpProtocolError(
        ERR_INVALID_PARAMS,
        error instanceof Error ? error.message : "No stored report yet."
      );
    }
  }
  return { uri, mimeType: known.mimeType, text: PROOFCORE_MCP_INSTRUCTIONS };
}

/** A prompt is a user message the client can fill from an argument, not a hidden tool. */
export async function getMcpPrompt(
  name: string,
  args: Record<string, unknown>,
  _cwd: string
): Promise<{
  description: string;
  messages: { role: "user"; content: { type: "text"; text: string } }[];
}> {
  const known = mcpPromptDescriptors().find((prompt) => prompt.name === name);
  if (!known) {
    throw new McpProtocolError(ERR_INVALID_PARAMS, "Unknown prompt: " + name);
  }
  const text = (lines: string[]): { role: "user"; content: { type: "text"; text: string } } => ({
    role: "user",
    content: { type: "text", text: lines.join("\n") },
  });
  const target = typeof args.target === "string" && args.target.trim() ? args.target.trim() : null;
  const modules =
    typeof args.modules === "string" && args.modules.trim() ? args.modules.trim() : null;
  const audience =
    typeof args.audience === "string" && args.audience.trim() ? args.audience.trim() : "developer";

  switch (name) {
    case "audit_target":
      return {
        description: known.description,
        messages: [
          text([
            "Analyse " + (target ?? "the configured target") + " with PROOFCORE.",
            "1. Call project_summary, then doctor.",
            "2. Call validate_config and fix what it reports before running.",
            "3. Call run_tests" + (modules ? " with modules: " + modules : "") + ".",
            "4. Call last_report and read it from disk; do not paraphrase a result you did not read.",
            "Report every check, including the ones that passed, and state what was not measured.",
          ]),
        ],
      };
    case "explain_findings":
      return {
        description: known.description,
        messages: [
          text([
            "Read the last PROOFCORE report with last_report, then explain it for a " +
              audience +
              ".",
            "For each non-passing check give: what was observed, why it matters, the impact, the scope, how to verify it, and the fix.",
            "Never invent a finding that the report does not contain, and never quote a score without its coverage.",
          ]),
        ],
      };
    case "fix_finding": {
      const finding = typeof args.finding === "string" ? args.finding.trim() : "";
      if (!finding) {
        throw new McpProtocolError(ERR_INVALID_PARAMS, "fix_finding needs a finding id or title.");
      }
      return {
        description: known.description,
        messages: [
          text([
            "Fix the PROOFCORE finding: " + finding + ".",
            "1. Read the last report and quote the evidence for this finding.",
            "2. Find the code that causes it with search_code and read_file.",
            "3. Propose the smallest fix, and wait for approval before writing.",
            "4. Re-run the check with run_tests and compare: a fix is proven only by a passing re-measurement.",
          ]),
        ],
      };
    }
    case "release_check":
      return {
        description: known.description,
        messages: [
          text([
            "Decide whether this release is safe to ship, using PROOFCORE only.",
            "Run doctor, validate_config and run_tests. Then read last_report.",
            "Answer SHIP, SHIP WITH RISKS or DO NOT SHIP, and justify it with the checks and their coverage.",
            "If a check could not run, say which one; a skipped check is never a pass.",
          ]),
        ],
      };
    default:
      throw new McpProtocolError(ERR_INVALID_PARAMS, "Unknown prompt: " + name);
  }
}

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
    case "edit_file":
      return editFile(toolContext(context.cwd), {
        path: String(args.path ?? ""),
        oldString: String(args.oldString ?? ""),
        newString: String(args.newString ?? ""),
        ...(args.replaceAll === true ? { replaceAll: true } : {}),
        ...(args.apply === true ? { apply: true } : {}),
      });
    case "delete_path":
      return deletePath(toolContext(context.cwd), {
        path: String(args.path ?? ""),
        ...(args.recursive === true ? { recursive: true } : {}),
        ...(args.apply === true ? { apply: true } : {}),
      });
    case "move_path":
      return movePath(toolContext(context.cwd), {
        from: String(args.from ?? ""),
        to: String(args.to ?? ""),
        ...(args.overwrite === true ? { overwrite: true } : {}),
        ...(args.apply === true ? { apply: true } : {}),
      });
    case "copy_path":
      return copyPath(toolContext(context.cwd), {
        from: String(args.from ?? ""),
        to: String(args.to ?? ""),
        ...(args.overwrite === true ? { overwrite: true } : {}),
        ...(args.apply === true ? { apply: true } : {}),
      });
    case "make_directory":
      return makeDirectory(toolContext(context.cwd), { path: String(args.path ?? "") });
    case "path_info":
      return pathInfo(toolContext(context.cwd), { path: String(args.path ?? "") });
    case "list_directory":
      return listDirectory(toolContext(context.cwd), {
        ...(typeof args.path === "string" ? { path: args.path } : {}),
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      });
    case "run_command":
      return runCommand(toolContext(context.cwd), {
        command: String(args.command ?? ""),
        args: Array.isArray(args.args) ? args.args.map(String) : [],
        ...(typeof args.cwd === "string" ? { cwd: args.cwd } : {}),
        ...(typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {}),
      });
    case "run_shell":
      return runShell({
        command: String(args.command ?? ""),
        cwd: context.cwd,
        ...(typeof args.cwd === "string" ? { cwd: resolve(context.cwd, args.cwd) } : {}),
        ...(typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {}),
      });
    case "http_request":
      return httpRequest({
        url: String(args.url ?? ""),
        ...(typeof args.method === "string" ? { method: args.method } : {}),
        ...(args.headers && typeof args.headers === "object"
          ? { headers: args.headers as Record<string, string> }
          : {}),
        ...(typeof args.body === "string" ? { body: args.body } : {}),
        ...(args.json !== undefined ? { json: args.json } : {}),
        ...(typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {}),
        ...(typeof args.maxBytes === "number" ? { maxBytes: args.maxBytes } : {}),
        ...(args.redirect === "follow" || args.redirect === "manual" || args.redirect === "error"
          ? { redirect: args.redirect }
          : {}),
      });
    case "web_fetch":
      return webFetch(toolContext(context.cwd), {
        url: String(args.url ?? ""),
        ...(typeof args.maxChars === "number" ? { maxChars: args.maxChars } : {}),
        ...(args.headers && typeof args.headers === "object"
          ? { headers: args.headers as Record<string, string> }
          : {}),
      });
    case "run_sandboxed":
      return runInSandbox(context.cwd, {
        command: String(args.command ?? ""),
        args: Array.isArray(args.args) ? args.args.map(String) : [],
        ...(args.writable === true ? { writable: true } : {}),
        ...(args.network === true ? { network: true } : {}),
        ...(typeof args.image === "string" ? { image: args.image } : {}),
        ...(typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {}),
      });
    case "build_semantic_index":
      return buildSemanticIndex(toolContext(context.cwd));
    case "semantic_search":
      return semanticSearch(toolContext(context.cwd), {
        query: String(args.query ?? ""),
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      });
    case "complete_code":
      return completeCode(toolContext(context.cwd), {
        path: String(args.path ?? ""),
        line: Number(args.line ?? 1),
        ...(typeof args.column === "number" ? { column: args.column } : {}),
        ...(typeof args.maxCompletions === "number" ? { maxCompletions: args.maxCompletions } : {}),
      });
    case "browser_open":
      return browserOpen(toolContext(context.cwd), {
        ...(typeof args.url === "string" ? { url: args.url } : {}),
        ...(typeof args.width === "number" ? { width: args.width } : {}),
        ...(typeof args.height === "number" ? { height: args.height } : {}),
        ...(args.includeText === false ? { includeText: false } : {}),
        ...(typeof args.waitMs === "number" ? { waitMs: args.waitMs } : {}),
        ...(typeof args.executablePath === "string" ? { executablePath: args.executablePath } : {}),
      });
    case "browser_goto":
      return browserGoto(toolContext(context.cwd), {
        ...(typeof args.page === "string" ? { page: args.page } : {}),
        ...(typeof args.url === "string" ? { url: args.url } : {}),
        ...(args.back === true ? { back: true } : {}),
        ...(args.forward === true ? { forward: true } : {}),
        ...(args.reload === true ? { reload: true } : {}),
      });
    case "browser_snapshot":
      return browserSnapshot(toolContext(context.cwd), {
        ...(typeof args.page === "string" ? { page: args.page } : {}),
        ...(args.text === false ? { text: false } : {}),
        ...(typeof args.maxElements === "number" ? { maxElements: args.maxElements } : {}),
        ...(args.includeHidden === true ? { includeHidden: true } : {}),
      });
    case "browser_interact":
      return browserInteract(toolContext(context.cwd), {
        ...(typeof args.page === "string" ? { page: args.page } : {}),
        action: String(args.action ?? "") as Parameters<typeof browserInteract>[1]["action"],
        ...(typeof args.ref === "string" ? { ref: args.ref } : {}),
        ...(typeof args.selector === "string" ? { selector: args.selector } : {}),
        ...(typeof args.x === "number" ? { x: args.x } : {}),
        ...(typeof args.y === "number" ? { y: args.y } : {}),
        ...(typeof args.text === "string" ? { text: args.text } : {}),
        ...(typeof args.key === "string" ? { key: args.key } : {}),
        ...(typeof args.value === "string" ? { value: args.value } : {}),
        ...(Array.isArray(args.values) ? { values: args.values.map(String) } : {}),
        ...(Array.isArray(args.files) ? { files: args.files.map(String) } : {}),
        ...(args.clear === true ? { clear: true } : {}),
        ...(args.submit === true ? { submit: true } : {}),
        ...(typeof args.expression === "string" ? { expression: args.expression } : {}),
        ...(typeof args.dy === "number" ? { dy: args.dy } : {}),
        ...(typeof args.dx === "number" ? { dx: args.dx } : {}),
        ...(typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {}),
        ...(args.button === "left" || args.button === "right" || args.button === "middle"
          ? { button: args.button }
          : {}),
        ...(typeof args.clickCount === "number" ? { clickCount: args.clickCount } : {}),
      });
    case "browser_eval":
      return browserEval(toolContext(context.cwd), {
        ...(typeof args.page === "string" ? { page: args.page } : {}),
        expression: String(args.expression ?? ""),
      });
    case "browser_screenshot":
      return browserScreenshot(toolContext(context.cwd), {
        ...(typeof args.page === "string" ? { page: args.page } : {}),
        ...(typeof args.path === "string" ? { path: args.path } : {}),
        ...(args.fullPage === true ? { fullPage: true } : {}),
        ...(args.format === "png" || args.format === "jpeg" ? { format: args.format } : {}),
      });
    case "browser_pdf":
      return browserPdf(toolContext(context.cwd), {
        ...(typeof args.page === "string" ? { page: args.page } : {}),
        ...(typeof args.path === "string" ? { path: args.path } : {}),
      });
    case "browser_cookies":
      return browserCookies(toolContext(context.cwd), {
        ...(typeof args.page === "string" ? { page: args.page } : {}),
        ...(args.action === "get" || args.action === "set" || args.action === "clear"
          ? { action: args.action }
          : {}),
        ...(Array.isArray(args.cookies)
          ? {
              cookies: (args.cookies as CookieInput[]).filter(
                (cookie) =>
                  cookie && typeof cookie.name === "string" && typeof cookie.value === "string"
              ),
            }
          : {}),
      });
    case "browser_pages":
      return browserPages(toolContext(context.cwd));
    case "browser_close":
      return browserClose(toolContext(context.cwd), {
        ...(typeof args.page === "string" ? { page: args.page } : {}),
        ...(args.all === true ? { all: true } : {}),
      });
    case "inspect_page":
      return inspectPage({
        url: String(args.url ?? ""),
        ...(typeof args.screenshotPath === "string" ? { screenshotPath: args.screenshotPath } : {}),
        ...(args.viewport && typeof args.viewport === "object"
          ? { viewport: args.viewport as { width: number; height: number } }
          : {}),
      });
    case "analyze_image":
      return analyzeImage(toolContext(context.cwd), {
        path: String(args.path ?? ""),
        ...(typeof args.prompt === "string" ? { prompt: args.prompt } : {}),
        provider: await providerFromEnv(),
      });
    case "generate_svg": {
      const result = generateSvg({
        shape: (args.shape as "icon" | "placeholder" | "spinner" | "wave") ?? "icon",
        ...(typeof args.name === "string" ? { name: args.name } : {}),
        ...(typeof args.size === "number" ? { size: args.size } : {}),
        ...(typeof args.color === "string" ? { color: args.color } : {}),
        ...(typeof args.background === "string" ? { background: args.background } : {}),
        ...(typeof args.label === "string" ? { label: args.label } : {}),
      });
      if (typeof args.outPath === "string") {
        await writeFile(resolve(context.cwd, args.outPath), result.svg, "utf8");
        return { ...result, path: args.outPath };
      }
      return result;
    }
    case "debug_script":
      return debugScript(toolContext(context.cwd), {
        file: String(args.file ?? ""),
        breakpointLine: Number(args.breakpointLine ?? 1),
        ...(Array.isArray(args.args) ? { args: args.args.map(String) } : {}),
        ...(typeof args.expression === "string" ? { expression: args.expression } : {}),
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
    case "git_branch":
      return gitBranch(toolContext(context.cwd), {
        ...(args.action === "list" || args.action === "create" || args.action === "switch"
          ? { action: args.action }
          : {}),
        ...(typeof args.name === "string" ? { name: args.name } : {}),
      });
    case "git_show":
      return gitShow(toolContext(context.cwd), {
        ...(typeof args.ref === "string" ? { ref: args.ref } : {}),
        ...(typeof args.path === "string" ? { path: args.path } : {}),
      });
    case "git_blame":
      return gitBlame(toolContext(context.cwd), {
        path: String(args.path ?? ""),
        ...(typeof args.startLine === "number" ? { startLine: args.startLine } : {}),
        ...(typeof args.endLine === "number" ? { endLine: args.endLine } : {}),
      });
    case "git_stage":
      return gitStage(toolContext(context.cwd), {
        paths: Array.isArray(args.paths) ? args.paths.map(String) : [],
      });
    case "git_unstage":
      return gitUnstage(toolContext(context.cwd), {
        paths: Array.isArray(args.paths) ? args.paths.map(String) : [],
      });
    case "system_info":
      return systemInfo(context.cwd);
    default:
      throw new ProofCoreError({
        message: `Unknown tool: ${name}`,
        category: "CONFIGURATION",
        code: "unknown_tool",
        details: { name },
      });
  }
}

/**
 * Provider credentials for the tools that need a model.
 *
 * Read from the environment, never from a tool argument: a model must not be able to
 * supply its own key or redirect a request to another endpoint.
 */
async function providerFromEnv(): Promise<{
  baseUrl: string;
  model: string;
  apiKey: string;
  kind?: string;
}> {
  const baseUrl = process.env.PROOFCORE_AI_BASE_URL;
  const model = process.env.PROOFCORE_AI_MODEL;
  const apiKey = process.env.PROOFCORE_AI_KEY;
  if (!baseUrl || !model || !apiKey) {
    throw new ProofCoreError({
      message:
        "This tool needs a model: set PROOFCORE_AI_BASE_URL, PROOFCORE_AI_MODEL and PROOFCORE_AI_KEY.",
      category: "CONFIGURATION",
      code: "ai_not_configured",
    });
  }
  return {
    baseUrl,
    model,
    apiKey,
    ...(process.env.PROOFCORE_AI_KIND ? { kind: process.env.PROOFCORE_AI_KIND } : {}),
  };
}

/** One context for every code tool: the workspace root is the process cwd. */
function toolContext(cwd: string): ToolContext {
  return { root: cwd };
}

async function loadConfigFor(cwd: string): Promise<LoadedConfig> {
  return loadConfig({ cwd, skipValidation: true });
}

/** What machine the agent is on: facts, not a description of the product. */
function systemInfo(cwd: string): Record<string, unknown> {
  const cores = cpus();
  return {
    platform: platform(),
    release: release(),
    arch: arch(),
    hostname: hostname(),
    node: process.versions.node,
    cpu: cores[0]?.model?.trim() ?? null,
    cores: cores.length,
    memoryGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    shell: process.env.SHELL ?? process.env.COMSPEC ?? null,
    cwd,
    home: homedir(),
    browser: browsers.status(),
  };
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
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false },
          },
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
      case "resources/list":
        return { resources: mcpResourceDescriptors() };
      case "resources/templates/list":
        return { resourceTemplates: [] };
      case "resources/read": {
        const uri = typeof params.uri === "string" ? params.uri : "";
        if (!uri) throw new McpProtocolError(ERR_INVALID_PARAMS, "resources/read needs a uri.");
        const content = await readMcpResource(uri, this.cwd);
        return { contents: [content] };
      }
      case "prompts/list":
        return { prompts: mcpPromptDescriptors() };
      case "prompts/get": {
        const name = typeof params.name === "string" ? params.name : "";
        if (!name) throw new McpProtocolError(ERR_INVALID_PARAMS, "prompts/get needs a name.");
        const promptArgs = (params.arguments ?? {}) as Record<string, unknown>;
        return await getMcpPrompt(name, promptArgs, this.cwd);
      }
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
  // Responses are written in the order requests arrived. The queue is the point: a slow
  // tool (a real run) must not let a later, faster answer overtake it, or a client that
  // matches responses to its own request order is left reading the wrong result.
  let queue: Promise<void> = Promise.resolve();
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    queue = queue.then(async () => {
      const response = await server.handleMessage(trimmed);
      if (response !== null) write(response);
    });
  });
  // stdio lifecycle is the client's; no timeout here by design.
  await new Promise<void>((resolve) => {
    rl.on("close", () => resolve());
    process.stdin.on("end", () => resolve());
  });
}
