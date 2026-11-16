import { CreditCard, Download, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Card, ErrorState, Loading, Metric, StatusBadge } from "../../components/app/ui.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch, postJson } from "../../lib/api.js";
import { formatDate, formatDay, formatMinor } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";

/**
 * Billing.
 *
 * The page's job is to tell the truth about money, which mostly means being explicit
 * about what is *not* true yet:
 *
 *   - a plan is active only when a verified payment says so, and the page reads the
 *     server's verdict rather than inferring one from a redirect;
 *   - when the configured provider cannot auto-charge (SasPay cannot), the page says
 *     "prepaid, renew manually" instead of showing a renewal that will never happen;
 *   - a receipt is labelled a receipt, not a tax invoice;
 *   - every action is a real request, and a failure is shown as a failure.
 */

interface BillingData {
  subscription: {
    planKey: string;
    planName: string;
    entitled: boolean;
    state: string;
    reason: string | null;
    period: "monthly" | "yearly" | null;
    currency: string | null;
    amountMinor: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    accessEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    pendingPlanKey: string | null;
    recurringSupported: boolean;
    renewalDueAt: string | null;
    provider: string;
  };
  entitlements: Record<string, number | boolean>;
  usage: { key: string; label: string; used: number; limit: number; counted: string }[];
  provider: {
    name: string;
    slug: string;
    automatedRecurring: boolean;
    refunds: boolean;
    webhookSignatureScheme: string;
    notes: string[];
  };
  payments: {
    id: string;
    state: string;
    planKey: string;
    period: string;
    amount: { currency: string; minor: string };
    providerReference: string | null;
    credited: boolean;
    createdAt: string;
    updatedAt: string;
    failureReason?: string;
  }[];
  invoices: {
    id: string;
    number: string;
    status: string;
    currency: string;
    total: { currency: string; minor: string };
    issuedAt: string;
    periodStart: string;
    periodEnd: string;
    documentKind: string;
    taxNote?: string;
  }[];
}

interface PlanOption {
  key: string;
  name: string;
  rank: number;
  description: string;
  prepaidOnly: boolean;
  prices: {
    id: string;
    period: "monthly" | "yearly";
    amount: { currency: string; minor: string };
  }[];
}

