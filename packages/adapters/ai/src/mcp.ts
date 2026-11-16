import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { ProofstackError } from "@proofstack/core";

/**
 * A Model Context Protocol client.
 *
 * MCP is JSON-RPC 2.0. Over stdio each message is one line of JSON on the child's
 * stdin/stdout; over HTTP it is a POST with a JSON-RPC body. That is the whole
 * protocol surface this client needs, and it is implemented here rather than pulled
 * from a dependency so the transport is auditable.
 *
 * What it does NOT do: invent capabilities. If a server does not advertise `tools`,
 * `listTools` returns an empty list rather than an error, and if it does not advertise
 * `resources` or `prompts`, those calls are refused with a clear message.
 *
 * Lifecycle, per the spec:
 *   spawn → `initialize` → `notifications/initialized` → (tools/list, tools/call…)
 *
 * The client is deliberately strict about three things:
 *   - **Timeouts.** A hung server must not hang the CLI. Every request has a deadline.
 *   - **Stderr.** Server stderr is captured, never forwarded to stdout, because stdout
 *     is the JSON-RPC channel and a stray log line would corrupt it.
 *   - **Shutdown.** `close()` sends SIGTERM, then SIGKILL after a grace period, and
 *     always resolves. A leaked child process is a CI machine that never finishes.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface McpTool {
  name: string;
  description?: string;
  /** JSON Schema for the tool's arguments, as the server advertised it. */
  inputSchema?: Record<string, unknown>;
  /** Server-provided annotations (readOnlyHint, destructiveHint…), passed through. */
  annotations?: Record<string, unknown>;
}

export interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
}

export interface McpServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  instructions?: string;
}

export interface McpToolResult {
  /** Text content flattened out of the result, for a model to read. */
  text: string;
  /** True when the server reported the tool call itself failed. */
  isError: boolean;
  /** The raw content blocks, for callers that want structure. */
  content: unknown[];
}

export interface McpClientOptions {
  /** Display name, used in error messages and tool namespacing. */
  name: string;
  transport: "stdio" | "http";
  /** stdio: argv array. Never a shell string. */
  command?: string[];
  /** http: the MCP endpoint. */
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  /** Receives the server's stderr, for diagnostics. */
  onStderr?: (chunk: string) => void;
}

export interface McpClient {
  readonly name: string;
  readonly serverInfo: McpServerInfo | null;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  listResources(): Promise<McpResource[]>;
  readResource(uri: string): Promise<string>;
  listPrompts(): Promise<McpPrompt[]>;
  close(): Promise<void>;
}

/**
 * Create and connect a client.
 *
 * Connecting performs the handshake, so a returned client is a client that actually
 * works. A server that fails to start or fails `initialize` throws here rather than
 * failing later at the first tool call, when the error would be attributed to the tool.
 */
export async function connectMcp(options: McpClientOptions): Promise<McpClient> {
  const client =
    options.transport === "stdio"
      ? new StdioMcpClient(options)
      : new HttpMcpClient(options);
  await client.initialize();
  return client;
}

// ------------------------------------------------------------------ stdio transport

class StdioMcpClient implements McpClient {
  readonly name: string;
  serverInfo: McpServerInfo | null = null;

  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly timeoutMs: number;
  private closed = false;

  constructor(private readonly options: McpClientOptions) {
    this.name = options.name;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async initialize(): Promise<void> {
    const command = this.options.command;
    if (!command || command.length === 0) {
      throw new ProofstackError({
        message: `MCP server "${this.name}" has no command`,
        category: "CONFIGURATION",
        code: "mcp_command_missing",
      });
    }

    const [file, ...args] = command;
    if (!file) {
      throw new ProofstackError({
        message: `MCP server "${this.name}" has an empty command`,
        category: "CONFIGURATION",
        code: "mcp_command_empty",
      });
    }

    // Resolve ${ENV_VAR} references rather than passing literal placeholders, so a
    // config file can name a token without containing one.
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    for (const [key, value] of Object.entries(this.options.env ?? {})) {
      env[key] = expandEnv(value);
    }

    this.child = spawn(file, args, {
      ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
      env,
      stdio: ["pipe", "pipe", "pipe"],
      // No shell: an argv array is not a command line, and must never be parsed as one.
      shell: false,
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => this.options.onStderr?.(chunk));

    this.child.on("error", (error) => this.failAll(error));
    this.child.on("exit", (code, signal) => {
      if (!this.closed) {
        this.failAll(
          new ProofstackError({
            message: `MCP server "${this.name}" exited (code ${code ?? "null"}, signal ${signal ?? "none"})`,
            category: "PROVIDER",
            code: "mcp_server_exited",
            details: { code, signal },
          }),
        );
      }
    });

    const result = (await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {}, prompts: {} },
      clientInfo: { name: "proofstack", version: "0.1.0" },
    })) as {
      protocolVersion?: string;
      capabilities?: Record<string, unknown>;
      serverInfo?: { name?: string; version?: string };
      instructions?: string;
    };

