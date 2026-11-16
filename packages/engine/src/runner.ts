import {
  type Assertion,
  aggregateStatus,
  type Finding,
  type ModuleId,
  type ModuleRun,
  type RunStatus,
  type Severity,
  type TestCaseResult,
  type TestRun,
  type TestStatus,
  testRunSchema,
} from "@proofstack/contracts";
import {
  type Clock,
  durationMs,
  FixedClock,
  Logger,
  ProofstackError,
  sha256Hex,
  toFailureRecord,
  uuid,
} from "@proofstack/core";
import {
  AssertionFailed,
  CaseContext,
  NullEvidenceStore,
  SkipRequested,
  TimeoutRequested,
} from "./context.js";
import { fingerprintFinding } from "./fingerprint.js";
import { rngFor } from "./rng.js";
import type {
  CaseOutcome,
  EngineOptions,
  EvidenceStore,
  ModuleProvider,
  ReportCall,
  TestCaseDef,
  TestSuiteDef,
} from "./types.js";

/**
 * One scheduler for the whole suite.
 *
 * Guarantees the product depends on:
 *  - cases are scheduled in declaration order and reported in that same order, so
 *    two runs of the same config produce identical reports;
 *  - a case that errors is ERROR, never FAILED and never PASSED;
 *  - retries apply only to retryable ERROR outcomes, never to a real product
 *    failure — retrying a defect does not hide it;
 *  - cancellation stops scheduling, and the un-run cases are reported as SKIPPED
 *    with a reason rather than disappearing;
 *  - the assembled run is validated against the shared contract before it is
 *    returned, so the CLI, the API and the dashboard cannot drift apart.
 */

export const ENGINE_VERSION = "0.1.0";

export interface EngineRunResult {
  run: TestRun;
  cancelled: boolean;
}

interface Planned {
  provider: ModuleProvider;
  suite: TestSuiteDef;
  caseDef: TestCaseDef;
  index: number;
}

