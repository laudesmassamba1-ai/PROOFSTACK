import type {
  Finding,
  ModuleRun,
  ReportFormat,
  RunStatus,
  TestCaseResult,
  TestRun,
} from "@proofcore/contracts";
import { stableStringify } from "@proofcore/core";

/**
 * The report engine.
 *
 * One `TestRun` in, four formats out. The formats exist because four different
 * consumers read reports and none of them should be handed a bespoke shape:
 *
 *   - `json`  — the CLI, the API and any tooling. Stable, complete, machine-readable.
 *   - `junit` — CI systems. Every case becomes a testcase, so a failure blocks a merge
 *               in the tool the team already uses.
 *   - `html`  — a human, offline, no build step. Self-contained, no external requests.
 *   - `text`  — a terminal. Short, aligned, and honest about skips.
 *
 * Every renderer is pure: it takes a run and returns a string. That is what makes the
 * reports testable and what stops one format from quietly disagreeing with another.
 */

export interface RenderOptions {
  /** Product name shown in the HTML title and the text header. */
  projectName?: string;
  /** Base URL for evidence links, when evidence lives outside the report. */
  evidenceBaseUrl?: string;
  /** Include the full case list in text output (default: only non-passing cases). */
  verbose?: boolean;
}

export function renderReport(
  run: TestRun,
  format: ReportFormat,
  options: RenderOptions = {}
): string {
  switch (format) {
    case "json":
      return renderJson(run);
    case "junit":
      return renderJunit(run);
    case "html":
      return renderHtml(run, options);
    case "text":
      return renderText(run, options);
    default:
      throw new Error(`unsupported report format: ${String(format)}`);
  }
}

/** JSON: the canonical form. Stable key order so two runs diff cleanly. */
export function renderJson(run: TestRun): string {
  return `${stableStringify(run, 2)}\n`;
}

/**
 * JUnit XML.
 *
 * CI systems are unforgiving about this format, so the details matter:
 *   - a SKIPPED case is `<skipped/>`, not a pass and not a failure;
 *   - an ERROR case is `<error>`, which is distinct from `<failure>` — a harness
 *     problem must not be reported as a product defect;
 *   - the suite time is in seconds with three decimals;
 *   - every attribute is escaped, because a product's error message will contain
 *     quotes, angle brackets and ampersands.
 */