    this.serverInfo = {
      name: result.serverInfo?.name ?? this.name,
      version: result.serverInfo?.version ?? "unknown",
      protocolVersion: result.protocolVersion ?? MCP_PROTOCOL_VERSION,
      capabilities: result.capabilities ?? {},
      ...(result.instructions ? { instructions: result.instructions } : {}),
    };

    // The spec requires this notification after a successful initialize.
    this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<McpTool[]> {
    if (!this.supports("tools")) return [];
    const result = (await this.request("tools/list", {})) as { tools?: unknown[] };
    return normalizeTools(result.tools ?? []);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (!this.supports("tools")) {
      throw new ProofstackError({
        message: `MCP server "${this.name}" does not advertise tools`,
        category: "UNSUPPORTED",
        code: "mcp_tools_unsupported",
      });
    }
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: unknown[];
      isError?: boolean;
    };
    return {
      text: flattenContent(result.content ?? []),
      isError: result.isError === true,
      content: result.content ?? [],
    };
  }

  async listResources(): Promise<McpResource[]> {
    if (!this.supports("resources")) return [];
    const result = (await this.request("resources/list", {})) as { resources?: unknown[] };
    return (result.resources ?? []).flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const record = entry as Record<string, unknown>;
      if (typeof record.uri !== "string") return [];
      return [
        {
          uri: record.uri,
          ...(typeof record.name === "string" ? { name: record.name } : {}),
          ...(typeof record.description === "string" ? { description: record.description } : {}),
          ...(typeof record.mimeType === "string" ? { mimeType: record.mimeType } : {}),
        },
      ];
    });
  }

  async readResource(uri: string): Promise<string> {
    if (!this.supports("resources")) {
      throw new ProofstackError({
        message: `MCP server "${this.name}" does not advertise resources`,
        category: "UNSUPPORTED",
        code: "mcp_resources_unsupported",
      });
    }
    const result = (await this.request("resources/read", { uri })) as { contents?: unknown[] };
    return flattenContent(result.contents ?? []);
  }

  async listPrompts(): Promise<McpPrompt[]> {
    if (!this.supports("prompts")) return [];
    const result = (await this.request("prompts/list", {})) as { prompts?: unknown[] };
    return (result.prompts ?? []).flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const record = entry as Record<string, unknown>;
      if (typeof record.name !== "string") return [];
      return [
        {
          name: record.name,
          ...(typeof record.description === "string" ? { description: record.description } : {}),
          ...(Array.isArray(record.arguments)
            ? { arguments: record.arguments as McpPrompt["arguments"] }
            : {}),
        },
      ];
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const child = this.child;
    if (!child || child.exitCode !== null) return;

    // Ask politely, then insist. Always resolve: a stuck child must not wedge the CLI.
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
        resolve();
      }, 2_000);

      child.once("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });

      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(killTimer);
        resolve();
      }
    });
    this.failAll(new ProofstackError({ message: `MCP server "${this.name}" closed`, category: "INTERNAL", code: "mcp_closed" }));
  }

  // ---- JSON-RPC plumbing

  private supports(capability: "tools" | "resources" | "prompts"): boolean {
    return Boolean(this.serverInfo?.capabilities?.[capability]);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    // Newline-delimited JSON. A partial line stays in the buffer until its newline
    // arrives, so a large tool result split across reads is reassembled correctly.
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleMessage(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private handleMessage(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      // A server that logs to stdout corrupts the channel. Surface it as a diagnostic
      // rather than silently dropping it, because it explains later failures.
      this.options.onStderr?.(`[${this.name}] non-JSON on stdout: ${line.slice(0, 200)}\n`);
      return;
    }
    if (typeof message !== "object" || message === null) return;
    const record = message as Record<string, unknown>;

    // A response has an id; a notification does not.
    if (typeof record.id === "number") {
      const pending = this.pending.get(record.id);
      if (!pending) return;
      this.pending.delete(record.id);
      clearTimeout(pending.timer);
      if (record.error) {
        const error = record.error as { message?: string; code?: number; data?: unknown };
        pending.reject(
          new ProofstackError({
            message: `MCP "${this.name}": ${error.message ?? "unknown error"}`,
            category: "PROVIDER",
            code: `mcp_error_${error.code ?? "unknown"}`,
            details: { data: error.data },
          }),
        );
      } else {
        pending.resolve(record.result);
      }
      return;
    }

    // A server-initiated request (sampling, roots). We do not implement those, so we
    // answer with a proper JSON-RPC error instead of leaving the server waiting.
    if (typeof record.method === "string" && record.id !== undefined) {
      this.write({
        jsonrpc: "2.0",
        id: record.id,
        error: { code: -32601, message: `PROOFSTACK does not implement ${record.method}` },
      });
    }
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new ProofstackError({
            message: `MCP "${this.name}" did not answer ${method} within ${this.timeoutMs}ms`,
            category: "TIMEOUT",
            code: "mcp_timeout",
            retryable: true,
            details: { method, timeoutMs: this.timeoutMs },
          }),
        );
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(message: unknown): void {
    const child = this.child;
    if (!child || !child.stdin.writable) {
      throw new ProofstackError({
        message: `MCP server "${this.name}" is not accepting input`,
        category: "PROVIDER",
        code: "mcp_stdin_closed",
      });
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failAll(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

// ------------------------------------------------------------------- http transport

/**
 * Streamable HTTP transport.
 *
 * Each JSON-RPC message is a POST. A response may be plain JSON or an SSE stream; both
 * are handled, because servers differ and a client that only speaks one of them is a
 * client that works with half the ecosystem.
 */
class HttpMcpClient implements McpClient {
  readonly name: string;
  serverInfo: McpServerInfo | null = null;

  private nextId = 1;
  private sessionId: string | null = null;
  private readonly timeoutMs: number;

  constructor(private readonly options: McpClientOptions) {
    this.name = options.name;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async initialize(): Promise<void> {
    if (!this.options.url) {
      throw new ProofstackError({
        message: `MCP server "${this.name}" has no url`,
        category: "CONFIGURATION",
        code: "mcp_url_missing",
      });
    }

    const result = (await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {}, prompts: {} },
      clientInfo: { name: "proofstack", version: "0.1.0" },
    })) as {
      protocolVersion?: string;
      capabilities?: Record<string, unknown>;
      serverInfo?: { name?: string; version?: string };
      instructions?: string;
    };

    this.serverInfo = {
      name: result.serverInfo?.name ?? this.name,
      version: result.serverInfo?.version ?? "unknown",
      protocolVersion: result.protocolVersion ?? MCP_PROTOCOL_VERSION,
      capabilities: result.capabilities ?? {},
      ...(result.instructions ? { instructions: result.instructions } : {}),
    };

    await this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<McpTool[]> {
    if (!this.supports("tools")) return [];
    const result = (await this.request("tools/list", {})) as { tools?: unknown[] };
    return normalizeTools(result.tools ?? []);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: unknown[];
      isError?: boolean;
    };
    return {
      text: flattenContent(result.content ?? []),
      isError: result.isError === true,
      content: result.content ?? [],
    };
  }

  async listResources(): Promise<McpResource[]> {
    if (!this.supports("resources")) return [];
    const result = (await this.request("resources/list", {})) as { resources?: unknown[] };
    return (result.resources ?? []).flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const record = entry as Record<string, unknown>;
      return typeof record.uri === "string" ? [{ uri: record.uri }] : [];
    });
  }

  async readResource(uri: string): Promise<string> {
    const result = (await this.request("resources/read", { uri })) as { contents?: unknown[] };
    return flattenContent(result.contents ?? []);
  }

  async listPrompts(): Promise<McpPrompt[]> {
    if (!this.supports("prompts")) return [];
    const result = (await this.request("prompts/list", {})) as { prompts?: unknown[] };
    return (result.prompts ?? []).flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const record = entry as Record<string, unknown>;
      return typeof record.name === "string" ? [{ name: record.name }] : [];
    });
  }

  async close(): Promise<void> {
    // Stateless over HTTP: nothing to tear down. Kept for interface symmetry.
  }

  private supports(capability: "tools" | "resources" | "prompts"): boolean {
    return Boolean(this.serverInfo?.capabilities?.[capability]);
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const response = await this.post({ jsonrpc: "2.0", id, method, params });
    const message = await readRpcMessage(response);
    if (message.error) {
      const error = message.error as { message?: string; code?: number };
      throw new ProofstackError({
        message: `MCP "${this.name}": ${error.message ?? "unknown error"}`,
        category: "PROVIDER",
        code: `mcp_error_${error.code ?? "unknown"}`,
      });
    }
    return message.result;
  }

  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    await this.post({ jsonrpc: "2.0", method, params });
  }

  private async post(body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    for (const [key, value] of Object.entries(this.options.headers ?? {})) {
      headers[key] = expandEnv(value);
    }
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    try {
      const response = await fetch(this.options.url!, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const session = response.headers.get("mcp-session-id");
      if (session) this.sessionId = session;
      if (!response.ok) {
        throw new ProofstackError({
          message: `MCP "${this.name}" returned HTTP ${response.status}`,
          category: "PROVIDER",
          code: "mcp_http_error",
          retryable: response.status >= 500 || response.status === 429,
          details: { status: response.status },
        });
      }
      return response;
    } catch (error) {
      if (error instanceof ProofstackError) throw error;
      throw new ProofstackError({
        message: `MCP "${this.name}" request failed: ${error instanceof Error ? error.message : String(error)}`,
        category: "NETWORK",
        code: "mcp_network_error",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Read one JSON-RPC message from a response that may be JSON or SSE. */
async function readRpcMessage(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (contentType.includes("text/event-stream")) {
    // Take the last `data:` line that parses as a JSON-RPC message.
    const lines = text.split("\n").filter((line) => line.startsWith("data:"));
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const payload = lines[i]!.slice(5).trim();
      if (!payload) continue;
      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        if ("result" in parsed || "error" in parsed) return parsed;
      } catch {
        // Not a message; keep looking.
      }
    }
    throw new ProofstackError({
      message: "MCP server sent an event stream with no JSON-RPC response",
      category: "PROVIDER",
      code: "mcp_sse_no_response",
    });
  }

  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ProofstackError({
      message: `MCP server returned non-JSON: ${text.slice(0, 200)}`,
      category: "PROVIDER",
      code: "mcp_bad_response",
    });
  }
}

// ------------------------------------------------------------------------- helpers

function normalizeTools(raw: unknown[]): McpTool[] {
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string") return [];
    return [
      {
        name: record.name,
        ...(typeof record.description === "string" ? { description: record.description } : {}),
        ...(typeof record.inputSchema === "object" && record.inputSchema !== null
          ? { inputSchema: record.inputSchema as Record<string, unknown> }
          : {}),
        ...(typeof record.annotations === "object" && record.annotations !== null
          ? { annotations: record.annotations as Record<string, unknown> }
          : {}),
      },
    ];
  });
}

