import type {
  AuditEntry,
  BillingStore,
  Customer,
  PaymentIntent,
  StoredInvoice,
  StoredUsageEvent,
  StoredWebhookRecord,
  Subscription,
} from "@proofstack/billing";
import { iso } from "@proofstack/core";
import {
  bool,
  type Database,
  json,
  nullableStr,
  num,
  parseJson,
  type Row,
  str,
} from "../db/types.js";

/**
 * The production billing store.
 *
 * It is the SQL implementation of the guarantees `@proofstack/billing` relies on:
 *
 *   - `payment_intents.idempotency_key` UNIQUE      → one charge per billing period
 *   - `webhook_events(provider, provider_event_id)` → replay is a no-op
 *   - `usage_events(workspace_id, kind, dedupe_key)` → metered once per subject
 *   - `invoices.payment_attempt_id` UNIQUE          → one receipt per payment
 *
 * Those constraints are enforced by SQLite/D1, so two concurrent webhook deliveries
 * cannot both insert the same event: exactly one gets `changes === 1`.
 */
export class SqlBillingStore implements BillingStore {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date()
  ) {}

  // --------------------------------------------------------------- customers

  async saveCustomer(customer: Customer): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO customers (id, email, email_normalized, name, country, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET email = excluded.email, email_normalized = excluded.email_normalized,
           name = excluded.name, country = excluded.country`
      )
      .bind(
        customer.id,
        customer.email,
        customer.emailNormalized,
        customer.name,
        customer.country,
        customer.createdAt
      )
      .run();
  }

  async getCustomer(id: string): Promise<Customer | null> {
    const row = await this.db.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first<Row>();
    return row ? mapCustomer(row) : null;
  }

  async findCustomerByNormalizedEmail(email: string): Promise<Customer | null> {
    const row = await this.db
      .prepare("SELECT * FROM customers WHERE email_normalized = ?")
      .bind(email)
      .first<Row>();
    return row ? mapCustomer(row) : null;
  }

  // ----------------------------------------------------------- subscriptions

  async saveSubscription(subscription: Subscription): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO subscriptions (id, workspace_id, customer_id, plan_key, currency, period, state,
                                    current_period_start, current_period_end, cancel_at_period_end,
                                    trial_ends_at, provider, pending_plan_key, funded_by_intent_ids,
                                    created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           plan_key = excluded.plan_key, currency = excluded.currency, period = excluded.period,
           state = excluded.state, current_period_start = excluded.current_period_start,
           current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
           trial_ends_at = excluded.trial_ends_at, pending_plan_key = excluded.pending_plan_key,
           funded_by_intent_ids = excluded.funded_by_intent_ids, updated_at = excluded.updated_at`
      )
      .bind(
        subscription.id,
        subscription.workspaceId,
        subscription.customerId,
        subscription.planKey,
        subscription.currency,
        subscription.period,
        subscription.state,
        subscription.currentPeriodStart,
        subscription.currentPeriodEnd,
        bool(subscription.cancelAtPeriodEnd),
        subscription.trialEndsAt,
        subscription.provider,
        subscription.pendingPlanKey,
        json(subscription.fundedByIntentIds),
        subscription.createdAt,
        subscription.updatedAt
      )
      .run();
  }

  async getSubscription(id: string): Promise<Subscription | null> {
    const row = await this.db
      .prepare("SELECT * FROM subscriptions WHERE id = ?")
      .bind(id)
      .first<Row>();
    return row ? mapSubscription(row) : null;
  }

  async listSubscriptions(workspaceId: string): Promise<Subscription[]> {
    const rows = await this.db
      .prepare("SELECT * FROM subscriptions WHERE workspace_id = ? ORDER BY created_at ASC")
      .bind(workspaceId)
      .all<Row>();
    return rows.map(mapSubscription);
  }

  async liveSubscription(workspaceId: string): Promise<Subscription | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM subscriptions WHERE workspace_id = ? AND state NOT IN ('CANCELLED', 'EXPIRED')
         ORDER BY created_at DESC LIMIT 1`
      )
      .bind(workspaceId)
      .first<Row>();
    return row ? mapSubscription(row) : null;
  }

  // -------------------------------------------------------- payment intents

  async saveIntent(intent: PaymentIntent): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO payment_intents (id, workspace_id, subscription_id, plan_key, price_id, period, currency,
                                      amount_minor, provider, idempotency_key, purpose, state, provider_reference,
                                      provider_checkout_url, verified_amount_minor, verified_net_amount_minor,
                                      credited, failure_reason, quarantined, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state = excluded.state, provider_reference = excluded.provider_reference,
           provider_checkout_url = excluded.provider_checkout_url,
           verified_amount_minor = excluded.verified_amount_minor,
           verified_net_amount_minor = excluded.verified_net_amount_minor,
           credited = excluded.credited, failure_reason = excluded.failure_reason,
           quarantined = excluded.quarantined, updated_at = excluded.updated_at`
      )
      .bind(
        intent.id,
        intent.workspaceId,
        intent.subscriptionId,
        intent.planKey,
        intent.priceId,
        intent.period,
        intent.currency,
        intent.amountMinor,
        intent.provider,
        intent.idempotencyKey,
        intent.purpose,
        intent.state,
        intent.providerReference,
        intent.providerCheckoutUrl,
        intent.verifiedAmountMinor,
        intent.verifiedNetAmountMinor,
        bool(intent.credited),
        intent.failureReason,
        bool(intent.quarantined),
        intent.createdAt,
        intent.updatedAt
      )
      .run();
  }

  async getIntent(id: string): Promise<PaymentIntent | null> {
    const row = await this.db
      .prepare("SELECT * FROM payment_intents WHERE id = ?")
      .bind(id)
      .first<Row>();
    return row ? mapIntent(row) : null;
  }

  async findIntentByIdempotencyKey(key: string): Promise<PaymentIntent | null> {
    const row = await this.db
      .prepare("SELECT * FROM payment_intents WHERE idempotency_key = ?")
      .bind(key)
      .first<Row>();
    return row ? mapIntent(row) : null;
  }

  async findIntentByProviderReference(reference: string): Promise<PaymentIntent | null> {
    const row = await this.db
      .prepare(
        "SELECT * FROM payment_intents WHERE provider_reference = ? ORDER BY created_at DESC LIMIT 1"
      )
      .bind(reference)
      .first<Row>();
    return row ? mapIntent(row) : null;
  }

  async listIntents(workspaceId: string): Promise<PaymentIntent[]> {
    const rows = await this.db
      .prepare("SELECT * FROM payment_intents WHERE workspace_id = ? ORDER BY created_at DESC")
      .bind(workspaceId)
      .all<Row>();
    return rows.map(mapIntent);
  }

  // --------------------------------------------------------------- webhooks

  async insertWebhook(record: StoredWebhookRecord): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO webhook_events (id, provider, provider_event_id, type, received_at,
                                              signature_valid, processing_state, processed_at, body_digest, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        record.id,
        record.provider,
        record.providerEventId,
        record.type,
        record.receivedAt,
        bool(record.signatureValid),
        record.processingState,
        record.processedAt ?? null,
        record.bodyDigest,
        record.error ?? null
      )
      .run();
    // D1/SQLite report the number of rows actually written; zero means the unique
    // constraint rejected a duplicate delivery.
    return result.changes > 0;
  }

  async saveWebhook(record: StoredWebhookRecord): Promise<void> {
    await this.db
      .prepare(
        `UPDATE webhook_events SET processing_state = ?, processed_at = ?, error = ?
         WHERE provider = ? AND provider_event_id = ?`
      )
      .bind(
        record.processingState,
        record.processedAt ?? null,
        record.error ?? null,
        record.provider,
        record.providerEventId
      )
      .run();
  }

  async listWebhooks(limit: number): Promise<StoredWebhookRecord[]> {
    const rows = await this.db
      .prepare("SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT ?")
      .bind(limit)
      .all<Row>();
    return rows.map((row) => ({
      id: str(row, "id"),
      provider: str(row, "provider") as StoredWebhookRecord["provider"],
      providerEventId: str(row, "provider_event_id"),
      type: str(row, "type"),
      receivedAt: str(row, "received_at"),
      signatureValid: num(row, "signature_valid") === 1,
      processingState: str(row, "processing_state") as StoredWebhookRecord["processingState"],
      ...(nullableStr(row, "processed_at") ? { processedAt: str(row, "processed_at") } : {}),
      bodyDigest: str(row, "body_digest"),
      ...(nullableStr(row, "error") ? { error: str(row, "error") } : {}),
    }));
  }

  // ------------------------------------------------------------------ usage

  async insertUsage(event: StoredUsageEvent): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO usage_events (id, workspace_id, project_id, kind, quantity, dedupe_key,
                                             occurred_at, billing_treatment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        event.id,
        event.workspaceId,
        event.projectId ?? null,
        event.kind,
        event.quantity,
        event.dedupeKey,
        event.occurredAt,
        event.billingTreatment
      )
      .run();
    return result.changes > 0;
  }

  async usageByKind(
    workspaceId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<Record<string, number>> {
    const rows = await this.db
      .prepare(
        `SELECT kind, SUM(quantity) AS total FROM usage_events
         WHERE workspace_id = ? AND occurred_at >= ? AND occurred_at < ?
           AND billing_treatment != 'not_counted'
         GROUP BY kind`
      )
      .bind(workspaceId, periodStart, periodEnd)
      .all<Row>();
    const totals: Record<string, number> = {};
    for (const row of rows) totals[str(row, "kind")] = num(row, "total");
    return totals;
  }

  // --------------------------------------------------------------- invoices

  async saveInvoice(invoice: StoredInvoice): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO invoices (id, number, workspace_id, subscription_id, payment_attempt_id,
                                         provider_reference, status, payload, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        invoice.id,
        invoice.number,
        invoice.workspaceId,
        invoice.subscriptionId,
        invoice.paymentAttemptId,
        invoice.providerReference ?? null,
        invoice.status,
        json(invoice),
        invoice.issuedAt
      )
      .run();
  }

  async getInvoice(id: string): Promise<StoredInvoice | null> {
    const row = await this.db
      .prepare("SELECT payload FROM invoices WHERE id = ?")
      .bind(id)
      .first<Row>();
    return row ? parseJson<StoredInvoice | null>(row.payload, null) : null;
  }

  async findInvoiceByIntent(paymentIntentId: string): Promise<StoredInvoice | null> {
    const row = await this.db
      .prepare("SELECT payload FROM invoices WHERE payment_attempt_id = ?")
      .bind(paymentIntentId)
      .first<Row>();
    return row ? parseJson<StoredInvoice | null>(row.payload, null) : null;
  }

  async listInvoices(workspaceId: string): Promise<StoredInvoice[]> {
    const rows = await this.db
      .prepare("SELECT payload FROM invoices WHERE workspace_id = ? ORDER BY issued_at DESC")
      .bind(workspaceId)
      .all<Row>();
    return rows
      .map((row) => parseJson<StoredInvoice | null>(row.payload, null))
      .filter((row): row is StoredInvoice => row !== null);
  }

  // ------------------------------------------------------------------ audit

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO audit_logs (id, workspace_id, actor, action, detail, at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(entry.id, entry.workspaceId, entry.actor, entry.action, json(entry.detail), entry.at)
      .run();
  }

  async listAudit(workspaceId: string, limit: number): Promise<AuditEntry[]> {
    const rows = await this.db
      .prepare("SELECT * FROM audit_logs WHERE workspace_id = ? ORDER BY at DESC LIMIT ?")
      .bind(workspaceId, limit)
      .all<Row>();
    return rows.map((row) => ({
      id: str(row, "id"),
      workspaceId: str(row, "workspace_id"),
      actor: str(row, "actor"),
      action: str(row, "action"),
      detail: parseJson<Record<string, unknown>>(row.detail, {}),
      at: str(row, "at"),
    }));
  }

  /** Webhook deliveries for the admin view; never includes a payload or a signature. */
  async recentWebhookTypes(
    limit = 20
  ): Promise<{ type: string; state: string; receivedAt: string }[]> {
    const rows = await this.db
      .prepare(
        "SELECT type, processing_state, received_at FROM webhook_events ORDER BY received_at DESC LIMIT ?"
      )
      .bind(limit)
      .all<Row>();
    return rows.map((row) => ({
      type: str(row, "type"),
      state: str(row, "processing_state"),
      receivedAt: str(row, "received_at"),
    }));
  }

  /** Used by tests and the admin CLI: a fresh, honest timestamp for reconciliation. */
  now(): string {
    return iso(this.clock());
  }
}

