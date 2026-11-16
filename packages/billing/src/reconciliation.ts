import type { PaymentProvider } from "@proofstack/adapter-payments";
import { iso, uuid } from "@proofstack/core";
import type { CheckoutService } from "./checkout.js";
import type { BillingStore } from "./store.js";

/**
 * Reconciliation.
 *
 * Webhooks are best-effort; the ledger is not. This pass re-verifies anything that is
 * still open, closes periods that expired, and reports the drift between what the
 * provider says and what the subscription table says. It is safe to run repeatedly:
 * every branch re-reads the provider and `credited` makes a repeat inert.
 *
 * It is also the answer to "the webhook never arrived". A missed webhook must never
 * mean a customer paid and got nothing.
 */
export class ReconciliationService {
  constructor(
    private readonly store: BillingStore,
    private readonly provider: PaymentProvider,
    private readonly checkout: CheckoutService
  ) {}

  async sweep(input: { workspaceIds: string[]; now?: Date }): Promise<ReconciliationReport> {
    const now = input.now ?? new Date();
    const report: ReconciliationReport = {
      ranAt: iso(now),
      workspaces: input.workspaceIds.length,
      reverified: 0,
      credited: 0,
      failed: 0,
      stillPending: 0,
      mismatches: 0,
      expiredPeriodsClosed: 0,
      details: [],
    };

    for (const workspaceId of input.workspaceIds) {
      const intents = await this.store.listIntents(workspaceId);
      for (const intent of intents) {
        if (intent.credited || !intent.providerReference) continue;
        report.reverified += 1;
        const result = await this.checkout.finalize(intent.id, { source: "reconciliation" });
        switch (result.outcome) {
          case "credited":
            report.credited += 1;
            break;
          case "failed":
            report.failed += 1;
            break;
          case "amount_mismatch":
            report.mismatches += 1;
            break;
          case "still_pending":
          case "verification_unavailable":
            report.stillPending += 1;
            break;
          default:
            break;
        }
        report.details.push({ intentId: intent.id, outcome: result.outcome });
      }

      const subscription = await this.store.liveSubscription(workspaceId);
      if (
        subscription &&
        (subscription.state === "ACTIVE" ||
          subscription.state === "TRIALING" ||
          subscription.state === "CANCEL_AT_PERIOD_END") &&
        new Date(subscription.currentPeriodEnd) <= now
      ) {
        // The paid period ended with no successful renewal. The entitlement resolver
        // already drops access at this boundary; recording the state makes the *why*
        // visible to the customer instead of looking like a bug.
        const nextState = subscription.cancelAtPeriodEnd ? "EXPIRED" : "PAST_DUE";
        await this.store.saveSubscription({
          ...subscription,
          state: nextState,
          updatedAt: iso(now),
        });
        report.expiredPeriodsClosed += 1;
        report.details.push({ intentId: subscription.id, outcome: `period_closed:${nextState}` });
      }
    }

    await this.store.appendAudit({
      id: uuid(),
      workspaceId: "system",
      actor: "reconciliation",
      action: "sweep",
      detail: {
        ranAt: report.ranAt,
        workspaces: report.workspaces,
        reverified: report.reverified,
        credited: report.credited,
        failed: report.failed,
        stillPending: report.stillPending,
        mismatches: report.mismatches,
        expiredPeriodsClosed: report.expiredPeriodsClosed,
      },
      at: iso(now),
    });

    return report;
  }

  /**
   * Compare what the provider reports against the local ledger, without mutating
   * anything. This is the audit view: it answers "is our table lying to us?".
   */
  async audit(input: { workspaceIds: string[] }): Promise<ReconciliationAudit> {
    const rows: ReconciliationAuditRow[] = [];
    for (const workspaceId of input.workspaceIds) {
      for (const intent of await this.store.listIntents(workspaceId)) {
        if (!intent.providerReference) continue;
        let providerState = "unavailable";
        let providerAmountMinor: string | null = null;
        try {
          const verified = await this.provider.verifyTransaction(intent.providerReference);
          providerState = verified.state;
          providerAmountMinor = verified.amount.minor.toString();
        } catch {
          providerState = "unavailable";
        }
        const amountAgrees =
          providerAmountMinor === null || providerAmountMinor === intent.amountMinor;
        const stateAgrees =
          providerState === "unavailable" ||
          (providerState === "SUCCEEDED" && intent.credited) ||
          providerState === intent.state;
        rows.push({
          workspaceId,
          intentId: intent.id,
          providerReference: intent.providerReference,
          localState: intent.state,
          providerState,
          localAmountMinor: intent.amountMinor,
          providerAmountMinor,
          credited: intent.credited,
          quarantined: intent.quarantined,
          agrees: amountAgrees && stateAgrees,
        });
      }
    }
    return { checkedAt: iso(), rows, disagreements: rows.filter((r) => !r.agrees).length };
  }
}

export interface ReconciliationReport {
  ranAt: string;
  workspaces: number;
  reverified: number;
  credited: number;
  failed: number;
  stillPending: number;
  mismatches: number;
  expiredPeriodsClosed: number;
  details: { intentId: string; outcome: string }[];
}

export interface ReconciliationAuditRow {
  workspaceId: string;
  intentId: string;
  providerReference: string;
  localState: string;
  providerState: string;
  localAmountMinor: string;
  providerAmountMinor: string | null;
  credited: boolean;
  quarantined: boolean;
  agrees: boolean;
}

export interface ReconciliationAudit {
  checkedAt: string;
  rows: ReconciliationAuditRow[];
  disagreements: number;
}
