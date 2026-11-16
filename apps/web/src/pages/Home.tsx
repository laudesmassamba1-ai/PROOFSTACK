import {
  ArrowRight,
  BookOpen,
  Check,
  CircleCheck,
  Globe2,
  PackageOpen,
  Route as RouteIcon,
  Terminal,
} from "lucide-react";
import { Link } from "react-router";
import { ParticleLogo } from "../components/brand/ParticleLogo.js";
import { CliPreview } from "../components/marketing/CliPreview.js";
import { EngineDiagram } from "../components/marketing/EngineDiagram.js";
import { ModuleShowcase } from "../components/marketing/ModuleShowcase.js";
import { PricingTable } from "../components/marketing/PricingTable.js";
import { useI18n } from "../i18n/index.js";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";

const MODULE_CARDS = [
  {
    id: "world",
    icon: Globe2,
    className: "module-world",
    command: "proofstack test --module world",
  },
  {
    id: "flow",
    icon: RouteIcon,
    className: "module-flow",
    command: "proofstack test --module flow",
  },
  {
    id: "exit",
    icon: PackageOpen,
    className: "module-exit",
    command: "proofstack test --module exit",
  },
] as const;

export function Home() {
  const { t } = useI18n();

  return (
    <>
      <section className="proof-hero">
        <ParticleLogo
          className="opacity-95"
          focus="right"
          density={0.95}
          waveIntensity={0.9}
          logoFormationDuration={2800}
        />
        <div className="proof-hero-shade" />
        <div className="relative z-10 mx-auto max-w-[1240px] px-5 lg:px-8">
          <div className="flex min-h-[min(820px,82vh)] flex-col justify-center pb-28 pt-20 sm:pt-24">
            <span className="signal-pill w-fit">
              <span className="signal-dot" />
              {t("home.signal")}
            </span>
            <h1 className="proof-hero-title mt-7 max-w-[13ch] text-white">{t("hero.title")}</h1>
            <p className="mt-7 max-w-[54ch] text-[1.02rem] leading-relaxed text-white/62">
              {t("hero.lede")}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link to="/signup" className="btn btn-primary">
                {t("hero.cta.primary")} <ArrowRight size={16} />
              </Link>
              <Link to="/platform" className="btn btn-ghost">
                {t("hero.cta.explore")}
              </Link>
            </div>
            <div className="mt-10 flex max-w-[620px] flex-col gap-3">
              <div className="brand-panel inline-flex w-fit max-w-full items-center gap-3 px-4 py-3">
                <Terminal size={15} className="shrink-0 text-brand-mint" />
                <code className="truncate text-[0.78rem] text-white/72">{t("hero.cli")}</code>
              </div>
              <p className="font-mono text-[0.68rem] text-white/32">{t("hero.status")}</p>
            </div>
          </div>

          <div className="grid gap-3 border-t border-white/10 py-5 sm:grid-cols-3">
            {MODULE_CARDS.map((module) => (
              <Link
                key={module.id}
                to={`/${module.id}`}
                className={`module-card ${module.className} group flex items-center justify-between px-4 py-3.5`}
              >
                <span className="flex items-center gap-3">
                  <module.icon size={15} className="module-accent-text" />
                  <span className="font-mono text-[0.68rem] tracking-[0.16em] text-white/62">
                    {module.id.toUpperCase()}
                  </span>
                </span>
                <ArrowRight
                  size={14}
                  className="text-white/25 transition-transform group-hover:translate-x-0.5 group-hover:text-white/60"
                />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <Section id="modules">
        <SectionHeading
          eyebrow={t("modules.eyebrow")}
          title={t("modules.title")}
          lede={t("modules.lede")}
        />
        <div className="mt-10">
          <ModuleShowcase />
        </div>
      </Section>

      <Section tone="deeper" id="engine">
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <SectionHeading
              eyebrow={t("home.engine.eyebrow")}
              title={t("home.engine.title")}
              lede={t("home.engine.lede")}
            />
            <ul className="mt-8 space-y-3">
              {(["1", "2", "3"] as const).map((index) => (
                <li key={index} className="flex gap-3 text-[0.9rem] leading-relaxed text-white/56">
                  <CircleCheck size={17} className="mt-0.5 shrink-0 text-brand-emerald" />
                  <span>{t(`home.engine.${index}` as const)}</span>
                </li>
              ))}
            </ul>
          </div>
          <EngineDiagram />
        </div>
      </Section>

      <Section>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            eyebrow={t("home.modules.eyebrow")}
            title={t("home.modules.title")}
            lede={t("home.modules.lede")}
          />
          <Link
            to="/platform"
            className="text-[0.82rem] font-medium text-brand-mint hover:underline"
          >
            {t("home.engine.link")} <ArrowRight size={13} className="inline" />
          </Link>
        </div>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {MODULE_CARDS.map((module) => (
            <article key={module.id} className={`module-card ${module.className} p-6`}>
              <div className="flex items-center justify-between">
                <span className="module-glow flex size-10 items-center justify-center rounded-xl border border-white/10">
                  <module.icon size={18} className="module-accent-text" />
                </span>
                <span className="font-mono text-[0.64rem] uppercase tracking-[0.16em] text-white/30">
                  {t(`modules.${module.id}.tag` as const)}
                </span>
              </div>
              <h3 className="mt-5 text-[1.25rem] font-semibold tracking-tight">
                {t(`modules.${module.id}.name` as const)}
              </h3>
              <p className="mt-2 text-[0.88rem] leading-relaxed text-white/52">
                {t(`modules.${module.id}.body` as const)}
              </p>
              <code className="mt-5 block truncate rounded-lg border border-white/8 bg-black/20 px-3 py-2 font-mono text-[0.67rem] text-white/42">
                {module.command}
              </code>
            </article>
          ))}
        </div>
      </Section>

      <Section tone="deeper" id="cli">
        <div className="grid items-center gap-10 lg:grid-cols-[0.83fr_1.17fr]">
          <div>
            <p className="eyebrow">{t("home.cli.eyebrow")}</p>
            <h2 className="mt-3 text-balance text-[2rem] leading-[1.08] tracking-tight sm:text-[2.55rem]">
              {t("home.cli.title")}
            </h2>
            <p className="mt-4 max-w-[54ch] text-[0.96rem] leading-relaxed text-white/56">
              {t("home.cli.lede")}
            </p>
            <ul className="mt-7 space-y-3">
              {(["1", "2", "3", "4"] as const).map((index) => (
                <li key={index} className="flex gap-3 text-[0.86rem] leading-relaxed text-white/56">
                  <Check size={15} className="mt-0.5 shrink-0 text-brand-emerald" />
                  <span>{t(`home.cli.${index}` as const)}</span>
                </li>
              ))}
            </ul>
          </div>
          <CliPreview />
        </div>
      </Section>

      <Section id="workflow">
        <SectionHeading
          eyebrow={t("home.workflow.eyebrow")}
          title={t("home.workflow.title")}
          lede={t("home.workflow.lede")}
        />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {(["1", "2", "3"] as const).map((index) => (
            <div key={index} className="workflow-line relative pl-12">
              <span className="absolute left-0 top-0 flex size-9 items-center justify-center rounded-full border border-brand-mint/25 bg-brand-mint/8 font-mono text-[0.72rem] text-brand-mint">
                0{index}
              </span>
              <h3 className="text-[1rem] font-semibold">
                {t(`home.workflow.${index}.title` as const)}
              </h3>
              <p className="mt-2 max-w-[36ch] text-[0.86rem] leading-relaxed text-white/50">
                {t(`home.workflow.${index}.body` as const)}
              </p>
              <code className="mt-4 block rounded-lg border border-white/8 bg-white/[0.025] px-3 py-2 font-mono text-[0.68rem] leading-relaxed text-white/46">
                {index === "1"
                  ? "npm i -D @proofstack/cli\nnpx proofstack init"
                  : index === "2"
                    ? "proofstack doctor\nproofstack validate"
                    : "proofstack test\nproofstack report"}
              </code>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="deeper" id="pricing">
        <SectionHeading
          eyebrow={t("pricing.eyebrow")}
          title={t("pricing.title")}
          lede={t("pricing.lede")}
        />
        <div className="mt-9">
          <PricingTable />
        </div>
      </Section>

      <Section>
        <div className="brand-panel relative overflow-hidden p-8 sm:p-12 lg:p-14">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                "radial-gradient(55% 80% at 80% 50%, rgba(120,227,203,0.12), transparent 70%), linear-gradient(120deg, transparent 30%, rgba(49,95,200,0.1))",
            }}
          />
          <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="eyebrow">{t("home.docs.eyebrow")}</p>
              <h2 className="mt-3 max-w-[16ch] text-balance text-[2rem] leading-[1.06] tracking-tight sm:text-[2.7rem]">
                {t("home.docs.title")}
              </h2>
              <p className="mt-4 max-w-[58ch] text-[0.94rem] leading-relaxed text-white/52">
                {t("home.docs.body")}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link to="/docs" className="btn btn-primary">
                <BookOpen size={15} /> {t("home.docs.cta")}
              </Link>
              <Link to="/signup" className="btn btn-ghost">
                {t("hero.cta.primary")} <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
