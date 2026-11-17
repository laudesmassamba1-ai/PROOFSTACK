import { CircleCheck, CircleDashed, Terminal } from "lucide-react";
import { Link } from "react-router";
import { useI18n } from "../i18n/index.js";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";

/**
 * This page describes the build that exists today, not the roadmap. Each entry is
 * either verifiable in the repository or explicitly marked as pending, so a reader
 * cannot mistake an intention for a feature.
 */
const NOW = [
  {
    title: "Execution engine and three modules",
    body: "Scheduling, parallelism, timeouts, cancellation, retry policy, fingerprints and evidence refs. WORLD (8 locale profiles), FLOW (checkout and webhook scenarios) and EXIT (schema, integrity, round trip) run from one TestRun contract.",
  },
  {
    title: "Money, time and Unicode core",
    body: "BigInt minor units with ISO 4217 exponents, IANA zone + DST wall-clock resolution, grapheme/RTL/collation primitives, secret-redacting logger.",
  },
  {
    title: "CLI and reports",
    body: "init, doctor, validate, test, report, projects, login/logout, sync and ai. JSON, JUnit XML, HTML and text output; exit codes are a contract (0 pass, 1 defect, 2 harness error, 3 cancelled).",
  },
  {
    title: "SaaS API and database",
    body: "Hono on Node 22 SQLite and Cloudflare Workers/D1 from one schema. Accounts, workspaces, projects, run ingestion, reports, API keys, entitlements, checkout, receipts and signed webhooks.",
  },
  {
    title: "Dashboard and billing",
    body: "Authenticated overview, projects, module views, settings and a billing page that reads verified payment state. The sandbox provider exercises the full lifecycle without moving money.",
  },
  {
    title: "Provider research",
    body: "SasPay OpenAPI 3.1 spec fetched and stored in Docs/research; capability matrix written from it, including what it does not support (refunds, automatic recurring charges).",
  },
];

const PENDING = [
  {
    title: "Playwright browser journeys",
    body: "WORLD and FLOW currently drive HTTP endpoints and fixtures. A browser form driver and screenshots-on-failure evidence are not implemented.",
  },
  {
    title: "Cloudflare deployment",
    body: "Live on Vercel and Cloudflare: the web app proxies /api, /v1 and /health to a Worker backed by D1, with migrations applied. A production sign-up → session → overview path is verified; SasPay still runs in sandbox because no live credentials are configured.",
  },
  {
    title: "Email delivery",
    body: "No provider is configured, so verification, password reset and teammate invitations are absent rather than faked.",
  },
  {
    title: "Operator console",
    body: "Plans and prices are code-backed today. An admin interface for pricing, subscriptions, refunds and webhook history is not built.",
  },
  {
    title: "Translation coverage",
    body: "Marketing pages, account forms and every customer workspace screen — shell, Overview, Projects, modules, CLI, Billing and Settings — are FR/EN. The creator operations console remains English operational copy.",
  },
];

export function Docs() {
  const { t } = useI18n();
  return (
    <>
      <Section>
        <SectionHeading eyebrow={t("nav.docs")} title={t("docs.title")} lede={t("docs.lede")} />
        <div className="brand-panel mt-8 flex flex-wrap items-center gap-3 p-4">
          <Terminal size={15} className="text-brand-mint" />
          <code className="text-[0.8rem] text-white/74">
            pnpm install && pnpm build && pnpm test
          </code>
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
              Progress is tracked in{" "}
              <code className="text-white/60">docs/DEVELOPMENT_STATUS.md</code> in the repository.
            </p>
            <Link to="/changelog" className="btn btn-ghost mt-6">
              {t("nav.changelog")}
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
