import { environmentKindSchema, type RunUploadRequest } from "@proofcore/contracts";
import { z } from "zod";

/**
 * The PROOFCORE HTTP SDK.
 *
 * It speaks only the **machine API** — the routes a project token (`psk_…`) can call:
 * `GET /v1/project` and `POST /v1/runs`. Everything else the product exposes
 * (workspaces, projects, analyses, assistant) is session-authenticated with a cookie and
 * a CSRF token, which belongs in the web app, not in a server-to-server SDK; those
 * routes are deliberately absent here rather than reimplemented with the wrong auth.
 *
 * Three rules shape the code:
 * - **No invented contract.** Request bodies are `RunUploadRequest` from
 *   `@proofcore/contracts`; responses are parsed with schemas that mirror what the
 *   routes actually return. A shape the SDK does not know is an error, never a cast.
 * - **The server is the authority.** `uploadRun` does not retry by itself. A retry is a
 *   decision the caller makes with the `Idempotency-Key` it owns, and a 429 carries
 *   `retryAfterSeconds` so it can be honoured instead of guessed.
 * - **Credentials stay out of code.** `tokenEnvVar` holds the *name* of the variable; the
 *   value is read at call time, so rotating a secret does not need a new client.
 *
 * The package is `private`: it is not published to npm. Consumers in this monorepo
 * import it through the workspace; external integrators use the HTTP API directly.
 */

export const SDK_VERSION = "0.1.0";

/** A `fetch`-compatible function, injectable so tests can drive the real app. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const usageSchema = z
  .object({
    monthlyTestRuns: z.number().int().nonnegative(),
    limit: z.union([z.number().int(), z.literal(-1)]),
    remaining: z.union([z.number().int(), z.literal(-1)]),
  })
  .strict();

/** Exactly what `GET /v1/project` answers, field for field. */
const machineProjectSchema = z
  .object({
    workspace: z.object({ id: z.string(), name: z.string() }).strict(),
    project: z
      .object({
        id: z.string(),
        name: z.string(),
        baseUrl: z.string(),
        environment: environmentKindSchema,
      })
      .strict()
      .nullable(),
    plan: z.object({ key: z.string(), entitled: z.boolean() }).strict(),
    usage: usageSchema,
  })
  .strict();

/** Exactly what `POST /v1/runs` answers, including the retention date the route adds. */
const runUploadResultSchema = z
  .object({
    runId: z.string(),
    reportId: z.string(),
    recorded: z.boolean(),
    retainedUntil: z.string().nullable().optional(),
    usage: usageSchema,
  })
  .strict();

const apiErrorBodySchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        category: z.string().optional(),
        details: z.unknown().optional(),
        requestId: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type MachineProject = z.infer<typeof machineProjectSchema>;
export type RunUploadResult = z.infer<typeof runUploadResultSchema>;

/**
 * An error the API returned, or a response whose shape the SDK refuses.
 *
 * `code` is the server's stable code (`invalid_api_key`, `scope_missing`,
 * `idempotency_key_required`, `quota_exhausted`, `rate_limited`…), so a caller can branch
 * on it without parsing a message. `code` is `invalid_response` when the status was 2xx
 * but the body did not match the documented shape — that is an SDK/server mismatch, and
 * saying so is better than handing back a half-typed object.
 */
export class ProofcoreApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly category: string | undefined;
  readonly details: unknown;
  readonly requestId: string | undefined;
  /** Present on `429`, from the `Retry-After` header, in seconds. */
  readonly retryAfterSeconds: number | undefined;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    category?: string;
    details?: unknown;
    requestId?: string;
    retryAfterSeconds?: number;
  }) {
    super(`${input.code}: ${input.message}`);
    this.name = "ProofcoreApiError";
    this.status = input.status;
    this.code = input.code;
    this.category = input.category;
    this.details = input.details;
    this.requestId = input.requestId;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }
}

export interface ProofcoreClientOptions {
  /** API origin, e.g. `https://proofcore-api.example.com`. Paths are added by the SDK. */
  baseUrl: string;
  /** A project token (`psk_…`). Prefer `tokenEnvVar` in CI. */
  token?: string;
  /** Name of the environment variable holding the token, read at call time. */
  tokenEnvVar?: string;
  /** Injectable transport; defaults to the runtime's `fetch`. */
  fetch?: FetchLike;
  /** Per-request deadline. Default 30 s. */
  timeoutMs?: number;
}

export interface UploadRunOptions {
  /**
   * The `Idempotency-Key` header. Defaults to `sync:<run.id>`, the same derivation the
   * CLI uses, so a retried upload of the same run is recorded once.
   */
  idempotencyKey?: string;
}

