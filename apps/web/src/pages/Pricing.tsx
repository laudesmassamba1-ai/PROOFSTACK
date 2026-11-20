import { PricingTable } from "../components/marketing/PricingTable.js";
import { useI18n } from "../i18n/index.js";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";

export function Pricing() {
  const { t } = useI18n();
  return (
    <Section>
      <SectionHeading
        level={1}
        index="01 — PLANS"
        eyebrow={t("pricing.eyebrow")}
        title={t("pricing.title")}
        lede={t("pricing.lede")}
      />
      <div className="mt-10">
        <PricingTable />
      </div>
    </Section>
  );
}
