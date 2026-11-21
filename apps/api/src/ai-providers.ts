/**
 * AI provider registry and catalogue discovery.
 *
 * The product's promise to the user is: pick a provider, paste a key, done. The model
 * is an implementation detail chosen from the provider's own catalogue — never a string
 * the user has to know, and never one we hard-code (a preset shipping a retired model id
 * breaks every conversation with an upstream 404).
 *
 * Two wire formats exist in practice:
 *  - `openai`: POST {base}/chat/completions, `Authorization: Bearer`, tool_calls.
 *  - `anthropic`: POST {base}/messages, `x-api-key` + `anthropic-version`, content blocks.
 */

export type ProviderKind = "openai" | "anthropic";

export interface ProviderDefinition {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Some providers expose the catalogue at a different path. */
  modelsPath?: string;
  docsUrl?: string;
  /** True when the provider accepts an empty key (local runtime). */
  keyOptional?: boolean;
}

export const PROVIDERS: ProviderDefinition[] = [
  { id: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1" },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
  },
  {
    id: "google",
    label: "Google Gemini",
    kind: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  { id: "groq", label: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "mistral", label: "Mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1" },
  { id: "deepseek", label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1" },
  { id: "xai", label: "xAI (Grok)", kind: "openai", baseUrl: "https://api.x.ai/v1" },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  { id: "together", label: "Together", kind: "openai", baseUrl: "https://api.together.xyz/v1" },
  { id: "cerebras", label: "Cerebras", kind: "openai", baseUrl: "https://api.cerebras.ai/v1" },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    keyOptional: true,
  },
  { id: "custom", label: "Autre (compatible OpenAI)", kind: "openai", baseUrl: "" },
];

export function findProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

/** Model families that are not chat models; offering them as a chat model looks broken. */
const NON_CHAT =
  /whisper|tts|orpheus|embed|rerank|guard|moderation|dall-e|stable-diffusion|imagen|veo|sora|transcribe|audio/i;

export function chatModelsOf(models: string[]): string[] {
  return models.filter((id) => !NON_CHAT.test(id));
}

/**
 * Picks a sensible default from a real catalogue.
 *
 * Preference is by family quality, then by catalogue order. It only ever returns an id
 * the provider itself listed.
 */
export function suggestModel(chatModels: string[]): string | undefined {
  const preference = [
    /gpt-5/i,
    /claude.*(opus|sonnet)/i,
    /gpt-4\.1/i,
    /gpt-oss-120b/i,
    /gemini.*(2\.5|3).*pro/i,
    /gpt-4o(?!-mini)/i,
    /claude/i,
    /gemini/i,
    /mistral-large/i,
    /qwen3/i,
    /llama-4/i,
    /gpt-oss/i,
    /gpt-4o-mini/i,
    /llama/i,
  ];
  for (const pattern of preference) {
    const hit = chatModels.find((id) => pattern.test(id));
    if (hit) return hit;
  }
  return chatModels[0];
}

export interface CatalogueResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  models: string[];
  chatModels: string[];
  suggested?: string;
  message: string;
}

/** Reads the provider's own model catalogue. This is the only authority on model ids. */
export async function fetchCatalogue(
  provider: ProviderDefinition,
  baseUrl: string,
  apiKey: string
): Promise<CatalogueResult> {
  const root = (baseUrl || provider.baseUrl).replace(/\/+$/, "");
  const path = provider.modelsPath ?? (provider.kind === "anthropic" ? "/models" : "/models");
  const started = Date.now();
  const headers: Record<string, string> =
    provider.kind === "anthropic"
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : { authorization: `Bearer ${apiKey}` };

  let response: Response;
  try {
    // A provider endpoint never needs a redirect; following one would let a
    // configured base URL pivot the request to an internal address. Workers reject
    // `redirect: "error"`, so `manual` keeps the response visible and the status is
    // refused below like any other non-2xx answer.
    response = await fetch(`${root}${path}`, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      models: [],
      chatModels: [],
      message:
        error instanceof Error && error.name === "TimeoutError"
          ? "Le fournisseur n'a pas répondu en 15 secondes."
          : `Réseau injoignable : ${error instanceof Error ? error.message : "erreur inconnue"}`,
    };
  }

  const latencyMs = Date.now() - started;
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      status: response.status,
      latencyMs,
      models: [],
      chatModels: [],
      message: explainStatus(response.status, text),
    };
  }

  let models: string[] = [];
  try {
    const payload = (await response.json()) as {
      data?: { id?: string }[];
      models?: { id?: string; name?: string }[];
    };
    const raw: ({ id?: string; name?: string } | undefined)[] =
      payload.data ?? payload.models ?? [];
    models = raw
      .map((entry) => entry?.id ?? entry?.name)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    models = [];
  }

  const chatModels = chatModelsOf(models);
  const suggested = suggestModel(chatModels);
  return {
    ok: true,
    status: response.status,
    latencyMs,
    models,
    chatModels,
    ...(suggested ? { suggested } : {}),
    message: `Connexion établie · ${chatModels.length} modèle(s) de conversation disponibles.`,
  };
}

export function explainStatus(status: number, body: string): string {
  const detail = body.replace(/\s+/g, " ").slice(0, 220);
  if (status === 401 || status === 403) {
    return `La clé a été refusée (HTTP ${status}). Vérifie qu'elle est complète, active et autorisée. ${detail}`;
  }
  if (status === 404) {
    return `HTTP 404 : l'URL de base est incorrecte. ${detail}`;
  }
  if (status === 429) {
    return `HTTP 429 : quota ou débit dépassé sur cette clé. ${detail}`;
  }
  return `Le fournisseur a répondu HTTP ${status}. ${detail}`;
}
