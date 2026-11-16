import type { Assertion, Evidence, TestCaseResult } from "@proofstack/contracts";
import { ProofstackError, sha256Hex } from "@proofstack/core";
import type { EvidenceStore, ReportCall, TestContext } from "./types.js";

/** Control-flow signals: they are not failures, and must never be reported as such. */
export class SkipRequested extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "SkipRequested";
  }
}

export class AssertionFailed extends ProofstackError {
  constructor(
    message: string,
    readonly details_: Record<string, unknown>,
    /**
     * The caller's specific failure code (e.g. `duplicate_order_created`). The engine
     * must not overwrite it with a generic one: a report whose every failure says
     * "assertion_failed" cannot be triaged, and the fingerprint that groups the same
     * defect across runs depends on this being specific.
     */
    code = "assertion_failed"
  ) {
    super({ message, category: "ASSERTION", code, details: details_ });
    this.name = "AssertionFailed";
  }
}

export class TimeoutRequested extends ProofstackError {
  constructor(message: string, details: Record<string, unknown>) {
    super({ message, category: "TIMEOUT", code: "case_timeout", details, retryable: true });
    this.name = "TimeoutRequested";
  }
}

export interface ContextSeed {
  runId: string;
  caseId: string;
  suiteId: string;
  module: TestCaseResult["module"];
  environment: TestCaseResult["environment"];
  config: TestContext["config"];
  profile?: string;
  clock: TestContext["clock"];
  log: TestContext["log"];
  rng: TestContext["rng"];
  signal: AbortSignal;
  timeoutMs: number;
  store: EvidenceStore;
}

/** Mutable while a case runs; frozen into the TestCaseResult afterwards. */
export class CaseContext implements TestContext {
  readonly runId: string;
  readonly caseId: string;
  readonly suiteId: string;
  readonly module: TestCaseResult["module"];
  readonly environment: TestCaseResult["environment"];
  readonly config: TestContext["config"];
  readonly profile?: string;
  readonly clock: TestContext["clock"];
  readonly log: TestContext["log"];
  readonly rng: TestContext["rng"];
  readonly signal: AbortSignal;
  readonly timeoutMs: number;

  private readonly store: EvidenceStore;
  private readonly assertionList: Assertion[] = [];
  private readonly reportList: ReportCall[] = [];
  private readonly evidenceList: Evidence[] = [];
  private evidenceSeq = 0;

  constructor(seed: ContextSeed) {
    this.runId = seed.runId;
    this.caseId = seed.caseId;
    this.suiteId = seed.suiteId;
    this.module = seed.module;
    this.environment = seed.environment;
    this.config = seed.config;
    this.profile = seed.profile;
    this.clock = seed.clock;
    this.log = seed.log;
    this.rng = seed.rng;
    this.signal = seed.signal;
    this.timeoutMs = seed.timeoutMs;
    this.store = seed.store;
  }

  get assertions(): readonly Assertion[] {
    return this.assertionList;
  }
  get reports(): readonly ReportCall[] {
    return this.reportList;
  }
  get evidence(): readonly Evidence[] {
    return this.evidenceList;
  }

  check(
    condition: boolean,
    input: {
      description: string;
      expected?: unknown;
      actual?: unknown;
      target?: string;
      severity?: TestCaseResult["severity"];
      code?: string;
      detail?: string;
    }
  ): void {
    const assertion: Assertion = {
      id: `${this.caseId}#a${this.assertionList.length + 1}`,
      description: input.description,
      expected: input.expected,
      actual: input.actual,
      status: condition ? "PASSED" : "FAILED",
      ...(input.target === undefined ? {} : { target: input.target }),
    };
    this.assertionList.push(assertion);
    if (condition) return;
    const summary = `${input.description}${
      input.target ? ` [${input.target}]` : ""
    } — expected ${render(input.expected)}, got ${render(input.actual)}`;
    this.log.warn("assertion failed", { caseId: this.caseId, target: input.target });
    throw new AssertionFailed(
      input.detail ? `${summary} — ${input.detail}` : summary,
      {
        caseId: this.caseId,
        assertionId: assertion.id,
        severity: input.severity ?? "MEDIUM",
        ...(input.code === undefined ? {} : { code: input.code }),
        ...(input.target === undefined ? {} : { target: input.target }),
        expected: safe(input.expected),
        actual: safe(input.actual),
      },
      input.code ?? "assertion_failed"
    );
  }

