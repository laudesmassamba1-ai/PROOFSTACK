import { RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Card, Empty, ErrorState, Loading, Metric, StatusBadge } from "../../components/app/ui.js";
import { EnhancedCard } from "../../components/common/EnhancedCard.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { duration, formatDate, formatMinor, relativeTime } from "../../lib/format.js";

/**
 * Creator's operations console.
 *
 * Read-only by design. It shows the business and the machinery separately: users,
 * workspaces and money first, then runs and webhook delivery. Every number comes from
 * the database through the allowlisted admin endpoint; the sandbox banner is driven by
 * the provider capability, not by a hardcoded environment guess.
 */

interface AdminOverview {
  generatedAt: string;
  admin: { email: string };
  provider: { slug: string; displayName: string; live: boolean };
  totals: {
    users: number;
    workspaces: number;
    projects: number;
    activeSubscriptions: number;
    runs24h: number;
    runs7d: number;
    failedFindings7d: number;
    failedWebhooks: number;
    latestMigration: string | null;
  };
  revenue: { currency: string; minor: string; payments: number }[];
  paymentsByState: { state: string; count: number }[];
  users: {
    id: string;
    email: string;
    name: string;
    createdAt: string;
    emailVerified: boolean;
    workspaces: number;
    runs: number;
    lastSessionAt: string | null;
  }[];
  workspaces: {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    ownerEmail: string | null;
    members: number;
    projects: number;
    runs: number;
    planKey: string | null;
    planState: string | null;
    lastRunAt: string | null;
  }[];
  payments: {
    id: string;
    workspaceId: string;
    workspaceName: string;
    planKey: string;
    period: string;
    amountMinor: string;
    currency: string;
    state: string;
    credited: boolean;
    provider: string;
    providerReference: string | null;
    failureReason: string | null;
    createdAt: string;
  }[];
  runs: {
    id: string;
    workspaceName: string;
    projectName: string;
    status: string;
    environment: string;
    startedAt: string;
    durationMs: number;
    totalCases: number;
    failedCases: number;
  }[];
  webhooks: {
    id: string;
    provider: string;
    type: string;
    state: string;
    receivedAt: string;
    signatureValid: boolean;
    error: string | null;
  }[];
}

interface OutboxRow {
  id: string;
  to: string;
  subject: string;
  kind: string;
  status: string;
  error: string | null;
  createdAt: string;
}

/**
 * Operator view of the outbox.
 *
 * It exists because "no mail provider configured" is a real state on this deployment and
 * the queue is then the delivery mechanism: the operator copies the link and sends it.
 * Nothing here pretends a message was delivered.
 */
