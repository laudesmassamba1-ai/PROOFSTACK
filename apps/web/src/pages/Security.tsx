import { Section, SectionHeading } from "../layouts/BrandLayout.js";
import { useI18n } from "../i18n/index.js";

const CONTROLS = [
  ["Server-side authorisation", "Workspace isolation is enforced by query scoping, not by the ids a client sends. Changing an id in a request cannot reveal another tenant's data."],
  ["Payment truth", "Entitlements change only after the provider's verified transaction status says so. Redirects, query parameters and page delays carry no authority."],
  ["Webhook integrity", "Signature recomputed over the raw body, timestamp age limited to 300 s, constant-time comparison, event-id deduplication persisted, unknown event types recorded and ignored."],
  ["Secrets", "API keys are stored hashed. Tokens are displayed once. The logger redacts by key name and masks opaque secrets in free text before any sink sees them."],
  ["Money", "Integer minor units with ISO 4217 exponents everywhere, including receipts. No float arithmetic on any billing path."],
  ["Test safety", "Destructive actions are refused against production by configuration validation. Real charges are excluded from automated runs. Synthetic fixtures only; no national identity numbers."],
  ["Data minimisation", "Reports synchronise metadata and results. Large traces stay in the customer's CI. Nothing is uploaded unless sync is explicitly enabled."],
];

export function Security() {
  const { t } = useI18n();
  return (
    <Section>
      <SectionHeading
        eyebrow={t("nav.security")}
        title={t("security.title")}
        lede="PROOFSTACK is a testing product, so its own failure modes are mostly about trust: whose data, whose money, whose verdict. This page states the controls that exist in code today and the ones that are designed but not yet built."
      />
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {CONTROLS.map(([title, body]) => (
          <article key={title} className="brand-panel p-5">
            <h3 className="text-[0.94rem] font-semibold">{title}</h3>
            <p className="mt-2 text-[0.85rem] leading-relaxed text-white/52">{body}</p>
          </article>
        ))}
      </div>
      <div className="brand-panel mt-8 p-6">
        <h3 className="text-[0.94rem] font-semibold">Not claimed</h3>
        <p className="mt-2 max-w-[92ch] text-[0.85rem] leading-relaxed text-white/52">
          No penetration test has been performed on this build. No formal PCI assessment exists, and card data is never
          handled — hosted provider checkout only. Security documentation in the repository (THREAT_MODEL,
          SECURITY_CONTROLS, PAYMENT_SECURITY) is written against the code that exists, and marks what is still
          unimplemented rather than describing an ideal system.
        </p>
      </div>
    </Section>
  );
}