export async function runEngine(options: EngineOptions): Promise<EngineRunResult> {
  const { config } = options;
  const clock: Clock = options.clock ?? new FixedClock(Date.now());
  const logger = options.logger ?? new Logger({ level: "info" });
  const store: EvidenceStore = options.evidenceStore ?? new NullEvidenceStore();
  const runId = options.runId ?? `run_${uuid()}`;
  const only = new Set<ModuleId>(options.only ?? config.enabledModules);
  const providers = options.providers.filter((p) => only.has(p.id));
  const onlyCases = (options.onlyCases ?? []).map((pattern) => pattern.trim().toLowerCase()).filter(Boolean);

  if (providers.length === 0) {
    throw new ProofstackError({
      message: `no module provider selected (requested: ${[...only].join(", ") || "none"})`,
      category: "CONFIGURATION",
      code: "no_providers",
      details: { requested: [...only] },
    });
  }

  const controller = new AbortController();
  const external = options.signal;
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else
      external.addEventListener("abort", () => controller.abort(external.reason), { once: true });
  }

  const startedAt = clock.now();
  const planned: Planned[] = [];
  for (const provider of providers) {
    const suites = await provider.suites({
      config,
      environment: config.environment,
      ...(options.profiles === undefined ? {} : { profiles: options.profiles }),
    });
    for (const suite of suites) {
      for (const caseDef of suite.cases) {
        if (onlyCases.length > 0 && !matchesOnlyCases(caseDef, suite, onlyCases)) continue;
        planned.push({ provider, suite, caseDef, index: planned.length });
      }
    }
  }

  // An explicit `--only` that matches nothing is an operator error, not an empty pass.
  // A provider that legitimately emits no cases is left to the status model, where an
  // empty module is ERROR rather than a vacuous success.
  if (planned.length === 0 && onlyCases.length > 0) {
    throw new ProofstackError({
      message: `no case matched --only ${onlyCases.join(", ")}`,
      category: "CONFIGURATION",
      code: "no_matching_cases",
      details: { onlyCases, requestedModules: [...only] },
    });
  }

  // A module whose cases were all filtered out by `--only` must not appear as an
  // empty ERROR module: it simply did not participate in this run.
  const activeIds = new Set(planned.map((item) => item.provider.id));
  const activeProviders =
    onlyCases.length > 0
      ? providers.filter((provider) => activeIds.has(provider.id))
      : providers;

  logger.debug("engine scheduled", {
    runId,
    cases: planned.length,
    modules: activeProviders.map((p) => p.id),
  });

  const outcomes = new Map<number, CaseOutcome>();
  let cursor = 0;
  let stopRequested = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (controller.signal.aborted || stopRequested) return;
      const index = cursor++;
      if (index >= planned.length) return;
      const item = planned[index]!;
      const outcome = await executeCase(item, {
        runId,
        config,
        clock,
        logger,
        store,
        signal: controller.signal,
      });
      outcomes.set(index, outcome);
      if (config.engine.stopOnCritical && outcome.findings.some((f) => f.severity === "CRITICAL")) {
        logger.warn("stopOnCritical: halting scheduling", { runId, caseId: outcome.result.id });
        stopRequested = true;
        return;
      }
    }
  };

  const concurrency = Math.min(config.engine.parallel, Math.max(1, planned.length));
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const dropReason = controller.signal.aborted
    ? "cancelled before execution"
    : stopRequested
      ? "not executed: stopped after a CRITICAL finding"
      : "not executed";

  for (const item of planned) {
    if (outcomes.has(item.index)) continue;
    const now = clock.iso();
    outcomes.set(item.index, {
      result: {
        ...baseResult(item.caseDef, item.suite.id, {
          status: "SKIPPED",
          startedAt: now,
          endedAt: now,
          durationMs: 0,
          environment: config.environment,
          skippedReason: dropReason,
          ...(options.revision === undefined ? {} : { revision: options.revision }),
        }),
      },
      findings: [],
    });
  }

  const ordered: CaseOutcome[] = [...outcomes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1]);

  const allFindings: Finding[] = [];
  for (const outcome of ordered) allFindings.push(...outcome.findings);

  const moduleRuns: ModuleRun[] = activeProviders.map((provider) => {
    const cases = ordered.filter((o) => o.result.module === provider.id).map((o) => o.result);
    const starts = cases.map((c) => Date.parse(c.startedAt));
    const ends = cases.map((c) => Date.parse(c.endedAt));
    return {
      module: provider.id,
      status: controller.signal.aborted
        ? "CANCELLED"
        : stopRequested
          ? "PARTIAL"
          : aggregateStatus(cases.map((c) => c.status)),
      startedAt: boundary(starts, "min", clock),
      endedAt: boundary(ends, "max", clock),
      durationMs: cases.reduce((acc, c) => acc + c.durationMs, 0),
      totals: {
        total: cases.length,
        passed: count(cases, "PASSED"),
        failed: count(cases, "FAILED"),
        warnings: count(cases, "WARNING"),
        skipped: count(cases, "SKIPPED"),
        errors: count(cases, "ERROR"),
      },
      cases,
    };
  });

  const endedAt = clock.now();
  const runStatus: RunStatus = controller.signal.aborted
    ? "CANCELLED"
    : moduleRuns.length === 0
      ? "ERROR"
      : moduleRuns.every((m) => m.status === "COMPLETED")
        ? "COMPLETED"
        : moduleRuns.some((m) => m.status === "ERROR")
          ? "ERROR"
          : moduleRuns.some((m) => m.status === "FAILED")
            ? "FAILED"
            : moduleRuns.some((m) => m.status === "CANCELLED")
              ? "CANCELLED"
              : moduleRuns.every((m) => m.status === "NOTHING_VERIFIED")
                ? "NOTHING_VERIFIED"
                : "PARTIAL";

  const candidate: TestRun = {
    id: runId,
    projectId: options.projectId ?? `local:${config.project.name}`,
    workspaceId: options.workspaceId ?? `local:${config.project.name}`,
    environment: config.environment,
    ...(options.revision === undefined ? {} : { revision: options.revision }),
    status: runStatus,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationMs: durationMs(startedAt, endedAt),
    modules: activeProviders.map((p) => p.id),
    moduleRuns,
    findings: allFindings,
    engineVersion: ENGINE_VERSION,
    ...(options.cliVersion === undefined ? {} : { cliVersion: options.cliVersion }),
    ...(options.host === undefined ? {} : { host: options.host }),
  };

  const parsed = testRunSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => ` - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ProofstackError({
      message: `engine produced a run that violates the shared contract:\n${issues}`,
      category: "INTERNAL",
      code: "contract_violation",
      details: { issueCount: parsed.error.issues.length },
    });
  }

  return { run: parsed.data, cancelled: controller.signal.aborted };
}

interface ExecuteDeps {
  runId: string;
  config: EngineOptions["config"];
  clock: Clock;
  logger: Logger;
  store: EvidenceStore;
  signal: AbortSignal;
}

async function executeCase(item: Planned, deps: ExecuteDeps): Promise<CaseOutcome> {
  const { caseDef } = item;
  const timeoutMs = caseDef.timeoutMs ?? deps.config.engine.timeoutMs;
  const maxAttempts = deps.config.engine.retries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const local = new AbortController();
    const onOuterAbort = () => local.abort(deps.signal.reason);
    if (deps.signal.aborted) local.abort(deps.signal.reason);
    else deps.signal.addEventListener("abort", onOuterAbort, { once: true });

    const startedAt = deps.clock.now();
    const ctx = new CaseContext({
      runId: deps.runId,
      caseId: caseDef.id,
      suiteId: item.suite.id,
      module: caseDef.module,
      environment: deps.config.environment,
      config: deps.config,
      ...(caseDef.profile === undefined ? {} : { profile: caseDef.profile }),
      clock: deps.clock,
      log: deps.logger.child({ caseId: caseDef.id, attempt, module: caseDef.module }),
      rng: rngFor(deps.config.engine.seed, caseDef.id, attempt),
      signal: local.signal,
      timeoutMs,
      store: deps.store,
    });

    let status: TestStatus = "PASSED";
    let failure: TestCaseResult["failure"] | undefined;
    let skippedReason: string | undefined;

    try {
      if (caseDef.skip) throw new SkipRequested(caseDef.skip);
      await raceWithTimeout(caseDef.execute(ctx), timeoutMs, local, caseDef.id);
      if (ctx.reports.length > 0) status = "WARNING";
    } catch (error) {
      if (error instanceof SkipRequested) {
        status = "SKIPPED";
        skippedReason = error.reason;
      } else if (error instanceof AssertionFailed) {
        status = "FAILED";
        failure = {
          message: error.message,
          category: error.category,
          code: error.code,
          retryable: false,
        };
      } else if (error instanceof TimeoutRequested) {
        status = "ERROR";
        failure = {
          message: error.message,
          category: "TIMEOUT",
          code: error.code,
          retryable: true,
        };
      } else {
        const record = toFailureRecord(error);
        status = "ERROR";
        failure = {
          message: record.message,
          category: record.category,
          code: record.code,
          retryable: retryableCategory(deps.config.engine.retryOn, record.category),
        };
      }
    } finally {
      deps.signal.removeEventListener("abort", onOuterAbort);
    }

    const endedAt = deps.clock.now();
    const isLastAttempt = attempt >= maxAttempts;

    if (!isLastAttempt && failure?.retryable === true && status === "ERROR") {
      deps.logger.warn("retrying case after harness error", {
        caseId: caseDef.id,
        attempt,
        category: failure.category,
      });
      continue;
    }

    const result: TestCaseResult = {
      ...baseResult(caseDef, item.suite.id, {
        status,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        durationMs: durationMs(startedAt, endedAt),
        environment: deps.config.environment,
        ...(deps.config.project.revision === undefined
          ? {}
          : { revision: deps.config.project.revision }),
        ...(skippedReason === undefined ? {} : { skippedReason }),
        ...(failure === undefined ? {} : { failure }),
      }),
      assertions: [...ctx.assertions],
      evidence: [...ctx.evidence],
      attempts: attempt,
      ...(caseDef.profile === undefined ? {} : { profile: caseDef.profile }),
    };

    const findings = await buildFindings(
      result,
      ctx.assertions,
      ctx.reports,
      ctx.evidence.map((e) => e.id)
    );
    result.findingIds = findings.map((f) => f.id);
    return { result, findings };
  }

  throw new ProofstackError({
    message: "engine: unreachable retry exit",
    category: "INTERNAL",
    code: "unreachable",
  });
}

function retryableCategory(retryOn: readonly string[], category: string): boolean {
  if (category === "TIMEOUT") return retryOn.includes("TIMEOUT");
  if (category === "NETWORK" || category === "RATE_LIMITED") return retryOn.includes("ERROR");
  return false;
}

/**
 * JS cannot preempt a synchronous loop, so a timeout stops *waiting* and aborts the
 * case's signal. A case that ignores its signal is still reported as ERROR/TIMEOUT
 * rather than being silently treated as slow-but-passing.
 */
async function raceWithTimeout(
  work: void | Promise<void>,
  timeoutMs: number,
  local: AbortController,
  caseId: string
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(work).then(() => undefined),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          local.abort("timeout");
          reject(
            new TimeoutRequested(`case ${caseId} exceeded ${timeoutMs}ms`, { caseId, timeoutMs })
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * `--only` is a substring filter over the fields a human would type or copy from a
 * report. It is applied by the scheduler rather than by each module so WORLD, FLOW and
 * EXIT all honour it the same way, including fixture-category patterns like "address"
 * (WORLD case ids embed the profile and category).
 */
function matchesOnlyCases(
  caseDef: TestCaseDef,
  suite: TestSuiteDef,
  patterns: readonly string[]
): boolean {
  const haystacks = [
    caseDef.id,
    caseDef.name,
    caseDef.module,
    caseDef.profile ?? "",
    suite.id,
    suite.name,
  ].map((value) => value.toLowerCase());
  return patterns.some((pattern) => haystacks.some((value) => value.includes(pattern)));
}

function baseResult(
  caseDef: TestCaseDef,
  suiteId: string,
  fields: {
    status: TestStatus;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    environment: TestCaseResult["environment"];
    revision?: string;
    skippedReason?: string;
    failure?: TestCaseResult["failure"];
  }
): TestCaseResult {
  return {
    id: caseDef.id,
    name: caseDef.name,
    module: caseDef.module,
    description: caseDef.description,
    status: fields.status,
    severity: caseDef.severity,
    startedAt: fields.startedAt,
    endedAt: fields.endedAt,
    durationMs: fields.durationMs,
    environment: fields.environment,
    suiteId,
    assertions: [],
    findingIds: [],
    evidence: [],
    logs: [],
    attempts: 1,
    ...(fields.revision === undefined ? {} : { revision: fields.revision }),
    ...(fields.skippedReason === undefined ? {} : { skippedReason: fields.skippedReason }),
    ...(fields.failure === undefined ? {} : { failure: fields.failure }),
  };
}

/**
 * Findings come from failed assertions, explicit `ctx.report()` calls and execution
 * errors. The reproduction command is generated from the config that produced the
 * run, so every report line is actionable rather than decorative.
 */
async function buildFindings(
  result: TestCaseResult,
  assertions: readonly Assertion[],
  reports: readonly ReportCall[],
  evidenceIds: readonly string[]
): Promise<Finding[]> {
  const out: Finding[] = [];
  const repro = {
    summary: `Re-run only this case: ${result.id}`,
    command: `proofstack test --module ${result.module} --only ${result.id}`,
    fixtureIds: [] as string[],
    environment: result.environment,
  };

  for (const assertion of assertions.filter((a) => a.status === "FAILED")) {
    const fingerprint = await fingerprintFinding({
      module: result.module,
      testCaseId: result.id,
      detail: assertion.description,
      code: result.failure?.code,
      profile: result.profile,
      field: assertion.target,
    });
    out.push({
      id: `fnd_${await shortHash(`${result.id}${assertion.id}`)}`,
      testCaseId: result.id,
      module: result.module,
      title: `${result.name}: ${assertion.description}`,
      detail: `Expected ${render(assertion.expected)}, received ${render(assertion.actual)}`,
      severity: result.severity,
      status: "FAILED",
      fingerprint,
      ...(assertion.target === undefined ? {} : { field: assertion.target }),
      failure: {
        message: `assertion ${assertion.id} failed`,
        category: "ASSERTION",
        // The specific code the module raised, so a finding is triageable and the
        // fingerprint groups the same defect across runs.
        code: result.failure?.code ?? "assertion_failed",
        expected: render(assertion.expected),
        actual: render(assertion.actual),
      },
      reproduction: repro,
      evidenceIds: [...evidenceIds],
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      durationMs: result.durationMs,
    });
  }

  for (const report of reports) {
    const fingerprint = await fingerprintFinding({
      module: result.module,
      testCaseId: result.id,
      detail: report.detail,
      code: report.code,
      profile: report.locale,
      field: report.field,
    });
    out.push({
      id: `fnd_${await shortHash(`${result.id}${report.title}`)}`,
      testCaseId: result.id,
      module: result.module,
      title: `${result.name}: ${report.title}`,
      detail: report.detail,
      severity: report.severity,
      status: "WARNING",
      fingerprint,
      ...(report.locale === undefined ? {} : { locale: report.locale }),
      ...(report.country === undefined ? {} : { country: report.country }),
      ...(report.field === undefined ? {} : { field: report.field }),
      reproduction: repro,
      evidenceIds: report.evidenceIds ?? [...evidenceIds],
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      durationMs: result.durationMs,
    });
  }

  if (result.status === "ERROR" && result.failure) {
    // An unevaluated check is reported, so it can never look like "nothing found".
    const fingerprint = await fingerprintFinding({
      module: result.module,
      testCaseId: result.id,
      detail: result.failure.message,
      code: result.failure.code,
    });
    out.push({
      id: `fnd_${await shortHash(`${result.id}err`)}`,
      testCaseId: result.id,
      module: result.module,
      title: `${result.name}: execution error`,
      detail: result.failure.message,
      severity: "MEDIUM" as Severity,
      status: "ERROR",
      fingerprint,
      failure: {
        message: result.failure.message,
        category: result.failure.category,
        code: result.failure.code,
      },
      reproduction: {
        summary: "The check could not be evaluated; this is not a product verdict.",
        command: `proofstack doctor && proofstack test --module ${result.module} --only ${result.id}`,
        fixtureIds: [],
        environment: result.environment,
        ...(result.failure.retryable === undefined
          ? {}
          : { notes: result.failure.retryable ? "Retried and still failing." : "Not retried." }),
      },
      evidenceIds: [...evidenceIds],
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      durationMs: result.durationMs,
    });
  }

  return out;
}

async function shortHash(value: string): Promise<string> {
  return (await sha256Hex(value)).slice(0, 16);
}

function render(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function count(cases: readonly TestCaseResult[], status: TestStatus): number {
  return cases.filter((c) => c.status === status).length;
}

function boundary(values: number[], mode: "min" | "max", clock: Clock): string {
  if (values.length === 0) return clock.iso();
  const picked = mode === "min" ? Math.min(...values) : Math.max(...values);
  return new Date(picked).toISOString();
}
