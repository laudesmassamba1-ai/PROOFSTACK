import {
  type PaymentProvider,
  SandboxProvider,
  SasPayProvider,
} from "@proofstack/adapter-payments";
import type { Env } from "./env.js";

/**
 * Provider selection.
 *
 * The application never assumes Stripe, and never invents a capability. It looks at
 * what the deployment actually configured:
 *
 *   SASPAY_API_KEY + SASPAY_WEBHOOK_SECRET present → real SasPay adapter
 *   otherwise                                      → deterministic sandbox provider
 *
 * The sandbox is not a fake payment confirmation: `resolveEntitlements` still only
 * credits a subscription after `verifyTransaction` reports SUCCEEDED, and the sandbox
 * verifier is a real provider implementation with scripted outcomes. Paid features are
 * never granted because of a redirect.
 */
export function hasSasPayCredentials(env: Env): boolean {
  return Boolean(env.SASPAY_API_KEY && env.SASPAY_WEBHOOK_SECRET);
}

export function createPaymentProvider(env: Env): PaymentProvider {
  if (hasSasPayCredentials(env)) {
    return new SasPayProvider({
      apiKey: env.SASPAY_API_KEY!,
      webhookSecret: env.SASPAY_WEBHOOK_SECRET!,
      ...(env.SASPAY_BASE_URL ? { baseUrl: env.SASPAY_BASE_URL } : {}),
      ...(env.SASPAY_FEE_CHARGE_MODE === "DEDUCTED" ? { feeChargeMode: "DEDUCTED" as const } : {}),
    });
  }
  return new SandboxProvider();
}

export function isSandbox(provider: PaymentProvider): provider is SandboxProvider {
  return provider.getCapabilities().provider === "sandbox";
}

export function providerDiagnostics(provider: PaymentProvider) {
  const capabilities = provider.getCapabilities();
  return {
    provider: capabilities.provider,
    displayName: capabilities.displayName,
    automatedRecurring: capabilities.automatedRecurring,
    refunds: capabilities.refunds,
    currencies: capabilities.currencies,
    countries: capabilities.countries,
    webhookSignatureScheme: capabilities.webhookSignatureScheme,
    notes: capabilities.notes,
    configured: capabilities.provider !== "sandbox",
  };
}
