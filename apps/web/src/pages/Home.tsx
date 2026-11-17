import { ArrowRight, Globe2, PackageOpen, Route as RouteIcon, Terminal } from "lucide-react";
import { Link } from "react-router";
import { DottedWave } from "../components/brand/DottedWave.js";
import { HeroLockup } from "../components/brand/Logo.js";
import { ParticleLogo } from "../components/brand/ParticleLogo.js";
import { ModuleShowcase } from "../components/marketing/ModuleShowcase.js";
import { useI18n } from "../i18n/index.js";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";

const MODULE_CARDS = [
  { id: "world", icon: Globe2, className: "module-world" },
  { id: "flow", icon: RouteIcon, className: "module-flow" },
  { id: "exit", icon: PackageOpen, className: "module-exit" },
] as const;

export function Home() {
  const { t } = useI18n();

  return (
    <>
      {/* ---------- brand hero: reference A ---------- */}
      <section className="relative min-h-[86vh] overflow-hidden">
        {/*
          The signature motion: a field of particles drifts as a wave, converges into the
          three-layer P, holds, then dissolves back. It is the brand's identity, so it is
          the hero's main visual — but it sits *behind* a scrim and never over the copy.
          A static SVG mark renders when motion is reduced or Canvas is unavailable.
        */}
        <ParticleLogo focus="right" density={1} waveIntensity={1} className="z-0" />
        <DottedWave
          className="absolute inset-0 size-full opacity-45"
          step={17}
          intensity={0.7}
          bias={0.6}
        />
        <div
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{
            background:
              "radial-gradient(72% 62% at 26% 46%, rgba(5,7,8,0.92), rgba(5,7,8,0.55) 55%, rgba(5,7,8,0.15) 78%)",
          }}
        />
        <div className="relative z-[2] mx-auto flex min-h-[86vh] max-w-[1240px] flex-col justify-center gap-12 px-5 py-20 sm:py-24 lg:px-8">
          <div className="max-w-[760px]">
            <HeroLockup size={54} />
            <p className="eyebrow mt-10 text-white/80">{t("hero.eyebrow")}</p>
            {/*
              The headline is the image, per the reference decoding: uppercase, ultra-tight
              leading (0.86–0.92) and negative tracking (−0.05em), sized to dominate the
              viewport on desktop (88–148px) while still fitting a 320px phone.
            */}
            <h1 className="rise rise-2 hero-title mt-4 max-w-[16ch] text-balance text-white">
              {t("hero.title")}
            </h1>
            <p className="rise rise-3 mt-6 max-w-[58ch] text-[1.02rem] leading-relaxed text-white/62">
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

          <div className="grid max-w-[760px] gap-3 border-t border-white/10 py-5 sm:grid-cols-3">
            {MODULE_CARDS.map((module) => {
              const Icon = module.icon;
              return (
                <a
                  key={module.id}
                  href={`#${module.id}`}
                  className={`module-card ${module.className} group flex items-center justify-between px-4 py-3.5`}
                >
                  <span className="flex items-center gap-3">
                    <Icon size={15} className="module-accent-text" />
                    <span className="font-mono text-[0.68rem] tracking-[0.16em] text-white/62">
                      {module.id.toUpperCase()}
                    </span>
                  </span>
                  <span className="text-white/25">›</span>
                </a>
              );
            })}
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
                  <span
                    className="mt-0.5 shrink-0 rounded-full bg-brand-emerald"
                    style={{ width: 10, height: 10 }}
                  />
                  <span>{t(`home.engine.${index}` as const)}</span>
                </li>
              ))}
            </ul>
          </div>
          {/* The engine diagram is drawn below; this anchor keeps the grid balanced. */}
          <div role="presentation" />
        </div>
      </Section>
    </>
  );
}
