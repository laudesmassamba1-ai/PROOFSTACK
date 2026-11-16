import type { ModuleId, ProofstackConfig } from "@proofstack/contracts";
import type { ModuleProvider, SuiteInput, TestSuiteDef } from "@proofstack/engine";
import { buildFlowSuites, type FlowCheckOptions } from "./checks.js";
import type { FlowScenario, PaymentUnderTest } from "./harness.js";
import { HttpPaymentTarget } from "./target.js";

export const FLOW_VERSION = "0.1.0";

export interface FlowProviderOptions {
  /** Inject the payment surface. Without it every case is SKIPPED with a reason. */
  target?: PaymentUnderTest;
  scenarios?: readonly FlowScenario[];
  /** Resolved from `modules.flow.webhookSecretEnvVar` by the caller. Never persisted. */
  webhookSecret?: string;
}

/**
 * The FLOW module provider.
 *
 * The provider is a thin adapter: it resolves the target once per run and hands the
 * engine a suite. All judgement lives in `checks.ts`, so the same scenarios can be
 * driven by the CLI, by a test, or by a future browser adapter without duplicating
 * the assertions.
 */
export function createFlowProvider(options: FlowProviderOptions = {}): ModuleProvider {
  return {
    id: "flow" as ModuleId,
    version: FLOW_VERSION,
    label: "FLOW",
    suites: (input: SuiteInput): TestSuiteDef[] => {
      const runId = `run_${Date.now().toString(36)}`;
      const checkOptions: FlowCheckOptions = {
        config: input.config,
        runId,
        ...(options.target === undefined ? {} : { target: options.target }),
        ...(options.scenarios === undefined ? {} : { scenarios: options.scenarios }),
        ...(options.webhookSecret === undefined ? {} : { webhookSecret: options.webhookSecret }),
      };
      return buildFlowSuites(checkOptions);
    },
  };
}

/**
 * Build the default target for a config, when one is configured.
 *
 * Returns `undefined` rather than throwing when FLOW has no target: an unconfigured
 * module produces SKIPPED cases, which is honest, instead of a run that fails for a
 * reason that is not about the product.
 */
export function defaultFlowTarget(
  config: ProofstackConfig,
  tokenProvider?: () => string | undefined
): PaymentUnderTest | undefined {
  const target = new HttpPaymentTarget({
    config,
    ...(tokenProvider === undefined ? {} : { tokenProvider }),
  });
  if (!target.capabilities.checkout) return undefined;
  return target;
}

export * from "./checks.js";
export * from "./harness.js";
export * from "./target.js";
