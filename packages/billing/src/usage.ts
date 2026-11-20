import type { EntitlementKey, UsageEvent, UsageEventKind } from "@proofcore/contracts";
import { type Clock, deterministicId, iso, systemClock } from "@proofcore/core";
import {
  checkEntitlement,
  type EffectiveEntitlements,
  type EntitlementCheck,
  type EntitlementDecision,
  resolveEntitlements,
} from "./entitlements.js";
import type { BillingStore } from "./store.js";

/**
 * Usage metering.
 *
 * Two rules, and they are the whole design:
 *
 *   1. **Metered once per subject.** The dedupe key is derived from the thing acted
 *      on (run id, export id, payment intent id), not from the request. A retried
 *      upload, a double-clicked button and a resumed CI job all meter once. This is
 *      the `counted_once_per_intent` policy, implemented rather than documented.
 *
 *   2. **A failed run is not billed.** Only a run that produced a report is counted;
 *      a harness error or a cancelled run is recorded with `not_counted` so the
 *      customer can see what happened without being charged for our failure.
 *
 * The period comes from the resolved entitlements, so metering and gating can never
 * disagree about which window they are counting in.
 */

/** Maps each metered usage kind to the entitlement key that limits it. */
export const USAGE_LIMIT_KEYS: Record<UsageEventKind, EntitlementKey> = {
  test_run: "monthly_test_runs",
  module_run: "monthly_test_runs",
  report_storage: "report_retention_days",
  export_job: "exit_datasets",
  api_request: "api_access",
  cli_sync: "cli_access",
  ai_audit: "monthly_ai_audits",
};

export interface MeterInput {
  workspaceId: string;
  kind: UsageEventKind;
  quantity?: number;
  /** The thing acted on: run id, export id, payment intent id, file hash. */
  subjectId: string;
  projectId?: string;
  /**
   * Whether this event counts against the quota. A failed or cancelled run passes
   * `false` and is still recorded, so the dashboard can show it honestly.
   */
  countable?: boolean;
  at?: Date;
}

export interface MeterResult {
  /** True when this call is the one that recorded the event. */
  counted: boolean;
  reason: "recorded" | "duplicate" | "not_counted" | "quota_exhausted";
  usage: number;
  limit: number;
  remaining: number;
  decision: EntitlementDecision;
}

export class UsageMeter {
  constructor(
    private readonly store: BillingStore,
    private readonly clock: Clock = systemClock
  ) {}

  /** Read-only view of what a workspace has used this period. */
  async snapshot(
    workspaceId: string,
    at: Date = new Date(this.clock.now())
  ): Promise<{ entitlements: EffectiveEntitlements; usage: Record<string, number> }> {
    const entitlements = await resolveEntitlements(this.store, workspaceId, at);
    const usage = await this.store.usageByKind(
      workspaceId,
      entitlements.periodStart,
      entitlements.periodEnd
    );
    return { entitlements, usage };
  }

  /**
   * Ask whether an action may proceed, and record it if it may.
   *
   * `subjectId` is mandatory even for a read-only check: it is what makes the write
   * idempotent, and a caller that cannot name its subject is a caller that has not
   * thought about retries.
   */
  async authorize(input: {
    workspaceId: string;
    check: EntitlementCheck;
    subjectId: string;
    /** Record this much usage when allowed. 0 = pure gate, nothing recorded. */
    quantity?: number;
    kind?: UsageEventKind;
    projectId?: string;
    at?: Date;
  }): Promise<{ allowed: boolean; decision: EntitlementDecision; meter: MeterResult | null }> {
    const at = input.at ?? new Date(this.clock.now());
    const entitlements = await resolveEntitlements(this.store, input.workspaceId, at);
    const usage = await this.store.usageByKind(
      input.workspaceId,
      entitlements.periodStart,
      entitlements.periodEnd
    );

    const kind = input.kind ?? usageKindFor(input.check.key);
    const used = kind ? (usage[kind] ?? 0) : 0;
    const decision = checkEntitlement(entitlements, input.check, used);

    if (!decision.allowed) {
      return { allowed: false, decision, meter: null };
    }

    const quantity = input.quantity ?? 0;
    if (quantity <= 0 || !kind) {
      return { allowed: true, decision, meter: null };
    }

    const meter = await this.meter({
      workspaceId: input.workspaceId,
      kind,
      quantity,
      subjectId: input.subjectId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      at,
    });
    return { allowed: meter.counted || meter.reason === "duplicate", decision, meter };
  }

  async meter(input: MeterInput): Promise<MeterResult> {
    const at = input.at ?? new Date(this.clock.now());
    const quantity = input.quantity ?? 1;
    const countable = input.countable ?? true;
    const entitlements = await resolveEntitlements(this.store, input.workspaceId, at);
    const usage = await this.store.usageByKind(
      input.workspaceId,
      entitlements.periodStart,
      entitlements.periodEnd
    );
    const limitKey = USAGE_LIMIT_KEYS[input.kind];
    const used = usage[input.kind] ?? 0;
    const decision = checkEntitlement(entitlements, { key: limitKey, requested: quantity }, used);

    if (countable && !decision.allowed) {
      return {
        counted: false,
        reason: "quota_exhausted",
        usage: used,
        limit: typeof decision.limit === "number" ? decision.limit : 0,
        remaining: decision.remaining,
        decision,
      };
    }

    const event: UsageEvent = {
      id: await deterministicId("usage", [`${input.workspaceId}:${input.kind}:${input.subjectId}`]),
      workspaceId: input.workspaceId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      kind: input.kind,
      quantity,
      // The dedupe key IS the subject identity: same run, same export, same intent →
      // one meter entry, whatever the retry count.
      dedupeKey: `${input.kind}:${input.subjectId}`,
      occurredAt: iso(at),
      billingTreatment: countable ? "counted_once_per_intent" : "not_counted",
    };

    const inserted = await this.store.insertUsage(event);
    if (!inserted) {
      return {
        counted: false,
        reason: "duplicate",
        usage: used,
        limit: typeof decision.limit === "number" ? decision.limit : 0,
        remaining: decision.remaining,
        decision,
      };
    }

    if (!countable) {
      return {
        counted: true,
        reason: "not_counted",
        usage: used,
        limit: typeof decision.limit === "number" ? decision.limit : 0,
        remaining: decision.remaining,
        decision,
      };
    }

    const next = used + quantity;
    const limit = typeof decision.limit === "number" ? decision.limit : 0;
    return {
      counted: true,
      reason: "recorded",
      usage: next,
      limit,
      remaining: limit === -1 ? -1 : Math.max(0, limit - next),
      decision,
    };
  }
}

/** Which usage counter backs a given entitlement key. */
export function usageKindFor(key: EntitlementKey): UsageEventKind | null {
  switch (key) {
    case "monthly_test_runs":
      return "test_run";
    case "exit_datasets":
      return "export_job";
    case "api_access":
      return "api_request";
    case "cli_access":
      return "cli_sync";
    default:
      return null;
  }
}
