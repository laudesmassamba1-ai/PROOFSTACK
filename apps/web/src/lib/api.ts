/**
 * The single place the browser is allowed to talk to the product API.
 *
 * There is no fallback fake: reads may be served from the last real GET response
 * while the API is down, but mutations are never simulated. The UI says the data is
 * cached and keeps server-only actions disabled until the connection returns.
 *
 * Session authentication is an HttpOnly cookie, so every dashboard call uses
 * `credentials: "include"` and never stores a token in JavaScript.
 */
/**
 * In production the web app is served behind the same origin as `/api/*` and
 * `/health`, so the base is intentionally empty. A localhost fallback in a built
 * bundle would send production visitors to their own machine.
 */
export const API_BASE: string =
  (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ??
  (import.meta.env.DEV ? "http://localhost:8787" : "");

const CACHE_PREFIX = "proofcore.api-cache.v1:";
const CACHE_MAX_BYTES = 1_500_000;

/** Keys are scoped by API origin so a local/staging response never masquerades as prod. */
function cacheKey(path: string): string {
  return `${CACHE_PREFIX}${API_BASE}${path}`;
}

function notifyConnection(online: boolean, detail?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("proofcore:connection", { detail: { online, ...(detail ? { detail } : {}) } })
  );
}

/** The last successful GET body, so the shell can still be navigated during an outage. */
function readCached<T>(path: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(path));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeCached(path: string, text: string): void {
  if (typeof window === "undefined" || text.length > CACHE_MAX_BYTES) return;
  try {
    window.localStorage.setItem(cacheKey(path), text);
  } catch {
    // Quota, private mode, or a disabled storage: the online path still works.
  }
}

/** Removes account data from the machine when the user signs out. */
export function clearApiCache(): void {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(CACHE_PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

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
    if ((init.method ?? "GET") === "GET") writeCached(path, text);
    notifyConnection(true);
    return (text.length === 0 ? ({} as T) : JSON.parse(text)) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      // A 5xx is an outage, not a refused input. Serve the last real answer so the
      // workspace remains navigable; 4xx responses must still reach the caller.
      if ((init.method ?? "GET") === "GET" && error.status >= 500) {
        const cached = readCached<T>(path);
        if (cached !== null) {
          notifyConnection(false, error.message);
          return cached;
        }
      }
      throw error;
    }
    if ((init.method ?? "GET") === "GET") {
      const cached = readCached<T>(path);
      if (cached !== null) {
        notifyConnection(false, error instanceof Error ? error.message : String(error));
        return cached;
      }
    }
    notifyConnection(false, error instanceof Error ? error.message : String(error));
    throw new ApiError(error instanceof Error ? error.message : String(error), 0, "network_error");
  } finally {
    clearTimeout(timer);
  }
}

export async function postJson<T>(path: string, payload: unknown, timeoutMs = 6000): Promise<T> {
  // Mutations are never served from the cache: a failed write must be visible.
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
