import { type EntitlementKey, type Plan, type PlanSeed, planSchema } from "@proofcore/contracts";

/**
 * Plan definitions.
 *
 * These are the *initial pricing hypotheses* from the product brief, expressed once.
 * Nothing in the UI computes a price: the marketing page, the CLI and the API all
 * read this module, and the database seed imports it, so a price cannot disagree
 * with itself. The operator changes prices in the database, never in a component.
 *
 * Amounts are integer minor units. XOF/XAF have no subunit (exponent 0), so a
 * "12.00" style value would be a bug: 15000 means fifteen thousand CFA francs.
 */

const usd = (minor: number) => ({ currency: "USD", minor: String(minor) });
const eur = (minor: number) => ({ currency: "EUR", minor: String(minor) });
const xof = (whole: number) => ({ currency: "XOF", minor: String(whole) });

export const FREE_ENTITLEMENTS: Record<EntitlementKey, number | boolean> = {
  workspace_limit: 1,
  project_limit: 1,
  // Ten runs a month is a taste, not a QA department: enough to wire the modules up and
  // see them work, not enough to run a team's regression on the free tier.
  monthly_test_runs: 10,
  monthly_ai_audits: 3,
  world_profiles: 2,
  flow_scenarios: 3,
  exit_datasets: 1,
  report_retention_days: 14,
  team_members: 1,
  api_access: false,
  cli_access: true,
  github_integration: false,
  advanced_reports: false,
  client_sharing: false,
  priority_support: false,
};

export const UNLIMITED = -1;

const PLAN_SEEDS: PlanSeed[] = [
  {
    id: "plan_free",
    key: "free",
    name: "Free",
    rank: 0,
    description: "One project, the five modules at basic depth, standard reports.",
    trialDays: 0,
    graceDays: 0,
    renewalReminderDays: 0,
    publiclyAvailable: true,
    prepaidOnly: false,
    active: true,
    prices: [],
    entitlements: { ...FREE_ENTITLEMENTS },
    // FAIL and CLEAN audits are included on every plan; the in-chat audit tools
    // are free, while metered AI audits (page scans) count against
    // monthly_ai_audits via the `ai_audit` usage kind.
    modules: ["world", "flow", "exit", "fail", "clean"],
  },
  {
    id: "plan_developer",
    key: "developer",
    name: "Developer",
    rank: 1,
    description: "Full module depth, cloud sync from the CLI, extended reports.",
    trialDays: 14,
    graceDays: 7,
    renewalReminderDays: 7,
    publiclyAvailable: true,
    // Set by the deployment when no configured provider can auto-charge (SasPay cannot).
    prepaidOnly: true,
    active: true,
    prices: [
      { id: "price_developer_monthly_usd", period: "monthly", amount: usd(1200), featured: true },
      { id: "price_developer_yearly_usd", period: "yearly", amount: usd(12000) },
      { id: "price_developer_monthly_eur", period: "monthly", amount: eur(1200) },
      { id: "price_developer_yearly_eur", period: "yearly", amount: eur(12000) },
      { id: "price_developer_monthly_xof", period: "monthly", amount: xof(15000) },
      { id: "price_developer_yearly_xof", period: "yearly", amount: xof(150000) },
    ],
    entitlements: {
      workspace_limit: 1,
      project_limit: 5,
      monthly_test_runs: 300,
      monthly_ai_audits: 60,
      world_profiles: UNLIMITED,
      flow_scenarios: 40,
      exit_datasets: 10,
      report_retention_days: 180,
      team_members: 1,
      api_access: true,
      cli_access: true,
      github_integration: true,
      advanced_reports: true,
      client_sharing: false,
      priority_support: false,
    },
    // FAIL and CLEAN audits are included on every plan; the in-chat audit tools
    // are free, while metered AI audits (page scans) count against
    // monthly_ai_audits via the `ai_audit` usage kind.
    modules: ["world", "flow", "exit", "fail", "clean"],
  },
  {
    id: "plan_studio",
    key: "studio",
    name: "Studio",
    rank: 2,
    description: "Team collaboration, shared configurations, CI integrations.",
    trialDays: 14,
    graceDays: 7,
    renewalReminderDays: 7,
    publiclyAvailable: true,
    prepaidOnly: true,
    active: true,
    prices: [
      { id: "price_studio_monthly_usd", period: "monthly", amount: usd(2900), featured: true },
      { id: "price_studio_yearly_usd", period: "yearly", amount: usd(29000) },
      { id: "price_studio_monthly_eur", period: "monthly", amount: eur(2900) },
      { id: "price_studio_yearly_eur", period: "yearly", amount: eur(29000) },
      { id: "price_studio_monthly_xof", period: "monthly", amount: xof(35000) },
      { id: "price_studio_yearly_xof", period: "yearly", amount: xof(350000) },
    ],
    entitlements: {
      workspace_limit: 2,
      project_limit: 20,
      monthly_test_runs: 1500,
      monthly_ai_audits: 300,
      world_profiles: UNLIMITED,
      flow_scenarios: 150,
      exit_datasets: 40,
      report_retention_days: 365,
      team_members: 10,
      api_access: true,
      cli_access: true,
      github_integration: true,
      advanced_reports: true,
      client_sharing: true,
      priority_support: false,
    },
    // FAIL and CLEAN audits are included on every plan; the in-chat audit tools
    // are free, while metered AI audits (page scans) count against
    // monthly_ai_audits via the `ai_audit` usage kind.
    modules: ["world", "flow", "exit", "fail", "clean"],
  },
  {
    id: "plan_agency",
    key: "agency",
    name: "Agency",
    rank: 3,
    description: "Multiple client workspaces, client-facing reports, highest limits.",
    trialDays: 14,
    graceDays: 14,
    renewalReminderDays: 14,
    publiclyAvailable: true,
    prepaidOnly: true,
    active: true,
    prices: [
      { id: "price_agency_monthly_usd", period: "monthly", amount: usd(7900), featured: true },
      { id: "price_agency_yearly_usd", period: "yearly", amount: usd(79000) },
      { id: "price_agency_monthly_eur", period: "monthly", amount: eur(7900) },
      { id: "price_agency_yearly_eur", period: "yearly", amount: eur(79000) },
      { id: "price_agency_monthly_xof", period: "monthly", amount: xof(95000) },
      { id: "price_agency_yearly_xof", period: "yearly", amount: xof(950000) },
    ],
    entitlements: {
      workspace_limit: 10,
      project_limit: UNLIMITED,
      monthly_test_runs: 8000,
      monthly_ai_audits: UNLIMITED,
      world_profiles: UNLIMITED,
      flow_scenarios: UNLIMITED,
      exit_datasets: UNLIMITED,
      report_retention_days: 730,
      team_members: 50,
      api_access: true,
      cli_access: true,
      github_integration: true,
      advanced_reports: true,
      client_sharing: true,
      priority_support: true,
    },
    // FAIL and CLEAN audits are included on every plan; the in-chat audit tools
    // are free, while metered AI audits (page scans) count against
    // monthly_ai_audits via the `ai_audit` usage kind.
    modules: ["world", "flow", "exit", "fail", "clean"],
  },
];

