import { Globe2, PackageOpen, Route as RouteIcon, Terminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Card, Empty, ErrorState, Loading, Metric, StatusBadge } from "../../components/app/ui.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { duration, relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";

/**
 * A module view.
 *
 * It reports what the engine has actually verified for one module across the
 * workspace. A module with no run says so; it is never rendered as green because
 * "nothing failed".
 */

const MODULES = {
  world: {
    name: "WORLD",
    icon: Globe2,
    summary: "Can users from different countries use the software correctly?",
    body: "Locale fixtures for identity, phone, address, currency and dates. A finding here means real data was rejected or silently changed.",
    command: "proofstack test --module world",
  },
  flow: {
    name: "FLOW",
    icon: RouteIcon,
    summary: "Can users complete the critical operations?",
    body: "Journeys, checkout scenarios, webhook ordering and idempotency. Failures are reported with the step that broke, not just a status.",
    command: "proofstack test --module flow",
  },
  exit: {
    name: "EXIT",
    icon: PackageOpen,
    summary: "Can users retrieve their information without losing it?",
    body: "Export formats, schema validity, referential integrity and round-trip fidelity. Nothing here runs against production data by default.",
    command: "proofstack test --module exit",
  },
} as const;

type ModuleId = keyof typeof MODULES;

interface ModuleRun {
  id: string;
  projectId: string;
  projectName: string;
  status: string;
  startedAt: string;
  durationMs: number;
  totals: Record<
    string,
    {
      passed: number;
      failed: number;
      warnings: number;
      errors: number;
      skipped: number;
      total: number;
    }
  >;
}

interface Finding {
  id: string;
  title: string;
  projectId: string;
  severity: string;
  code: string | null;
  detectedAt: string;
}

export function ModulePage() {
  const { module: raw } = useParams();
  const module = (
    raw === "world" || raw === "flow" || raw === "exit" ? raw : null
  ) as ModuleId | null;
  const { workspaceId } = useSession();
  const [runs, setRuns] = useState<ModuleRun[] | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId || !module) return;
    setError(null);
    try {
      const [runBody, findingBody] = await Promise.all([
        apiFetch<{ items: ModuleRun[] }>(`/api/v1/runs?workspaceId=${workspaceId}&limit=50`),
        apiFetch<{ items: Finding[] }>(
          `/api/v1/findings?workspaceId=${workspaceId}&module=${module}`
        ),
      ]);
      setRuns(runBody.items.filter((run) => run.totals[module] !== undefined));
      setFindings(findingBody.items);
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [module, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!module) {
    return (
      <Empty title="Unknown module" body="PROOFSTACK has three modules: WORLD, FLOW and EXIT." />
    );
  }
  const meta = MODULES[module];
  const Icon = meta.icon;

  if (error) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!runs) return <Loading label={`Loading ${meta.name} activity…`} />;

  const totals = runs.reduce(
    (sum, run) => {
      const moduleTotals = run.totals[module];
      if (!moduleTotals) return sum;
      return {
        passed: sum.passed + moduleTotals.passed,
        failed: sum.failed + moduleTotals.failed,
        warnings: sum.warnings + moduleTotals.warnings,
        errors: sum.errors + moduleTotals.errors,
        skipped: sum.skipped + moduleTotals.skipped,
      };
    },
    { passed: 0, failed: 0, warnings: 0, errors: 0, skipped: 0 }
  );
  const latest = runs[0];

  return (
    <>
      <PageHeader
        title={meta.name}
        description={meta.summary}
        actions={
          latest ? (
            <StatusBadge status={latest.status} />
          ) : (
            <span className="app-badge">not verified yet</span>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Cases passed"
          value={totals.passed}
          hint="Across the most recent runs listed below"
        />
        <Metric
          label="Failures"
          value={totals.failed}
          hint="Product defects with a reproducible case id"
        />
        <Metric
          label="Warnings"
          value={totals.warnings}
          hint="Ran, but proved less than expected"
        />
        <Metric
          label="Skipped"
          value={totals.skipped}
          hint="No target or fixture available: never counted as a pass"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card title="What this module checks" description={meta.body}>
          <div className="px-5 py-4">
            {runs.length === 0 ? (
              <Empty
                title={`${meta.name} has not run yet`}
                body="Point this module at your application in proofstack.config.ts, then run it. Until then its cases are skipped, not passed."
                action={
                  <Link to="/app/projects" className="app-btn">
                    Configure a project
                  </Link>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Status</th>
                      <th>Started</th>
                      <th>Duration</th>
                      <th>Passed / failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => {
                      const moduleTotals = run.totals[module]!;
                      return (
                        <tr key={run.id}>
                          <td className="font-medium">{run.projectName}</td>
                          <td>
                            <StatusBadge status={run.status} />
                          </td>
                          <td className="text-muted">{relativeTime(run.startedAt)}</td>
                          <td className="text-muted">{duration(run.durationMs)}</td>
                          <td>
                            {moduleTotals.passed} / {moduleTotals.failed}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card
            title="Run it"
            description="The browser work happens on your machine or in CI, never in the dashboard."
          >
            <div className="px-5 py-4">
              <pre className="overflow-x-auto rounded-[var(--radius)] bg-surface-alt px-3 py-2 app-mono">
                {meta.command}
              </pre>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                A project token is required to upload the result. Create one from a project page.
              </p>
              <Link to="/app/projects" className="app-btn mt-3">
                <Terminal size={14} /> Projects
              </Link>
            </div>
          </Card>

          <Card title="Open findings" description="Failed checks recorded for this module.">
            {findings.length === 0 ? (
              <Empty title="No finding" body="No failed check has been recorded for this module." />
            ) : (
              <ul className="divide-y divide-line">
                {findings.slice(0, 8).map((finding) => (
                  <li key={finding.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">{finding.title}</p>
                      <span className="app-badge app-badge-danger">
                        {finding.severity.toLowerCase()}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      <span className="app-mono">{finding.code ?? "—"}</span> ·{" "}
                      {relativeTime(finding.detectedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <p className="mt-4 flex items-center gap-2 text-xs text-muted">
        <Icon size={14} /> {meta.name} · {meta.summary}
      </p>
    </>
  );
}
