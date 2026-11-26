import { CreditCard, Download, PartyPopper, RefreshCw, TriangleAlert } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Card, Empty, ErrorState, Loading, Metric, StatusBadge } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch, postJson } from "../../lib/api.js";
import {
  periodLabel,
  planLabel,
  providerNote,
  sandboxOutcomeLabel,
  statusLabel,
} from "../../lib/appLabels.js";
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
    currencies: string[];
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

/**
 * Billing usage rows, in the reader's language.
 *
 * The API labels its counters in English because the CLI, the webhook payloads and the
 * operator console all read them; the billing page is the only bilingual surface that
 * prints them. Mapping by key keeps a new counter from silently leaking English into a
 * French table — which is exactly what happened to `monthly_ai_audits`.
 */
const USAGE_COPY: Record<
  string,
  { fr: { label: string; counted: string }; en: { label: string; counted: string } }
> = {
  monthly_test_runs: {
    fr: {
      label: "Tests exécutés cette période",
      counted:
        "Un par identifiant de run ; les réessais et échecs d'envoi ne comptent pas deux fois.",
    },
    en: {
      label: "Test runs this period",
      counted: "One per run id; retries and failed uploads are not double-billed.",
    },
  },
  monthly_ai_audits: {
    fr: {
      label: "Audits IA cette période",
      counted:
        "Un par identifiant d'audit ; un scan ou un tour de conversation réessayé n'est compté qu'une fois.",
    },
    en: {
      label: "AI audits this period",
      counted: "One per audit id; a retried scan or chat turn is metered once.",
    },
  },
  project_limit: {
    fr: { label: "Projets", counted: "Comptage en direct" },
    en: { label: "Projects", counted: "Live count" },
  },
};

function usageCopy(
  key: string,
  fallbackCounted: string,
  fr: boolean
): { label: string; counted: string } {
  const entry = USAGE_COPY[key];
  if (entry) return fr ? entry.fr : entry.en;
  // Unknown counter (added server-side, not yet translated): keep the API's own words
  // rather than inventing a French sentence that might say the wrong thing.
  return { label: key, counted: fallbackCounted };
}

/**
 * The monthly price the configured provider can actually charge.
 *
 * SasPay declares XOF/XAF only; the catalogue also carries USD and EUR for display.
 * Sending the first catalogue price (USD) made every test/live SasPay checkout fail with
 * `no_chargeable_currency` before the provider was even called.
 */
function monthlyPriceFor(
  plan: PlanOption,
  currencies: readonly string[]
): PlanOption["prices"][number] | undefined {
  return plan.prices.find(
    (price) => price.period === "monthly" && currencies.includes(price.amount.currency)
  );
}

