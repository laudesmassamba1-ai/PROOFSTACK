/**
 * `proofcore scan|audit … --sync` — push a page-scan result into the cloud as a run.
 *
 * The page scan (`proofcore scan`, `proofcore audit fail|clean`) already shares the
 * run / finding pipeline with the engine modules: the contracts say FAIL and CLEAN are
 * audits that ride the same history, insights and webhooks as everything else. This
 * module is the bridge that was missing on the CLI side: it turns a `ScanResult` into a
 * `TestRun` payload shaped exactly like what `POST /v1/runs` accepts, so a scan run from
 * a terminal is retrievable in the dashboard like any other run — no second command,
 * no divergence between what the CLI showed and what the cloud recorded.
 *
 * Honesty rules carried over from the scan itself:
 *   - a check that was not measured stays SKIPPED, never a pass;
 *   - only WARN and FAIL become findings: a passed check is an answer, not a defect;
 *   - the run id is derived from the scan identity (final URL + scan time), so a retried
 *     upload presents the same Idempotency-Key and the API records it once.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stdout } from "node:process";
import {
  aggregateStatus,
  type Finding,
  type ModuleRun,
  type TestCaseResult,
  type TestRun,
} from "@proofcore/contracts";
import { type ScanResult, type ScanStatus, stableStringify } from "@proofcore/core";

/** Same vocabulary as index.ts — duplicated here to keep the entry point acyclic. */
export interface SyncFlags {
  json: boolean;
  quiet: boolean;
  color: boolean;
}

function paint(flags: SyncFlags, code: string, text: string): string {
  return flags.color ? `\u001B[${code}m${text}\u001B[0m` : text;
}

const green = (f: SyncFlags, t: string) => paint(f, "32", t);
const red = (f: SyncFlags, t: string) => paint(f, "31", t);
const dim = (f: SyncFlags, t: string) => paint(f, "2", t);

function out(flags: SyncFlags, text: string): void {
  if (!flags.quiet) stdout.write(`${text}\n`);
}

function errSync(_flags: SyncFlags, text: string): void {
  process.stderr.write(`${text}\n`);
}

const SCAN_STATUS_TO_CASE: Record<ScanStatus, TestCaseResult["status"]> = {
  PASS: "PASSED",
  WARN: "WARNING",
  FAIL: "FAILED",
  SKIPPED: "SKIPPED",
};

const SCAN_STATUS_TO_SEVERITY: Record<ScanStatus, TestCaseResult["severity"]> = {
  PASS: "INFO",
  WARN: "MEDIUM",
  FAIL: "HIGH",
  SKIPPED: "INFO",
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown host";
  }
}

/**
 * The cloud identity a scan run belongs to. The CLI cannot guess a tenant: the key
 * (`GET /v1/project`) is the only authority, the same rule `proofcore sync` follows.
 */
export interface SyncIdentity {
  workspaceId: string;
  projectId: string;
}

/**
 * Turn a page scan into a run the engine pipeline accepts.
 *
 * `wanted` is the `--only` filter (empty = everything). Cases share the page load, so
 * per-case timings are deliberately zero: no per-check stopwatch was run, and inventing
 * one would be a lie in every field the dashboard sorts by.
 */