function PendingMail() {
  const [state, setState] = useState<{
    emailConfigured: boolean;
    recent: OutboxRow[];
  } | null>(null);
  const [body, setBody] = useState<{ id: string; body: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<{ emailConfigured: boolean; recent: OutboxRow[] }>(
          "/api/account/delivery-status"
        );
        setState(data);
      } catch {
        setState(null);
      }
    })();
  }, []);

  if (!state || state.recent.length === 0) return null;

  return (
    <EnhancedCard className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Messages non remis</h2>
        <span className="text-[11px] text-muted-foreground">
          {state.emailConfigured
            ? "Fournisseur e-mail actif : ces lignes sont des échecs ou des messages en attente."
            : "Aucun fournisseur e-mail : ces messages doivent être remis à la main."}
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        {state.recent.slice(0, 8).map((entry) => (
          <div key={entry.id} className="rounded-lg border border-border/60 bg-surface-2 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-[10.5px] text-muted-foreground">{entry.kind}</span>
              <span className="font-medium">{entry.to}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  entry.status === "sent"
                    ? "bg-success/12 text-success"
                    : "bg-warning/12 text-warning"
                }`}
              >
                {entry.status}
              </span>
              <button
                type="button"
                className="ml-auto text-[11px] text-primary hover:underline"
                onClick={() =>
                  void (async () => {
                    const full = await apiFetch<{ body: string }>(
                      `/api/account/outbox/${entry.id}`
                    );
                    setBody({ id: entry.id, body: full.body });
                  })()
                }
              >
                Voir le contenu
              </button>
            </div>
            {entry.error && (
              <p className="mt-1 text-[10.5px] text-muted-foreground">{entry.error}</p>
            )}
            {body?.id === entry.id && (
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-surface-1 p-2 text-[10.5px] leading-relaxed text-foreground/80">
                {body.body}
              </pre>
            )}
          </div>
        ))}
      </div>
    </EnhancedCard>
  );
}

export function Admin() {
  const { t } = useI18n();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await apiFetch<AdminOverview>("/api/v1/admin/overview?limit=50"));
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const errorCode = error && "code" in error ? (error as ApiError).code : null;

  if (error) {
    return (
      <>
        <PageHeader title={t("admin.title")} description={t("admin.description")} />
        <ErrorState error={error} onRetry={() => void load()} />
        {errorCode === "admin_required" ? (
          <p className="mt-3 text-xs leading-relaxed text-muted">{t("admin.error.restricted")}</p>
        ) : null}
        {errorCode === "admin_not_configured" ? (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            {t("admin.error.notConfigured")}
          </p>
        ) : null}
      </>
    );
  }

  if (!data) return <Loading label={t("admin.loading")} />;

  return (
    <>
      <PageHeader
        title={t("admin.title")}
        description={t("admin.signedInAs", { email: data.admin.email })}
        actions={
          <button type="button" className="app-btn" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> {t("admin.refresh")}
          </button>
        }
      />

      {!data.provider.live ? (
        <p className="mb-4 flex items-start gap-2 rounded-[var(--radius)] border border-warning/40 bg-warning/8 px-4 py-3 text-xs leading-relaxed text-muted">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-warning" />
          <span>
            {t("admin.sandboxBefore")}
            <strong>{data.provider.displayName}</strong>
            {t("admin.sandboxAfter")}
          </span>
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Metric
          label={t("admin.metric.users")}
          value={data.totals.users}
          hint={t("admin.metric.usersHint")}
        />
        <Metric
          label={t("admin.metric.workspaces")}
          value={data.totals.workspaces}
          hint={t("admin.metric.workspacesHint", { count: data.totals.activeSubscriptions })}
        />
        <Metric
          label={t("admin.metric.projects")}
          value={data.totals.projects}
          hint={t("admin.metric.projectsHint")}
        />
        <Metric
          label={t("admin.metric.runs")}
          value={data.totals.runs24h}
          hint={t("admin.metric.runsHint", { count: data.totals.runs7d })}
        />
        <Metric
          label={t("admin.metric.failedFindings")}
          value={data.totals.failedFindings7d}
          hint={t("admin.metric.failedFindingsHint")}
        />
        <Metric
          label={t("admin.metric.failedWebhooks")}
          value={data.totals.failedWebhooks}
          hint={
            data.totals.latestMigration
              ? t("admin.metric.migrationHint", { id: data.totals.latestMigration })
              : t("admin.metric.noMigration")
          }
        />
      </div>

      {/* Undelivered mail. Without a provider the queue is the only way a customer gets
          a reset link, so the operator needs to read it here and send it by hand. */}
      <PendingMail />

      <EnhancedCard className="mt-6 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card title={t("admin.revenue.title")} description={t("admin.revenue.description")}>
          {data.revenue.length === 0 ? (
            <Empty title={t("admin.revenue.empty.title")} body={t("admin.revenue.empty.body")} />
          ) : (
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
              {data.revenue.map((entry) => (
                <div key={entry.currency}>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">
                    {entry.currency}
                  </p>
                  <p className="mt-1 text-[1.35rem] font-semibold leading-none">
                    {formatMinor(entry.minor, entry.currency)}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {t("admin.revenue.credited", { count: entry.payments })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={t("admin.attempts.title")} description={t("admin.attempts.description")}>
          {data.paymentsByState.length === 0 ? (
            <Empty title={t("admin.attempts.empty.title")} body={t("admin.attempts.empty.body")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>{t("admin.th.state")}</th>
                    <th className="text-right">{t("admin.th.attempts")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.paymentsByState.map((entry) => (
                    <tr key={entry.state}>
                      <td>
                        <StatusBadge status={entry.state} />
                      </td>
                      <td className="text-right tabular-nums">{entry.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </EnhancedCard>

      <Card
        className="mt-6"
        title={t("admin.users.title")}
        description={t("admin.users.description", { count: data.users.length })}
      >
        {data.users.length === 0 ? (
          <Empty title={t("admin.users.empty.title")} body={t("admin.users.empty.body")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th>{t("admin.th.account")}</th>
                  <th className="text-right">{t("admin.th.workspace")}</th>
                  <th className="text-right">{t("admin.th.runs")}</th>
                  <th>{t("admin.th.joined")}</th>
                  <th>{t("admin.th.lastSession")}</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <p className="font-medium">{user.name}</p>
                      <p className="text-xs text-muted">{user.email}</p>
                      <p className="text-xs text-muted">
                        {user.emailVerified
                          ? t("admin.user.verified")
                          : t("admin.user.emailNotConfigured")}
                      </p>
                    </td>
                    <td className="text-right tabular-nums">{user.workspaces}</td>
                    <td className="text-right tabular-nums">{user.runs}</td>
                    <td className="whitespace-nowrap text-xs">{formatDate(user.createdAt)}</td>
                    <td className="whitespace-nowrap text-xs text-muted">
                      {relativeTime(user.lastSessionAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        className="mt-6"
        title={t("admin.workspaces.title")}
        description={t("admin.workspaces.description")}
      >
        {data.workspaces.length === 0 ? (
          <Empty
            title={t("admin.workspaces.empty.title")}
            body={t("admin.workspaces.empty.body")}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th>{t("admin.th.workspace")}</th>
                  <th>{t("admin.th.owner")}</th>
                  <th className="text-right">{t("admin.th.members")}</th>
                  <th className="text-right">{t("admin.th.projects")}</th>
                  <th className="text-right">{t("admin.th.runs")}</th>
                  <th>{t("admin.th.plan")}</th>
                  <th>{t("admin.th.lastRun")}</th>
                </tr>
              </thead>
              <tbody>
                {data.workspaces.map((workspace) => (
                  <tr key={workspace.id}>
                    <td>
                      <p className="font-medium">{workspace.name}</p>
                      <p className="app-mono text-xs text-muted">{workspace.slug}</p>
                    </td>
                    <td className="text-xs">{workspace.ownerEmail ?? "—"}</td>
                    <td className="text-right tabular-nums">{workspace.members}</td>
                    <td className="text-right tabular-nums">{workspace.projects}</td>
                    <td className="text-right tabular-nums">{workspace.runs}</td>
                    <td>
                      <p className="text-xs font-medium">
                        {workspace.planKey ?? t("admin.plan.free")}
                      </p>
                      {workspace.planState ? <StatusBadge status={workspace.planState} /> : null}
                    </td>
                    <td className="whitespace-nowrap text-xs text-muted">
                      {relativeTime(workspace.lastRunAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        className="mt-6"
        title={t("admin.payments.title")}
        description={t("admin.payments.description")}
      >
        {data.payments.length === 0 ? (
          <Empty title={t("admin.payments.empty.title")} body={t("admin.payments.empty.body")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th>{t("admin.th.created")}</th>
                  <th>{t("admin.th.workspace")}</th>
                  <th>{t("admin.th.plan")}</th>
                  <th className="text-right">{t("admin.th.amount")}</th>
                  <th>{t("admin.th.state")}</th>
                  <th>{t("admin.th.credited")}</th>
                  <th>{t("admin.th.reference")}</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="whitespace-nowrap text-xs">{formatDate(payment.createdAt)}</td>
                    <td className="text-xs">{payment.workspaceName}</td>
                    <td className="text-xs">
                      {payment.planKey}
                      <span className="ml-1 text-muted">/ {payment.period}</span>
                    </td>
                    <td className="text-right tabular-nums">
                      {formatMinor(payment.amountMinor, payment.currency)}
                    </td>
                    <td>
                      <StatusBadge status={payment.state} />
                      {payment.failureReason ? (
                        <p className="mt-1 max-w-[28ch] text-xs text-muted">
                          {payment.failureReason}
                        </p>
                      ) : null}
                    </td>
                    <td className="text-xs">{payment.credited ? t("admin.yes") : t("admin.no")}</td>
                    <td className="app-mono text-xs text-muted">
                      {payment.providerReference ?? "—"}
                      <span className="mt-1 block text-[0.65rem]">{payment.provider}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card title={t("admin.runs.title")} description={t("admin.runs.description")}>
          {data.runs.length === 0 ? (
            <Empty title={t("admin.runs.empty.title")} body={t("admin.runs.empty.body")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>{t("admin.th.started")}</th>
                    <th>{t("admin.th.project")}</th>
                    <th>{t("admin.th.status")}</th>
                    <th className="text-right">{t("admin.th.duration")}</th>
                    <th className="text-right">{t("admin.th.failedTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((run) => (
                    <tr key={run.id}>
                      <td className="whitespace-nowrap text-xs">{formatDate(run.startedAt)}</td>
                      <td>
                        <p className="text-xs font-medium">{run.projectName}</p>
                        <p className="text-xs text-muted">{run.workspaceName}</p>
                      </td>
                      <td>
                        <StatusBadge status={run.status} />
                        <p className="mt-1 text-xs text-muted">{run.environment}</p>
                      </td>
                      <td className="text-right text-xs">{duration(run.durationMs)}</td>
                      <td className="text-right tabular-nums text-xs">
                        {run.totalCases === 0 ? "—" : `${run.failedCases} / ${run.totalCases}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={t("admin.webhooks.title")} description={t("admin.webhooks.description")}>
          {data.webhooks.length === 0 ? (
            <Empty title={t("admin.webhooks.empty.title")} body={t("admin.webhooks.empty.body")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>{t("admin.th.received")}</th>
                    <th>{t("admin.th.event")}</th>
                    <th>{t("admin.th.state")}</th>
                    <th>{t("admin.th.signature")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.webhooks.map((webhook) => (
                    <tr key={webhook.id}>
                      <td className="whitespace-nowrap text-xs">
                        {relativeTime(webhook.receivedAt)}
                      </td>
                      <td>
                        <p className="text-xs font-medium">{webhook.type}</p>
                        <p className="text-xs text-muted">{webhook.provider}</p>
                      </td>
                      <td>
                        <StatusBadge status={webhook.state} />
                        {webhook.error ? (
                          <p className="mt-1 max-w-[24ch] text-xs text-muted">{webhook.error}</p>
                        ) : null}
                      </td>
                      <td className="text-xs">
                        {webhook.signatureValid
                          ? t("admin.signature.valid")
                          : t("admin.signature.invalid")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted">{t("admin.footer")}</p>
    </>
  );
}
