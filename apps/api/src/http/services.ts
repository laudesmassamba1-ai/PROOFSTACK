import type { PaymentProvider } from "@proofcore/adapter-payments";
import { CheckoutService, UsageMeter, WebhookProcessor } from "@proofcore/billing";
import type { PaymentAutomationEvent } from "../automation.js";
import type { Database } from "../db/types.js";
import type { EmailSender } from "../email.js";
import { createEmailSender } from "../email.js";
import type { AppConfig } from "../env.js";
import {
  type ApiKeyRecord,
  AppStore,
  type SessionRecord,
  type UserRecord,
} from "../store/app-store.js";
import { SqlBillingStore } from "../store/billing-store.js";

/**
 * Composition root. Routes receive these services, never a global.
 *
 * The same object graph is built by the Worker, the Node dev server and every test,
 * so an integration test exercises the exact wiring production uses.
 */
export interface Services {
  n8n?: { trigger: (event: string, payload: PaymentAutomationEvent) => Promise<void> };

  db: Database;
  config: AppConfig;
  store: AppStore;
  billing: SqlBillingStore;
  provider: PaymentProvider;
  checkout: CheckoutService;
  webhooks: WebhookProcessor;
  meter: UsageMeter;
  email: EmailSender;
  clock: () => Date;
}

export function createServices(input: {
  db: Database;
  config: AppConfig;
  provider: PaymentProvider;
  clock?: () => Date;
}): Services {
  const clock = input.clock ?? (() => new Date());
  const store = new AppStore(input.db, clock);
  const billing = new SqlBillingStore(input.db, clock);
  const checkout = new CheckoutService(billing, input.provider, clock);
  const email = createEmailSender(store, {
    ...(input.config.resendApiKey ? { RESEND_API_KEY: input.config.resendApiKey } : {}),
    ...(input.config.mailFrom ? { MAIL_FROM: input.config.mailFrom } : {}),
  });
  const meter = new UsageMeter(billing, {
    now: () => clock().getTime(),
    iso: () => clock().toISOString(),
  });
  const webhooks = new WebhookProcessor(billing, input.provider, checkout, clock);
  return {
    db: input.db,
    config: input.config,
    store,
    billing,
    provider: input.provider,
    checkout,
    webhooks,
    meter,
    email,
    clock,
  };
}

/** Variables set by middleware and read by handlers. */
export interface Variables {
  user: UserRecord;
  session: SessionRecord;
  requestId: string;
  apiKey: ApiKeyRecord;
}

export type AppEnv = { Variables: Variables };
