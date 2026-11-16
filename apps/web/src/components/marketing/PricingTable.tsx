import { PLANS, SUPPORTED_CURRENCIES, yearlySavingPercent } from "@proofstack/billing";
import { type EntitlementKey, planSchema } from "@proofstack/contracts";
import { Money } from "@proofstack/core";
import { Check, Minus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useI18n } from "../../i18n/index.js";

type Period = "monthly" | "yearly";

/**
 * Prices are read from the plan definitions, formatted through the same Money type
 * the checkout uses. Nothing here computes a price, converts a currency, or repeats
 * a number that the billing layer also owns.
 */
export function PricingTable({ currentPlanKey }: { currentPlanKey?: string }) {
  const { t, locale } = useI18n();
  const [period, setPeriod] = useState<Period>("monthly");
  const [currency, setCurrency] = useState<string>("USD");

  const plans = PLANS.map((plan) => planSchema.parse(plan));
  const featured = plans.filter((plan) => plan.publiclyAvailable);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-center gap-3">
        <div className="inline-flex rounded-full border border-white/12 bg-white/4 p-1">
          {(["monthly", "yearly"] as Period[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setPeriod(option)}
              aria-pressed={period === option}
              className={`rounded-full px-4 py-2 text-[0.84rem] transition-colors ${
                period === option ? "bg-white text-[#050708]" : "text-white/62 hover:text-white"
              }`}
            >
              {t(option === "monthly" ? "pricing.monthly" : "pricing.yearly")}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-[0.82rem] text-white/54">
          {t("currency")}
          <select
            className="field w-auto py-2"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
          >
            {SUPPORTED_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-5 lg:grid-cols-4">
        {featured.map((plan) => {
          const price = plan.prices.find(
            (entry) => entry.period === period && entry.amount.currency === currency
          );
          const saving = period === "yearly" ? yearlySavingPercent(plan, currency) : undefined;
          const isFree = plan.prices.length === 0;
          const isCurrent = plan.key === currentPlanKey;
          return (
            <article
              key={plan.id}
              className={`brand-panel relative flex flex-col p-6 ${
                plan.key === "studio" ? "ring-1 ring-brand-mint/35" : ""
              }`}
            >
              {plan.key === "studio" ? (
                <span className="absolute -top-3 left-6 rounded-full bg-brand-mint px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[#05231b]">
                  {t("mkt.pricing.featured")}
                </span>
              ) : null}

              <h3 className="text-[1.05rem] font-semibold">{plan.name}</h3>
              <p className="mt-1.5 min-h-[3.2rem] text-[0.84rem] leading-relaxed text-white/52">
                {plan.description}
              </p>

              <div className="mt-4 flex items-baseline gap-2">
                {isFree ? (
                  <span className="text-[2.1rem] font-semibold tracking-tight">
                    {t("pricing.free")}
                  </span>
                ) : price ? (
                  <>
                    <span className="text-[2.1rem] font-semibold tracking-tight tabular-nums">
                      {Money.of(price.amount.currency, BigInt(price.amount.minor)).format(
                        locale === "fr" ? "fr-FR" : "en-US",
                        { maximumFractionDigits: price.amount.currency === "XOF" ? 0 : 2 }
                      )}
                    </span>
                    <span className="text-[0.84rem] text-white/46">
                      {t(period === "monthly" ? "pricing.perMonth" : "pricing.perYear")}
                    </span>
                  </>
                ) : (
                  <span className="text-[1.4rem] font-semibold text-white/60">
                    {t("mkt.pricing.notOffered").replace("{currency}", currency)}
                  </span>
                )}
              </div>

              {saving !== undefined && saving > 0 ? (
                <p className="mt-2 inline-flex w-fit rounded-full bg-brand-emerald/12 px-2.5 py-1 text-[0.72rem] text-brand-mint">
                  {t("pricing.save").replace("{percent}", String(saving))}
                </p>
              ) : null}

              <ul className="mt-5 space-y-2.5 text-[0.85rem]">
                <LimitLine
                  label={t("mkt.pricing.projects")}
                  value={plan.entitlements.project_limit}
                />
                <LimitLine
                  label={t("mkt.pricing.runs")}
                  value={plan.entitlements.monthly_test_runs}
                />
                <LimitLine
                  label={t("mkt.pricing.worldProfiles")}
                  value={plan.entitlements.world_profiles}
                />
                <LimitLine
                  label={t("mkt.pricing.flowScenarios")}
                  value={plan.entitlements.flow_scenarios}
                />
                <LimitLine
                  label={t("mkt.pricing.exitDatasets")}
                  value={plan.entitlements.exit_datasets}
                />
                <LimitLine
                  label={t("mkt.pricing.teamMembers")}
                  value={plan.entitlements.team_members}
                />
                <LimitLine
                  label={t("mkt.pricing.retention")}
                  value={plan.entitlements.report_retention_days}
                />
                <FlagLine label={t("mkt.pricing.cli")} value={plan.entitlements.cli_access} />
                <FlagLine label={t("mkt.pricing.api")} value={plan.entitlements.api_access} />
                <FlagLine
                  label={t("mkt.pricing.github")}
                  value={plan.entitlements.github_integration}
                />
                <FlagLine
                  label={t("mkt.pricing.advanced")}
                  value={plan.entitlements.advanced_reports}
                />
                <FlagLine
                  label={t("mkt.pricing.client")}
                  value={plan.entitlements.client_sharing}
                />
              </ul>

              <div className="mt-6 grow" />
              {isCurrent ? (
                <span className="btn btn-ghost justify-center opacity-70">
                  {t("pricing.current")}
                </span>
              ) : (
                <Link
                  to={`/signup?plan=${plan.key}&period=${period}&currency=${currency}`}
                  className={`btn justify-center ${plan.key === "studio" ? "btn-primary" : "btn-ghost"}`}
                >
                  {t("pricing.cta").replace("{plan}", plan.name)}
                </Link>
              )}
              {plan.prepaidOnly ? (
                <p className="mt-3 text-[0.72rem] leading-relaxed text-white/38">
                  {t("mkt.pricing.prepaid").replace("{days}", String(plan.graceDays))}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="brand-panel mt-6 p-6">
        <h4 className="text-[0.95rem] font-semibold">{t("pricing.renewal.title")}</h4>
        <p className="mt-2 max-w-[92ch] text-[0.86rem] leading-relaxed text-white/56">
          {t("pricing.renewal.body")}
        </p>
      </div>
    </div>
  );
}

function LimitLine({
  label,
  value,
}: {
  label: string;
  value: EntitlementKey | number | boolean | undefined;
}) {
  const { t } = useI18n();
  const display =
    value === true
      ? t("mkt.yes")
      : value === false
        ? t("mkt.no")
        : Number(value) === -1
          ? t("mkt.pricing.unlimited")
          : String(value ?? 0);
  return (
    <li className="flex items-center justify-between gap-3 border-b border-white/6 pb-2 last:border-0">
      <span className="text-white/56">{label}</span>
      <span className="font-mono text-[0.8rem] text-white/86">{display}</span>
    </li>
  );
}

function FlagLine({ label, value }: { label: string; value: boolean | number | undefined }) {
  const { t } = useI18n();
  const on = value === true;
  return (
    <li className="flex items-center justify-between gap-3 text-[0.85rem]">
      <span className="text-white/56">{label}</span>
      <span className={on ? "text-brand-mint" : "text-white/26"}>
        {on ? <Check size={15} /> : <Minus size={15} />}
        <span className="sr-only">
          {on ? t("mkt.pricing.included") : t("mkt.pricing.notIncluded")}
        </span>
      </span>
    </li>
  );
}
