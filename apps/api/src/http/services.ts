import type { PaymentProvider } from "@proofcore/adapter-payments";
import { CheckoutService, UsageMeter, WebhookProcessor } from "@proofcore/billing";
import { scanPage } from "@proofcore/core";
import type { PaymentAutomationEvent } from "../automation.js";
import type { Database } from "../db/types.js";
import type { EmailSender } from "../email.js";
import { createEmailSender } from "../email.js";
import type { AppConfig } from "../env.js";
import { createProjectKnowledge, type ProjectKnowledge } from "../project-knowledge.js";
import type { ScenarioReport, ScenarioStep } from "../scenario.js";
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
export interface LocalScenarioInput {
  url: string;
  name: string;
  steps: ScenarioStep[];
  allowDestructive: boolean;
}

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
  /** Absent when NEON_DATABASE_URL is not configured: file audits then answer 503. */
  projectKnowledge: ProjectKnowledge | null;
  /**
   * A real browser on this machine, for the Node server only.
   *
   * The deployed Worker drives Cloudflare's Browser Rendering binding; the local server
   * has no such binding, but the machine already has a Chromium and the CLI already
   * drives it over CDP. Injecting that runner keeps one execution path and lets the same
   * scenario run locally without a paid service or a downloaded browser. Absent in the
   * Worker and in tests: there, a scenario that needs a browser is refused, not faked.
   */
  localScenario?: (input: LocalScenarioInput) => Promise<ScenarioReport>;
  clock: () => Date;
  /**
   * The page scanner, injected so a route can be tested without reaching the network.
   * Production passes `scanPage` itself; a test passes a stub, exactly like `fetchImpl`.
   */
  scan: typeof scanPage;
}

export function createServices(input: {
  db: Database;
  config: AppConfig;
  provider: PaymentProvider;
  clock?: () => Date;
  scan?: typeof scanPage;
}): Services {
  const clock = input.clock ?? (() => new Date());
  const store = new AppStore(input.db, clock);
  const billing = new SqlBillingStore(input.db, clock);
  const checkout = new CheckoutService(billing, input.provider, clock);
  const email = createEmailSender(store, {
    ...(input.config.resendApiKey ? { RESEND_API_KEY: input.config.resendApiKey } : {}),
    ...(input.config.mailFrom ? { MAIL_FROM: input.config.mailFrom } : {}),
    ...(input.config.emailjsServiceId ? { EMAILJS_SERVICE_ID: input.config.emailjsServiceId } : {}),
    ...(input.config.emailjsTemplateId
      ? { EMAILJS_TEMPLATE_ID: input.config.emailjsTemplateId }
      : {}),
    ...(input.config.emailjsPublicKey ? { EMAILJS_PUBLIC_KEY: input.config.emailjsPublicKey } : {}),
    ...(input.config.emailjsPrivateKey
      ? { EMAILJS_PRIVATE_KEY: input.config.emailjsPrivateKey }
      : {}),
  });
  const projectKnowledge = createProjectKnowledge(input.config.neonDatabaseUrl);
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
    projectKnowledge,
    clock,
    scan: input.scan ?? scanPage,
  };
}

/** Variables set by middleware and read by handlers. */
export interface Variables {
  user: UserRecord;
  session: SessionRecord;
  requestId: string;
  apiKey: ApiKeyRecord;
}

export type AppEnv = {
  Variables: Variables;
  /**
   * The Worker's `browser` binding, declared in wrangler.toml.
   *
   * Optional on purpose: a Worker without the binding still serves every tool, and
   * `browse_url` then reports `server_html` instead of pretending it rendered the page.
   */
  Bindings: { BROWSER?: unknown };
};
