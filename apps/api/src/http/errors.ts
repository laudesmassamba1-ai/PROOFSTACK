import { PaymentProviderError } from "@proofcore/adapter-payments";
import type { ErrorResponse } from "@proofcore/contracts";
import { ProofCoreError } from "@proofcore/core";

/**
 * HTTP error envelope.
 *
 * A `ProofCoreError` already carries a machine-readable category; this maps the
 * category onto the status the client should see, once, in one place. Routes throw
 * either kind of error and never build an error response by hand.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const STATUS_BY_CATEGORY: Record<ProofCoreError["category"], number> = {
  VALIDATION: 400,
  CONFIGURATION: 500,
  NOT_FOUND: 404,
  PERMISSION: 403,
  TIMEOUT: 504,
  NETWORK: 502,
  PROVIDER: 502,
  ASSERTION: 500,
  UNSUPPORTED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export function toErrorResponse(
  error: unknown,
  requestId: string
): { status: number; body: ErrorResponse } {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          category: statusCategory(error.status),
          ...(error.details ? { details: error.details } : {}),
          requestId,
        },
      },
    };
  }

  if (error instanceof PaymentProviderError) {
    // A provider failure is never reported as a client error. The request may be
    // retryable, but the browser must not show "payment failed" for a 502.
    const status = error.status === 0 ? 502 : error.status === 429 ? 503 : 502;
    return {
      status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          category: "PROVIDER",
          ...(error.details ? { details: error.details } : {}),
          requestId,
        },
      },
    };
  }

  if (error instanceof ProofCoreError) {
    // A handful of business conflicts are not expressible in the error taxonomy:
    // a taken email or an already-subscribed workspace is a 409, not a 400.
    const conflict = error.code === "email_taken" || error.code === "already_subscribed";
    return {
      status: conflict ? 409 : (STATUS_BY_CATEGORY[error.category] ?? 500),
      body: {
        error: {
          code: error.code,
          message: error.message,
          category: error.category,
          ...(Object.keys(error.details).length > 0 ? { details: error.details } : {}),
          requestId,
        },
      },
    };
  }

  // Anything unrecognised is a bug. Log it server-side, return nothing internal.
  return {
    status: 500,
    body: {
      error: {
        code: "internal_error",
        message: "The server could not complete this request.",
        category: "INTERNAL",
        requestId,
      },
    },
  };
}

function statusCategory(status: number): string {
  if (status === 400 || status === 422) return "VALIDATION";
  if (status === 401 || status === 403) return "PERMISSION";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "INTERNAL";
  return "VALIDATION";
}

/** Best-effort client address. Cloudflare sets the first header; proxies the second. */
export function clientAddress(headers: { get(name: string): string | undefined }): string {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}

/**
 * Fixed-window limiter for authentication endpoints.
 *
 * In-memory per isolate: it raises the cost of password spraying in a single
 * region but is not a distributed guarantee. The paid plans' API traffic is metered
 * separately in the database, where the limit is authoritative.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: () => number = () => Date.now()
  ) {}

  check(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.clock();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    entry.count += 1;
    return {
      allowed: entry.count <= this.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
}
