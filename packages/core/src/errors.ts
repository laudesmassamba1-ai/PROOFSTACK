/**
 * Error taxonomy used by the engine, the modules, the CLI and the API.
 *
 * Every failure that leaves a package boundary is classified so that reports can
 * distinguish "the product under test is broken" (ASSERTION) from "the harness
 * could not run" (NETWORK / TIMEOUT / CONFIGURATION). A run that errored is never
 * reported as a passing run.
 */

export const ERROR_CATEGORIES = [
  "VALIDATION",
  "CONFIGURATION",
  "NOT_FOUND",
  "PERMISSION",
  "TIMEOUT",
  "NETWORK",
  "PROVIDER",
  "ASSERTION",
  "UNSUPPORTED",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export interface ProofCoreErrorInit {
  message: string;
  category?: ErrorCategory;
  code?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class ProofCoreError extends Error {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(init: ProofCoreErrorInit) {
    super(init.message);
    this.name = "ProofCoreError";
    this.category = init.category ?? "INTERNAL";
    this.code = init.code ?? `${this.category.toLowerCase()}_error`;
    this.retryable = init.retryable ?? false;
    this.details = init.details ?? {};
    if ("cause" in init) this.cause = init.cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      code: this.code,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

export function isProofCoreError(value: unknown): value is ProofCoreError {
  return value instanceof ProofCoreError;
}

/**
 * Map an unknown thrown value onto a serializable failure record.
 * Never leaks stack text into customer reports by default.
 */
export interface FailureRecord {
  message: string;
  category: ErrorCategory;
  code: string;
  name?: string;
  stack?: string;
  details?: Record<string, unknown>;
}

export function toFailureRecord(error: unknown, opts: { stack?: boolean } = {}): FailureRecord {
  if (isProofCoreError(error)) {
    const record: FailureRecord = {
      message: error.message,
      category: error.category,
      code: error.code,
      name: error.name,
      details: error.details,
    };
    if (opts.stack && error.stack) record.stack = error.stack;
    return record;
  }
  if (error instanceof Error) {
    const record: FailureRecord = {
      message: error.message || error.name,
      category: classifyByName(error),
      code: error.name || "unknown_error",
      name: error.name,
    };
    if (opts.stack && error.stack) record.stack = error.stack;
    return record;
  }
  return {
    message: typeof error === "string" ? error : `Non-error thrown value: ${typeof error}`,
    category: "INTERNAL",
    code: "non_error_thrown",
  };
}

function classifyByName(error: Error): ErrorCategory {
  const name = error.name;
  const message = error.message.toLowerCase();
  if (name === "TimeoutError" || message.includes("timeout")) return "TIMEOUT";
  if (name === "AbortError") return "TIMEOUT";
  if (
    message.includes("enotfound") ||
    message.includes("econnrefused") ||
    message.includes("fetch failed")
  )
    return "NETWORK";
  if (message.includes("429") || message.includes("rate limit")) return "RATE_LIMITED";
  if (name === "TypeError" && message.includes("undefined")) return "INTERNAL";
  return "INTERNAL";
}

export function assertNever(value: never, label = "exhaustive check"): never {
  throw new ProofCoreError({
    message: `${label}: unexpected value ${JSON.stringify(value)}`,
    category: "INTERNAL",
    code: "not_exhaustive",
    details: { value },
  });
}
