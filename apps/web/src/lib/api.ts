/**
 * The single place the browser is allowed to talk to the product API.
 *
 * There is no fallback fake: when the API is unreachable the UI says so and sends
 * nothing. A marketing site that pretends to create accounts is worse than one that
 * admits the backend is not running yet.
 */
export const API_BASE: string =
  (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "http://localhost:8787";

export type Probe = { status: "checking" | "reachable" | "unreachable"; detail?: string };

export async function probeApi(base = API_BASE, timeoutMs = 1500): Promise<Probe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/health`, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) return { status: "unreachable", detail: `HTTP ${response.status}` };
    const body = (await response.json()) as { status?: string; version?: string };
    return { status: "reachable", detail: `${body.status ?? "ok"} ${body.version ?? ""}`.trim() };
  } catch (error) {
    return { status: "unreachable", detail: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function postJson<T>(path: string, payload: unknown, timeoutMs = 6000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      credentials: "include",
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(extractMessage(text) ?? `HTTP ${response.status}`);
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

function extractMessage(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === "string") return parsed.error;
    return parsed.error?.message ?? parsed.message;
  } catch {
    return undefined;
  }
}