  equal(actual: unknown, expected: unknown, description: string, target?: string): void {
    this.check(deepEqual(actual, expected), {
      description,
      expected,
      actual,
      ...(target === undefined ? {} : { target }),
    });
  }

  warn(input: ReportCall): void {
    this.reportList.push({
      ...input,
      severity: input.severity === "CRITICAL" ? "HIGH" : input.severity,
    });
  }

  report(input: ReportCall): void {
    this.reportList.push(input);
  }

  skip(reason: string): never {
    throw new SkipRequested(reason);
  }

  async attachText(input: {
    label: string;
    kind?: Evidence["kind"];
    text: string;
    mediaType?: string;
  }): Promise<Evidence> {
    this.evidenceSeq += 1;
    const key = `${this.caseId}--text-${this.evidenceSeq}`;
    const bytes = new TextEncoder().encode(input.text);
    const evidence = await this.store.put({
      caseId: this.caseId,
      key,
      bytes,
      label: input.label,
      kind: input.kind ?? "log",
      createdAt: this.clock.iso(),
      ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
    });
    this.evidenceList.push(evidence);
    return evidence;
  }

  async attachBytes(input: {
    label: string;
    kind?: Evidence["kind"];
    bytes: Uint8Array;
    mediaType?: string;
    key?: string;
  }): Promise<Evidence> {
    this.evidenceSeq += 1;
    const key = input.key ?? `${this.caseId}--bin-${this.evidenceSeq}`;
    const evidence = await this.store.put({
      caseId: this.caseId,
      key,
      bytes: input.bytes,
      label: input.label,
      kind: input.kind ?? "screenshot",
      createdAt: this.clock.iso(),
      ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
    });
    this.evidenceList.push(evidence);
    return evidence;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(
          new ProofstackError({
            message: "cancelled",
            category: "TIMEOUT",
            code: "cancelled",
            retryable: false,
          })
        );
      };
      if (this.signal.aborted) {
        clearTimeout(timer);
        onAbort();
        return;
      }
      this.signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

/** Empty store used when the caller did not provide one (nothing is persisted). */
export class NullEvidenceStore implements EvidenceStore {
  async put(input: {
    caseId: string;
    key: string;
    bytes: Uint8Array;
    mediaType?: string;
    label: string;
    kind: Evidence["kind"];
    createdAt: string;
  }): Promise<Evidence> {
    const digest = await sha256Hex(input.bytes);
    return {
      id: `ev_${input.key}`,
      kind: input.kind,
      label: input.label,
      ref: {
        storage: "local",
        path: `.proofstack/evidence/${input.key}`,
        sha256: digest,
        bytes: input.bytes.byteLength,
      },
      ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
      createdAt: input.createdAt,
    };
  }
}

/**
 * Keeps blobs in memory for the lifetime of the process: used by tests and by the
 * CLI when the caller asked for evidence to be inspected before writing reports.
 * Nothing is uploaded: `put` returns a ref with a digest, and the bytes stay here.
 */
export class MemoryEvidenceStore implements EvidenceStore {
  readonly blobs = new Map<string, Uint8Array>();

  async put(input: {
    caseId: string;
    key: string;
    bytes: Uint8Array;
    mediaType?: string;
    label: string;
    kind: Evidence["kind"];
    createdAt: string;
  }): Promise<Evidence> {
    this.blobs.set(input.key, input.bytes);
    const digest = await sha256Hex(input.bytes);
    return {
      id: `ev_${input.key}`,
      kind: input.kind,
      label: input.label,
      ref: {
        storage: "local",
        path: `.proofstack/evidence/${input.key}`,
        sha256: digest,
        bytes: input.bytes.byteLength,
      },
      ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
      createdAt: input.createdAt,
    };
  }
}

function render(value: unknown): string {
  if (typeof value === "string")
    return JSON.stringify(value.length > 80 ? `${value.slice(0, 80)}…` : value);
  return JSON.stringify(safe(value)) ?? String(value);
}

/** Never put a cyclic or binary object into a report field. */
function safe(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (ArrayBuffer.isView(value)) return `[binary ${(value as Uint8Array).byteLength}B]`;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  for (const key of ak) {
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
      return false;
  }
  return true;
}
