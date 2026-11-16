/**
 * The single place the browser is allowed to talk to the product API.
 *
 * There is no fallback fake: when the API is unreachable the UI says so and sends
 * nothing. A marketing site that pretends to create accounts is worse than one that
 * admits the backend is not running yet.
 *
 * Session authentication is an HttpOnly cookie, so every dashboard call uses
 * `credentials: "include"` and never stores a token in JavaScript.
 */
export const API_BASE: string =
  (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ??
  "http://localhost:8787";

export type Probe = { status: "checking" | "reachable" | "unreachable"; detail?: string };

export async function probeApi(base = API_BASE, timeoutMs = 1500): Promise<Probe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/health`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { status: "unreachable", detail: `HTTP ${response.status}` };
    const body = (await response.json()) as { status?: string; version?: string };
    return { status: "reachable", detail: `${body.status ?? "ok"} ${body.version ?? ""}`.trim() };
  } catch (error) {
    return {
      status: "unreachable",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 10_000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? "GET",
      headers:
        init.body === undefined
          ? { accept: "application/json" }
          : { accept: "application/json", "content-type": "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: controller.signal,
      credentials: "include",
    });
    const text = await response.text();
    if (!response.ok) {
      const parsed = safeParse(text);
      throw new ApiError(
        parsed?.error?.message ?? `HTTP ${response.status}`,
        response.status,
        parsed?.error?.code ?? `http_${response.status}`,
        parsed?.error?.details
      );
    }
    return (text.length === 0 ? ({} as T) : JSON.parse(text)) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error instanceof Error ? error.message : String(error), 0, "network_error");
  } finally {
    clearTimeout(timer);
  }
}

export async function postJson<T>(path: string, payload: unknown, timeoutMs = 6000): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: payload, timeoutMs });
}

function safeParse(
  text: string
): { error?: { message?: string; code?: string; details?: unknown } } | null {
  try {
    return JSON.parse(text) as { error?: { message?: string; code?: string; details?: unknown } };
  } catch {
    return null;
  }
}