export function Billing() {
  const { workspaceId } = useSession();
  const { locale, t } = useI18n();
  const fr = locale === "fr";
  const [data, setData] = useState<BillingData | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [celebrate, setCelebrate] = useState<{ planKey: string } | null>(null);
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
    const price = monthlyPriceFor(plan, data?.provider.currencies ?? []);
    if (!price) {
      setNotice({
        tone: "bad",
        text: fr
          ? "Aucun tarif mensuel n'est configuré dans une devise acceptée par le fournisseur de paiement."
          : "No monthly price is configured in a currency the payment provider accepts.",
      });
      return;
    }
    const isUpgrade = plan.rank > currentRank;
    if (!isUpgrade) {
      await act(
        plan.key,
        () => postJson("/api/v1/billing/change-plan", { workspaceId, planKey: plan.key }),
        fr
          ? `${plan.name} sera appliqué à la fin de cette période.`
          : `${plan.name} queued for the end of this period.`
      );
      return;
    }
    setBusy(plan.key);
    setNotice(null);
    try {
      const currency = price.amount.currency;
      const start = await postJson<{ intent: { id: string }; redirectUrl?: string }>(
        "/api/v1/checkout/start",
        {
          workspaceId,
          planKey: plan.key,
          period: "monthly",
          currency,
          returnUrl: `${window.location.origin}/app/billing`,
        }
      );
      setCheckout({
        intentId: start.intent.id,
        planKey: plan.key,
        ...(start.redirectUrl ? { redirectUrl: start.redirectUrl } : {}),
        sandbox: data?.provider.slug === "sandbox",
      });
      setNotice({
        tone: "ok",
        text: fr
          ? "Paiement ouvert. L'offre ne change que lorsque le fournisseur confirme le paiement au serveur."
          : "Checkout opened. The plan changes only when the provider confirms the payment to the server.",
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
      if (status.entitled) {
        setCheckout(null);
        setCelebrate({ planKey: checkout.planKey ?? "paid" });
      }
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
        text: fr
          ? `Le fournisseur sandbox a renvoyé ${result.state}. L'abonnement a été recalculé depuis cet état vérifié.`
          : `Sandbox provider reported ${result.state}. The subscription was recalculated from that verified state.`,
      });
      if (result.outcome === "credited") {
        setCheckout(null);
        setCelebrate({ planKey: checkout.planKey ?? "paid" });
      }
      await load();
    } catch (caught) {
      setNotice({ tone: "bad", text: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(null);
    }
  };

  // No workspace means no request was made. A spinner would be a lie the user cannot
  // act on, so the page names the real state.
  if (!workspaceId) {
    return (
      <Empty
        title={fr ? "Aucun espace sélectionné" : "No workspace selected"}
        body={
          fr
            ? "Choisissez un espace dans l'en-tête, ou créez-en un. Rien n'est chargé avant ce choix."
            : "Pick a workspace in the header, or create one. Nothing is loaded until a workspace is chosen."
        }
        tester="empty"
      />
    );
  }
  if (error) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!data) return <Loading label={fr ? "Chargement de la facturation…" : "Loading billing…"} />;

  const sub = data.subscription;
  const currentRank = plans.find((plan) => plan.key === sub.planKey)?.rank ?? 0;

  return (
    <>
      <PageHeader
        title={t("ws.billing.title")}
        description={t("ws.billing.description")}
        actions={
          <button
            type="button"
            className="app-btn"
            onClick={() => void load()}
            disabled={busy !== null}
          >
            <RefreshCw size={14} className={busy === "reload" ? "animate-spin" : ""} />{" "}
            {fr ? "Actualiser" : "Refresh"}
          </button>
        }
      />

      {celebrate ? (
        <div
          className="pk-celebrate relative mb-4 overflow-hidden rounded-[var(--radius)] border border-accent/50 bg-accent/10 px-6 py-6"
          role="status"
        >
          {/* confetti burst: purely decorative */}
          <span aria-hidden className="pointer-events-none absolute inset-0">
            {Array.from({ length: 16 }, (_, i) => {
              const angle = (i / 16) * Math.PI * 2;
              const distance = 60 + (i % 4) * 28;
              const colors = ["#10b981", "#34d399", "#a3e635", "#fbbf24", "#38bdf8"];
              return (
                <span
                  key={`${Math.round(Math.cos(angle) * 100)}-${distance}-${Math.round((angle * 180) / Math.PI)}`} // position-encoded, stable
                  className="pk-confetti-piece"
                  style={
                    {
                      "--cx": `${Math.cos(angle) * distance}px`,
                      "--cy": `${Math.sin(angle) * distance + 20}px`,
                      "--cr": `${(i % 2 ? 1 : -1) * 240}deg`,
                      "--pd": `${(i % 5) * 70}ms`,
                      backgroundColor: colors[i % colors.length],
                    } as React.CSSProperties
                  }
                />
              );
            })}
          </span>
          <div className="relative flex items-center gap-4">
            <svg width="44" height="44" viewBox="0 0 48 48" aria-hidden>
              <circle
                cx="24"
                cy="24"
                r="21"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="text-accent/60"
              />
              <path
                d="M15 24.5 L21.5 31 L33 18.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pk-celebrate-path text-accent"
              />
            </svg>
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-accent">
                <PartyPopper size={15} />
                {fr
                  ? `Abonnement ${planLabel(celebrate.planKey, celebrate.planKey, true)} activé`
                  : `${celebrate.planKey} plan activated`}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {fr
                  ? "Crédité après vérification du fournisseur. Vos nouveaux droits sont actifs immédiatement."
                  : "Credited after provider verification. Your new entitlements are live immediately."}
              </p>
            </div>
            <button
              type="button"
              className="ml-auto rounded-lg p-1.5 text-muted transition hover:bg-surface-2 hover:text-foreground"
              onClick={() => setCelebrate(null)}
              aria-label={fr ? "Fermer" : "Dismiss"}
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

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
          title={fr ? "Paiement en cours" : "Checkout in progress"}
          description={
            fr
              ? "Rien n'est crédité depuis cette page ni depuis une redirection : l'état ci-dessous est la vérification du fournisseur par le serveur."
              : "Nothing is credited from this page or from a redirect: the state below is the server's verification of the provider."
          }
        >
          <div className="px-5 py-4">
            <p className="text-sm">
              {fr ? "Offre" : "Plan"}{" "}
              <strong>{planLabel(checkout.planKey, checkout.planKey, fr)}</strong> ·{" "}
              {fr ? "tentative" : "attempt"}{" "}
              <code className="app-mono text-xs">{checkout.intentId}</code>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {checkout.sandbox ? (
                <>
                  <span className="text-xs text-muted">
                    {fr ? "Résultat sandbox :" : "Sandbox outcome:"}
                  </span>
                  {(["success", "declined", "cancelled", "expired"] as const).map((outcome) => (
                    <button
                      key={outcome}
                      type="button"
                      className={`app-btn ${outcome === "success" ? "app-btn-primary" : ""}`}
                      disabled={busy !== null}
                      onClick={() => void settleSandbox(outcome)}
                    >
                      {sandboxOutcomeLabel(outcome, fr)}
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
                  {fr ? "Continuer vers le paiement" : "Continue to payment"}
                </a>
              ) : null}
              <button
                type="button"
                className="app-btn"
                disabled={busy !== null}
                onClick={() => void checkStatus()}
              >
                {fr ? "J'ai payé — vérifier l'état" : "I have paid — check status"}
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label={fr ? "Offre" : "Plan"}
          value={planLabel(sub.planKey, sub.planName, fr)}
          hint={
            sub.entitled
              ? fr
                ? "L'accès payant est actif"
                : "Paid access is active"
              : fr
                ? `Retour à ${planLabel("free", "Free", true)}`
                : "Resolving to Free"
          }
        />
        <Metric
          label={fr ? "État" : "Status"}
          value={
            <StatusBadge
              status={sub.entitled ? sub.state : sub.state === "NONE" ? "FREE" : sub.state}
            />
          }
          hint={
            sub.cancelAtPeriodEnd
              ? fr
                ? "Se termine à la fin de la période"
                : "Cancels at period end"
              : sub.pendingPlanKey
                ? fr
                  ? `Changement en attente : ${planLabel(
                      sub.pendingPlanKey,
                      sub.pendingPlanKey,
                      true
                    )}`
                  : `Change queued: ${sub.pendingPlanKey}`
                : fr
                  ? "Aucun changement en attente"
                  : "No pending change"
          }
        />
        <Metric
          label={
            sub.recurringSupported
              ? fr
                ? "Renouvellement le"
                : "Renews on"
              : fr
                ? "À renouveler avant le"
                : "Renew manually by"
          }
          value={formatDay(sub.renewalDueAt ?? sub.currentPeriodEnd)}
          hint={
            sub.recurringSupported
              ? fr
                ? "Le fournisseur débite automatiquement"
                : "The provider charges this automatically"
              : fr
                ? "Ce fournisseur ne débite pas automatiquement ; un nouveau paiement est requis"
                : "This provider cannot auto-charge; a new payment is required"
          }
        />
        <Metric
          label={fr ? "Montant" : "Amount"}
          value={sub.amountMinor && sub.currency ? formatMinor(sub.amountMinor, sub.currency) : "—"}
          hint={
            sub.period
              ? fr
                ? `par ${sub.period === "monthly" ? "mois" : "an"}`
                : `per ${sub.period === "monthly" ? "month" : "year"}`
              : fr
                ? "Aucune période payée"
                : "No paid period"
          }
        />
      </div>

      {!sub.entitled ? (
        <Card className="mt-4">
          <div className="flex items-start gap-3">
            <TriangleAlert size={17} className="mt-0.5 shrink-0 text-warning" />
            <div>
              <p className="text-sm font-medium">
                {fr
                  ? `Cet espace est sur ${planLabel("free", "Free", true)}`
                  : "This workspace is on Free"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {sub.reason === "period_ended_awaiting_renewal"
                  ? fr
                    ? `La période payée s'est terminée le ${formatDate(sub.currentPeriodEnd)} et aucun renouvellement vérifié n'existe.`
                    : `The paid period ended on ${formatDate(sub.currentPeriodEnd)} and no verified renewal exists.`
                  : sub.reason === "subscription_cancelled"
                    ? fr
                      ? "L'abonnement a été annulé."
                      : "The subscription was cancelled."
                    : sub.reason === "subscription_suspended"
                      ? fr
                        ? "L'abonnement est suspendu."
                        : "The subscription is suspended."
                      : fr
                        ? "Aucun abonnement payant n'est actif."
                        : "No paid subscription is active."}{" "}
                {fr
                  ? "Rien n'a été supprimé, et aucune fonction payante n'est activée avant la confirmation d'un paiement par le fournisseur."
                  : "Nothing was deleted, and no paid feature is switched on until a provider confirms a payment."}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <Card
        className="mt-6"
        title={fr ? "Usage de cette période" : "Usage this period"}
        description={
          fr
            ? "Compté une fois par sujet : un envoi réessayé ou un nouveau run du même identifiant ne compte qu'une fois."
            : "Metered once per subject: a retried upload or a re-run of the same id counts once."
        }
      >
        <div className="overflow-x-auto app-table-stack-wrap">
          <table className="app-table app-table-stack">
            <thead>
              <tr>
                <th>{fr ? "Compteur" : "Counter"}</th>
                <th className="text-right">{fr ? "Utilisé" : "Used"}</th>
                <th className="text-right">{fr ? "Limite" : "Limit"}</th>
                <th>{fr ? "Traitement" : "Billing treatment"}</th>
              </tr>
            </thead>
            <tbody>
              {data.usage.map((counter) => {
                // Localisation **par clé**, jamais par comparaison de libellé : l'API
                // répond en anglais, et chercher `label === "Projects"` laissait passer
                // la ligne « AI audits this period » telle quelle dans une page française.
                const text = usageCopy(counter.key, counter.counted, fr);
                return (
                  <tr key={counter.key}>
                    <td data-label={fr ? "Compteur" : "Counter"}>{text.label}</td>
                    <td data-label={fr ? "Utilisé" : "Used"} className="text-right tabular-nums">
                      {counter.used}
                    </td>
                    <td data-label={fr ? "Limite" : "Limit"} className="text-right tabular-nums">
                      {counter.limit === -1 ? (fr ? "illimité" : "unlimited") : counter.limit}
                    </td>
                    <td
                      data-label={fr ? "Traitement" : "Billing treatment"}
                      className="text-xs text-muted"
                    >
                      {text.counted}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        className="mt-6"
        title={fr ? "Changer d'offre" : "Change plan"}
        description={
          sub.recurringSupported
            ? fr
              ? "Les montées s'appliquent immédiatement avec un nouveau paiement ; les descentes attendent la fin de la période."
              : "Upgrades apply immediately with a new charge; downgrades queue until the period ends."
            : fr
              ? "Ce fournisseur ne débite pas automatiquement : changer d'offre crée une nouvelle période prépayée. Rien ne se renouvelle seul."
              : "This provider cannot auto-charge, so a plan change is a new prepaid period. Nothing renews by itself."
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {plans
            .filter((plan) => plan.rank > 0)
            .map((plan) => {
              const monthly = monthlyPriceFor(plan, data.provider.currencies ?? []);
              const isCurrent = plan.key === sub.planKey;
              const isUpgrade = plan.rank > currentRank;
              return (
                <div key={plan.key} className="rounded-[var(--radius)] border border-line p-4">
                  <p className="text-sm font-semibold">{plan.name}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    {fr
                      ? ((
                          {
                            developer: "Toute la profondeur des modules et des rapports étendus.",
                            studio:
                              "Collaboration d'équipe, configurations partagées et intégrations CI.",
                            agency:
                              "Plusieurs espaces clients, des rapports clients et les limites les plus hautes.",
                          } as Record<string, string>
                        )[plan.key] ?? plan.description)
                      : plan.description}
                  </p>
                  <p className="mt-3 text-lg font-semibold">
                    {monthly ? formatMinor(monthly.amount.minor, monthly.amount.currency) : "—"}
                    <span className="ml-1 text-xs font-normal text-muted">
                      {fr ? "/ mois" : "/ month"}
                    </span>
                  </p>
                  <button
                    type="button"
                    className={`app-btn mt-3 w-full ${isUpgrade ? "app-btn-primary" : ""}`}
                    disabled={isCurrent || busy !== null || !monthly}
                    onClick={() => void choosePlan(plan)}
                  >
                    {isCurrent
                      ? fr
                        ? "Offre actuelle"
                        : "Current plan"
                      : isUpgrade
                        ? fr
                          ? `Passer à ${plan.name}`
                          : `Upgrade to ${plan.name}`
                        : fr
                          ? `Choisir ${plan.name}`
                          : `Switch to ${plan.name}`}
                  </button>
                </div>
              );
            })}
        </div>
        <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-muted">
          {fr
            ? "Une offre n'est jamais activée par une redirection du navigateur. L'accès change seulement quand le statut vérifié de la transaction confirme le paiement."
            : "A plan is never activated by a browser redirect. Access changes only after the provider's verified transaction status says the payment succeeded."}
        </p>
      </Card>

      <Card
        className="mt-6"
        title={fr ? "Historique des paiements" : "Payment history"}
        description={
          fr
            ? "Chaque tentative, y compris celles qui ont échoué. Un échec est affiché, pas caché."
            : "Every attempt, including the ones that failed. A failed attempt is shown, not hidden."
        }
      >
        {data.payments.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">
            {fr ? "Aucune tentative de paiement." : "No payment attempts yet."}
          </p>
        ) : (
          <div className="overflow-x-auto app-table-stack-wrap">
            <table className="app-table app-table-stack">
              <thead>
                <tr>
                  <th>{fr ? "Créé" : "Created"}</th>
                  <th>{fr ? "Offre" : "Plan"}</th>
                  <th className="text-right">{fr ? "Montant" : "Amount"}</th>
                  <th>{fr ? "État" : "State"}</th>
                  <th>{fr ? "Crédité" : "Credited"}</th>
                  <th>{fr ? "Référence" : "Reference"}</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td data-label={fr ? "Créé" : "Created"} className="whitespace-nowrap text-xs">
                      {formatDate(payment.createdAt)}
                    </td>
                    <td data-label={fr ? "Offre" : "Plan"}>
                      {planLabel(payment.planKey, payment.planKey, fr)}
                      <span className="ml-1 text-xs text-muted">
                        / {periodLabel(payment.period, fr)}
                      </span>
                    </td>
                    <td data-label={fr ? "Montant" : "Amount"} className="text-right tabular-nums">
                      {formatMinor(payment.amount.minor, payment.amount.currency)}
                    </td>
                    <td data-label={fr ? "État" : "State"}>
                      <StatusBadge status={payment.state} />
                      {payment.failureReason ? (
                        <span className="ml-2 text-xs text-muted">{payment.failureReason}</span>
                      ) : null}
                    </td>
                    <td data-label={fr ? "Crédité" : "Credited"} className="text-xs">
                      {payment.credited ? (fr ? "oui" : "yes") : fr ? "non" : "no"}
                    </td>
                    <td
                      data-label={fr ? "Référence" : "Reference"}
                      className="app-mono text-xs text-muted"
                    >
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
        title={fr ? "Reçus" : "Receipts"}
        description={
          fr
            ? "Un reçu prouve un paiement. Ce n'est pas une facture fiscale ; le traitement TVA/GST n'est pas évalué."
            : "A payment receipt proves a payment. It is not a tax invoice, and VAT/GST treatment is not assessed."
        }
      >
        {data.invoices.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">
            {fr
              ? "Aucun reçu. Un reçu est émis lorsqu'un paiement est vérifié."
              : "No receipts yet. One is issued when a payment is verified."}
          </p>
        ) : (
          <div className="overflow-x-auto app-table-stack-wrap">
            <table className="app-table app-table-stack">
              <thead>
                <tr>
                  <th>{fr ? "Numéro" : "Number"}</th>
                  <th>{fr ? "Émis" : "Issued"}</th>
                  <th>{fr ? "Période" : "Service period"}</th>
                  <th className="text-right">Total</th>
                  <th>{fr ? "État" : "Status"}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td data-label={fr ? "Numéro" : "Number"} className="app-mono text-xs">
                      {invoice.number}
                    </td>
                    <td data-label={fr ? "Émis" : "Issued"} className="whitespace-nowrap text-xs">
                      {formatDate(invoice.issuedAt)}
                    </td>
                    <td
                      data-label={fr ? "Période" : "Service period"}
                      className="whitespace-nowrap text-xs"
                    >
                      {formatDay(invoice.periodStart)} → {formatDay(invoice.periodEnd)}
                    </td>
                    <td data-label="Total" className="text-right tabular-nums">
                      {formatMinor(invoice.total.minor, invoice.total.currency)}
                    </td>
                    <td data-label={fr ? "État" : "Status"}>
                      <StatusBadge status={invoice.status} />
                    </td>
                    <td data-label={fr ? "Reçu" : "Receipt"} className="text-right">
                      <button
                        type="button"
                        className="app-btn"
                        onClick={() =>
                          downloadReceipt(invoice, planLabel(sub.planKey, sub.planName, fr), fr)
                        }
                      >
                        <Download size={13} /> {fr ? "Reçu" : "Receipt"}
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
        title={fr ? "Fournisseur de paiement" : "Payment provider"}
        description={
          fr
            ? "Ce que la passerelle configurée peut faire, et ne peut pas faire. Lu depuis l'adaptateur, pas depuis le marketing."
            : "What the configured gateway can and cannot do. Read from the adapter, not from marketing."
        }
      >
        <dl className="grid gap-3 px-5 py-4 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted">{fr ? "Fournisseur" : "Provider"}</dt>
            <dd className="mt-0.5 font-medium">{data.provider.name}</dd>
          </div>
          <div>
            <dt className="text-muted">
              {fr ? "Débits récurrents automatiques" : "Automatic recurring charges"}
            </dt>
            <dd className="mt-0.5 font-medium">
              {data.provider.automatedRecurring
                ? fr
                  ? "pris en charge"
                  : "supported"
                : fr
                  ? "non pris en charge"
                  : "not supported"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">{fr ? "Remboursements via API" : "Refunds via API"}</dt>
            <dd className="mt-0.5 font-medium">
              {data.provider.refunds
                ? fr
                  ? "pris en charge"
                  : "supported"
                : fr
                  ? "administratif uniquement"
                  : "administrative only"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">{fr ? "Signature du webhook" : "Webhook signature"}</dt>
            <dd className="app-mono mt-0.5">{data.provider.webhookSignatureScheme}</dd>
          </div>
        </dl>
        <ul className="border-t border-line px-5 py-3 text-xs leading-relaxed text-muted">
          {data.provider.notes.map((note) => (
            <li key={note} className="mt-1 first:mt-0">
              · {providerNote(note, fr)}
            </li>
          ))}
        </ul>
      </Card>

      {sub.entitled || sub.state !== "NONE" ? (
        <Card
          className="mt-6"
          title={fr ? "Annulation" : "Cancel"}
          description={
            fr
              ? "L'annulation conserve l'accès déjà payé jusqu'à la fin de la période."
              : "Cancelling keeps the access you already paid for until the period ends."
          }
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
                  fr
                    ? `Annulé. L'accès continue jusqu'au ${formatDay(sub.currentPeriodEnd)}.`
                    : `Cancelled. Access continues until ${formatDay(sub.currentPeriodEnd)}.`
                )
              }
            >
              <CreditCard size={14} />{" "}
              {sub.cancelAtPeriodEnd
                ? fr
                  ? "Annulation déjà programmée"
                  : "Cancellation already scheduled"
                : fr
                  ? "Annuler l'abonnement"
                  : "Cancel subscription"}
            </button>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              {fr
                ? `Aucun nouveau débit n'est créé. L'offre repasse à ${planLabel(
                    "free",
                    "Free",
                    true
                  )} le`
                : "No further charge is created. The plan drops to Free at"}{" "}
              {formatDay(sub.currentPeriodEnd)}
              {fr ? ", et vos données sont conservées." : ", and your data is kept."}
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
function downloadReceipt(
  invoice: BillingData["invoices"][number],
  planName: string,
  fr: boolean
): void {
  const lines = fr
    ? [
        "PROOFCORE — REÇU DE PAIEMENT",
        "",
        `Numéro de reçu : ${invoice.number}`,
        `Émis le         : ${formatDate(invoice.issuedAt)}`,
        `Offre           : ${planName}`,
        `Période        : du ${formatDay(invoice.periodStart)} au ${formatDay(invoice.periodEnd)}`,
        `Montant         : ${formatMinor(invoice.total.minor, invoice.total.currency)}`,
        `État            : ${statusLabel(invoice.status, true)}`,
        "",
        "Ce document est un reçu de paiement. Ce n'est pas une facture fiscale.",
        invoice.taxNote ??
          "Le traitement TVA/GST dépend de la juridiction du vendeur et de l'acheteur ; il n'a pas été évalué pour ce document.",
        "",
      ]
    : [
        "PROOFCORE — PAYMENT RECEIPT",
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
