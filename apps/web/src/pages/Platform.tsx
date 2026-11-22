import { Cpu, Database, Globe, Server, Terminal, Wind } from "lucide-react";
import { useI18n } from "../i18n/index.js";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";

const STACK = [
  { icon: Globe, key: "frontend" },
  { icon: Server, key: "backend" },
  { icon: Database, key: "data" },
  { icon: Terminal, key: "cli" },
  { icon: Cpu, key: "engine" },
  { icon: Wind, key: "budget" },
] as const;

const RUNTIME_RULE = `Workers do NOT run test sessions.

  customer laptop / CI                Cloudflare Workers
  ┌──────────────────────────┐        ┌───────────────────────────┐
  │ proofcore test          │  HTTPS │ auth · projects · billing │
  │  ├ engine (world/flow/   │ ─────► │ reports · usage · webhooks│
  │  │  exit)                │        └───────────────────────────┘
  │  ├ local fixtures        │
  │  └ junit/json/html out   │   only metadata + results are sent
  └──────────────────────────┘   and never by default`;

export function Platform() {
  const { t } = useI18n();
  return (
    <>
      <Section>
        <SectionHeading
          as="h1"
          eyebrow={t("mkt.platform.eyebrow")}
          title={t("mkt.platform.title")}
          lede={t("mkt.platform.lede")}
        />
        {/* The stack is technical fact, so the grid may stay regular — but each cell
            is a lit, tilted surface with the mono stack name, per the reference board. */}
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {STACK.map(({ icon: Icon, key }) => (
            <article key={key} className="brand-panel spot-card p-5" data-tilt data-reveal>
              <Icon size={19} className="text-brand-cyan" />
              <h3 className="mt-4 text-[0.96rem] font-semibold">
                {t(`mkt.platform.stack.${key}.title` as const)}
              </h3>
              <p className="mt-2 text-[0.84rem] leading-relaxed text-white/52">
                {t(`mkt.platform.stack.${key}.body` as const)}
              </p>
              <p className="mt-4 font-mono text-[0.6rem] tracking-[0.16em] text-white/30">
                {key.toUpperCase()}
              </p>
            </article>
          ))}
        </div>
      </Section>

      <Section tone="deeper">
        <SectionHeading
          eyebrow={t("mkt.platform.runtime.eyebrow")}
          title={t("mkt.platform.runtime.title")}
        />
        <div data-reveal>
          <pre className="brand-panel spot-card mt-8 overflow-x-auto p-5 font-mono text-[0.72rem] leading-relaxed text-white/72">
            {RUNTIME_RULE}
          </pre>
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <article className="brand-panel spot-card p-6" data-tilt data-reveal>
            <h3 className="text-[0.98rem] font-semibold">{t("mkt.platform.shared.title")}</h3>
            <p className="mt-2 text-[0.86rem] leading-relaxed text-white/52">
              {t("mkt.platform.shared.body")}
            </p>
          </article>
          <article className="brand-panel spot-card p-6" data-tilt data-reveal>
            <h3 className="text-[0.98rem] font-semibold">{t("mkt.platform.evidence.title")}</h3>
            <p className="mt-2 text-[0.86rem] leading-relaxed text-white/52">
              {t("mkt.platform.evidence.body")}
            </p>
          </article>
        </div>
      </Section>
    </>
  );
}
