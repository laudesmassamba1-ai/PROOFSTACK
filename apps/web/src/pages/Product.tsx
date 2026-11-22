import { Boxes, GitBranch, Layers, Monitor, ShieldCheck, Terminal, Wrench } from "lucide-react";
import { Link } from "react-router";
import { ModuleShowcase } from "../components/marketing/ModuleShowcase.js";
import { useI18n } from "../i18n/index.js";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";

/**
 * The product page carries the art direction's second movement: after the brand
 * hero proves the instrument exists, this page shows the machinery. The layout
 * is deliberately asymmetric (the shared machinery gets the wide cell, the
 * assistant gets a bento with one dominant panel), every card is a spot-lit
 * spring-tilted surface, and the deeper band carries the corner-anchored aurora
 * from the reference board. No invented numbers, no decoration without duty.
 */
const SHARED: { key: "project" | "engine" | "report" | "workspace"; icon: typeof Boxes }[] = [
  { key: "project", icon: Boxes },
  { key: "engine", icon: Layers },
  { key: "report", icon: GitBranch },
  { key: "workspace", icon: ShieldCheck },
];

const ASSISTANT: { key: "browser" | "terminal" | "tools"; icon: typeof Monitor }[] = [
  { key: "browser", icon: Monitor },
  { key: "terminal", icon: Terminal },
  { key: "tools", icon: Wrench },
];

export function Product() {
  const { t } = useI18n();
  return (
    <>
      <Section>
        <SectionHeading
          as="h1"
          eyebrow={t("modules.eyebrow")}
          title={t("product.title")}
          lede={t("product.lede")}
        />
        <div className="mt-10" data-reveal>
          <ModuleShowcase />
        </div>
      </Section>

      <Section tone="deeper" className="aurora-band">
        <SectionHeading
          eyebrow={t("product.assistant.eyebrow")}
          title={t("product.assistant.title")}
          lede={t("product.assistant.lede")}
        />
        {/* Bento: the browser panel is the claim's proof, so it takes the wide cell;
            terminal and tools stack beside it. Equal thirds would read as filler. */}
        <div className="mt-9 grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          <article className="brand-panel spot-card p-7" data-tilt data-reveal>
            <Monitor size={20} className="text-brand-mint" />
            <h3 className="mt-4 text-[1.05rem] font-semibold">
              {t("product.assistant.browser.t")}
            </h3>
            <p className="mt-2 max-w-[52ch] text-[0.88rem] leading-relaxed text-white/54">
              {t("product.assistant.browser.d")}
            </p>
            <p className="mt-5 font-mono text-[0.66rem] tracking-[0.14em] text-white/32">
              CHROMIUM · TABS · COOKIES · ZOOM · FIND
            </p>
          </article>
          <div className="grid gap-5">
            {ASSISTANT.slice(1).map(({ key, icon: Icon }) => (
              <article key={key} className="brand-panel spot-card p-6" data-tilt data-reveal>
                <Icon size={20} className="text-brand-mint" />
                <h3 className="mt-4 text-[1rem] font-semibold">
                  {t(`product.assistant.${key}.t`)}
                </h3>
                <p className="mt-2 text-[0.88rem] leading-relaxed text-white/54">
                  {t(`product.assistant.${key}.d`)}
                </p>
              </article>
            ))}
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow={t("product.shared.eyebrow")} title={t("product.shared.title")} />
        {/* 2×2 but not a filler grid: each card is a real architectural fact, and the
            spotlight border + layered shadow give them the reference's depth. */}
        <div className="mt-9 grid gap-5 md:grid-cols-2">
          {SHARED.map(({ key, icon: Icon }) => (
            <article key={key} className="brand-panel spot-card p-6" data-tilt data-reveal>
              <Icon size={20} className="text-brand-mint" />
              <h3 className="mt-4 text-[1rem] font-semibold">{t(`product.shared.${key}.t`)}</h3>
              <p className="mt-2 text-[0.88rem] leading-relaxed text-white/54">
                {t(`product.shared.${key}.d`)}
              </p>
            </article>
          ))}
        </div>
        <div data-reveal className="mt-8 flex flex-wrap gap-3">
          {(["world", "flow", "exit", "fail", "clean"] as const).map((module) => (
            <Link key={module} to={`/${module}`} className="btn btn-ghost" data-magnet>
              {module.toUpperCase()}
            </Link>
          ))}
          <Link to="/platform" className="btn btn-primary" data-magnet>
            {t("nav.platform")}
          </Link>
        </div>
      </Section>
    </>
  );
}
