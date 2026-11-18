import { ArrowRight, FolderPlus, Terminal } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { ModulePassRates, RunsTrend, SeverityBreakdown } from "../../components/app/Insights.js";
import { ModuleObject } from "../../components/app/ModuleObjects.js";
import { Empty, ErrorState, Loading, StatusBadge } from "../../components/app/ui.js";
import { EnhancedCard } from "../../components/common/EnhancedCard.js";
import { useI18n } from "../../i18n/index.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { duration, formatDate, relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";

interface Insights {
  runsPerDay: { day: string; total: number; passed: number; failed: number }[];
  severityCounts: { severity: string; count: number }[];
  moduleTotals: {
    module: string;
    passed: number;
    failed: number;
    warnings: number;
    total: number;
  }[];
}

interface Overview {
  workspace: { id: string; name: string; myRole: string };
  projects: { id: string; name: string; baseUrl: string; enabledModules: string[] }[];
  recentRuns: {
    id: string;
    projectId: string;
    projectName: string;
    status: string;
    startedAt: string;
    durationMs: number;
    findingCount: number;
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
  }[];
  modules: {
    module: string;
    status: string;
    passed: number;
    failed: number;
    warnings: number;
    errors: number;
    lastRunAt?: string;
  }[];
  recentFailures: {
    id: string;
    title: string;
    module: string;
    severity: string;
    detectedAt: string;
    projectId: string;
  }[];
  usage: {
    counters: { key: string; label: string; used: number; limit: number; counted: string }[];
  };
  subscription: {
    planKey: string;
    planName: string;
    entitled: boolean;
    state: string;
    reason: string | null;
    recurringSupported: boolean;
    renewalDueAt: string | null;
    currentPeriodEnd: string | null;
  };
}

type ModuleId = "world" | "flow" | "exit" | "fail" | "clean";
const MODULE_IDS: ModuleId[] = ["world", "flow", "exit", "fail", "clean"];

const EMPTY_TOTALS = { passed: 0, failed: 0, warnings: 0, errors: 0, skipped: 0, total: 0 };

