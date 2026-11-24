import { PLANS, SUPPORTED_CURRENCIES, yearlySavingPercent } from "@proofcore/billing";
import { type EntitlementKey, planSchema } from "@proofcore/contracts";
import { Money } from "@proofcore/core";
import { BadgeCheck, Check, ChevronRight, Minus, ShieldCheck, Zap } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useI18n } from "../../i18n/index.js";

type Period = "monthly" | "yearly";

/**
 * Entitlements that are sold but not shipped yet.
 *
 * Showing a checkmark for something the product cannot do is the one kind of
 * dishonesty this pricing page must never commit: a paying customer would buy a
 * promise and find nothing. They are rendered as "coming" until they exist.
 */
const NOT_YET_SHIPPED = new Set<EntitlementKey>([
  "github_integration",
  "client_sharing",
  "advanced_reports",
  "priority_support",
]);

/**
 * Prices are read from the plan definitions, formatted through the same Money type
 * the checkout uses. Nothing here computes a price, converts a currency, or repeats
 * a number that the billing layer also owns.
 *
 * Mise en page inspirée de la page pricing de Mixpanel : feuilles blanches posées
 * sur le noir, plan de droite légèrement soulevé, et un calculateur d'usage —
 * dont le modèle n'invente rien : il lit le catalogue réel (seuils d'exécutions
 * des plans) et renvoie vers le prix facturé par la même couche billing.
 */
