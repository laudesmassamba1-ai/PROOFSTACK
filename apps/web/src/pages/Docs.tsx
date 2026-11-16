import { Link } from "react-router";
import { CircleCheck, CircleDashed, Terminal } from "lucide-react";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";
import { useI18n } from "../i18n/index.js";

/**
 * This page describes the build that exists today, not the roadmap. Each entry is
 * either verifiable in the repository or explicitly marked as pending, so a reader
 * cannot mistake an intention for a feature.
 */
const NOW = [
  { title: "Execution engine", body: "Scheduling, parallelism, timeouts, cancellation, retry policy, fingerprints, evidence refs, contract-validated TestRun output. 16 engine tests." },
  { title: "Money, time and Unicode core", body: "BigInt minor units with ISO 4217 exponents, IANA zone + DST wall-clock resolution, grapheme/RTL/collation primitives, secret-redacting logger. 48 tests." },
  { title: "WORLD module", body: "8 locale profiles, fixture expansion, HTTP target driver, synthetic driver, storage-integrity comparison. Detection logic exercised against deliberately buggy targets." },
  { title: "Plan and entitlement definitions", body: "Four plans, sparse entitlement maps resolved against the FREE baseline, derived yearly saving, prepaid-only flag driven by provider capability." },
  { title: "Provider research", body: "SasPay OpenAPI 3.1 spec fetched and stored in Docs/research; capability matrix written from it, including what it does not support." },
];

const PENDING = [
  { title: "CLI (`proofstack …`)", body: "Command surface and config loader are specified in the contracts; implementation is the next build phase." },
  { title: "API + D1 schema", body: "Workers/Hono/Drizzle/Better Auth with tenant-scoped authorisation and webhook ingestion." },
  { title: "Dashboard", body: "Authenticated application shell, projects, module views, billing portal." },
  { title: "FLOW browser execution", body: "Playwright journeys through the CLI, plus the SasPay adapter against real sandbox credentials." },
  { title: "EXIT connectors", body: "Export readers and the round-trip differ." },
];

export function Docs() {
  const { t } = useI18n();
  return (
    <>
      <Section>
        <SectionHeading eyebrow={t("nav.docs")} title={t("docs.title")} lede={t("docs.lede")} />
        <div className="brand-panel mt-8 flex flex-wrap items-center gap-3 p-4">
          <Terminal size={15} className="text-brand-mint" />
          <code className="text-[0.8rem] text-white/74">pnpm install && pnpm build && pnpm test</code>
          <span className="ml-auto text-[0.76rem] text-white/38">Node 22 LTS · pnpm 12</span>
        </div>
      </Section>

      <Section tone="deeper">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="flex items-center gap-2 text-[1.15rem] font-semibold">
              <CircleCheck size={18} className="text-brand-emerald" /> {t("docs.available")}
            </h2>
            <ul className="mt-5 space-y-4">
              {NOW.map((item) => (
                <li key={item.title} className="brand-panel p-4">
                  <h3 className="text-[0.92rem] font-semibold">{item.title}</h3>
                  <p className="mt-1.5 text-[0.84rem] leading-relaxed text-white/52">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="flex items-center gap-2 text-[1.15rem] font-semibold">
              <CircleDashed size={18} className="text-[#e9b45a]" /> {t("docs.planned")}
            </h2>
            <ul className="mt-5 space-y-4">
              {PENDING.map((item) => (
                <li key={item.title} className="brand-panel p-4">
                  <h3 className="text-[0.92rem] font-semibold">{item.title}</h3>
                  <p className="mt-1.5 text-[0.84rem] leading-relaxed text-white/52">{item.body}</p>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[0.82rem] text-white/40">
              Progress is tracked in <code className="text-white/60">docs/DEVELOPMENT_STATUS.md</code> in the repository.
            </p>
            <Link to="/changelog" className="btn btn-ghost mt-6">{t("nav.changelog")}</Link>
          </div>
        </div>
      </Section>
    </>
  );
}
