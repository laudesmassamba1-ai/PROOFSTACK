import type {
  Assertion,
  EnvironmentKind,
  Evidence,
  Finding,
  ModuleId,
  ProofstackConfig,
  Severity,
  TestCaseResult,
  TestStatus,
} from "@proofstack/contracts";
import type { Clock, Logger } from "@proofstack/core";
import type { Rng } from "./rng.js";

/**
 * Engine-facing types. Modules implement `ModuleProvider`; everything else in the
 * product (CLI, API, dashboard, reports) consumes `TestRun` from the contracts.
 */

export interface EvidenceStore {
  /**
   * Persist a blob and return the reference that goes into the report. Large
   * artefacts stay local or in CI artifacts: what lands in the report is a pointer
   * plus a digest, never the bytes.
   */
  put(input: {
    caseId: string;
    key: string;
    bytes: Uint8Array;
    mediaType?: string;
    label: string;
    kind: Evidence["kind"];
    createdAt: string;
  }): Promise<Evidence>;
}

export interface ReportCall {
  title: string;
  detail: string;
  severity: Severity;
  field?: string;
  code?: string;
  locale?: string;
  country?: string;
  evidenceIds?: string[];
}

export interface TestContext {
  readonly runId: string;
  readonly caseId: string;
  readonly suiteId: string;
  readonly module: ModuleId;
  readonly environment: EnvironmentKind;
  readonly config: ProofstackConfig;
  readonly profile?: string;
  readonly clock: Clock;
  readonly log: Logger;
  readonly rng: Rng;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  /** Assertion outcomes collected for the report. */
  readonly assertions: readonly Assertion[];
  /** Findings the case chose to report without failing (WARNING-level insights). */
  readonly reports: readonly ReportCall[];
  readonly evidence: readonly Evidence[];

  /** Record a check and fail the case when it does not hold. */
  check(
    condition: boolean,
    input: {
      description: string;
      expected?: unknown;
      actual?: unknown;
      target?: string;
      severity?: Severity;
      code?: string;
      detail?: string;
    }
  ): void;
  /** Convenience wrapper: fail when two values differ. */
  equal(actual: unknown, expected: unknown, description: string, target?: string): void;
  /** Record an observation that is not a failure but must be visible. */
  warn(input: ReportCall): void;
  /** Report a finding without failing the case. */
  report(input: ReportCall): void;
  /** Stop the case as SKIPPED with a reason surfaced in the report. */
  skip(reason: string): never;
  /** Attach text evidence (log excerpt, payload, diff) to the case. */
  attachText(input: {
    label: string;
    kind?: Evidence["kind"];
    text: string;
    mediaType?: string;
  }): Promise<Evidence>;
  /** Attach binary evidence (screenshot) through the configured store. */
  attachBytes(input: {
    label: string;
    kind?: Evidence["kind"];
    bytes: Uint8Array;
    mediaType?: string;
    key?: string;
  }): Promise<Evidence>;
  /** Wait, refusing to outlive the case timeout or a cancellation. */
  sleep(ms: number): Promise<void>;
}

export interface TestCaseDef {
  id: string;
  name: string;
  description: string;
  module: ModuleId;
  severity: Severity;
  suiteId: string;
  profile?: string;
  /** Overrides `engine.timeoutMs` for this case. */
  timeoutMs?: number;
  /** Set to a reason string to ship the case as SKIPPED with an explanation. */
  skip?: string;
  execute(ctx: TestContext): Promise<void> | void;
}

export interface TestSuiteDef {
  id: string;
  name: string;
  module: ModuleId;
  description?: string;
  cases: TestCaseDef[];
}

export interface SuiteInput {
  config: ProofstackConfig;
  environment: EnvironmentKind;
  /** Only these profiles, when the caller narrowed the run. */
  profiles?: string[];
}

export interface ModuleProvider {
  readonly id: ModuleId;
  readonly version: string;
  /** Short label shown in reports, e.g. "WORLD". */
  readonly label: string;
  suites(input: SuiteInput): Promise<TestSuiteDef[]> | TestSuiteDef[];
}

export interface EngineEvent {
  type: "scheduled" | "case-start" | "case-end";
  total?: number;
  module?: ModuleId;
  name?: string;
  status?: TestStatus;
  durationMs?: number;
}

export interface EngineOptions {
  config: ProofstackConfig;
  providers: ModuleProvider[];
  /** Restrict which providers participate; defaults to config.enabledModules. */
  only?: ModuleId[];
  /** Case filter (`--only`): substring match on case id, name, suite, profile or module. */
  onlyCases?: string[];
  profiles?: string[];
  clock?: Clock;
  logger?: Logger;
  /** Observability hook for the CLI; never used to make a verification decision. */
  onEvent?: (event: EngineEvent) => void;
  evidenceStore?: EvidenceStore;
  signal?: AbortSignal;
  runId?: string;
  revision?: string;
  host?: TestRunHostInfo;
  /**
   * Cloud identity, supplied by the CLI from its project token. Local runs use
   * `local:<project.name>` so a report always has an owner.
   */
  projectId?: string;
  workspaceId?: string;
  cliVersion?: string;
}

export interface TestRunHostInfo {
  platform: string;
  nodeVersion: string;
  ci: boolean;
}

export interface CaseOutcome {
  result: TestCaseResult;
  findings: Finding[];
}