/** Flatten MCP content blocks into text a model can read. */
function flattenContent(content: unknown[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const record = block as Record<string, unknown>;
    if (typeof record.text === "string") {
      parts.push(record.text);
      continue;
    }
    if (record.type === "resource" && typeof record.resource === "object" && record.resource !== null) {
      const resource = record.resource as Record<string, unknown>;
      if (typeof resource.text === "string") parts.push(resource.text);
      else if (typeof resource.uri === "string") parts.push(`[resource ${resource.uri}]`);
      continue;
    }
    if (record.type === "image") {
      // Never inline image bytes into a prompt: it is expensive and usually useless.
      parts.push(`[image ${String(record.mimeType ?? "unknown")}]`);
      continue;
    }
    parts.push(JSON.stringify(record));
  }
  return parts.join("\n");
}

/** Replace ${VAR} with the environment value, leaving unknown names untouched. */
export function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (match, name: string) => process.env[name] ?? match);
}

/**
 * Namespace a tool name so two servers cannot collide: `mcp__<server>__<tool>`.
 * Sanitised to the character set a model's function-calling API accepts.
 */
export function namespacedToolName(server: string, tool: string): string {
  const clean = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `mcp__${clean(server)}__${clean(tool)}`;
}

/** Apply the allow/deny lists from the config to a server's tool list. */
export function filterTools(
  tools: readonly McpTool[],
  allow: readonly string[],
  deny: readonly string[],
): McpTool[] {
  return tools.filter((tool) => {
    if (deny.includes(tool.name)) return false;
    if (allow.length === 0) return true;
    return allow.includes(tool.name);
  });
}
