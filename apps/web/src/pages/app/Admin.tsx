import { RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Card, Empty, ErrorState, Loading, Metric, StatusBadge } from "../../components/app/ui.js";
import { EnhancedCard } from "../../components/common/EnhancedCard.js";
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

export function Admin() {
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
        <PageHeader
          title="Operations"
          description="Users, workspaces, payments, runs and webhook delivery for this deployment."
        />
        <ErrorState error={error} onRetry={() => void load()} />
        {errorCode === "admin_required" ? (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            This page is restricted to the accounts listed in the API&apos;s{" "}
            <code className="app-mono">ADMIN_EMAILS</code> variable. The session is valid; the
            account is simply not on the allowlist.
          </p>
        ) : null}
        {errorCode === "admin_not_configured" ? (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            The console is deployed but disabled until the API has a non-empty{" "}
            <code className="app-mono">ADMIN_EMAILS</code> allowlist. No account is treated as an
            administrator by default.
          </p>
        ) : null}
      </>
    );
  }

  if (!data) return <Loading label="Loading operations…" />;

  return (
    <>
      <PageHeader
        title="Operations"
        description={`Read-only view of the deployment. Signed in as ${data.admin.email}; access is re-checked on every request against ADMIN_EMAILS.`}
        actions={
          <button type="button" className="app-btn" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Refresh
          </button>
        }
      />

      {!data.provider.live ? (
        <p className="mb-4 flex items-start gap-2 rounded-[var(--radius)] border border-warning/40 bg-warning/8 px-4 py-3 text-xs leading-relaxed text-muted">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-warning" />
          <span>
            Payments are running on the <strong>{data.provider.displayName}</strong> sandbox. Every
            payment and amount below is scripted test data, not money received. The revenue card
            will only be meaningful once SasPay credentials are configured and a verified live
            payment exists.
          </span>
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="Users" value={data.totals.users} hint="Accounts in this database" />
        <Metric
          label="Workspaces"
          value={data.totals.workspaces}
          hint={`${data.totals.activeSubscriptions} non-cancelled subscription(s)`}
        />
        <Metric
          label="Projects"
          value={data.totals.projects}
          hint="Active projects, soft-deleted excluded"
        />
        <Metric
          label="Runs"
          value={data.totals.runs24h}
          hint={`${data.totals.runs7d} in the last 7 days`}
        />
        <Metric
          label="Failed findings"
          value={data.totals.failedFindings7d}
          hint="Detected in the last 7 days"
        />
        <Metric
          label="Failed webhooks"
          value={data.totals.failedWebhooks}
          hint={
            data.totals.latestMigration
              ? `Latest migration: ${data.totals.latestMigration}`
              : "No migration recorded"
          }
        />
      </div>

      <EnhancedCard className="mt-6 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card
          title="Verified revenue"
          description="Sum of credited payment intents, by currency. Credited means the provider verification marked the payment as paid."
        >
          {data.revenue.length === 0 ? (
            <Empty
              title="No credited payment"
              body="Nothing has been verified as paid yet. Failed, pending and sandbox-only attempts are not counted here."
            />
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
                    {entry.payments} credited payment{entry.payments === 1 ? "" : "s"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Payment attempts"
          description="Every state, including failures. The count is authoritative; the state names come from the database."
        >
          {data.paymentsByState.length === 0 ? (
            <Empty title="No payment attempt" body="No checkout has been started yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>State</th>
                    <th className="text-right">Attempts</th>
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
        title="Users"
        description={`The ${data.users.length} most recent accounts. Password hashes and session tokens are never selected by this endpoint.`}
      >
        {data.users.length === 0 ? (
          <Empty title="No users" body="No account has been created yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="text-right">Workspaces</th>
                  <th className="text-right">Runs</th>
                  <th>Joined</th>
                  <th>Last session</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <p className="font-medium">{user.name}</p>
                      <p className="text-xs text-muted">{user.email}</p>
                      <p className="text-xs text-muted">
                        {user.emailVerified ? "verified" : "email verification not configured"}
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
        title="Workspaces"
        description="Owner, size, activity and the latest subscription row. A missing plan means no subscription was ever created."
      >
        {data.workspaces.length === 0 ? (
          <Empty title="No workspace" body="No workspace has been created yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Owner</th>
                  <th className="text-right">Members</th>
                  <th className="text-right">Projects</th>
                  <th className="text-right">Runs</th>
                  <th>Plan</th>
                  <th>Last run</th>
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
                      <p className="text-xs font-medium">{workspace.planKey ?? "free"}</p>
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
        title="Payments"
        description="Every attempt with its provider reference and failure reason. A credited row is the only one that grants paid access."
      >
        {data.payments.length === 0 ? (
          <Empty title="No payment" body="No checkout has been started yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Workspace</th>
                  <th>Plan</th>
                  <th className="text-right">Amount</th>
                  <th>State</th>
                  <th>Credited</th>
                  <th>Reference</th>
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
                    <td className="text-xs">{payment.credited ? "yes" : "no"}</td>
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
        <Card
          title="Recent runs"
          description="What customers uploaded, newest first. Case counts come from the stored totals."
        >
          {data.runs.length === 0 ? (
            <Empty title="No run" body="No test run has been uploaded yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Project</th>
                    <th>Status</th>
                    <th className="text-right">Duration</th>
                    <th className="text-right">Failed / total</th>
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

        <Card
          title="Webhook delivery"
          description="Signature validity and processing state. A failed event is visible here instead of only in logs."
        >
          {data.webhooks.length === 0 ? (
            <Empty title="No webhook" body="No provider event has been received yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Event</th>
                    <th>State</th>
                    <th>Signature</th>
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
                      <td className="text-xs">{webhook.signatureValid ? "valid" : "invalid"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted">
        Read-only console. Mutating production data is deliberately not exposed here; use the
        provider dashboard or the API for actions. Data is queried live on each refresh, and the
        response is marked <code className="app-mono">no-store</code>.
      </p>
    </>
  );
}
