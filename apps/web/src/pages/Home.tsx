import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { AsciiHero, AsciiHeroCopy } from "../components/AsciiHero.js";
import { StatStrip } from "../components/marketing/StatStrip.js";
import { useI18n } from "../i18n/index.js";
import { Section } from "../layouts/BrandLayout.js";

/**
 * La landing est réduite à l'essentiel : le héros ASCII, les chiffres
 * tranquilles, un seul appel à l'action. Les anciennes sections fiches
 * (moteur, CLI, lecture IA, mur de modules) ont été retirées avec la
 * double DA — le site n'a plus qu'une seule direction artistique.
 */
export function Home() {
  const { t } = useI18n();

  return (
    <>
      {/* ---------- héros ASCII : la vague redessinée en glyphes ---------- */}
      <AsciiHero>
        <AsciiHeroCopy
          eyebrow={t("hero.eyebrow")}
          titlePre={t("hero.title.pre")}
          titlePre2={t("hero.title.pre2")}
          titleMid={t("hero.title.mid")}
          titleAccent={t("hero.title.accent")}
          lede={t("hero.lede")}
          cli={t("hero.cli")}
          cta={t("hero.cta.primary")}
        />
      </AsciiHero>

      {/* Quiet facts, counted up once on first intersection. */}
      <StatStrip />

      {/* ---------- final CTA ---------- */}
      <Section>
        <div
          data-reveal
          className="peint-final relative overflow-hidden px-6 py-12 text-center sm:px-10 sm:py-14"
        >
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
