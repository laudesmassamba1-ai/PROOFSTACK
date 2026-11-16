import { CircleAlert, CircleCheck, Terminal } from "lucide-react";
import { Link } from "react-router";
import { useI18n } from "../i18n/index.js";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";

export type ModuleName = "world" | "flow" | "exit";

interface ModuleContent {
  name: ModuleName;
  tag: string;
  headline: string;
  lede: string;
  checks: { label: string; detail: string }[];
  implemented: string[];
  pending: string[];
  sample: string;
  command: string;
}

const CONTENT: Record<ModuleName, ModuleContent> = {
  world: {
    name: "world",
    tag: "Global compatibility",
    headline: "Reach every user, not every ASCII table",
    lede: "WORLD generates international synthetic fixtures, submits them to your product, and compares what came back. It separates two failures people usually merge: refusing a valid value, and accepting an invalid one.",
    checks: [
      {
        label: "Identity data",
        detail:
          "Accented names, multiple surnames, 200-character names, non-Latin scripts, combining sequences, RTL display names, bidi-control and homoglyph spoofing.",
      },
      {
        label: "Phone numbers",
        detail:
          "Per-country validity from libphonenumber metadata, E.164 normalisation, national leading zeros, and the Benin 8→10 digit plan change.",
      },
      {
        label: "Addresses",
        detail:
          "Country-specific line counts, alphanumeric postcodes, and the countries that have no postcode system at all — where requiring one is a defect.",
      },
      {
        label: "Currency",
        detail:
          "ISO 4217 exponents (XOF has no subunit, JOD has three decimals), locale separators including U+202F and Arabic-Indic digits, precision loss, and values beyond Number.MAX_SAFE_INTEGER.",
      },
      {
        label: "Dates and time",
        detail:
          "Declared input formats, calendar-impossible dates (30 February), leap years, spring-forward gaps, fall-back ambiguity, and zone-correct instants.",
      },
      {
        label: "Sorting",
        detail:
          "Collation expectations per locale, asserted against the product's own ordered output when it exposes one.",
      },
    ],
    implemented: [
      "8 versioned locale profiles: en-US, en-GB, fr-FR, fr-BJ, fr-CG, ar-EG, ja-JP, pt-BR",
      "Fixture expansion with accept/reject expectations and canonical values",
      "HTTP target driver (submit + readback) and a synthetic driver for self-tests",
      "Storage-integrity comparison with exact / NFC / digit tolerances",
    ],
    pending: [
      "Browser form driver (Playwright) for apps without a record endpoint",
      "Profile packs beyond the shipped eight",
    ],
    sample: `fr-BJ/identity/Sossou-14  FAILED  corrupted_transformation
  expected  "Kòfí Sossou"
  actual    "Kof? Sossou"
  column    full_name  (utf8mb3 truncation at byte 5)
  reproduce proofstack test --module world --only fr-BJ/identity/Sossou-14`,
    command: "proofstack test --module world --profiles fr-BJ,ar-EG,ja-JP",
  },
  flow: {
    name: "flow",
    tag: "Transaction reliability",
    headline: "Prove the money path, including its worst days",
    lede: "FLOW drives a journey — cart, checkout, payment selection, confirmation — and then attacks it: declined, cancelled, timed-out, duplicated, delayed, out-of-order and forged webhooks. It reports the state the transaction actually reached, never the state the browser was redirected to.",
    checks: [
      {
        label: "Journeys",
        detail:
          "Navigation, form submission, product selection, cart, checkout, payment selection, confirmation, cancellation, refund workflow.",
      },
      {
        label: "Payment scenarios",
        detail:
          "Sandbox success and decline, cancellation, timeout, missing confirmation, duplicate order, refund, inconsistent state.",
      },
      {
        label: "Webhook hardening",
        detail:
          "Signature verification, timestamp age, duplicate delivery, idempotency, ordering, invalid payload, retry behaviour.",
      },
      {
        label: "State truth",
        detail:
          "The provider's verified transaction status is authoritative. A redirect, a delay or a query parameter can never activate anything.",
      },
    ],
    implemented: [
      "Provider-independent PaymentProvider contract",
      "Sandbox provider with deterministic outcomes",
      "Payment and subscription state machines with legal transitions only",
    ],
    pending: [
      "Playwright journey execution in the CLI",
      "SasPay adapter wired to real credentials (spec verified, no key present)",
    ],
    sample: `flow/webhook/duplicate  PASSED   idempotent: 2 deliveries, 1 entitlement change
flow/webhook/forged     PASSED   signature mismatch rejected (401)
flow/checkout/declined  FAILED   subscription activated on PENDING`,
    command: "proofstack test --module flow --payment-mode sandbox",
  },
  exit: {
    name: "exit",
    tag: "Data portability",
    headline: "An export is a promise until it round-trips",
    lede: "EXIT reads an export as a customer would: CSV, JSON, or a ZIP with a manifest. It validates schema, relationships, encodings, precision and file integrity, then imports the data back and diffs the result against the synthetic original.",
    checks: [
      {
        label: "Schema",
        detail:
          "Missing fields, invalid types, null handling, encoding, numeric precision, date transformations, ids, unique constraints.",
      },
      {
        label: "Relationships",
        detail:
          "Parent-child integrity, missing references, duplicates, orphans, referential consistency.",
      },
      {
        label: "File integrity",
        detail: "Presence, count, size, SHA-256 checksums, manifest references.",
      },
      {
        label: "Round trip",
        detail:
          "Original → export → re-import, with field-level diffs for missing records, changed values, altered dates, broken references and missing attachments.",
      },
    ],
    implemented: [
      "RFC 4180 CSV reader/writer with formula-injection guard",
      "ZIP manifest verification with SHA-256 digests",
      "Round-trip differ with record-level alignment",
    ],
    pending: [
      "Dataset connectors beyond HTTP and local files",
      "Schema inference from a live database",
    ],
    sample: `exit/roundtrip/orders  FAILED   2 of 500 records differ
  order_118  total: 1234.56 -> 1234.5599999999999 (float coercion)
  order_402  customer_id: "c_9" -> null (orphan dropped by LEFT JOIN)`,
    command: "proofstack test --module exit --formats json,csv,zip",
  },
};

