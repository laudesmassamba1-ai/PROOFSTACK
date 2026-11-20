import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Check,
  Globe2,
  PackageOpen,
  Route as RouteIcon,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { Link } from "react-router";
import { HeroLockup } from "../components/brand/Logo.js";
import { ParticleLogo } from "../components/brand/ParticleLogo.js";
import { CliPreview } from "../components/marketing/CliPreview.js";
import { EngineDiagram } from "../components/marketing/EngineDiagram.js";
import { ModuleShowcase } from "../components/marketing/ModuleShowcase.js";
import { StatStrip } from "../components/marketing/StatStrip.js";
import { useI18n } from "../i18n/index.js";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";

const MODULE_CARDS = [
  { id: "world", icon: Globe2, className: "module-world" },
  { id: "flow", icon: RouteIcon, className: "module-flow" },
  { id: "exit", icon: PackageOpen, className: "module-exit" },
  { id: "fail", icon: ShieldAlert, className: "module-fail" },
  { id: "clean", icon: BadgeCheck, className: "module-clean" },
] as const;

export function Home() {
  const { t } = useI18n();

  return (
    <>
      {/* ---------- brand hero ---------- */}
      <section className="hero-section relative overflow-hidden">
        {/*
          The signature motion: a field of particles drifts as a wave, converges into the
          three-layer P, holds, then dissolves back. It is the brand's identity, so it is
          the hero's main visual — but it sits *behind* a scrim and never over the copy.
          A static SVG mark renders when motion is reduced or Canvas is unavailable.
        */}
        <ParticleLogo
          focus="right"
          density={1}
          waveIntensity={1.05}
          particleSize={1.9}
          className="z-0"
        />
        {/* The scrim is what keeps the copy legible: particles are a texture, never a
            backdrop for a paragraph. It is a class, not an inline gradient, so the
            mobile direction (vertical) can differ from the desktop one (horizontal). */}
        <div className="hero-scrim pointer-events-none absolute inset-0 z-[1]" aria-hidden="true" />
        <div className="relative z-[2] mx-auto max-w-[1240px] px-5 pb-10 pt-6 lg:px-8">
          {/* Copy left, proof right: the promise above, the evidence beside it. */}
          <div className="grid items-center gap-10">
            <div className="min-w-0 max-w-[640px]">
              <HeroLockup size={46} />
              <p className="eyebrow mt-7 text-white/78">{t("hero.eyebrow")}</p>
              <h1 className="rise rise-2 hero-title mt-3 max-w-[13ch] text-balance text-white">
                {t("hero.title")}
              </h1>
              <p className="rise rise-3 mt-5 max-w-[55ch] text-[0.98rem] leading-relaxed text-white/62">
                {t("hero.lede")}
              </p>
              <div className="rise rise-3 mt-7 flex flex-wrap items-center gap-2.5">
                <Link to="/download" className="btn btn-primary">
                  {t("hero.cta.download")} <ArrowRight size={16} />
                </Link>
                <Link to="/signup" className="btn btn-ghost">
                  {t("hero.cta.primary")}
                </Link>
                <Link
                  to="/platform"
                  className="ml-1 inline-flex items-center gap-1 text-[0.84rem] text-white/52 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white"
                >
                  {t("hero.cta.explore")}
                </Link>
              </div>
              <div className="mt-6 flex max-w-[600px] flex-col gap-2">
                <div className="brand-panel inline-flex w-fit max-w-full items-center gap-2.5 px-3.5 py-2.5">
                  <Terminal size={14} className="shrink-0 text-brand-mint" />
                  <code className="truncate text-[0.76rem] text-white/72">{t("hero.cli")}</code>
                </div>
                <p className="font-mono text-[0.66rem] text-white/32">{t("hero.status")}</p>
              </div>
            </div>
          </div>

          <div className="mt-10 grid gap-2 border-t border-white/10 pt-5 sm:grid-cols-3 lg:grid-cols-5">
            {MODULE_CARDS.map((module, index) => {
              const Icon = module.icon;
              return (
                <a
                  key={module.id}
                  href={`#modules`}
                  className={`module-card ${module.className} hero-module-link group flex items-center justify-between px-3.5 py-3`}
                  style={{ animationDelay: `${420 + index * 70}ms` }}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon size={14} className="module-accent-text" />
                    <span className="font-mono text-[0.66rem] tracking-[0.16em] text-white/62">
                      {module.id.toUpperCase()}
                    </span>
                  </span>
                  <span className="text-white/25 transition-transform group-hover:translate-x-0.5">
                    ›
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {/* Quiet facts, counted up once on first intersection. */}
      <StatStrip />

      <Section id="modules">
        <SectionHeading
          eyebrow={t("modules.eyebrow")}
          title={t("modules.title")}
          lede={t("modules.lede")}
        />
        <div className="mt-8" data-reveal>
          <ModuleShowcase />
        </div>
        <div data-reveal className="mt-8 flex flex-wrap items-center gap-3">
          <Link to="/pricing" className="btn btn-ghost">
            {t("home.cta.pricing")} <ArrowRight size={16} />
          </Link>
        </div>
      </Section>

      {/* ---------- the AI reading: why a report is not a wall of red ---------- */}
      <Section tone="deeper" id="ai">
        <div className="grid items-center gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14">
          <div>
            <SectionHeading
              eyebrow={t("home.ai.eyebrow")}
              title={t("home.ai.title")}
              lede={t("home.ai.lede")}
            />
            <ul className="mt-7 space-y-3.5">
              {(["1", "2", "3"] as const).map((index) => (
                <li key={index} className="flex gap-3">
                  <span className="ai-check">
                    <Check size={12} />
                  </span>
                  <span className="text-[0.88rem] leading-relaxed text-white/58">
                    <strong className="font-medium text-white/86">
                      {t(`home.ai.point.${index}.t` as const)}
                    </strong>{" "}
                    {t(`home.ai.point.${index}.d` as const)}
                  </span>
                </li>
              ))}
            </ul>
            <div data-reveal className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/signup" className="btn btn-primary">
                {t("home.ai.cta")} <ArrowRight size={16} />
              </Link>
              <Link to="/docs" className="btn btn-ghost">
                {t("home.ai.docs")}
              </Link>
            </div>
          </div>

          <div data-reveal>
            <AiAuditSample />
          </div>
        </div>
      </Section>

      <Section id="engine">
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <SectionHeading
              eyebrow={t("home.engine.eyebrow")}
              title={t("home.engine.title")}
              lede={t("home.engine.lede")}
            />
            <ul className="mt-7 space-y-3">
              {(["1", "2", "3"] as const).map((index) => (
                <li key={index} className="flex gap-3 text-[0.9rem] leading-relaxed text-white/56">
                  <span
                    className="mt-0.5 shrink-0 rounded-full bg-brand-emerald"
                    style={{ width: 10, height: 10 }}
                  />
                  <span>{t(`home.engine.${index}` as const)}</span>
                </li>
              ))}
            </ul>
            <div data-reveal className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/platform" className="btn btn-ghost">
                {t("home.engine.link")} <ArrowRight size={16} />
              </Link>
            </div>
          </div>
          <div data-reveal>
            <EngineDiagram />
          </div>
        </div>
      </Section>

      {/* ---------- developer workflow ---------- */}
      <Section tone="deeper" id="workflow">
        <SectionHeading
          eyebrow={t("home.flow.eyebrow")}
          title={t("home.flow.title")}
          lede={t("home.flow.lede")}
        />
        <ol data-reveal className="mt-8 grid gap-3 md:grid-cols-3">
          {(["1", "2", "3"] as const).map((index) => (
            <li key={index} className="brand-panel p-5">
              <p className="font-mono text-[0.66rem] tracking-[0.2em] text-brand-mint/80">
                {t(`home.flow.step.${index}.k` as const)}
              </p>
              <p className="mt-2 text-[0.96rem] font-medium text-white/88">
                {t(`home.flow.step.${index}.t` as const)}
              </p>
              <p className="mt-1.5 text-[0.84rem] leading-relaxed text-white/52">
                {t(`home.flow.step.${index}.d` as const)}
              </p>
            </li>
          ))}
        </ol>
        <div className="mt-8" data-reveal>
          <CliPreview />
        </div>
        <div data-reveal className="mt-8 flex flex-wrap items-center gap-3">
          <Link to="/download" className="btn btn-primary">
            {t("hero.cta.download")} <ArrowRight size={16} />
          </Link>
          <Link to="/pricing" className="btn btn-ghost">
            {t("home.cta.pricing")}
          </Link>
        </div>
      </Section>

      {/* ---------- final CTA ---------- */}
      <Section>
        <div
          data-reveal
          className="brand-panel relative overflow-hidden px-6 py-12 text-center sm:px-10 sm:py-14"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(46% 60% at 50% 0%, rgba(120,227,203,0.13), transparent 70%), radial-gradient(40% 52% at 82% 100%, rgba(112,201,219,0.1), transparent 70%)",
            }}
          />
          <div className="relative">
            <p className="eyebrow">{t("home.cta.eyebrow")}</p>
            <h2 className="mx-auto mt-4 max-w-[22ch] text-balance text-[clamp(1.8rem,4.2vw,3.1rem)] font-semibold leading-[1.04] tracking-[-0.035em] text-white">
              {t("home.cta.title")}
            </h2>
            <p className="mx-auto mt-4 max-w-[54ch] text-[0.93rem] leading-relaxed text-white/58">
              {t("home.cta.lede")}
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link to="/signup" className="btn btn-primary">
                {t("home.cta.primary")} <ArrowRight size={16} />
              </Link>
              <Link to="/pricing" className="btn btn-ghost">
                {t("home.cta.pricing")}
              </Link>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}

/**
 * A recorded AI reading of a real finding set.
 *
 * It is labelled as a recording, because that is what it is: the sample is fixed copy,
 * not a live model call. What it shows is the shape of the answer a user actually gets —
 * a verdict, the cost of each defect, and the one thing to fix first.
 */
function AiAuditSample() {
  const { t } = useI18n();

  const lines = [
    { kind: "h", text: t("home.ai.sample.title") },
    { kind: "p", text: t("home.ai.sample.verdict") },
    { kind: "i", tone: "fail", text: t("home.ai.sample.i1") },
    { kind: "i", tone: "warn", text: t("home.ai.sample.i2") },
    { kind: "i", tone: "pass", text: t("home.ai.sample.i3") },
    { kind: "p", text: t("home.ai.sample.fix") },
  ] as const;

  return (
    <figure className="ai-sample">
      <figcaption className="ai-sample-bar">
        <Bot size={14} className="text-brand-mint" />
        <span className="font-mono text-[0.64rem] tracking-[0.14em] text-white/58">
          {t("home.ai.sample.bar")}
        </span>
        <span className="ai-sample-effort">{t("home.ai.sample.effort")}</span>
        <span className="ai-sample-rec">{t("home.ai.sample.recorded")}</span>
      </figcaption>
      <div className="ai-sample-body">
        {lines.map((line, index) => (
          <p
            key={line.text}
            className={
              line.kind === "h"
                ? "ai-line-h"
                : line.kind === "p"
                  ? "ai-line-p"
                  : `ai-line-i ai-line-${line.tone}`
            }
            style={{ "--d": `${index * 90}ms` } as React.CSSProperties}
          >
            {line.kind === "i" ? <span className="ai-line-bullet" aria-hidden="true" /> : null}
            {line.text}
          </p>
        ))}
      </div>
      <div className="ai-sample-foot">{t("home.ai.sample.foot")}</div>
    </figure>
  );
}
