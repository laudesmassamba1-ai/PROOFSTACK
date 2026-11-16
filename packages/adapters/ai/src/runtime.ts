import type { AiConfig, McpServerConfig } from "@proofstack/contracts";
import { ProofstackError } from "@proofstack/core";
import { connectMcp, filterTools, namespacedToolName, type McpClient, type McpTool } from "./mcp.js";
import type { AgentTool } from "./agent.js";
import { providerFromConfig, type AiProvider } from "./provider.js";

/**
 * Wiring: turn the `ai` block of the project config into live objects.
 *
 * This is the only place that knows how a config entry becomes a client. Keeping it in
 * one function means the CLI, the API and the tests connect the same way, and means a
 * misconfiguration produces one clear error instead of three different ones.
 *
 * Nothing here runs unless `ai.enabled` is true. An AI integration is opt-in.
 */

export interface AiRuntime {
  providers: AiProvider[];
  /** The provider used when `--provider` is omitted. */
  defaultProvider: AiProvider | null;
  mcpClients: McpClient[];
  /** Every MCP tool, namespaced and filtered, ready for the agent loop. */
  mcpTools: AgentTool[];
  /** Problems that did not stop the runtime from starting. */
  warnings: string[];
  close(): Promise<void>;
}

export interface BuildAiRuntimeOptions {
  config: AiConfig;
  /** Called with each server's stderr, for diagnostics. */
  onStderr?: (server: string, chunk: string) => void;
  /** Connect only these servers; defaults to those with autoConnect. */
  connectServers?: string[];
}

export async function buildAiRuntime(options: BuildAiRuntimeOptions): Promise<AiRuntime> {
  const { config } = options;
  const warnings: string[] = [];

  if (!config.enabled) {
    return {
      providers: [],
      defaultProvider: null,
      mcpClients: [],
      mcpTools: [],
      warnings: ["ai.enabled is false; no AI integration is active"],
      close: async () => undefined,
    };
  }

  // ---- providers
  const providers: AiProvider[] = [];
  for (const entry of config.providers) {
    try {
      providers.push(providerFromConfig(entry));
    } catch (error) {
      // A provider with a missing key is a warning, not a fatal error: the other
      // providers and the MCP tools may still be useful.
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  const explicitDefault = providers.find((provider) =>
    config.providers.find((entry) => entry.name === provider.name)?.default,
  );
  const defaultProvider = explicitDefault ?? providers[0] ?? null;

  // ---- MCP servers
  const wanted = options.connectServers ?? config.mcpServers.filter((s) => s.autoConnect).map((s) => s.name);
  const mcpClients: McpClient[] = [];
  const mcpTools: AgentTool[] = [];

  for (const server of config.mcpServers) {
    if (!wanted.includes(server.name)) continue;
    try {
      const client = await connectMcp({
        name: server.name,
        transport: server.transport,
        ...(server.command ? { command: server.command } : {}),
        ...(server.url ? { url: server.url } : {}),
        env: server.env,
        headers: server.headers,
        ...(server.cwd ? { cwd: server.cwd } : {}),
        timeoutMs: server.timeoutMs,
        ...(options.onStderr
          ? { onStderr: (chunk: string) => options.onStderr!(server.name, chunk) }
          : {}),
      });
      mcpClients.push(client);
      mcpTools.push(...await toolsFromServer(client, server));
    } catch (error) {
      warnings.push(
        `MCP server "${server.name}" could not connect: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    providers,
    defaultProvider,
    mcpClients,
    mcpTools,
    warnings,
    async close() {
      await Promise.all(mcpClients.map((client) => client.close().catch(() => undefined)));
    },
  };
}

/**
 * Wrap a server's tools as agent tools.
 *
 * Every MCP tool is treated as a `write` unless the server explicitly annotates it
 * read-only. That is the conservative direction: MCP annotations are advisory, and a
 * server that does not annotate is a server whose tools we do not understand.
 */
async function toolsFromServer(client: McpClient, server: McpServerConfig): Promise<AgentTool[]> {
  const available: McpTool[] = await client.listTools();
  const permitted = filterTools(available, server.allowTools, server.denyTools);

  return permitted.map((tool) => {
    const effect: "read" | "write" =
      tool.annotations?.readOnlyHint === true ? "read" : "write";

    return {
      effect,
      definition: {
        name: namespacedToolName(server.name, tool.name),
        description: tool.description ?? `${tool.name} (from MCP server ${server.name})`,
        parameters: tool.inputSchema ?? { type: "object", properties: {} },
      },
      async run(args: Record<string, unknown>): Promise<string> {
        const result = await client.callTool(tool.name, args);
        if (result.isError) {
          throw new ProofstackError({
            message: `MCP tool ${server.name}/${tool.name} failed: ${result.text.slice(0, 500)}`,
            category: "PROVIDER",
            code: "mcp_tool_error",
            details: { server: server.name, tool: tool.name },
          });
        }
        return result.text;
      },
    };
  });
}

/**
 * Describe the runtime for `proofstack ai status`.
 *
 * Reads like a receipt: what is configured, what connected, what is missing. No
 * secrets, and no claims about anything that was not actually reached.
 */
export function describeRuntime(runtime: AiRuntime): string[] {
  const lines: string[] = [];

  if (runtime.providers.length === 0) {
    lines.push("providers: none configured");
  } else {
    lines.push(`providers: ${runtime.providers.length}`);
    for (const provider of runtime.providers) {
      const isDefault = runtime.defaultProvider?.name === provider.name;
      lines.push(
        `  ${provider.name}${isDefault ? " (default)" : ""} — model ${provider.model}, tools ${provider.supportsTools ? "yes" : "no"}`,
      );
    }
  }

  if (runtime.mcpClients.length === 0) {
    lines.push("mcp servers: none connected");
  } else {
    lines.push(`mcp servers: ${runtime.mcpClients.length} connected`);
    for (const client of runtime.mcpClients) {
      const info = client.serverInfo;
      lines.push(
        `  ${client.name} — ${info?.name ?? "unknown"} ${info?.version ?? ""} (protocol ${info?.protocolVersion ?? "?"})`,
      );
    }
    lines.push(`mcp tools: ${runtime.mcpTools.length}`);
    for (const tool of runtime.mcpTools) {
      lines.push(`  ${tool.definition.name} [${tool.effect ?? "write"}]`);
    }
  }

  for (const warning of runtime.warnings) lines.push(`warning: ${warning}`);
  return lines;
}
