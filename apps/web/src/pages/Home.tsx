import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Check,
  Copy,
  Globe2,
  PackageOpen,
  Route as RouteIcon,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { OrbitStage } from "../components/brand/OrbitStage.js";
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

/** Section index for the rail and the headings. Decorative, real links underneath. */
const RAIL = [
  { id: "modules", key: "modules.eyebrow" as const },
  { id: "ai", key: "home.ai.eyebrow" as const },
  { id: "engine", key: "home.engine.eyebrow" as const },
  { id: "workflow", key: "home.flow.eyebrow" as const },
];

/** Language-neutral technical vocabulary: it reads as the product's own labels. */
const MARQUEE = [
  "LOCAL-FIRST",
  "WORLD",
  "FLOW",
  "EXIT",
  "FAIL",
  "CLEAN",
  "JSON · JUNIT · HTML",
  "SHA-256",
  "NO CLOUD SESSION",
  "NO BROWSER FARM",
];

export function Home() {
  const { t } = useI18n();

  return (
    <>
      {/* ---------------------------------------------------------- hero ---- */}
      <section className="cine-hero">
        {/*
          The signature field: particles drifting as a wave, behind everything. It is
          the brand's texture, never a backdrop for a paragraph — the scrim does that.
          A static SVG mark renders when motion is reduced or Canvas is unavailable.
        */}
        <ParticleLogo
          focus="right"
          density={0.85}
          waveIntensity={1}
          particleSize={1.8}
          className="z-0"
        />
        <div className="hero-scrim pointer-events-none absolute inset-0 z-[1]" aria-hidden="true" />

        <nav className="cine-rail" aria-label={t("modules.eyebrow")}>
          <span className="cine-rail-year" aria-hidden="true">
            PROOFCORE · 2026
          </span>
          <ul className="cine-rail-list">
            {RAIL.map((item, index) => (
              <li key={item.id}>
                <a className="cine-rail-link" href={`#${item.id}`} aria-label={t(item.key)}>
                  {String(index + 1).padStart(2, "0")}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="relative z-[2] mx-auto max-w-[1280px] px-5 sm:px-6 lg:px-10">
          <div className="cine-hero-grid">
            <div className="cine-hero-copy">
              <div className="cine-hero-eyebrow">
                <span className="eyebrow" data-anim="fade">
                  {t("hero.eyebrow")}
                </span>
                <span className="cine-hero-index" aria-hidden="true">
                  01 / 05
                </span>
              </div>

              <h1 className="cine-hero-title" data-anim="mask">
                <HeroTitle title={t("hero.title")} />
              </h1>

              <p className="cine-hero-lede" data-anim="fade">
                {t("hero.lede")}
              </p>

              <div className="cine-hero-actions" data-anim="fade">
                <Link to="/download" className="btn btn-primary" data-magnet>
                  {t("hero.cta.download")} <ArrowRight size={16} />
                </Link>
                <Link to="/signup" className="btn btn-ghost" data-magnet>
                  {t("hero.cta.primary")}
                </Link>
                <Link to="/platform" className="cine-hero-quiet-link">
                  {t("hero.cta.explore")} <ArrowRight size={13} />
                </Link>
              </div>

              <HeroCommand />
              <p className="cine-hero-note" data-anim="fade">
                {t("hero.status")}
              </p>
            </div>

            <div className="relative" data-anim="mask">
              <OrbitStage />
            </div>
          </div>

          <div className="cine-hero-modules" data-anim="fade">
            {MODULE_CARDS.map((module) => {
              const Icon = module.icon;
              return (
                <a
                  key={module.id}
                  href="#modules"
                  className={`cine-hero-module ${module.className}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon size={13} />
                    <span className="truncate">{module.id.toUpperCase()}</span>
                    <span className="cine-hero-module-dot" aria-hidden="true" />
                  </span>
                  <span className="cine-hero-module-arrow" aria-hidden="true">
                    ›
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- marquee ---- */}
      <div className="cine-marquee" aria-hidden="true">
        <div className="cine-marquee-track">
          {[0, 1].map((copy) => (
            <ul className="cine-marquee-set" key={copy}>
              {MARQUEE.map((item) => (
                <li className="cine-marquee-item" key={`${copy}-${item}`}>
                  {item}
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>

      {/* Quiet facts, counted up once on first intersection. */}
      <StatStrip />

      <Section id="modules">
        <SectionHeading
          index="02 — FIVE READINGS"
          eyebrow={t("modules.eyebrow")}
          title={t("modules.title")}
          lede={t("modules.lede")}
        />
        <div className="mt-9" data-anim="fade">
          <ModuleShowcase />
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-3" data-anim="fade">
          <Link to="/pricing" className="btn btn-ghost" data-magnet>
            {t("home.cta.pricing")} <ArrowRight size={16} />
          </Link>
        </div>
      </Section>

      {/* --------------------------------------------- the AI reading ---- */}
      <Section tone="deeper" id="ai">
        <div className="grid items-center gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16">
          <div>
            <SectionHeading
              index="03 — THE READING"
              eyebrow={t("home.ai.eyebrow")}
              title={t("home.ai.title")}
              lede={t("home.ai.lede")}
            />
            <ul className="mt-8 space-y-4">
              {(["1", "2", "3"] as const).map((index) => (
                <li key={index} className="flex gap-3">
                  <span className="ai-check">
                    <Check size={12} />
                  </span>
                  <span className="text-[0.9rem] leading-relaxed text-white/70">
                    <strong className="font-medium text-white">
                      {t(`home.ai.point.${index}.t` as const)}
                    </strong>{" "}
                    {t(`home.ai.point.${index}.d` as const)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap items-center gap-3" data-anim="fade">
              <Link to="/signup" className="btn btn-primary" data-magnet>
                {t("home.ai.cta")} <ArrowRight size={16} />
              </Link>
              <Link to="/docs" className="btn btn-ghost">
                {t("home.ai.docs")}
              </Link>
            </div>
          </div>

          <div data-anim="mask">
            <AiAuditSample />
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------- engine ---- */}
      <Section id="engine">
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div>
            <SectionHeading
              index="04 — ONE ENGINE"
              eyebrow={t("home.engine.eyebrow")}
              title={t("home.engine.title")}
              lede={t("home.engine.lede")}
            />
            <ul className="mt-8 space-y-3.5">
              {(["1", "2", "3"] as const).map((index) => (
                <li key={index} className="flex gap-3 text-[0.9rem] leading-relaxed text-white/70">
                  <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rotate-45 bg-brand-emerald" />
                  <span>{t(`home.engine.${index}` as const)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap items-center gap-3" data-anim="fade">
              <Link to="/platform" className="btn btn-ghost" data-magnet>
                {t("home.engine.link")} <ArrowRight size={16} />
              </Link>
            </div>
          </div>
          <div data-anim="mask" data-spot className="brand-panel p-3 sm:p-4">
            <EngineDiagram />
          </div>
        </div>
      </Section>

      {/* ------------------------------------------- developer workflow ---- */}
      <Section tone="deeper" id="workflow">
        <SectionHeading
          index="05 — THREE COMMANDS"
          eyebrow={t("home.flow.eyebrow")}
          title={t("home.flow.title")}
          lede={t("home.flow.lede")}
        />
        <ol className="cine-steps mt-9" data-anim="fade">
          {(["1", "2", "3"] as const).map((index) => (
            <li key={index} className="cine-step">
              <span className="cine-step-num" aria-hidden="true">
                {String(index).padStart(2, "0")}
              </span>
              <p className="cine-step-kicker">{t(`home.flow.step.${index}.k` as const)}</p>
              <p className="cine-step-title">{t(`home.flow.step.${index}.t` as const)}</p>
              <p className="cine-step-body">{t(`home.flow.step.${index}.d` as const)}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6" data-anim="mask">
          <CliPreview />
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-3" data-anim="fade">
          <Link to="/download" className="btn btn-primary" data-magnet>
            {t("hero.cta.download")} <ArrowRight size={16} />
          </Link>
          <Link to="/pricing" className="btn btn-ghost">
            {t("home.cta.pricing")}
          </Link>
        </div>
      </Section>

      {/* ---------------------------------------------------- final CTA ---- */}
      <Section>
        <div className="cine-cta" data-anim="fade" data-spot>
          <div className="cine-cta-rings" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className="eyebrow">{t("home.cta.eyebrow")}</p>
          <h2 className="cine-cta-title">
            <HeroTitle title={t("home.cta.title")} />
          </h2>
          <p className="cine-lede mx-auto mt-4 text-center">{t("home.cta.lede")}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/signup" className="btn btn-primary" data-magnet>
              {t("home.cta.primary")} <ArrowRight size={16} />
            </Link>
            <Link to="/pricing" className="btn btn-ghost">
              {t("home.cta.pricing")}
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}

/**
 * The headline, with its last word painted by the brand spectrum.
 *
 * The word is picked from the sentence itself, so no locale needs a hand-written split:
 * "Make Software Work Everywhere." ends on "Everywhere.", "Faites fonctionner vos
 * logiciels partout." on "partout.". The rest of the line keeps the page's ink.
 */
function HeroTitle({ title }: { title: string }) {
  const words = title.split(" ").filter(Boolean);
  const last = words.pop();
  if (!last) return <>{title}</>;
  return (
    <>
      {words.join(" ")} <span className="cine-spectrum-text">{last}</span>
    </>
  );
}

/** The install line, with a copy button that is honest about what it copies. */
function HeroCommand() {
  const { t } = useI18n();
  const command = t("hero.cli");
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="cine-command" data-anim="fade">
      <Terminal size={13} className="shrink-0 text-brand-mint" />
      <code title={command}>{command}</code>
      <button
        type="button"
        className="cine-command-copy"
        onClick={() => void copy()}
        aria-label={copied ? t("mkt.copied") : t("mkt.copy")}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

/**
 * A recorded AI reading of a real finding set.
 *
 * Labelled as a recording, because that is what it is: the sample is fixed copy, not a
 * live model call. What it shows is the shape of the answer a user actually gets — a
 * verdict, the cost of each defect, and the one thing to fix first.
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
        <span className="font-mono text-[0.64rem] tracking-[0.14em] text-white/62">
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
