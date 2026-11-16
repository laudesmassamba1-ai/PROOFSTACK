import type { UsageEventKind } from "@proofstack/contracts";
import type { Customer, PaymentIntent, StoredInvoice, StoredUsageEvent, StoredWebhookRecord, Subscription } from "./records.js";

/**
 * Persistence boundary for billing.
 *
 * The in-memory implementation makes the money logic runnable and testable with zero
 * infrastructure; the D1 implementation in apps/api is the production one. Both give
 * the same *uniqueness guarantees*, and those guarantees — not the SQL — are what the
 * correctness depends on:
 *   - webhook (provider, providerEventId) unique → replay is a no-op
 *   - usage (workspaceId, kind, dedupeKey) unique → a retried action is metered once
 *   - payment intent idempotencyKey unique → one charge per billing period
 */
export interface BillingStore {
  saveCustomer(customer: Customer): Promise<void>;
  getCustomer(id: string): Promise<Customer | null>;
  findCustomerByNormalizedEmail(email: string): Promise<Customer | null>;

  saveSubscription(subscription: Subscription): Promise<void>;
  getSubscription(id: string): Promise<Subscription | null>;
  listSubscriptions(workspaceId: string): Promise<Subscription[]>;
  /** The subscription that currently speaks for the workspace, if any. */
  liveSubscription(workspaceId: string): Promise<Subscription | null>;

  saveIntent(intent: PaymentIntent): Promise<void>;
  getIntent(id: string): Promise<PaymentIntent | null>;
  findIntentByIdempotencyKey(key: string): Promise<PaymentIntent | null>;
  findIntentByProviderReference(reference: string): Promise<PaymentIntent | null>;
  listIntents(workspaceId: string): Promise<PaymentIntent[]>;

  /** Resolves false when the (provider, providerEventId) pair already exists. */
  insertWebhook(record: StoredWebhookRecord): Promise<boolean>;
  saveWebhook(record: StoredWebhookRecord): Promise<void>;
  listWebhooks(limit: number): Promise<StoredWebhookRecord[]>;

  /** Resolves false when (workspaceId, kind, dedupeKey) already exists. */
  insertUsage(event: StoredUsageEvent): Promise<boolean>;
  usageByKind(workspaceId: string, periodStart: string, periodEnd: string): Promise<Record<string, number>>;

  saveInvoice(invoice: StoredInvoice): Promise<void>;
  getInvoice(id: string): Promise<StoredInvoice | null>;
  findInvoiceByIntent(paymentIntentId: string): Promise<StoredInvoice | null>;
  listInvoices(workspaceId: string): Promise<StoredInvoice[]>;

  appendAudit(entry: AuditEntry): Promise<void>;
  listAudit(workspaceId: string, limit: number): Promise<AuditEntry[]>;
}

export interface AuditEntry {
  id: string;
  workspaceId: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  at: string;
}

const USAGE_KINDS: UsageEventKind[] = [
  "test_run",
  "module_run",
  "report_storage",
  "export_job",
  "api_request",
  "cli_sync",
];

export class MemoryBillingStore implements BillingStore {
  private readonly customers = new Map<string, Customer>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly intents = new Map<string, PaymentIntent>();
  private readonly webhooks = new Map<string, StoredWebhookRecord>();
  private readonly usage = new Map<string, StoredUsageEvent>();
  private readonly invoices = new Map<string, StoredInvoice>();
  private readonly audit: AuditEntry[] = [];

  async saveCustomer(customer: Customer): Promise<void> {
    this.customers.set(customer.id, structuredClone(customer));
  }

  async findCustomerByNormalizedEmail(email: string): Promise<Customer | null> {
    for (const customer of this.customers.values()) {
      if (customer.emailNormalized === email) return structuredClone(customer);
    }
    return null;
  }

  async getCustomer(id: string): Promise<Customer | null> {
    const found = this.customers.get(id);
    return found ? structuredClone(found) : null;
  }

  async saveSubscription(subscription: Subscription): Promise<void> {
    this.subscriptions.set(subscription.id, structuredClone(subscription));
  }

