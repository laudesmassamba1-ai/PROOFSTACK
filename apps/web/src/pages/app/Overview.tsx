import { ArrowRight, Terminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Card, Empty, ErrorState, Loading, Metric, StatusBadge } from "../../components/app/ui.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { duration, formatDate, relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";

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
    /** Why the workspace is not on its paid plan, when it is not. */
    reason: string | null;
    recurringSupported: boolean;
    renewalDueAt: string | null;
    currentPeriodEnd: string | null;
  };
}

export function Overview() {
  const { workspaceId } = useSession();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    try {
      setData(await apiFetch<Overview>(`/api/v1/overview?workspaceId=${workspaceId}`));
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!workspaceId) return <Empty title="No workspace yet" body="Create a workspace to begin." />;
  if (error) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!data) return <Loading label="Loading your workspace…" />;

  const runsCounter = data.usage.counters.find((counter) => counter.key === "monthly_test_runs");
  const quota = runsCounter?.limit ?? 0;
  const used = runsCounter?.used ?? 0;
  const percent = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;

  return (
    <>
      <PageHeader
        title={`${data.workspace.name}`}
        description="What PROOFSTACK has verified in this workspace, and what it could not verify. Nothing here is simulated: an empty module means no run has covered it yet."
        actions={
          <>
            <Link to="/app/projects" className="app-btn">
              Projects
            </Link>
            <Link to="/app/billing" className="app-btn app-btn-primary">
              {data.subscription.entitled ? "Manage plan" : "Upgrade"} <ArrowRight size={14} />
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Plan"
          value={data.subscription.planName}
          hint={planHint(data.subscription)}
        />
        <Metric
          label="Projects"
          value={data.projects.length}
          hint="Active projects in this workspace"
        />
        <Metric
          label="Test runs"
          value={quota === -1 ? used : `${used} / ${quota}`}
          hint={quota === -1 ? "Unlimited on this plan" : "Metered once per run id this period"}
        />
        <Metric
          label="Open failures"
          value={data.recentFailures.length}
          hint="Failed findings detected in recent runs"
        />
      </div>

      {!data.subscription.entitled ? (
        <p className="mt-4 rounded-[var(--radius)] border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
          This workspace resolves to Free.{" "}
          {data.subscription.reason === "period_ended_awaiting_renewal"
            ? `The paid period ended on ${formatDate(data.subscription.currentPeriodEnd)} and no verified renewal exists.`
            : "No paid subscription is active for it."}{" "}
          No data was deleted, and nothing paid is switched on until a provider confirms a payment.
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {data.modules.map((module) => (
          <div key={module.module} className="app-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide">{module.module}</h2>
              <StatusBadge status={module.status} />
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-muted">Passed</dt>
                <dd className="mt-0.5 text-sm font-medium">{module.passed}</dd>
              </div>
              <div>
                <dt className="text-muted">Failed</dt>
                <dd className="mt-0.5 text-sm font-medium">{module.failed}</dd>
              </div>
              <div>
                <dt className="text-muted">Skipped</dt>
                <dd className="mt-0.5 text-sm font-medium">{module.warnings}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-muted">
              {module.lastRunAt
                ? `Last covered ${relativeTime(module.lastRunAt)}`
                : "No run has covered this module yet."}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card
          title="Recent runs"
          description="Uploaded by the CLI or CI. A report is stored once per run id."
          actions={
            <Link to="/app/projects" className="text-xs font-medium text-primary hover:underline">
              All projects
            </Link>
          }
        >
          {data.recentRuns.length === 0 ? (
            <Empty
              title="No run yet"
              body="Install the CLI, point a module at your app, and run `proofstack test`. Uploads appear here with their real status."
              action={
                <Link to="/docs" className="app-btn">
                  <Terminal size={14} /> Read the CLI guide
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
                    <th>Findings</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentRuns.map((run) => (
                    <tr key={run.id}>
                      <td className="font-medium">{run.projectName}</td>
                      <td>
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="text-muted">{formatDate(run.startedAt)}</td>
                      <td className="text-muted">{duration(run.durationMs)}</td>
                      <td>{run.findingCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Usage this period">
            <div className="px-5 py-4">
              <div className="flex items-baseline justify-between text-sm">
                <span>{runsCounter?.label ?? "Test runs"}</span>
                <span className="font-medium">
                  {quota === -1 ? `${used}` : `${used} / ${quota}`}
                </span>
              </div>
              <div className="app-meter mt-2" aria-hidden>
                <span style={{ width: `${quota === -1 ? 8 : percent}%` }} />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                {quota === -1
                  ? "Unlimited on this plan."
                  : `${Math.max(0, quota - used)} run(s) left. Retries of the same run id are not billed twice.`}
              </p>
            </div>
          </Card>

          <Card title="Recent failures">
            {data.recentFailures.length === 0 ? (
              <Empty
                title="Nothing failing"
                body="No failed finding has been recorded in this workspace's recent runs."
              />
            ) : (
              <ul className="divide-y divide-line">
                {data.recentFailures.slice(0, 5).map((finding) => (
                  <li key={finding.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">{finding.title}</p>
                      <span className="app-badge app-badge-danger">
                        {finding.severity.toLowerCase()}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {finding.module.toUpperCase()} · {relativeTime(finding.detectedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function planHint(subscription: Overview["subscription"]): string {
  if (!subscription.recurringSupported && subscription.entitled) {
    return subscription.renewalDueAt
      ? `Renews manually · due ${formatDate(subscription.renewalDueAt)}`
      : "Prepaid period";
  }
  return subscription.entitled ? "Verified subscription" : "Free tier";
}