export function scanRunFromScanResult(
  result: ScanResult,
  wanted: ReadonlySet<string>,
  identity: SyncIdentity
): TestRun {
  const startedAt = result.scannedAt;
  const endedAt = new Date(
    new Date(startedAt).getTime() + Math.max(0, result.durationMs)
  ).toISOString();
  const environment = process.env.CI ? "ci" : "local";

  const findings: Finding[] = [];
  const moduleRuns: ModuleRun[] = [];
  const modules: TestRun["modules"] = [];

  for (const summary of result.modules) {
    if (wanted.size > 0 && !wanted.has(summary.module)) continue;
    modules.push(summary.module);

    const checks = result.findings.filter((item) => item.module === summary.module);
    const cases: TestCaseResult[] = [];

    for (const check of checks) {
      const caseId = `${summary.module}:${check.id}`;
      const status = SCAN_STATUS_TO_CASE[check.status];
      const isDefect = check.status === "WARN" || check.status === "FAIL";
      if (isDefect) {
        findings.push({
          id: caseId,
          testCaseId: caseId,
          module: summary.module,
          title: check.id,
          detail: `${check.observed} — ${check.why}`,
          severity: SCAN_STATUS_TO_SEVERITY[check.status],
          status,
          fingerprint: `${summary.module}:${check.id}:${hostOf(result.finalUrl)}`,
          failure: {
            message: check.observed,
            category: "page_scan",
            code: check.id,
          },
          evidenceIds: [],
          startedAt,
          endedAt,
          durationMs: 0,
          reproduction: {
            summary: `Re-run the audit: proofcore scan ${result.finalUrl} --only ${summary.module}`,
            command: `proofcore audit ${summary.module} ${result.finalUrl}`,
            fixtureIds: [],
            environment,
            notes: "The evidence is the HTTP observation quoted above, not an opinion.",
          },
        });
      }
      cases.push({
        id: caseId,
        name: check.id,
        module: summary.module,
        description: check.why,
        status,
        severity: SCAN_STATUS_TO_SEVERITY[check.status],
        startedAt,
        endedAt,
        durationMs: 0,
        environment,
        suiteId: `page-scan:${hostOf(result.finalUrl)}`,
        assertions: [],
        findingIds: isDefect ? [caseId] : [],
        evidence: [],
        logs: [],
        attempts: 1,
      });
    }

    moduleRuns.push({
      module: summary.module,
      status: aggregateStatus(cases.map((c) => c.status)),
      startedAt,
      endedAt,
      durationMs: Math.max(0, result.durationMs),
      totals: {
        total: cases.length,
        passed: cases.filter((c) => c.status === "PASSED").length,
        failed: cases.filter((c) => c.status === "FAILED").length,
        warnings: cases.filter((c) => c.status === "WARNING").length,
        errors: 0,
        skipped: cases.filter((c) => c.status === "SKIPPED").length,
        blocked: 0,
        notApplicable: 0,
        notConfigured: 0,
      },
      cases,
    });
  }

  // The scan id is derived from what was scanned and when: the same report re-uploaded
  // (retry after a network failure) carries the same idempotency key, a fresh scan a
  // fresh one. That mirrors `proofcore test`, whose reports embed their own key.
  const identityHash = createHash("sha256")
    .update(`${result.finalUrl}|${result.scannedAt}`)
    .digest("hex")
    .slice(0, 20);

  return {
    id: `scan_${identityHash}`,
    projectId: identity.projectId,
    workspaceId: identity.workspaceId,
    environment,
    status: aggregateStatus(moduleRuns.flatMap((mr) => mr.cases.map((c) => c.status))),
    startedAt,
    endedAt,
    durationMs: Math.max(0, result.durationMs),
    modules,
    moduleRuns,
    findings,
    idempotencyKey: `sync:scan_${identityHash}`,
    host: {
      platform: process.platform,
      nodeVersion: process.version,
      ci: Boolean(process.env.CI),
    },
  };
}

/** Same summary shape `proofcore sync` sends: keyed by module, never a flat guess. */
export function summarizeScanRun(run: TestRun): {
  totals: Record<
    string,
    Pick<ModuleRun["totals"], "total" | "passed" | "failed" | "warnings" | "errors" | "skipped">
  >;
} {
  return {
    totals: Object.fromEntries(
      run.moduleRuns.map((moduleRun) => [
        moduleRun.module,
        {
          total: moduleRun.totals.total,
          passed: moduleRun.totals.passed,
          failed: moduleRun.totals.failed,
          warnings: moduleRun.totals.warnings,
          errors: moduleRun.totals.errors,
          skipped: moduleRun.totals.skipped,
        },
      ])
    ),
  };
}

/**
 * Save the built run next to the other reports and return its path, so a failed upload
 * can be retried with the exact same idempotency key via `proofcore sync <path>`.
 */
export function saveScanRun(
  flags: SyncFlags,
  root: string,
  outputDir: string,
  run: TestRun
): string {
  const dir = resolve(root, outputDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, "last-scan.json");
  writeFileSync(path, `${stableStringify(run, 2)}\n`, "utf8");
  out(flags, dim(flags, `  Rapport conservé pour reprise : proofcore sync ${path}`));
  return path;
}

/**
 * POST the run to `/v1/runs` with the exact conventions of `proofcore sync`: identity
 * from the key, Idempotency-Key derived from the run, honest error on refusal.
 * Returns a process exit code.
 */
export async function uploadScanRun(
  flags: SyncFlags,
  apiUrl: string,
  token: string,
  run: TestRun,
  summary: {
    totals: Record<
      string,
      Pick<ModuleRun["totals"], "total" | "passed" | "failed" | "warnings" | "errors" | "skipped">
    >;
  },
  maxPayloadBytes: number
): Promise<number> {
  const payload = stableStringify({ run, summary });
  if (Buffer.byteLength(payload) > maxPayloadBytes) {
    errSync(
      flags,
      red(
        flags,
        `Payload is ${Buffer.byteLength(payload)} bytes, over the ${maxPayloadBytes} byte limit. ` +
          "Scan fewer modules or raise sync.maxPayloadBytes."
      )
    );
    return 2;
  }

  try {
    const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/v1/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "idempotency-key": run.idempotencyKey ?? `sync:${run.id}`,
      },
      body: payload,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      errSync(flags, red(flags, `Sync failed: HTTP ${response.status} ${text.slice(0, 400)}`));
      return 2;
    }
    const body = (await response.json().catch(() => ({}))) as {
      runId?: string;
      recorded?: boolean;
    };
    if (flags.json) {
      stdout.write(`${stableStringify({ ok: true, ...body }, 2)}\n`);
    } else {
      out(
        flags,
        green(flags, `Synced run ${run.id}${body.recorded === false ? " (already recorded)" : ""}`)
      );
    }
    return 0;
  } catch (error) {
    errSync(
      flags,
      red(flags, `Sync failed: ${error instanceof Error ? error.message : String(error)}`)
    );
    return 2;
  }
}
