import type { ProofCoreConfig } from "@proofcore/contracts";
import { ProofCoreError } from "@proofcore/core";

/**
 * The surface WORLD drives against.
 *
 * WORLD never asserts anything about a product it cannot reach. A target exposes
 * three capabilities, each optional, and every check declares which one it needs:
 *  - `submit`   — send a record, learn whether the product accepted it and what it
 *                 stored (the stored echo is what makes corruption detectable);
 *  - `readback` — fetch the stored record again, for a second, independent look;
 *  - `sorted`   — ask the product to sort values under a locale, for collation.
 *
 * A missing capability produces SKIPPED cases with a reason, never a pass.
 */

export interface ProductFields {
  [field: string]: string;
}

export interface SubmitInput {
  profile: string;
  category: string;
  fields: ProductFields;
  /** Lets a target dedupe retries; the engine always sends one per case. */
  idempotencyKey: string;
}

export interface SubmitResult {
  accepted: boolean;
  recordId?: string;
  /** What the product says it stored. Absent means "not told", which is itself a finding. */
  stored?: ProductFields;
  errors?: Record<string, string>;
  httpStatus?: number;
  /** Short, redacted excerpt for the report. Never a full customer payload. */
  rawSample?: string;
}

export interface ProductUnderTest {
  readonly name: string;
  readonly capabilities: { submit: true; readback: boolean; sorted: boolean };
  submit(input: SubmitInput): Promise<SubmitResult>;
  readback?(recordId: string): Promise<ProductFields | undefined>;
  sorted?(input: { profile: string; field: string; values: string[] }): Promise<string[]>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * HTTP target. Works in Node 22 and in CI with plain `fetch`; authentication comes
 * from an environment variable so a token never lands in a config file or a report.
 */
export class HttpProductUnderTest implements ProductUnderTest {
  readonly name: string;
  readonly capabilities = { submit: true as const, readback: true, sorted: false };

  private readonly cfg: ProofCoreConfig["modules"]["world"]["target"];
  private readonly fetchImpl: FetchLike;
  private readonly tokenProvider?: () => string | undefined;

  constructor(options: {
    config: ProofCoreConfig;
    name?: string;
    fetchImpl?: FetchLike;
    /** Resolves `target.tokenEnvVar`. Injected so the package stays runtime-agnostic. */
    tokenProvider?: () => string | undefined;
  }) {
    this.cfg = options.config.modules.world.target;
    this.name = options.name ?? `http:${this.cfg.submitUrl ?? "unset"}`;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.tokenProvider = options.tokenProvider;
    if (this.cfg.kind !== "http" || !this.cfg.submitUrl) {
      throw new ProofCoreError({
        message: 'HttpProductUnderTest requires modules.world.target.kind="http" and a submitUrl',
        category: "CONFIGURATION",
        code: "world_target_unconfigured",
      });
    }
    if (this.cfg.readbackUrl === undefined) this.capabilities.readback = false;
    if (this.cfg.sortUrl !== undefined) this.capabilities.sorted = true;
  }