export function Overview() {
  const { workspaceId } = useSession();
  const { locale, t } = useI18n();
  const fr = locale === "fr";
  const [data, setData] = useState<Overview | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    try {
      setData(await apiFetch<Overview>(`/api/v1/overview?workspaceId=${workspaceId}`));
      setInsights(await apiFetch<Insights>(`/api/v1/insights?workspaceId=${workspaceId}&days=14`));
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!workspaceId) {
    return (
      <Empty
        title={fr ? "Aucun espace de travail" : "No workspace yet"}
        body={fr ? "Créez un espace de travail pour commencer." : "Create a workspace to begin."}
        tester={false}
      />
    );
  }
  if (error) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!data)
    return <Loading label={fr ? "Chargement de la situation…" : "Loading the situation…"} />;

  const latest = data.recentRuns[0];
  const failures = data.recentFailures.length;
  const hasProjects = data.projects.length > 0;
  const hasRuns = data.recentRuns.length > 0;

  const headline = !hasProjects
    ? t("ws.overview.noProject")
    : !hasRuns
      ? t("ws.overview.noRun")
      : failures > 0
        ? t("ws.overview.failures", { count: failures })
        : t("ws.overview.anomaly");

  const support = !hasProjects
    ? t("ws.overview.noProject.body")
    : !latest
      ? t("ws.overview.noRun.body", { project: data.projects[0]?.name ?? "The project" })
      : failures > 0
        ? t("ws.overview.failures.body", {
            project: latest.projectName,
            time: relativeTime(latest.startedAt),
          })
        : t("ws.overview.anomaly.body", { count: data.recentRuns.length });

  const firstFailure = data.recentFailures[0];
  const nextAction = !hasProjects
    ? { label: t("ws.overview.next.create"), to: "/app/projects", primary: true }
    : !hasRuns
      ? { label: t("ws.overview.next.install"), to: "/app/cli", primary: true }
      : failures > 0 && firstFailure
        ? {
            label: t("ws.overview.next.review"),
            to: `/app/modules/${firstFailure.module}`,
            primary: true,
          }
        : { label: t("ws.overview.next.run"), to: "/app/cli", primary: true };

  const runsCounter = data.usage.counters.find((counter) => counter.key === "monthly_test_runs");
  const quota = runsCounter?.limit ?? 0;
  const used = runsCounter?.used ?? 0;
  const percent = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;

  return (
    <div className="app-page app-overview">
      <EnhancedCard className="pk-enter" enable3d={undefined}>
        <section className="app-situation">
          <div className="app-situation-copy">
            <p className="app-eyebrow">
              {t("ws.overview.eyebrow")} / {data.workspace.name}
            </p>
            <h1 className="app-display app-situation-headline">{headline}</h1>
            <p className="app-support">{support}</p>
          </div>
          <aside
            className="app-situation-stamp"
            aria-label={fr ? "Faits réels du workspace" : "Real workspace facts"}
          >
            <p className="app-eyebrow">01 / {t("ws.overview.latest")}</p>
            <div className="app-stamp-facts">
              <div>
                <span className="app-stamp-value">{data.projects.length}</span>
                <span>{t("ws.overview.projects")}</span>
              </div>
              <div>
                <span className="app-stamp-value">{data.recentRuns.length}</span>
                <span>{t("ws.overview.runs.count")}</span>
              </div>
              <div>
                <span className={`app-stamp-value ${failures > 0 ? "is-danger" : ""}`}>
                  {failures}
                </span>
                <span>{t("ws.overview.failures.count")}</span>
              </div>
            </div>
            <p className="app-stamp-note">
              {latest
                ? `${latest.projectName} · ${relativeTime(latest.startedAt)}`
                : t("ws.overview.never")}
            </p>
          </aside>
        </section>
      </EnhancedCard>

      <section className="app-section" data-reveal aria-labelledby="module-objects-title">
        <div className="app-section-head">
          <p className="app-eyebrow">02 / {t("ws.overview.modules")}</p>
          <h2 id="module-objects-title" className="app-section-title">
            {MODULE_IDS.map((module) => module.toUpperCase()).join(". ")}.
          </h2>
        </div>

        <div className="app-object-grid">
          {MODULE_IDS.map((module, index) => {
            const latestModuleRun = data.recentRuns.find((run) => run.totals[module]);
            const totals = latestModuleRun?.totals[module] ?? EMPTY_TOTALS;
            const moduleRecord = data.modules.find((item) => item.module === module);
            const covered = moduleRecord?.lastRunAt ?? latestModuleRun?.startedAt;
            return (
              <Link
                key={module}
                style={{ "--pk-delay": `${140 + index * 80}ms` } as React.CSSProperties}
                to={`/app/modules/${module}`}
                className={`app-object-card pk-enter module-${module} app-object-card-${index + 1}`}
              >
                <div className="app-object-card-head">
                  <span className="app-object-index">0{index + 1}</span>
                  {covered ? (
                    <StatusBadge status={moduleRecord?.status ?? latestModuleRun?.status ?? ""} />
                  ) : (
                    <span className="app-badge">{t("ws.status.notTested")}</span>
                  )}
                </div>
                <div className="app-object-stage">
                  <ModuleObject
                    module={module}
                    passed={totals.passed}
                    failed={totals.failed}
                    total={totals.total}
                  />
                </div>
                <div className="app-object-card-foot">
                  <h3 className="app-object-name">{module.toUpperCase()}</h3>
                  <p className="app-object-state">
                    {covered
                      ? t("ws.module.latestSummary", {
                          passed: totals.passed,
                          failed: totals.failed,
                          skipped: totals.skipped,
                          warnings: totals.warnings,
                        })
                      : t("ws.module.latestNone")}
                  </p>
                  <span className="app-object-open">
                    {t("ws.overview.openModule")} <ArrowRight size={13} />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="app-section" data-reveal aria-labelledby="insights-title">
        <div className="app-section-head">
          <p className="app-eyebrow">03 / {fr ? "Évolution" : "Evolution"}</p>
          <h2 id="insights-title" className="app-section-title">
            {fr ? "14 derniers jours" : "Last 14 days"}
          </h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="app-workbench lg:col-span-2">
            <header className="app-workbench-head">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {fr ? "Vérifications par jour" : "Checks per day"}
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-success/70" />
                  {fr ? "réussis" : "passed"}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-danger/80" />
                  {fr ? "échoués" : "failed"}
                </span>
              </div>
            </header>
            {insights ? (
              <RunsTrend runs={insights.runsPerDay} locale={locale} />
            ) : (
              <p className="p-4 text-xs text-muted-foreground">…</p>
            )}
          </div>
          <div className="app-workbench">
            <header className="app-workbench-head">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {fr ? "Gravité des échecs" : "Failure severity"}
                </p>
              </div>
            </header>
            <div className="p-4">
              {insights ? (
                <SeverityBreakdown counts={insights.severityCounts} locale={locale} />
              ) : (
                <p className="text-xs text-muted-foreground">…</p>
              )}
            </div>
          </div>
          <div className="app-workbench lg:col-span-3">
            <header className="app-workbench-head">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {fr ? "Taux de réussite par module" : "Pass rate per module"}
                </p>
              </div>
            </header>
            <div className="p-4">
              {insights ? (
                <ModulePassRates modules={insights.moduleTotals} />
              ) : (
                <p className="text-xs text-muted-foreground">…</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="app-next-action">
        <div>
          <p className="app-eyebrow">03 / {t("ws.overview.next")}</p>
          <h2 className="app-next-title">{nextAction.label}</h2>
          <p className="app-next-body">
            {!hasProjects
              ? t("ws.overview.noProject.body")
              : !hasRuns
                ? t("ws.overview.runs.empty")
                : failures > 0
                  ? t("ws.overview.failures.empty")
                  : t("ws.overview.anomaly.body", { count: data.recentRuns.length })}
          </p>
          {!hasProjects ? (
            <ol className="app-onboard mt-5">
              {[t("ws.overview.onboard.step1"), t("ws.overview.onboard.step2"), t("ws.overview.onboard.step3")].map(
                (step, index) => (
                  <li key={step}>
                    <span className="app-onboard-index" aria-hidden>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{step}</span>
                  </li>
                )
              )}
            </ol>
          ) : null}
        </div>
        <div className="app-next-actions">
          <Link
            to={nextAction.to}
            className={nextAction.primary ? "app-btn app-btn-mint" : "app-btn"}
          >
            {!hasProjects ? <FolderPlus size={14} /> : <Terminal size={14} />}
            {nextAction.label} <ArrowRight size={14} />
          </Link>
          <Link to={hasProjects ? "/app/projects" : "/app/cli"} className="app-btn app-btn-paper">
            {hasProjects ? t("ws.overview.allProjects") : t("ws.overview.next.cli")}
          </Link>
        </div>
      </section>

      <div className="app-overview-body">
        <section className="app-workbench" aria-labelledby="recent-runs-title">
          <header className="app-workbench-head">
            <div>
              <p className="app-eyebrow">04 / {t("ws.overview.runs")}</p>
              <h2 id="recent-runs-title" className="app-workbench-title">
                {t("ws.overview.runs")}
              </h2>
              <p>{t("ws.overview.runs.body")}</p>
            </div>
            <Link to="/app/projects" className="app-text-link">
              {t("ws.overview.allProjects")} <ArrowRight size={13} />
            </Link>
          </header>
          {!hasRuns ? (
            <Empty
              title={t("ws.overview.runs")}
              body={t("ws.overview.runs.empty")}
              tester="working"
              action={
                <Link to="/app/cli" className="app-btn">
                  <Terminal size={14} /> {t("ws.overview.next.install")}
                </Link>
              }
            />
          ) : (
            <div className="app-table-wrap">
              <table className="app-table app-runs-table">
                <thead>
                  <tr>
                    <th>{t("ws.module.project")}</th>
                    <th>{t("ws.module.status")}</th>
                    <th>{t("ws.module.started")}</th>
                    <th>{t("ws.module.duration")}</th>
                    <th>Findings</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentRuns.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <Link to={`/app/projects/${run.projectId}`} className="app-row-link">
                          {run.projectName}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="text-muted">{formatDate(run.startedAt)}</td>
                      <td className="text-muted">{duration(run.durationMs)}</td>
                      <td className="tabular-nums">{run.findingCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="app-overview-side">
          <section className="app-workbench app-failures-panel" aria-labelledby="failures-title">
            <header className="app-workbench-head">
              <div>
                <p className="app-eyebrow">05 / {t("ws.overview.failures.title")}</p>
                <h2 id="failures-title" className="app-workbench-title">
                  {t("ws.overview.failures.title")}
                </h2>
              </div>
              <span className="app-count-mark">{failures}</span>
            </header>
            {failures === 0 ? (
              <Empty
                title={t("ws.overview.failures.title")}
                body={t("ws.overview.failures.empty")}
              />
            ) : (
              <ul className="app-failure-list">
                {data.recentFailures.slice(0, 5).map((finding) => (
                  <li key={finding.id}>
                    <Link to={`/app/modules/${finding.module}`} className="app-failure-row">
                      <span className="app-failure-glyph" aria-hidden>
                        ×
                      </span>
                      <span className="min-w-0">
                        <span className="app-failure-title">{finding.title}</span>
                        <span className="app-failure-meta">
                          {finding.module.toUpperCase()} · {relativeTime(finding.detectedAt)}
                        </span>
                      </span>
                      <span className="app-badge app-badge-danger">
                        {finding.severity.toLowerCase()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="app-workbench app-usage-panel" aria-labelledby="usage-title">
            <header className="app-workbench-head">
              <div>
                <p className="app-eyebrow">06 / {t("ws.overview.usage")}</p>
                <h2 id="usage-title" className="app-workbench-title">
                  {data.subscription.planName}
                </h2>
              </div>
              <span className="app-badge">
                {data.subscription.entitled ? t("ws.overview.plan") : t("ws.overview.free")}
              </span>
            </header>
            <div className="app-usage-body">
              <div className="app-usage-row">
                <span>{runsCounter?.label ?? t("ws.overview.runs.count")}</span>
                <strong>{quota === -1 ? `${used}` : `${used} / ${quota}`}</strong>
              </div>
              <div className="app-meter" aria-hidden>
                <span style={{ width: `${quota === -1 ? 8 : percent}%` }} />
              </div>
              <p>
                {quota === -1
                  ? "Unlimited on this plan."
                  : `${Math.max(0, quota - used)} run(s) left. Retries of the same run id are not billed twice.`}
              </p>
              {!data.subscription.entitled ? (
                <p className="app-usage-note">
                  {data.subscription.reason === "period_ended_awaiting_renewal"
                    ? `The paid period ended on ${formatDate(data.subscription.currentPeriodEnd)}.`
                    : "No verified paid subscription is active."}{" "}
                  Nothing was deleted; paid access is not switched on until a provider confirms a
                  payment.
                </p>
              ) : null}
              <Link to="/app/billing" className="app-text-link">
                {data.subscription.entitled ? "Manage plan" : "View plans"} <ArrowRight size={13} />
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
