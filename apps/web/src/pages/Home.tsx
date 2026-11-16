import { ArrowRight, Terminal, Globe2, Route as RouteIcon, PackageOpen } from "lucide-react";
import { Link } from "react-router";
import { DottedWave } from "../components/brand/DottedWave.js";
import { HeroLockup } from "../components/brand/Logo.js";
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
      {/* ---------- brand hero: reference A (minimalist, non-AI) ---------- */}
      <section className="relative min-h-[86vh] overflow-hidden">
        <DottedWave className="absolute inset-0 size-full" step={15} intensity={1} bias={0.66} />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 60% at 30% 45%, rgba(5,7,8,0.86), rgba(5,7,8,0.2) 70%)",
          }}
        />
        <div className="relative mx-auto flex min-h-[86vh] max-w-[1240px] px-5 py-20 sm:py-24 lg:px-8 lg:flex-row items-center gap-8">
          <div className="max-w-[760px] lg:order-1 order-2">
            <HeroLockup size={54} />
            <p className="eyebrow mt-10 text-white/80">{t("hero.eyebrow")}</p>
            <h1 className="rise rise-2 mt-4 max-w-[18ch] text-balance text-white text-[2.2rem] leading-[1.06] tracking-tight sm:text-[3.4rem] lg:text-[4rem]">
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

          <div className="grid gap-3 border-t border-white/10 py-5 sm:grid-cols-3">
            {MODULE_CARDS.map((module) => {
              const Icon = module.icon as any;
              return (
                <a key={module.id} href={`#${module.id}`} className={`module-card ${module.className} group flex items-center justify-between px-4 py-3.5`}>
                  <span className="flex items-center gap-3">
                    <Icon size={15} className="module-accent-text" />
                    <span className="font-mono text-[0.68rem] tracking-[0.16em] text-white/62">{module.id.toUpperCase()}</span>
                  </span>
                  <span className="text-white/25">›</span>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {/* Sections réciproques minimalisées pour éviter vibe IA */}
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
              {(["1","2","3"] as const).map((index) => (
                <li key={index} className="flex gap-3 text-[0.9rem] leading-relaxed text-white/56">
                  <span className="mt-0.5 shrink-0 rounded-full bg-brand-emerald" style={{ width: 10, height: 10 }} />
                  <span>{t(`home.engine.${index}` as const)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div aria-label="engine diagram placeholder" />
        </div>
      </Section>
    </>
  );
}
