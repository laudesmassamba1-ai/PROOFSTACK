import {
  type EffectiveEntitlements,
  findPlan,
  findPrice,
  resolveEntitlements,
} from "@proofstack/billing";
import type { EntitlementKey } from "@proofstack/contracts";
import type { ProjectRecord, RunRecord } from "../store/app-store.js";
import type { Services } from "./services.js";

/**
 * Wire shapes.
 *
 * Only the fields a client needs leave the server. Provider references are included
 * (they are not secrets), provider request payloads are not.
 */

export function projectDto(project: ProjectRecord) {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    baseUrl: project.baseUrl,
    ...(project.stack ? { stack: project.stack } : {}),
    environment: project.environment,
    enabledModules: project.enabledModules,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    ...(project.lastRunAt ? { lastRunAt: project.lastRunAt } : {}),
    ...(project.lastRunStatus ? { lastRunStatus: project.lastRunStatus } : {}),
  };
}

export function runSummaryDto(run: RunRecord & { projectName?: string }) {
  return {
    id: run.id,
    ...(run.reportId ? { reportId: run.reportId } : {}),
    projectId: run.projectId,
    ...(run.projectName ? { projectName: run.projectName } : {}),
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    environment: run.environment,
    ...(run.revision ? { revision: run.revision } : {}),
    totals: run.totals,
    findingCount: Object.values(run.totals).reduce(
      (sum, module) => sum + module.failed + module.warnings,
      0
    ),
  };
}

export interface SubscriptionView {
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
}

/**
 * The subscription view is derived from the resolution the server enforces, so the
 * dashboard cannot show "Studio" while the API is granting Free.
 */
export async function subscriptionView(
  services: Services,
  workspaceId: string,
  effective?: EffectiveEntitlements
): Promise<{ view: SubscriptionView; effective: EffectiveEntitlements }> {
  const entitlements =
    effective ?? (await resolveEntitlements(services.billing, workspaceId, services.clock()));
  const subscription = await services.billing.liveSubscription(workspaceId);
  const plan = findPlan(entitlements.planKey);
  const price =
    subscription && plan
      ? findPrice(plan.key, subscription.currency, subscription.period)
      : undefined;

  return {
    effective: entitlements,
    view: {
      planKey: entitlements.planKey,
      planName: entitlements.planName,
      entitled: entitlements.entitled,
      state: subscription?.state ?? "NONE",
      reason: entitlements.reason,
      period: subscription?.period ?? null,
      currency: price?.currency ?? subscription?.currency ?? null,
      amountMinor: price ? price.minor.toString() : null,
      currentPeriodStart: subscription?.currentPeriodStart ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      accessEndsAt: entitlements.accessEndsAt,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      pendingPlanKey: subscription?.pendingPlanKey ?? null,
      recurringSupported: entitlements.recurringSupported,
      // Only set when the deployment cannot auto-charge: the customer must renew.
      renewalDueAt: entitlements.recurringSupported
        ? null
        : (subscription?.currentPeriodEnd ?? null),
      provider: services.provider.getCapabilities().provider,
    },
  };
}

export function usageCounters(effective: EffectiveEntitlements, usage: Record<string, number>) {
  const keys: { key: EntitlementKey; kind: string; label: string }[] = [
    { key: "monthly_test_runs", kind: "test_run", label: "Test runs this period" },
    { key: "project_limit", kind: "", label: "Projects" },
  ];
  return keys.map(({ key, kind, label }) => {
    const limit = effective.entitlements[key];
    const used = kind ? (usage[kind] ?? 0) : 0;
    return {
      key,
      label,
      used,
      limit: typeof limit === "boolean" ? (limit ? -1 : 0) : limit,
      counted:
        key === "monthly_test_runs"
          ? "One per run id; retries and failed uploads are not double-billed."
          : "Live count",
    };
  });
}

export function entitlementMap(effective: EffectiveEntitlements) {
  return Object.fromEntries(
    Object.entries(effective.entitlements).map(([key, value]) => [
      key,
      typeof value === "boolean" ? value : Number(value),
    ])
  );
}
