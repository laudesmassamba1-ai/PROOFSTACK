import { ProofstackError } from "@proofstack/core";

/**
 * AI provider adapters.
 *
 * One shape: OpenAI-compatible chat completions. That is not a shortcut, it is the
 * de-facto standard — Perch, OpenAI, Ollama, vLLM, LM Studio, Together and most
 * gateways all accept the same request body. Supporting one shape correctly is worth
 * more than supporting five badly, and it means a local model works with no code
 * change: point `baseUrl` at `http://localhost:11434/v1`.
 *
 * What this file does NOT do: assume a provider supports tool calling. Some do, some
 * do not, and a local model may not. `supportsTools` is a per-provider fact the caller
 * sets, and the agent loop degrades to a single-shot completion when it is false.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on an assistant message that requested tool calls. */
  toolCalls?: ToolCall[];
  /** Present on a tool result message, linking it to the call it answers. */
  toolCallId?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments. A provider that returns invalid JSON is a provider bug we surface. */
  arguments: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  /** Ask the provider to stop; used by the agent loop on cancellation. */
  signal?: AbortSignal;
}

export interface ChatResponse {
  message: ChatMessage;
  /** Token accounting as the provider reported it, when it did. */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** Why generation stopped: "stop", "tool_calls", "length"… */
  finishReason?: string;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  /** Whether this provider/model can request tool calls. */
  readonly supportsTools: boolean;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export interface OpenAiCompatibleOptions {
  name: string;
  baseUrl: string;
  model: string;
  /** Read at call time, never stored. A local endpoint may need none. */
  apiKey?: string;
  headers?: Record<string, string>;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  supportsTools?: boolean;
  fetchImpl?: typeof fetch;
}

/**
 * An OpenAI-compatible chat client.
 *
 * The base URL is normalised so both `https://host/v1` and `https://host` work: a
 * missing `/v1` is the single most common misconfiguration, and guessing it wrong
 * produces a 404 that reads like an auth failure.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name: string;
  readonly model: string;
  readonly supportsTools: boolean;

  private readonly endpoint: string;
  private readonly options: OpenAiCompatibleOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiCompatibleOptions) {
    this.options = options;
    this.name = options.name;
    this.model = options.model;
    this.supportsTools = options.supportsTools ?? true;
    this.fetchImpl = options.fetchImpl ?? fetch;

    const base = options.baseUrl.replace(/\/+$/, "");
    this.endpoint = /\/v\d+$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 120_000);
    const onAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onAbort, { once: true });

    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages.map(toWireMessage),
      max_tokens: request.maxTokens ?? this.options.maxTokens ?? 4_096,
      temperature: request.temperature ?? this.options.temperature ?? 0.2,
      stream: false,
    };

    if (request.tools && request.tools.length > 0 && this.supportsTools) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      body.tool_choice = "auto";
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(this.options.headers ?? {}),
    };
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ProofstackError({
        message: `AI provider "${this.name}" request failed: ${error instanceof Error ? error.message : String(error)}`,
        category: "NETWORK",
        code: "ai_network_error",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", onAbort);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ProofstackError({
        message: `AI provider "${this.name}" returned HTTP ${response.status}: ${text.slice(0, 400)}`,
        category: response.status === 429 ? "RATE_LIMITED" : "PROVIDER",
        code: `ai_http_${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
        details: { status: response.status },
      });
    }

    const payload = (await response.json()) as {
      model?: string;
      choices?: {
        message?: {
          role?: string;
          content?: string | null;
          tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
        };
        finish_reason?: string;
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const choice = payload.choices?.[0];
    if (!choice?.message) {
      throw new ProofstackError({
        message: `AI provider "${this.name}" returned no choices`,
        category: "PROVIDER",
        code: "ai_empty_response",
      });
    }

    const toolCalls: ToolCall[] = [];
    for (const call of choice.message.tool_calls ?? []) {
      const name = call.function?.name;
      if (!name) continue;
      toolCalls.push({
        id: call.id ?? `call_${toolCalls.length}`,
        name,
        arguments: parseArguments(call.function?.arguments, this.name),
      });
    }

    return {
      message: {
        role: "assistant",
        content: choice.message.content ?? "",
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
      ...(payload.usage
        ? {
            usage: {
              promptTokens: payload.usage.prompt_tokens ?? 0,
              completionTokens: payload.usage.completion_tokens ?? 0,
              totalTokens: payload.usage.total_tokens ?? 0,
            },
          }
        : {}),
      ...(choice.finish_reason ? { finishReason: choice.finish_reason } : {}),
      model: payload.model ?? this.model,
    };
  }
}

/**
 * Parse tool-call arguments.
 *
 * A model that emits malformed JSON is common enough that it must not crash the loop.
 * An empty string means "no arguments", which is legitimate. Anything else that fails
 * to parse is surfaced with the raw text, because silently substituting `{}` would run
 * a tool with the wrong inputs.
 */
function parseArguments(raw: string | undefined, provider: string): Record<string, unknown> {
  if (raw === undefined || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    throw new ProofstackError({
      message: `AI provider "${provider}" emitted invalid JSON for tool arguments: ${raw.slice(0, 300)}`,
      category: "PROVIDER",
      code: "ai_bad_tool_arguments",
      details: { raw: raw.slice(0, 1_000) },
    });
  }
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId ?? "",
    };
  }
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }
  return {
    role: message.role,
    content: message.content,
    ...(message.name ? { name: message.name } : {}),
  };
}

/**
 * Build a provider from the project config.
 *
 * The key is read from the environment at construction, and the error message names the
 * variable rather than echoing anything. A provider that needs no key (a local model)
 * simply has no `apiKeyEnvVar`.
 */
export function providerFromConfig(config: {
  name: string;
  baseUrl: string;
  model: string;
  apiKeyEnvVar?: string;
  headers?: Record<string, string>;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): AiProvider {
  let apiKey: string | undefined;
  if (config.apiKeyEnvVar) {
    apiKey = process.env[config.apiKeyEnvVar];
    if (!apiKey) {
      throw new ProofstackError({
        message: `AI provider "${config.name}" needs ${config.apiKeyEnvVar}, which is not set.`,
        category: "CONFIGURATION",
        code: "ai_key_missing",
        details: { provider: config.name, envVar: config.apiKeyEnvVar },
      });
    }
  }

  return new OpenAiCompatibleProvider({
    name: config.name,
    baseUrl: config.baseUrl,
    model: config.model,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(config.headers === undefined ? {} : { headers: config.headers }),
    ...(config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens }),
    ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
  });
}
