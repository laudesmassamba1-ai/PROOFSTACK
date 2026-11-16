/**
 * AI integration.
 *
 * Three ways AI reaches PROOFSTACK, each independently useful and independently
 * disableable:
 *
 *   - `mcp`        — a real Model Context Protocol client (stdio + streamable HTTP).
 *                    PROOFSTACK consumes MCP servers; their tools become the agent's
 *                    tools, namespaced `mcp__<server>__<tool>`.
 *   - `provider`   — OpenAI-compatible chat completions. One adapter covers Perch,
 *                    OpenAI, Ollama, vLLM and LM Studio; only the base URL changes.
 *   - `cli-agent`  — hand a prompt to an external agent as an argv array and read its
 *                    answer. argv, never a shell string.
 *
 * `agent` is the bounded loop that ties them together: hard turn ceiling, token budget,
 * and an autonomy gate that refuses state-changing tools unless the operator opted in.
 *
 * Nothing here is required for the product to work, and no key is ever stored: every
 * credential is read from an environment variable at call time.
 */
export * from "./mcp.js";
export * from "./provider.js";
export * from "./agent.js";
export * from "./cli-agent.js";
export * from "./runtime.js";