  async getSubscription(id: string): Promise<Subscription | null> {
    const found = this.subscriptions.get(id);
    return found ? structuredClone(found) : null;
  }

  async listSubscriptions(workspaceId: string): Promise<Subscription[]> {
    return [...this.subscriptions.values()]
      .filter((s) => s.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((s) => structuredClone(s));
  }

  async liveSubscription(workspaceId: string): Promise<Subscription | null> {
    const live = (await this.listSubscriptions(workspaceId)).filter((s) => s.state !== "CANCELLED" && s.state !== "EXPIRED");
    const newest = live.at(-1);
    return newest ? structuredClone(newest) : null;
  }

  async saveIntent(intent: PaymentIntent): Promise<void> {
    this.intents.set(intent.id, structuredClone(intent));
  }

  async getIntent(id: string): Promise<PaymentIntent | null> {
    const found = this.intents.get(id);
    return found ? structuredClone(found) : null;
  }

  async findIntentByIdempotencyKey(key: string): Promise<PaymentIntent | null> {
    for (const intent of this.intents.values()) {
      if (intent.idempotencyKey === key) return structuredClone(intent);
    }
    return null;
  }

  async findIntentByProviderReference(reference: string): Promise<PaymentIntent | null> {
    for (const intent of this.intents.values()) {
      if (intent.providerReference === reference) return structuredClone(intent);
    }
    return null;
  }

  async listIntents(workspaceId: string): Promise<PaymentIntent[]> {
    return [...this.intents.values()]
      .filter((i) => i.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((i) => structuredClone(i));
  }

  async insertWebhook(record: StoredWebhookRecord): Promise<boolean> {
    const key = `${record.provider}|${record.providerEventId}`;
    if (this.webhooks.has(key)) return false;
    this.webhooks.set(key, structuredClone(record));
    return true;
  }

  async saveWebhook(record: StoredWebhookRecord): Promise<void> {
    this.webhooks.set(`${record.provider}|${record.providerEventId}`, structuredClone(record));
  }

  async listWebhooks(limit: number): Promise<StoredWebhookRecord[]> {
    return [...this.webhooks.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, limit).map((w) => structuredClone(w));
  }

  async insertUsage(event: StoredUsageEvent): Promise<boolean> {
    const key = `${event.workspaceId}|${event.kind}|${event.dedupeKey}`;
    if (this.usage.has(key)) return false;
    this.usage.set(key, structuredClone(event));
    return true;
  }

  async usageByKind(workspaceId: string, periodStart: string, periodEnd: string): Promise<Record<string, number>> {
    const totals: Record<string, number> = Object.fromEntries(USAGE_KINDS.map((k) => [k, 0]));
    for (const event of this.usage.values()) {
      if (event.workspaceId !== workspaceId) continue;
      if (event.billingTreatment === "not_counted") continue;
      if (event.occurredAt < periodStart || event.occurredAt >= periodEnd) continue;
      totals[event.kind] = (totals[event.kind] ?? 0) + event.quantity;
    }
    return totals;
  }

  async saveInvoice(invoice: StoredInvoice): Promise<void> {
    this.invoices.set(invoice.id, structuredClone(invoice));
  }

  async getInvoice(id: string): Promise<StoredInvoice | null> {
    const found = this.invoices.get(id);
    return found ? structuredClone(found) : null;
  }

  async findInvoiceByIntent(paymentIntentId: string): Promise<StoredInvoice | null> {
    for (const invoice of this.invoices.values()) {
      if (invoice.paymentAttemptId === paymentIntentId) return structuredClone(invoice);
    }
    return null;
  }

  async listInvoices(workspaceId: string): Promise<StoredInvoice[]> {
    return [...this.invoices.values()]
      .filter((i) => i.workspaceId === workspaceId)
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
      .map((i) => structuredClone(i));
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    this.audit.unshift(structuredClone(entry));
    if (this.audit.length > 1000) this.audit.length = 1000;
  }

  async listAudit(workspaceId: string, limit: number): Promise<AuditEntry[]> {
    return this.audit.filter((a) => a.workspaceId === workspaceId).slice(0, limit).map((a) => structuredClone(a));
  }
}