export function Billing() {
  const { workspaceId } = useSession();
  const [data, setData] = useState<BillingData | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [checkout, setCheckout] = useState<{
    intentId: string;
    planKey: string;
    redirectUrl?: string;
    sandbox: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    try {
      const [billing, planList] = await Promise.all([
        apiFetch<BillingData>(`/api/v1/billing?workspaceId=${workspaceId}`),
        apiFetch<{ items: PlanOption[] }>("/api/v1/plans"),
      ]);
      setData(billing);
      setPlans(planList.items);
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (label: string, run: () => Promise<unknown>, success: string) => {
      setBusy(label);
      setNotice(null);
      try {
        await run();
        setNotice({ tone: "ok", text: success });
        await load();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setNotice({ tone: "bad", text: message });
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  /**
   * An upgrade is a new charge, so it starts a checkout. A downgrade is queued at the
   * API and takes effect at the period boundary. Sending both to change-plan would
   * produce an upgrade that is "scheduled" but never paid for.
   */
  const choosePlan = async (plan: PlanOption) => {
    if (!workspaceId) return;
    const isUpgrade = plan.rank > currentRank;
    if (!isUpgrade) {
      await act(
        plan.key,
        () => postJson("/api/v1/billing/change-plan", { workspaceId, planKey: plan.key }),
        `${plan.name} queued for the end of this period.`
      );
      return;
    }
    setBusy(plan.key);
    setNotice(null);
    try {
      const currency =
        plan.prices.find((price) => price.period === "monthly")?.amount.currency ?? "USD";
      const start = await postJson<{ intent: { id: string }; redirectUrl?: string }>(
        "/api/v1/checkout/start",
        { workspaceId, planKey: plan.key, period: "monthly", currency }
      );
      setCheckout({
        intentId: start.intent.id,
        planKey: plan.key,
        ...(start.redirectUrl ? { redirectUrl: start.redirectUrl } : {}),
        sandbox: data?.provider.slug === "sandbox",
      });
      setNotice({
        tone: "ok",
        text: "Checkout opened. The plan changes only when the provider confirms the payment to the server.",
      });
    } catch (caught) {
      setNotice({ tone: "bad", text: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(null);
    }
  };

  const checkStatus = async () => {
    if (!workspaceId || !checkout) return;
    setBusy("status");
    try {
      const status = await apiFetch<{ state: string; entitled: boolean; message: string }>(
        `/api/v1/checkout/${checkout.intentId}?workspaceId=${workspaceId}`
      );
      setNotice({ tone: status.entitled ? "ok" : "bad", text: status.message });
      if (status.entitled) setCheckout(null);
      await load();
    } catch (caught) {
      setNotice({ tone: "bad", text: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Sandbox only. It exists so the whole payment lifecycle is exercisable without
   * credentials; the resulting state still comes from provider verification.
   */
  const settleSandbox = async (outcome: "success" | "declined" | "cancelled" | "expired") => {
    if (!workspaceId || !checkout) return;
    setBusy("settle");
    try {
      const result = await postJson<{ outcome: string; state: string }>(
        `/api/v1/checkout/${checkout.intentId}/sandbox/settle?workspaceId=${workspaceId}`,
        { outcome }
      );
      setNotice({
        tone: result.outcome === "credited" ? "ok" : "bad",
        text: `Sandbox provider reported ${result.state}. The subscription was recalculated from that verified state.`,
      });
      if (result.outcome === "credited") setCheckout(null);
      await load();
    } catch (caught) {
      setNotice({ tone: "bad", text: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(null);
    }
  };

  if (!workspaceId) return <Loading label="Select a workspace…" />;
  if (error) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!data) return <Loading label="Loading billing…" />;

  const sub = data.subscription;
  const currentRank = plans.find((plan) => plan.key === sub.planKey)?.rank ?? 0;

  return (
    <>
      <PageHeader
        title="Billing"
        description="Your plan, what it grants, and every payment attempt with its verified state."
        actions={
          <button
            type="button"
            className="app-btn"
            onClick={() => void load()}
            disabled={busy !== null}
          >
            <RefreshCw size={14} className={busy === "reload" ? "animate-spin" : ""} /> Refresh
          </button>
        }
      />

      {notice ? (
        <p
          className={`mb-4 rounded-[var(--radius)] border px-4 py-3 text-sm ${
            notice.tone === "ok" ? "border-accent/40 text-accent" : "border-danger/40 text-danger"
          }`}
          role="status"
        >
          {notice.text}
        </p>
      ) : null}

      {checkout ? (
        <Card
          className="mb-4"
          title="Checkout in progress"
          description="Nothing is credited from this page or from a redirect: the state below is the server's verification of the provider."
        >
          <div className="px-5 py-4">
            <p className="text-sm">
              Plan <strong>{checkout.planKey}</strong> · attempt{" "}
              <code className="app-mono text-xs">{checkout.intentId}</code>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {checkout.sandbox ? (
                <>
                  <span className="text-xs text-muted">Sandbox outcome:</span>
                  {(["success", "declined", "cancelled", "expired"] as const).map((outcome) => (
                    <button
                      key={outcome}
                      type="button"
                      className={`app-btn ${outcome === "success" ? "app-btn-primary" : ""}`}
                      disabled={busy !== null}
                      onClick={() => void settleSandbox(outcome)}
                    >
                      {outcome}
                    </button>
                  ))}
                </>
              ) : checkout.redirectUrl ? (
                <a
                  className="app-btn app-btn-primary"
                  href={checkout.redirectUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Continue to payment
                </a>
              ) : null}
              <button
                type="button"
                className="app-btn"
                disabled={busy !== null}
                onClick={() => void checkStatus()}
              >
                I have paid — check status
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Plan"
          value={sub.planName}
          hint={sub.entitled ? "Paid access is active" : "Resolving to Free"}
        />
        <Metric
          label="Status"
          value={
            <StatusBadge
              status={sub.entitled ? sub.state : sub.state === "NONE" ? "FREE" : sub.state}
            />
          }
          hint={
            sub.cancelAtPeriodEnd
              ? "Cancels at period end"
              : sub.pendingPlanKey
                ? `Change queued: ${sub.pendingPlanKey}`
                : "No pending change"
          }
        />
        <Metric
          label={sub.recurringSupported ? "Renews on" : "Renew manually by"}
          value={formatDay(sub.renewalDueAt ?? sub.currentPeriodEnd)}
          hint={
            sub.recurringSupported
              ? "The provider charges this automatically"
              : "This provider cannot auto-charge; a new payment is required"
          }
        />
        <Metric
          label="Amount"
          value={sub.amountMinor && sub.currency ? formatMinor(sub.amountMinor, sub.currency) : "—"}
          hint={
            sub.period ? `per ${sub.period === "monthly" ? "month" : "year"}` : "No paid period"
          }
        />
      </div>

      {!sub.entitled ? (
        <Card className="mt-4">
          <div className="flex items-start gap-3">
            <TriangleAlert size={17} className="mt-0.5 shrink-0 text-warning" />
            <div>
              <p className="text-sm font-medium">This workspace is on Free</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {sub.reason === "period_ended_awaiting_renewal"
                  ? `The paid period ended on ${formatDate(sub.currentPeriodEnd)} and no verified renewal exists.`
                  : sub.reason === "subscription_cancelled"
                    ? "The subscription was cancelled."
                    : sub.reason === "subscription_suspended"
                      ? "The subscription is suspended."
                      : "No paid subscription is active."}{" "}
                Nothing was deleted, and no paid feature is switched on until a provider confirms a
                payment.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <Card
        className="mt-6"
        title="Usage this period"
        description="Metered once per subject: a retried upload or a re-run of the same id counts once."
      >
        <div className="overflow-x-auto">
          <table className="app-table">
            <thead>
              <tr>
                <th>Counter</th>
                <th className="text-right">Used</th>
                <th className="text-right">Limit</th>
                <th>Billing treatment</th>
              </tr>
            </thead>
            <tbody>
              {data.usage.map((counter) => (
                <tr key={counter.key}>
                  <td>{counter.label}</td>
                  <td className="text-right tabular-nums">{counter.used}</td>
                  <td className="text-right tabular-nums">
                    {counter.limit === -1 ? "unlimited" : counter.limit}
                  </td>
                  <td className="text-xs text-muted">{counter.counted.replaceAll("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        className="mt-6"
        title="Change plan"
        description={
          sub.recurringSupported
            ? "Upgrades apply immediately with a new charge; downgrades queue until the period ends."
            : "This provider cannot auto-charge, so a plan change is a new prepaid period. Nothing renews by itself."
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {plans
            .filter((plan) => plan.rank > 0)
            .map((plan) => {
              const monthly = plan.prices.find((price) => price.period === "monthly");
              const isCurrent = plan.key === sub.planKey;
              const isUpgrade = plan.rank > currentRank;
              return (
                <div key={plan.key} className="rounded-[var(--radius)] border border-line p-4">
                  <p className="text-sm font-semibold">{plan.name}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{plan.description}</p>
                  <p className="mt-3 text-lg font-semibold">
                    {monthly ? formatMinor(monthly.amount.minor, monthly.amount.currency) : "—"}
                    <span className="ml-1 text-xs font-normal text-muted">/ month</span>
                  </p>
                  <button
                    type="button"
                    className={`app-btn mt-3 w-full ${isUpgrade ? "app-btn-primary" : ""}`}
                    disabled={isCurrent || busy !== null}
                    onClick={() => void choosePlan(plan)}
                  >
                    {isCurrent
                      ? "Current plan"
                      : isUpgrade
                        ? `Upgrade to ${plan.name}`
                        : `Switch to ${plan.name}`}
                  </button>
                </div>
              );
            })}
        </div>
        <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-muted">
          A plan is never activated by a browser redirect. Access changes only after the
          provider&apos;s verified transaction status says the payment succeeded.
        </p>
      </Card>

      <Card
        className="mt-6"
        title="Payment history"
        description="Every attempt, including the ones that failed. A failed attempt is shown, not hidden."
      >
        {data.payments.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">No payment attempts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Created</th>
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
                    <td>
                      {payment.planKey}
                      <span className="ml-1 text-xs text-muted">/ {payment.period}</span>
                    </td>
                    <td className="text-right tabular-nums">
                      {formatMinor(payment.amount.minor, payment.amount.currency)}
                    </td>
                    <td>
                      <StatusBadge status={payment.state} />
                      {payment.failureReason ? (
                        <span className="ml-2 text-xs text-muted">{payment.failureReason}</span>
                      ) : null}
                    </td>
                    <td className="text-xs">{payment.credited ? "yes" : "no"}</td>
                    <td className="app-mono text-xs text-muted">
                      {payment.providerReference ?? "—"}
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
        title="Receipts"
        description="A payment receipt proves a payment. It is not a tax invoice, and VAT/GST treatment is not assessed."
      >
        {data.invoices.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">
            No receipts yet. One is issued when a payment is verified.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Issued</th>
                  <th>Service period</th>
                  <th className="text-right">Total</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="app-mono text-xs">{invoice.number}</td>
                    <td className="whitespace-nowrap text-xs">{formatDate(invoice.issuedAt)}</td>
                    <td className="whitespace-nowrap text-xs">
                      {formatDay(invoice.periodStart)} → {formatDay(invoice.periodEnd)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatMinor(invoice.total.minor, invoice.total.currency)}
                    </td>
                    <td>
                      <StatusBadge status={invoice.status} />
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="app-btn"
                        onClick={() => downloadReceipt(invoice, sub.planName)}
                      >
                        <Download size={13} /> Receipt
                      </button>
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
        title="Payment provider"
        description="What the configured gateway can and cannot do. Read from the adapter, not from marketing."
      >
        <dl className="grid gap-3 px-5 py-4 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted">Provider</dt>
            <dd className="mt-0.5 font-medium">{data.provider.name}</dd>
          </div>
          <div>
            <dt className="text-muted">Automatic recurring charges</dt>
            <dd className="mt-0.5 font-medium">
              {data.provider.automatedRecurring ? "supported" : "not supported"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Refunds via API</dt>
            <dd className="mt-0.5 font-medium">
              {data.provider.refunds ? "supported" : "administrative only"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Webhook signature</dt>
            <dd className="app-mono mt-0.5">{data.provider.webhookSignatureScheme}</dd>
          </div>
        </dl>
        <ul className="border-t border-line px-5 py-3 text-xs leading-relaxed text-muted">
          {data.provider.notes.map((note) => (
            <li key={note} className="mt-1 first:mt-0">
              · {note}
            </li>
          ))}
        </ul>
      </Card>

      {sub.entitled || sub.state !== "NONE" ? (
        <Card
          className="mt-6"
          title="Cancel"
          description="Cancelling keeps the access you already paid for until the period ends."
        >
          <div className="px-5 py-4">
            <button
              type="button"
              className="app-btn app-btn-danger"
              disabled={busy !== null || sub.cancelAtPeriodEnd}
              onClick={() =>
                void act(
                  "cancel",
                  () => postJson("/api/v1/billing/cancel", { workspaceId }),
                  `Cancelled. Access continues until ${formatDay(sub.currentPeriodEnd)}.`
                )
              }
            >
              <CreditCard size={14} />{" "}
              {sub.cancelAtPeriodEnd ? "Cancellation already scheduled" : "Cancel subscription"}
            </button>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              No further charge is created. The plan drops to Free at{" "}
              {formatDay(sub.currentPeriodEnd)}, and your data is kept.
            </p>
          </div>
        </Card>
      ) : null}
    </>
  );
}

/**
 * Build a receipt as a downloadable text file.
 *
 * Deliberately not a PDF: a PDF generator is a dependency and a layout engine for a
 * document whose legal status is "receipt, not tax invoice". A plain, printable file
 * that states exactly what happened is more honest and more useful.
 */
function downloadReceipt(invoice: BillingData["invoices"][number], planName: string): void {
  const lines = [
    "PROOFSTACK — PAYMENT RECEIPT",
    "",
    `Receipt number : ${invoice.number}`,
    `Issued         : ${formatDate(invoice.issuedAt)}`,
    `Plan           : ${planName}`,
    `Service period : ${formatDay(invoice.periodStart)} to ${formatDay(invoice.periodEnd)}`,
    `Amount         : ${formatMinor(invoice.total.minor, invoice.total.currency)}`,
    `Status         : ${invoice.status}`,
    "",
    "This document is a payment receipt. It is not a tax invoice.",
    invoice.taxNote ??
      "VAT/GST treatment depends on the jurisdiction of the seller and the buyer and has not been assessed for this document.",
    "",
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${invoice.number}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}
