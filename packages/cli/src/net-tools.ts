import { ProofCoreError } from "@proofcore/core";

/**
 * HTTP as a tool.
 *
 * "Search the web" is not a capability; "make this request and show me the status, the
 * headers and the body" is. An agent that can call an API can check a deployment, test a
 * webhook, read a JSON endpoint, verify a CORS preflight or download an OpenAPI document —
 * none of which needs a model or a search provider.
 *
 * The request runs from the developer's machine, deliberately: reaching `localhost:3000` is
 * the point, not an accident. The response is capped and marked as truncated, so a 40 MB
 * download does not become a 40 MB tool result.
 */

export interface HttpResponse {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  contentType: string;
  body: string;
  bytes: number;
  durationMs: number;
  truncated: boolean;
  note?: string;
}

export interface HttpRequestInput {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  json?: unknown;
  timeoutMs?: number;
  maxBytes?: number;
  redirect?: "follow" | "manual" | "error";
}

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 30_000;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export async function httpRequest(input: HttpRequestInput): Promise<HttpResponse> {
  const method = (input.method ?? "GET").toUpperCase();
  if (!METHODS.has(method)) {
    throw new ProofCoreError({
      message: `Unsupported HTTP method: ${method}`,
      category: "VALIDATION",
      code: "method_not_allowed",
      details: { allowed: [...METHODS] },
    });
  }
  const raw = input.url.trim();
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (!/^https?:\/\//i.test(url)) {
    throw new ProofCoreError({
      message: "Only http(s) URLs can be requested.",
      category: "VALIDATION",
      code: "unsupported_scheme",
    });
  }

  const headers: Record<string, string> = { ...input.headers };
  let body = input.body;
  if (input.json !== undefined) {
    body = JSON.stringify(input.json);
    if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
      headers["content-type"] = "application/json";
    }
  }
  if (
    body !== undefined &&
    !Object.keys(headers).some((key) => key.toLowerCase() === "user-agent")
  ) {
    headers["user-agent"] = "PROOFCORE-http/1.0 (+https://proofcore.dev)";
  }

  const started = Date.now();
  const response = await fetch(url, {
    method,
    headers,
    ...(body !== undefined && method !== "GET" && method !== "HEAD" ? { body } : {}),
    redirect: input.redirect ?? "follow",
    signal: AbortSignal.timeout(Math.min(input.timeoutMs ?? TIMEOUT_MS, 120_000)),
  }).catch((error: unknown) => {
    throw new ProofCoreError({
      message: `Request failed: ${error instanceof Error ? error.message : "network error"}`,
      category: "NETWORK",
      code: "http_request_failed",
    });
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  const maxBytes = Math.min(input.maxBytes ?? MAX_BYTES, 20_000_000);
  const capped = buffer.subarray(0, maxBytes);
  const contentType = response.headers.get("content-type") ?? "";
  const textual =
    contentType === "" ||
    /text|json|xml|javascript|ecmascript|x-www-form-urlencoded|yaml|csv/i.test(contentType);
  const text = textual ? capped.toString("utf8") : "";
  const headerRecord: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headerRecord[key] = value;
  });
  return {
    url,
    finalUrl: response.url || url,
    status: response.status,
    statusText: response.statusText,
    headers: headerRecord,
    contentType,
    body: textual
      ? text
      : `<binary response: ${buffer.byteLength} bytes, ${contentType || "unknown type"}>`,
    bytes: buffer.byteLength,
    durationMs: Date.now() - started,
    truncated: buffer.byteLength > capped.byteLength || text.length < capped.byteLength,
    ...(textual
      ? {}
      : {
          note: "A binary body is not returned inline. Use http_request with a different endpoint, or the browser's download path.",
        }),
  };
}