  /**
   * Every request after submit gets the same deadline. Without it a readback or a sort
   * endpoint that never answers hangs the whole engine run, and the case timeout only
   * stops waiting — a leaked socket keeps the process alive.
   */
  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      throw new ProofCoreError({
        message: `WORLD could not reach the product: ${error instanceof Error ? error.message : String(error)}`,
        category: "NETWORK",
        code: "world_target_unreachable",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private headers(): Record<string, string> {
    const out: Record<string, string> = { "content-type": "application/json", ...this.cfg.headers };
    if (this.cfg.tokenEnvVar) {
      const token = this.tokenProvider?.();
      if (!token) {
        throw new ProofCoreError({
          message: `WORLD target needs the ${this.cfg.tokenEnvVar} environment variable`,
          category: "CONFIGURATION",
          code: "world_token_missing",
          details: { envVar: this.cfg.tokenEnvVar },
        });
      }
      out.authorization = `Bearer ${token}`;
    }
    return out;
  }

  async submit(input: SubmitInput): Promise<SubmitResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const response = await this.fetchImpl(this.cfg.submitUrl as string, {
        method: this.cfg.method,
        headers: this.headers(),
        body: JSON.stringify({
          profile: input.profile,
          category: input.category,
          fields: input.fields,
          idempotencyKey: input.idempotencyKey,
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      const parsed = safeJson(text);
      const errors = extractErrors(parsed, this.cfg.errorField);
      return {
        accepted: response.ok && errors === undefined,
        httpStatus: response.status,
        ...(recordIdOf(parsed) === undefined ? {} : { recordId: recordIdOf(parsed) }),
        ...(storedOf(parsed) === undefined ? {} : { stored: storedOf(parsed) }),
        ...(errors === undefined ? {} : { errors }),
        rawSample: text.slice(0, 400),
      };
    } catch (error) {
      throw new ProofCoreError({
        message: `WORLD could not reach the product: ${error instanceof Error ? error.message : String(error)}`,
        category: "NETWORK",
        code: "world_target_unreachable",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async readback(recordId: string): Promise<ProductFields | undefined> {
    const template = this.cfg.readbackUrl;
    if (!template) return undefined;
    const url = template.includes("{recordId}")
      ? template.replace("{recordId}", encodeURIComponent(recordId))
      : `${template}${template.includes("?") ? "&" : "?"}recordId=${encodeURIComponent(recordId)}`;
    const response = await this.request(url, { headers: this.headers() });
    if (!response.ok) return undefined;
    const parsed = safeJson(await response.text());
    return storedOf(parsed);
  }

  async sorted(input: { profile: string; field: string; values: string[] }): Promise<string[]> {
    const url = this.cfg.sortUrl;
    if (!url)
      throw new ProofCoreError({
        message: "WORLD collation checks need modules.world.target.sortUrl",
        category: "CONFIGURATION",
        code: "world_sort_url_missing",
      });
    const response = await this.request(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
    });
    const parsed = safeJson(await response.text()) as { items?: unknown } | null;
    const items = parsed?.items;
    if (!Array.isArray(items) || items.some((i) => typeof i !== "string")) {
      throw new ProofCoreError({
        message: "sort endpoint returned an unexpected shape",
        category: "PROVIDER",
        code: "world_sort_shape",
        details: { sample: JSON.stringify(parsed).slice(0, 200) },
      });
    }
    return items as string[];
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function recordIdOf(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const obj = parsed as Record<string, unknown>;
  for (const key of ["recordId", "id", "uuid"]) {
    if (typeof obj[key] === "string") return obj[key] as string;
  }
  const data = obj.data;
  if (data && typeof data === "object") {
    const nested = data as Record<string, unknown>;
    for (const key of ["recordId", "id"])
      if (typeof nested[key] === "string") return nested[key] as string;
  }
  return undefined;
}

function storedOf(parsed: unknown): ProductFields | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const obj = parsed as Record<string, unknown>;
  for (const key of ["stored", "record", "data", "echo", "object"]) {
    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const out: ProductFields = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
        else if (v === null) out[k] = "";
        else out[k] = String(v);
      }
      return out;
    }
  }
  return undefined;
}

function extractErrors(parsed: unknown, errorField: string): Record<string, string> | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const obj = parsed as Record<string, unknown>;
  const candidates = [obj[errorField], obj.errors, obj.validation, obj.details];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const entries = Object.entries(candidate as Record<string, unknown>);
      if (entries.length === 0) continue;
      const out: Record<string, string> = {};
      for (const [key, value] of entries) {
        out[key] = Array.isArray(value) ? value.map(String).join(", ") : String(value);
      }
      return out;
    }
    if (Array.isArray(candidate) && candidate.length > 0) {
      const out: Record<string, string> = {};
      for (const item of candidate) {
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const field = typeof record.field === "string" ? record.field : "general";
          out[field] = typeof record.message === "string" ? record.message : JSON.stringify(record);
        }
      }
      if (Object.keys(out).length > 0) return out;
    }
  }
  return undefined;
}

/**
 * A target that answers from memory. Used by PROOFCORE's own test suite to prove
 * the detectors actually detect, and by `proofcore init --demo`.
 */
export class SyntheticProductUnderTest implements ProductUnderTest {
  readonly name: string;
  readonly capabilities = { submit: true as const, readback: true, sorted: true };
  private readonly records = new Map<string, ProductFields>();
  private seq = 0;

  constructor(
    private readonly behaviour: {
      /** Return an error message when the product refuses a field value. */
      reject?: (field: string, value: string, profile: string) => string | undefined;
      /** Return what the product would store, to detect corruption. */
      transform?: (field: string, value: string, profile: string) => string;
      sort?: (values: string[], profile: string, field: string) => string[];
    },
    name = "synthetic"
  ) {
    this.name = name;
  }

  async submit(input: SubmitInput): Promise<SubmitResult> {
    const errors: Record<string, string> = {};
    const stored: ProductFields = {};
    for (const [field, value] of Object.entries(input.fields)) {
      const rejection = this.behaviour.reject?.(field, value, input.profile);
      if (rejection) {
        errors[field] = rejection;
        continue;
      }
      stored[field] = this.behaviour.transform
        ? this.behaviour.transform(field, value, input.profile)
        : value;
    }
    const failed = Object.keys(errors).length > 0;
    if (failed) return { accepted: false, errors, stored: undefined };
    const recordId = `rec_${++this.seq}`;
    this.records.set(recordId, stored);
    return { accepted: true, recordId, stored };
  }

  async readback(recordId: string): Promise<ProductFields | undefined> {
    return this.records.get(recordId);
  }

  async sorted(input: { profile: string; field: string; values: string[] }): Promise<string[]> {
    if (this.behaviour.sort)
      return this.behaviour.sort([...input.values], input.profile, input.field);
    return [...input.values].sort((a, b) =>
      a.localeCompare(b, input.profile, { sensitivity: "variant" })
    );
  }
}
