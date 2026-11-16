import { Section, SectionHeading } from "../layouts/BrandLayout.js";
import { PricingTable } from "../components/marketing/PricingTable.js";
import { useI18n } from "../i18n/index.js";

export function Pricing() {
  const { t } = useI18n();
  return (
    <Section>
      <SectionHeading eyebrow={t("pricing.eyebrow")} title={t("pricing.title")} lede={t("pricing.lede")} />
      <div className="mt-10">
        <PricingTable />
      </div>
    </Section>
  );
}