/**
 * Seeds are parsed through the contract: an incomplete or mistyped plan definition
 * fails at import time instead of surfacing as a wrong price in production.
 */
export const PLANS: Plan[] = planSchema.array().parse(PLAN_SEEDS);

export function plansForDisplay(): Plan[] {
  return [...PLANS].sort((a, b) => a.rank - b.rank);
}

export function findPlan(key: string): Plan | undefined {
  return PLANS.find((p) => p.key === key);
}

/** Currencies an operator can offer today, in display order. */
export const SUPPORTED_CURRENCIES = ["USD", "EUR", "XOF"] as const;

export const DEFAULT_DISPLAY_CURRENCY = "USD";

/**
 * Yearly saving, derived from the stored prices rather than asserted in copy:
 * if an operator changes the yearly amount, the badge changes with it.
 */
export function yearlySavingPercent(plan: Plan, currency: string): number | undefined {
  const monthly = plan.prices.find((p) => p.period === "monthly" && p.amount.currency === currency);
  const yearly = plan.prices.find((p) => p.period === "yearly" && p.amount.currency === currency);
  if (!monthly || !yearly) return undefined;
  const twelve = BigInt(monthly.amount.minor) * 12n;
  if (twelve === 0n) return undefined;
  const saved = twelve - BigInt(yearly.amount.minor);
  return Math.round(Number((saved * 10000n) / twelve) / 100);
}

/**
 * Price lookup. The client never sends an amount: it names a plan, a period and a
 * currency, and this function is the only place the number comes from.
 */
export interface PlanPrice {
  id: string;
  period: "monthly" | "yearly";
  currency: string;
  minor: bigint;
}

export function findPrice(
  planKey: string,
  currency: string,
  period: "monthly" | "yearly"
): PlanPrice | undefined {
  const plan = findPlan(planKey);
  if (!plan) return undefined;
  const price = plan.prices.find((p) => p.period === period && p.amount.currency === currency);
  if (!price) return undefined;
  return { id: price.id, period, currency, minor: BigInt(price.amount.minor) };
}

export function pricesFor(planKey: string): PlanPrice[] {
  const plan = findPlan(planKey);
  if (!plan) return [];
  return plan.prices.map((p) => ({
    id: p.id,
    period: p.period,
    currency: p.amount.currency,
    minor: BigInt(p.amount.minor),
  }));
}

/** Currencies a given plan can actually be charged in. */
export function chargeableCurrencies(planKey: string): string[] {
  return [...new Set(pricesFor(planKey).map((p) => p.currency))];
}

/**
 * Entitlement inheritance: a plan restates only what it changes. Resolving the map is
 * a pure function of the plan catalogue, so the CLI, the API and the web app compute
 * the identical answer without a shared cache.
 */
export function entitlementsFor(planKey: string): Record<EntitlementKey, number | boolean> {
  const plan = findPlan(planKey);
  const baseline: Record<EntitlementKey, number | boolean> = { ...FREE_ENTITLEMENTS };
  if (!plan) return baseline;
  for (const [key, value] of Object.entries(plan.entitlements)) {
    baseline[key as EntitlementKey] = value as number | boolean;
  }
  return baseline;
}

export function planRank(planKey: string): number {
  return findPlan(planKey)?.rank ?? 0;
}