export interface ProofcoreClient {
  readonly baseUrl: string;
  /** Workspace, project, plan and monthly test-run usage for this token. */
  getProject(): Promise<MachineProject>;
  /** Upload a finished run. Idempotent on the key, never retried automatically. */
  uploadRun(body: RunUploadRequest, options?: UploadRunOptions): Promise<RunUploadResult>;
}

export function createProofcoreClient(options: ProofcoreClientOptions): ProofcoreClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error(`baseUrl must be an absolute http(s) origin, received "${options.baseUrl}".`);
  }
  if (options.token !== undefined && options.tokenEnvVar !== undefined) {
    throw new Error("Pass either token or tokenEnvVar, not both: one credential per client.");
  }
  // A literal token is checked now, so a typo fails where it was written; an environment
  // variable can only be checked when it is read, which is why it is resolved per call.
  const literalToken =
    options.token !== undefined ? assertProjectToken(options.token, "token") : undefined;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const transport: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));

  /** Resolved per call, never cached: a rotated secret must not need a new client. */
  function token(): string {
    if (literalToken !== undefined) return literalToken;
    const name = options.tokenEnvVar;
    if (!name) {
      throw new Error("No credential: pass token, or tokenEnvVar naming the variable to read.");
    }
    const value = process.env[name];
    if (!value) {
      throw new Error(`Environment variable ${name} is not set; the SDK read it at call time.`);
    }
    return assertProjectToken(value, `$${name}`);
  }

  async function send<T>(
    path: string,
    input: {
      method: "GET" | "POST";
      schema: z.ZodType<T>;
      body?: string;
      idempotencyKey?: string;
    }
  ): Promise<T> {
    const headers = new Headers({
      accept: "application/json",
      authorization: `Bearer ${token()}`,
    });
    if (input.body !== undefined) headers.set("content-type", "application/json");
    if (input.idempotencyKey !== undefined) headers.set("idempotency-key", input.idempotencyKey);

    const response = await transport(`${baseUrl}${path}`, {
      method: input.method,
      headers,
      ...(input.body !== undefined ? { body: input.body } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) throw await toApiError(response);

    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = input.schema.safeParse(payload);
    if (!parsed.success) {
      throw new ProofcoreApiError({
        status: response.status,
        code: "invalid_response",
        message:
          `The server answered ${input.method} ${path} with a body this SDK version does not ` +
          "know. Refusing to return it as if it were the documented shape.",
        details: parsed.error.issues,
        ...(requestIdOf(response) ? { requestId: requestIdOf(response) } : {}),
      });
    }
    return parsed.data;
  }

  return {
    baseUrl,
    getProject: () => send("/v1/project", { method: "GET", schema: machineProjectSchema }),
    uploadRun: (body, uploadOptions) => {
      const key = uploadOptions?.idempotencyKey ?? `sync:${body.run.id}`;
      if (key.length < 8 || key.length > 200) {
        throw new Error("An Idempotency-Key must be 8–200 characters; pass an explicit one.");
      }
      return send("/v1/runs", {
        method: "POST",
        body: JSON.stringify(body),
        idempotencyKey: key,
        schema: runUploadResultSchema,
      });
    },
  };
}

function assertProjectToken(value: string, origin: string): string {
  const token = value.trim();
  if (!token.startsWith("psk_")) {
    throw new Error(
      `The credential from ${origin} is not a project token: the machine API accepts ` +
        "`Authorization: Bearer psk_…` only. Session cookies are not supported here."
    );
  }
  return token;
}

function requestIdOf(response: Response): string | undefined {
  const value = response.headers.get("x-request-id");
  return value ?? undefined;
}

async function toApiError(response: Response): Promise<ProofcoreApiError> {
  const raw = await response.text().catch(() => "");
  const retryAfter = Number(response.headers.get("retry-after"));
  let code = `http_${response.status}`;
  let message = raw.slice(0, 500) || `HTTP ${response.status}`;
  let category: string | undefined;
  let details: unknown;
  let requestId = requestIdOf(response);

  if (raw) {
    try {
      const parsed = apiErrorBodySchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        code = parsed.data.error.code;
        message = parsed.data.error.message;
        category = parsed.data.error.category;
        details = parsed.data.error.details;
        requestId = parsed.data.error.requestId ?? requestId;
      }
    } catch {
      // A non-JSON error body (a proxy page, an HTML 502) is reported verbatim below.
    }
  }

  return new ProofcoreApiError({
    status: response.status,
    code,
    message,
    ...(category !== undefined ? { category } : {}),
    ...(details !== undefined ? { details } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
    ...(Number.isFinite(retryAfter) ? { retryAfterSeconds: retryAfter } : {}),
  });
}