export function PricingTable({ currentPlanKey }: { currentPlanKey?: string }) {
  const { t, locale, messages } = useI18n();
  const [period, setPeriod] = useState<Period>("monthly");
  const [currency, setCurrency] = useState<string>("USD");

  const plans = PLANS.map((plan) => planSchema.parse(plan));
  const featured = plans.filter((plan) => plan.publiclyAvailable);

  return (
    <div className="pk-stage relative">
      <span className="pk-curtain" aria-hidden>
        <span className="pk-curtain-band is-left" />
        <span className="pk-curtain-band is-center" />
        <span className="pk-curtain-band is-right" />
      </span>

      <div className="relative z-10">
        <div className="mb-8 flex flex-wrap items-center justify-center gap-3">
          <div className="inline-flex rounded-full border border-white/12 bg-white/4 p-1">
            {(["monthly", "yearly"] as Period[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                aria-pressed={period === option}
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[0.84rem] transition-colors ${
                  period === option ? "bg-white text-[#050708]" : "text-white/62 hover:text-white"
                }`}
              >
                {t(option === "monthly" ? "pricing.monthly" : "pricing.yearly")}
                {option === "yearly" && period === "yearly" ? (
                  <span className="rounded-full bg-brand-emerald px-1.5 py-0.5 text-[0.62rem] font-semibold text-[#05231b]">
                    {t("pricing.bestValue")}
                  </span>
                ) : null}
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

        <p className="mx-auto mb-10 flex w-fit items-center gap-2 rounded-full border border-brand-mint/25 bg-brand-emerald/8 px-4 py-1.5 text-[0.78rem] text-brand-mint/90">
          <Zap size={13} />
          {t("pricing.founding")}
        </p>

        <div className="grid gap-5 lg:grid-cols-3">
          {featured.map((plan, planIndex) => {
            const price = plan.prices.find(
              (entry) => entry.period === period && entry.amount.currency === currency
            );
            const saving = period === "yearly" ? yearlySavingPercent(plan, currency) : undefined;
            const isFree = plan.prices.length === 0;
            const isCurrent = plan.key === currentPlanKey;
            const isFeatured = plan.key === "studio";
            return (
              <article
                key={plan.id}
                style={{ "--pk-delay": `${planIndex * 90}ms` } as React.CSSProperties}
                className={`pk-sheet pk-enter relative flex flex-col p-6 ${
                  isFeatured ? "pk-sheet-featured" : ""
                }`}
              >
                {isFeatured ? (
                  <span className="pk-flag absolute -top-3 left-6 flex items-center gap-1 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em]">
                    <BadgeCheck size={11} /> {t("mkt.pricing.featured")}
                  </span>
                ) : null}

                <h3 className="text-[1.08rem] font-semibold">{plan.name}</h3>
                {/* The server owns the catalogue, but its descriptions are English-only;
                    the page speaks the visitor's language via i18n and falls back to the
                    server string for any plan that has no key yet. */}
                <p className="pk-sheet-muted mt-1.5 min-h-[3.2rem] text-[0.84rem] leading-relaxed">
                  {(messages as Record<string, string>)[`pricing.plan.${plan.key}.desc`] ??
                    plan.description}
                </p>

                <div className="mt-4 flex items-baseline gap-2">
                  {isFree ? (
                    <span className="text-[2.1rem] font-semibold tracking-tight">
                      {t("pricing.free")}
                    </span>
                  ) : price ? (
                    <>
                      <span
                        key={`${period}-${currency}`}
                        className="pk-price-swap text-[2.1rem] font-semibold tracking-tight tabular-nums"
                      >
                        {Money.of(price.amount.currency, BigInt(price.amount.minor)).format(
                          locale === "fr" ? "fr-FR" : "en-US",
                          { maximumFractionDigits: price.amount.currency === "XOF" ? 0 : 2 }
                        )}
                      </span>
                      <span className="text-[0.84rem] opacity-55">
                        {t(period === "monthly" ? "pricing.perMonth" : "pricing.perYear")}
                      </span>
                    </>
                  ) : (
                    <span className="text-[1.4rem] font-semibold opacity-60">
                      {t("mkt.pricing.notOffered").replace("{currency}", currency)}
                    </span>
                  )}
                </div>

                {saving !== undefined && saving > 0 ? (
                  <p className="pk-save mt-2 inline-flex w-fit rounded-full px-2.5 py-1 text-[0.72rem] font-medium">
                    {t("pricing.save").replace("{percent}", String(saving))}
                  </p>
                ) : null}

                <ul className="mt-5 space-y-1.5 text-[0.85rem]">
                  <LimitLine
                    label={t("mkt.pricing.projects")}
                    value={plan.entitlements.project_limit}
                  />
                  <LimitLine
                    label={t("mkt.pricing.runs")}
                    value={plan.entitlements.monthly_test_runs}
                  />
                  <LimitLine
                    label={t("mkt.pricing.aiAudits")}
                    value={plan.entitlements.monthly_ai_audits}
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
                    pending={NOT_YET_SHIPPED.has("github_integration")}
                  />
                  <FlagLine
                    label={t("mkt.pricing.advanced")}
                    value={plan.entitlements.advanced_reports}
                    pending={NOT_YET_SHIPPED.has("advanced_reports")}
                  />
                  <FlagLine
                    label={t("mkt.pricing.client")}
                    value={plan.entitlements.client_sharing}
                    pending={NOT_YET_SHIPPED.has("client_sharing")}
                  />
                </ul>

                <div className="mt-6 grow" />
                {isCurrent ? (
                  <span className="pk-cta pk-cta-ghost justify-center opacity-70">
                    {t("pricing.current")}
                  </span>
                ) : (
                  <Link
                    to={`/signup?plan=${plan.key}&period=${period}&currency=${currency}`}
                    className={`pk-cta justify-center ${
                      isFeatured ? "pk-cta-primary" : "pk-cta-ghost"
                    }`}
                  >
                    {t("pricing.cta").replace("{plan}", plan.name)} <ChevronRight size={15} />
                  </Link>
                )}
                {plan.prepaidOnly ? (
                  <p className="pk-sheet-faint mt-3 flex items-start gap-1.5 text-[0.72rem] leading-relaxed">
                    <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                    {t("mkt.pricing.prepaid").replace("{days}", String(plan.graceDays))}
                  </p>
                ) : null}
                {!isFree && !isCurrent ? (
                  <p className="pk-sheet-faint mt-2 flex items-start gap-1.5 text-[0.72rem] leading-relaxed">
                    <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                    {t("pricing.guarantee")}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>

        <UsageCalculator period={period} currency={currency} />

        <div className="brand-panel mt-6 p-6">
          <h4 className="text-[0.95rem] font-semibold">{t("pricing.renewal.title")}</h4>
          <p className="mt-2 max-w-[92ch] text-[0.86rem] leading-relaxed text-white/56">
            {t("pricing.renewal.body")}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Calculateur d'usage ──────────────────────────────────────────────────
   Un curseur log (5 → 5 000 exécutions/mois) ; le plan recommandé est le plus
   petit qui couvre le volume d'après le catalogue réel, et le prix affiché est
   celui de la facturation — le curseur n'invente aucun tarif. */

function UsageCalculator({ period, currency }: { period: Period; currency: string }) {
  const { t, locale } = useI18n();
  const [slider, setSlider] = useState(0);

  const runs = useMemo(() => Math.round(5 * 1000 ** (slider / 100)), [slider]);

  const plans = PLANS.map((plan) => planSchema.parse(plan));
  const recommended = plans
    .filter(
      (plan) =>
        plan.publiclyAvailable &&
        typeof plan.entitlements.monthly_test_runs === "number" &&
        plan.entitlements.monthly_test_runs >= runs
    )
    .sort((a, b) => a.rank - b.rank)[0];
  const price = recommended?.prices.find(
    (entry) => entry.period === period && entry.amount.currency === currency
  );

  const format = (amountMinor: bigint): string =>
    Money.of(currency, amountMinor).format(locale === "fr" ? "fr-FR" : "en-US", {
      maximumFractionDigits: currency === "XOF" ? 0 : 2,
    });

  return (
    <div className="pk-calc pk-enter relative mt-16 overflow-hidden p-8">
      <span className="pk-calc-glow" aria-hidden />
      <div className="relative z-10 grid gap-10 md:grid-cols-2 md:items-center">
        <div>
          <p className="app-eyebrow">{t("pricing.calc.eyebrow")}</p>
          <div className="mt-3 flex items-baseline gap-3">
            {recommended && price ? (
              <span className="pk-calc-price tabular-nums">
                {format(BigInt(price.amount.minor))}
              </span>
            ) : (
              <span className="pk-calc-price">{t("pricing.calc.custom")}</span>
            )}
            {recommended ? (
              <span className="text-[0.9rem] text-white/46">
                {t(period === "monthly" ? "pricing.perMonth" : "pricing.perYear")}
              </span>
            ) : null}
          </div>
          <p className="mt-3 text-[0.85rem] text-white/58">
            {recommended
              ? t("pricing.calc.recommended").replace("{plan}", recommended.name)
              : t("pricing.calc.contact")}
          </p>
          {recommended ? (
            <Link
              to={`/signup?plan=${recommended.key}&period=${period}&currency=${currency}`}
              className="pk-cta pk-cta-auto pk-cta-primary mt-6"
            >
              {t("pricing.cta").replace("{plan}", recommended.name)} <ChevronRight size={15} />
            </Link>
          ) : (
            <Link to="/support" className="app-text-link mt-6 inline-flex">
              {t("pricing.calc.talk")} <ChevronRight size={14} />
            </Link>
          )}
        </div>

        <div className="w-full">
          <p className="mb-6 text-[0.85rem] text-white/58">{t("pricing.calc.slider")}</p>
          <div className="pk-slider relative mb-9">
            <span className="pk-slider-track" aria-hidden>
              <span className="pk-slider-fill" style={{ width: `${slider}%` }} />
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={slider}
              onChange={(event) => setSlider(Number(event.target.value))}
              aria-label={t("pricing.calc.slider")}
            />
            <span className="pk-slider-thumb" style={{ left: `${slider}%` }} aria-hidden />
            <div className="pk-slider-ticks font-mono">
              {[200, 1200, 5000].map((tick) => (
                <button
                  key={tick}
                  type="button"
                  style={{ left: `${(100 * Math.log10(tick / 5)) / 3}%` }}
                  onClick={() => setSlider(Math.round((100 * Math.log10(tick / 5)) / 3))}
                >
                  {tick.toLocaleString(locale === "fr" ? "fr-FR" : "en-US")}
                </button>
              ))}
            </div>
          </div>
          <p className="font-mono text-[0.72rem] text-white/46">
            {runs.toLocaleString(locale === "fr" ? "fr-FR" : "en-US")} {t("pricing.calc.runs")} /{" "}
            {t("pricing.calc.month")}
          </p>
        </div>
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
    <li className="pk-line flex min-h-[2.1rem] items-center justify-between gap-3 pb-1.5 last:border-0">
      <span>{label}</span>
      <span className="shrink-0 font-mono text-[0.8rem] font-medium">{display}</span>
    </li>
  );
}

function FlagLine({
  label,
  value,
  pending = false,
}: {
  label: string;
  value: boolean | number | undefined;
  pending?: boolean;
}) {
  const { t } = useI18n();
  const on = value === true;
  if (on && pending) {
    return (
      <li className="pk-line flex min-h-[2.1rem] items-center justify-between gap-3 pb-1.5 text-[0.85rem]">
        <span>{label}</span>
        <span className="pk-pending shrink-0 rounded-full px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wider">
          {t("mkt.pricing.pending")}
        </span>
      </li>
    );
  }
  return (
    <li className="pk-line flex min-h-[2.1rem] items-center justify-between gap-3 pb-1.5 text-[0.85rem]">
      <span>{label}</span>
      <span className={`shrink-0 ${on ? "pk-check" : "pk-dim"}`}>
        {on ? <Check size={15} /> : <Minus size={15} />}
        <span className="sr-only">
          {on ? t("mkt.pricing.included") : t("mkt.pricing.notIncluded")}
        </span>
      </span>
    </li>
  );
}