export function renderJunit(run: TestRun): string {
  const lines: string[] = [];
  const totals = runTotals(run);

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuites name="PROOFCORE" tests="${totals.total}" failures="${totals.failed}" errors="${totals.errors}" skipped="${totals.skipped}" time="${seconds(run.durationMs)}">`
  );

  for (const moduleRun of run.moduleRuns) {
    lines.push(
      `  <testsuite name="${escapeXml(moduleRun.module.toUpperCase())}" tests="${moduleRun.totals.total}" failures="${moduleRun.totals.failed}" errors="${moduleRun.totals.errors}" skipped="${moduleRun.totals.skipped}" time="${seconds(moduleRun.durationMs)}" timestamp="${escapeXml(moduleRun.startedAt)}">`
    );

    for (const testCase of moduleRun.cases) {
      const attributes = [
        `name="${escapeXml(testCase.name)}"`,
        `classname="${escapeXml(`${testCase.module}.${testCase.suiteId}`)}"`,
        `time="${seconds(testCase.durationMs)}"`,
      ];
      if (testCase.profile) attributes.push(`file="${escapeXml(testCase.profile)}"`);

      const body = junitBody(testCase, moduleRun, run);
      if (body === null) {
        lines.push(`    <testcase ${attributes.join(" ")}/>`);
      } else {
        lines.push(`    <testcase ${attributes.join(" ")}>`);
        lines.push(body);
        lines.push("    </testcase>");
      }
    }

    lines.push("  </testsuite>");
  }

  lines.push("</testsuites>");
  return `${lines.join("\n")}\n`;
}

function junitBody(testCase: TestCaseResult, moduleRun: ModuleRun, run: TestRun): string | null {
  if (testCase.status === "SKIPPED") {
    return `      <skipped message="${escapeXml(testCase.skippedReason ?? "skipped")}"/>`;
  }

  if (testCase.status === "ERROR") {
    const message = testCase.failure?.message ?? "case errored";
    return [
      `      <error type="${escapeXml(testCase.failure?.category ?? "ERROR")}" message="${escapeXml(message)}">`,
      escapeXml(testCase.failure?.stack ?? message),
      "      </error>",
    ].join("\n");
  }

  if (testCase.status === "FAILED" || testCase.status === "WARNING") {
    const findings = run.findings.filter((f) => f.testCaseId === testCase.id);
    const message = findings[0]?.title ?? testCase.failure?.message ?? "assertion failed";
    const detail = findings
      .map((f) => `${f.title}\n  ${f.detail}\n  reproduce: ${f.reproduction.command}`)
      .join("\n\n");
    return [
      `      <failure type="${escapeXml(testCase.failure?.code ?? "assertion_failed")}" message="${escapeXml(message)}">`,
      escapeXml(detail || message),
      "      </failure>",
    ].join("\n");
  }

  void moduleRun;
  return null;
}

/**
 * Text: what a developer sees in a terminal.
 *
 * Default output shows only what needs attention plus a summary. A 400-case run that
 * prints 400 green lines is a run nobody reads.
 */
export function renderText(run: TestRun, options: RenderOptions = {}): string {
  const lines: string[] = [];
  const totals = runTotals(run);
  const title = options.projectName ? `${options.projectName} — ` : "";

  lines.push(`${title}PROOFCORE run ${run.id}`);
  lines.push(`environment ${run.environment}  revision ${run.revision ?? "—"}  ${run.startedAt}`);
  lines.push("");

  for (const moduleRun of run.moduleRuns) {
    lines.push(
      `${moduleRun.module.toUpperCase().padEnd(6)} ${statusBadge(moduleRun.status)}  ${moduleRun.totals.passed} passed  ${moduleRun.totals.failed} failed  ${moduleRun.totals.warnings} warning  ${moduleRun.totals.errors} error  ${moduleRun.totals.skipped} skipped`
    );

    const interesting = options.verbose
      ? moduleRun.cases
      : moduleRun.cases.filter((c) => c.status !== "PASSED");

    for (const testCase of interesting) {
      lines.push(`  ${statusBadge(testCase.status)} ${testCase.id}  ${testCase.name}`);
      if (testCase.status === "SKIPPED" && testCase.skippedReason) {
        lines.push(`         skipped: ${testCase.skippedReason}`);
      }
      if (testCase.failure) {
        lines.push(`         ${testCase.failure.code}: ${testCase.failure.message}`);
      }
      for (const finding of run.findings.filter((f) => f.testCaseId === testCase.id)) {
        lines.push(`         → ${finding.detail}`);
        lines.push(`           reproduce: ${finding.reproduction.command}`);
      }
    }
    lines.push("");
  }

  lines.push(
    `${statusBadge(run.status)} ${totals.total} cases: ${totals.passed} passed, ${totals.failed} failed, ${totals.warnings} warning, ${totals.errors} error, ${totals.skipped} skipped in ${(run.durationMs / 1000).toFixed(2)}s`
  );

  if (totals.critical > 0) {
    lines.push(`\n${totals.critical} CRITICAL finding(s) — these block a release.`);
  }

  return `${lines.join("\n")}\n`;
}

/**
 * HTML: a single self-contained file.
 *
 * No external stylesheet, no script, no font request. A report that phones home is a
 * report that leaks which customers are testing what, and it also breaks the moment
 * it is opened on a plane.
 */
export function renderHtml(run: TestRun, options: RenderOptions = {}): string {
  const totals = runTotals(run);
  const title = options.projectName
    ? `${options.projectName} — PROOFCORE report`
    : "PROOFCORE report";

  const moduleSections = run.moduleRuns
    .map((moduleRun) => {
      const rows = moduleRun.cases
        .map((testCase) => {
          const findings = run.findings.filter((f) => f.testCaseId === testCase.id);
          const detail = findings.length
            ? `<ul class="findings">${findings
                .map(
                  (f) =>
                    `<li><strong>${escapeHtml(f.title)}</strong><br><span class="muted">${escapeHtml(f.detail)}</span><br><code>${escapeHtml(f.reproduction.command)}</code></li>`
                )
                .join("")}</ul>`
            : testCase.skippedReason
              ? `<span class="muted">${escapeHtml(testCase.skippedReason)}</span>`
              : "";
          return `<tr class="row-${testCase.status.toLowerCase()}">
        <td><span class="badge badge-${testCase.status.toLowerCase()}">${testCase.status}</span></td>
        <td><code>${escapeHtml(testCase.id)}</code><div class="muted">${escapeHtml(testCase.name)}</div>${detail}</td>
        <td class="num">${(testCase.durationMs / 1000).toFixed(2)}s</td>
      </tr>`;
        })
        .join("\n");

      return `<section>
      <h2>${escapeHtml(moduleRun.module.toUpperCase())} <span class="badge badge-${moduleRun.status.toLowerCase()}">${moduleRun.status}</span></h2>
      <p class="muted">${moduleRun.totals.passed} passed · ${moduleRun.totals.failed} failed · ${moduleRun.totals.warnings} warning · ${moduleRun.totals.errors} error · ${moduleRun.totals.skipped} skipped</p>
      <table>
        <thead><tr><th>Status</th><th>Case</th><th class="num">Time</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; --bg:#f7f8fa; --surface:#fff; --text:#142033; --muted:#68778a; --border:#e4e9f0;
          --pass:#249a72; --fail:#d65a65; --warn:#d69a3c; --err:#b45309; --skip:#68778a; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0c1118; --surface:#121a24; --text:#f0f4fa; --muted:#a0aec0; --border:#283545;
            --pass:#47c89a; --fail:#f07884; --warn:#e9b45a; --err:#f0a35e; --skip:#a0aec0; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem 1.25rem 4rem; background:var(--bg); color:var(--text);
         font:15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 1040px; margin: 0 auto; }
  h1 { font-size:1.6rem; letter-spacing:-0.02em; margin:0 0 .25rem; }
  h2 { font-size:1rem; letter-spacing:.06em; text-transform:uppercase; margin:2.5rem 0 .5rem; }
  code { font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace; font-size:.85em; }
  .muted { color:var(--muted); font-size:.86rem; }
  .summary { display:flex; flex-wrap:wrap; gap:.5rem; margin:1.25rem 0 0; }
  .stat { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:.6rem .9rem; min-width:104px; }
  .stat b { display:block; font-size:1.35rem; line-height:1.1; }
  table { width:100%; border-collapse:collapse; background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:.6rem .8rem; border-bottom:1px solid var(--border); vertical-align:top; }
  th { font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:600; }
  tr:last-child td { border-bottom:none; }
  .num { text-align:right; white-space:nowrap; font-variant-numeric: tabular-nums; }
  .badge { display:inline-block; padding:.1rem .45rem; border-radius:999px; font-size:.68rem; font-weight:700; letter-spacing:.04em; }
  .badge-passed, .badge-completed { background:color-mix(in srgb, var(--pass) 16%, transparent); color:var(--pass); }
  .badge-failed { background:color-mix(in srgb, var(--fail) 16%, transparent); color:var(--fail); }
  .badge-warning, .badge-partial { background:color-mix(in srgb, var(--warn) 18%, transparent); color:var(--warn); }
  .badge-error { background:color-mix(in srgb, var(--err) 18%, transparent); color:var(--err); }
  .badge-skipped, .badge-pending, .badge-running, .badge-cancelled { background:color-mix(in srgb, var(--skip) 16%, transparent); color:var(--skip); }
  .badge-nothing_verified { background:color-mix(in srgb, var(--warn) 18%, transparent); color:var(--warn); }
  .findings { margin:.45rem 0 0; padding-left:1.1rem; }
  .findings li { margin-bottom:.35rem; }
  footer { margin-top:3rem; color:var(--muted); font-size:.8rem; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p class="muted">Run <code>${escapeHtml(run.id)}</code> · environment <code>${escapeHtml(run.environment)}</code> · revision <code>${escapeHtml(run.revision ?? "—")}</code> · ${escapeHtml(run.startedAt)}</p>
  <div class="summary">
    <div class="stat"><b>${totals.total}</b>cases</div>
    <div class="stat"><b style="color:var(--pass)">${totals.passed}</b>passed</div>
    <div class="stat"><b style="color:var(--fail)">${totals.failed}</b>failed</div>
    <div class="stat"><b style="color:var(--warn)">${totals.warnings}</b>warning</div>
    <div class="stat"><b style="color:var(--err)">${totals.errors}</b>error</div>
    <div class="stat"><b style="color:var(--skip)">${totals.skipped}</b>skipped</div>
    <div class="stat"><b>${(run.durationMs / 1000).toFixed(1)}s</b>duration</div>
  </div>
  ${moduleSections}
  <footer>Generated by PROOFCORE ${escapeHtml(run.engineVersion ?? "")} · ${escapeHtml(run.cliVersion ?? "")} · this file is self-contained and makes no network requests.</footer>
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------- shared helpers

export interface RunTotals {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  errors: number;
  skipped: number;
  critical: number;
}

export function runTotals(run: TestRun): RunTotals {
  const totals: RunTotals = {
    total: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
    errors: 0,
    skipped: 0,
    critical: 0,
  };
  for (const moduleRun of run.moduleRuns) {
    totals.total += moduleRun.totals.total;
    totals.passed += moduleRun.totals.passed;
    totals.failed += moduleRun.totals.failed;
    totals.warnings += moduleRun.totals.warnings;
    totals.errors += moduleRun.totals.errors;
    totals.skipped += moduleRun.totals.skipped;
  }
  totals.critical = run.findings.filter(
    (f) => f.severity === "CRITICAL" && f.status === "FAILED"
  ).length;
  return totals;
}

/**
 * Exit code policy, in one place so the CLI and CI agree.
 *
 *   0  cases ran and none failed (some modules may legitimately be skipped)
 *   1  at least one product defect
 *   2  at least one harness error, or nothing was verified at all
 *   3  the run was cancelled before it finished
 *
 * "Nothing verified" is 2, not 0: a project whose modules are not wired up must not
 * pass a CI gate. It is reported as its own status so the message can say *why*,
 * rather than looking like a crash.
 */
export function exitCodeFor(run: TestRun): 0 | 1 | 2 | 3 {
  if (run.status === "CANCELLED") return 3;
  if (run.moduleRuns.some((m) => m.totals.errors > 0) || run.status === "ERROR") return 2;
  if (run.moduleRuns.some((m) => m.totals.failed > 0) || run.status === "FAILED") return 1;
  if (run.status === "NOTHING_VERIFIED") return 2;
  return 0;
}

function statusBadge(status: RunStatus | TestCaseResult["status"]): string {
  switch (status) {
    case "PASSED":
    case "COMPLETED":
      return "PASS";
    case "FAILED":
      return "FAIL";
    case "WARNING":
    case "PARTIAL":
      return "WARN";
    case "ERROR":
      return "ERR ";
    case "SKIPPED":
      return "SKIP";
    case "CANCELLED":
      return "CANC";
    case "NOTHING_VERIFIED":
      return "NONE";
    case "RUNNING":
      return "RUN ";
    default:
      return "PEND";
  }
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function escapeXml(value: string): string {
  return (
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;")
      // XML 1.0 forbids most control characters; strip them rather than emit invalid XML.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping forbidden XML characters is the purpose
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Group findings by fingerprint so the same defect across profiles is one issue. */
export function groupFindings(findings: readonly Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const existing = groups.get(finding.fingerprint);
    if (existing) existing.push(finding);
    else groups.set(finding.fingerprint, [finding]);
  }
  return groups;
}