// -------------------------------------------------------------------- mappers

function mapCustomer(row: Row): Customer {
  return {
    id: str(row, "id"),
    email: str(row, "email"),
    emailNormalized: str(row, "email_normalized"),
    name: str(row, "name"),
    country: nullableStr(row, "country"),
    createdAt: str(row, "created_at"),
  };
}

function mapSubscription(row: Row): Subscription {
  return {
    id: str(row, "id"),
    workspaceId: str(row, "workspace_id"),
    customerId: str(row, "customer_id"),
    planKey: str(row, "plan_key"),
    currency: str(row, "currency"),
    period: str(row, "period") as Subscription["period"],
    state: str(row, "state") as Subscription["state"],
    currentPeriodStart: str(row, "current_period_start"),
    currentPeriodEnd: str(row, "current_period_end"),
    cancelAtPeriodEnd: num(row, "cancel_at_period_end") === 1,
    trialEndsAt: nullableStr(row, "trial_ends_at"),
    provider: str(row, "provider") as Subscription["provider"],
    pendingPlanKey: nullableStr(row, "pending_plan_key"),
    fundedByIntentIds: parseJson<string[]>(row.funded_by_intent_ids, []),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function mapIntent(row: Row): PaymentIntent {
  return {
    id: str(row, "id"),
    workspaceId: str(row, "workspace_id"),
    subscriptionId: str(row, "subscription_id"),
    planKey: str(row, "plan_key"),
    priceId: str(row, "price_id"),
    period: str(row, "period") as PaymentIntent["period"],
    currency: str(row, "currency"),
    amountMinor: str(row, "amount_minor"),
    provider: str(row, "provider") as PaymentIntent["provider"],
    idempotencyKey: str(row, "idempotency_key"),
    purpose: str(row, "purpose") as PaymentIntent["purpose"],
    state: str(row, "state") as PaymentIntent["state"],
    providerReference: nullableStr(row, "provider_reference"),
    providerCheckoutUrl: nullableStr(row, "provider_checkout_url"),
    verifiedAmountMinor: nullableStr(row, "verified_amount_minor"),
    verifiedNetAmountMinor: nullableStr(row, "verified_net_amount_minor"),
    credited: num(row, "credited") === 1,
    failureReason: nullableStr(row, "failure_reason"),
    quarantined: num(row, "quarantined") === 1,
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}