export function ModulePage({ name }: { name: ModuleName }) {
  const { t } = useI18n();
  const content = CONTENT[name];
  const label = name.toUpperCase();

  return (
    <>
      <Section>
        <p className="eyebrow">
          {label} · {content.tag}
        </p>
        <h1 className="mt-3 text-[2.2rem] leading-[1.1] tracking-tight sm:text-[3rem]">
          {content.headline}
        </h1>
        <p className="mt-5 max-w-[68ch] text-[1rem] leading-relaxed text-white/58">
          {content.lede}
        </p>
        <p className="mt-6 max-w-[60ch] text-[0.95rem] italic text-white/44">
          {t(`question.${name}` as const)}
        </p>
        <div className="brand-panel mt-8 inline-flex items-center gap-3 px-4 py-3">
          <Terminal size={15} className="text-brand-mint" />
          <code className="text-[0.8rem] text-white/78">{content.command}</code>
        </div>
      </Section>

      <Section tone="deeper">
        <SectionHeading eyebrow="What it actually checks" title="Not a checklist of intentions" />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {content.checks.map((check) => (
            <article key={check.label} className="brand-panel p-5">
              <h3 className="text-[0.95rem] font-semibold">{check.label}</h3>
              <p className="mt-2 text-[0.86rem] leading-relaxed text-white/52">{check.detail}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section>
        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          <figure className="brand-panel overflow-hidden">
            <figcaption className="border-b border-white/8 px-4 py-3 font-mono text-[0.74rem] text-white/48">
              CLI output
            </figcaption>
            <pre className="overflow-x-auto px-4 py-4 font-mono text-[0.74rem] leading-relaxed text-white/76">
              {content.sample}
            </pre>
          </figure>

          <div>
            <h2 className="text-[1.3rem] font-semibold tracking-tight">
              Build status of this module
            </h2>
            <ul className="mt-5 space-y-3">
              {content.implemented.map((item) => (
                <li key={item} className="flex gap-3 text-[0.88rem] text-white/70">
                  <CircleCheck size={17} className="mt-0.5 shrink-0 text-brand-emerald" />
                  <span>{item}</span>
                </li>
              ))}
              {content.pending.map((item) => (
                <li key={item} className="flex gap-3 text-[0.88rem] text-white/42">
                  <CircleAlert size={17} className="mt-0.5 shrink-0 text-[#e9b45a]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap gap-3">
              {(["world", "flow", "exit"] as ModuleName[])
                .filter((other) => other !== name)
                .map((other) => (
                  <Link key={other} to={`/${other}`} className="btn btn-ghost">
                    {other.toUpperCase()}
                  </Link>
                ))}
              <Link to="/pricing" className="btn btn-primary">
                {t("nav.pricing")}
              </Link>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
