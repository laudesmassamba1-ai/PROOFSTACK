import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { type GlyphKind, ModuleGlyph, NameStrip } from "../components/brand/GlyphArt.js";
import { useI18n } from "../i18n/index.js";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";

/**
 * La page produit refaite : une seule DA (l'instrument noir), deux assets
 * neufs dessinés en glyphes (la bande de noms, les sceaux de modules), des
 * rangées à filets au lieu de cartes, et l'assistant comme un seul panneau.
 * Rien de décoratif : chaque ligne est un fait du produit.
 */
const ROWS: { key: "world" | "flow" | "exit" | "fail" | "clean"; kind: GlyphKind }[] = [
  { key: "world", kind: "world" },
  { key: "flow", kind: "flow" },
  { key: "exit", kind: "exit" },
  { key: "fail", kind: "fail" },
  { key: "clean", kind: "clean" },
];

const ASSISTANT = ["browser", "terminal", "tools"] as const;
const SHARED = ["project", "engine", "report", "workspace"] as const;

export function Product() {
  const { t } = useI18n();
  return (
    <>
      <Section>
        <SectionHeading
          as="h1"
          eyebrow={t("product.eyebrow")}
          title={t("product.title")}
          lede={t("product.lede")}
        />
        <div data-reveal className="mt-10">
          <NameStrip />
        </div>
      </Section>

      {/* ---------- les cinq modules : rangées à filets, sceaux en glyphes ---------- */}
      <Section>
        <SectionHeading eyebrow={t("modules.eyebrow")} title={t("modules.title")} />
        <div data-reveal className="mt-9 border-t border-white/8">
          {ROWS.map(({ key, kind }) => (
            <Link
              key={key}
              to={`/${key}`}
              className="group grid grid-cols-[72px_1fr] items-center gap-5 border-b border-white/8 px-2 py-6 transition-colors hover:bg-white/[0.03] sm:grid-cols-[104px_1fr_1fr_auto] sm:gap-8 sm:px-4"
            >
              <div className="h-16 w-16 sm:h-[104px] sm:w-[104px]">
                <ModuleGlyph kind={kind} />
              </div>
              <div>
                <p className="font-mono text-[0.62rem] tracking-[0.2em] text-white/34">
                  {key.toUpperCase()}
                </p>
                <h3 className="mt-1 text-[1.02rem] font-semibold text-white/92">
                  {t(`product.rows.${key}.t` as const)}
                </h3>
                <p className="mt-1.5 max-w-[46ch] text-[0.86rem] leading-relaxed text-white/52">
                  {t(`product.rows.${key}.d` as const)}
                </p>
              </div>
              <p className="hidden font-mono text-[0.62rem] leading-loose tracking-[0.12em] text-white/30 md:block">
                {t(`product.rows.${key}.k` as const)}
              </p>
              <ArrowRight
                size={16}
                className="hidden text-white/30 transition-transform group-hover:translate-x-1 group-hover:text-white/70 sm:block"
              />
            </Link>
          ))}
        </div>
      </Section>

      {/* ---------- l'assistant : un seul panneau, trois faits ---------- */}
      <Section tone="deeper">
        <SectionHeading
          eyebrow={t("product.assistant.eyebrow")}
          title={t("product.assistant.title")}
          lede={t("product.assistant.lede")}
        />
        <div
          data-reveal
          className="mt-9 rounded-2xl border border-white/8 bg-white/[0.02] p-7 sm:p-9"
        >
          <div className="grid gap-8 md:grid-cols-3">
            {ASSISTANT.map((key) => (
              <div
                key={key}
                className="border-t border-white/10 pt-5 first:border-t-0 first:pt-0 md:border-t-0 md:pt-0"
              >
                <p className="font-mono text-[0.62rem] tracking-[0.2em] text-white/34">
                  {key.toUpperCase()}
                </p>
                <h3 className="mt-2 text-[1rem] font-semibold text-white/90">
                  {t(`product.assistant.${key}.t`)}
                </h3>
                <p className="mt-2 text-[0.86rem] leading-relaxed text-white/52">
                  {t(`product.assistant.${key}.d`)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-8 border-t border-white/8 pt-5 font-mono text-[0.62rem] tracking-[0.14em] text-white/30">
            CHROMIUM · TABS · COOKIES · ZOOM · FIND — SESSION SUIVIE À LA NAVIGATION
          </p>
        </div>
      </Section>

      {/* ---------- le socle partagé : définitions à filets, pas des cartes ---------- */}
      <Section>
        <SectionHeading eyebrow={t("product.shared.eyebrow")} title={t("product.shared.title")} />
        <div data-reveal className="mt-9 grid gap-x-14 border-t border-white/8 md:grid-cols-2">
          {SHARED.map((key) => (
            <div key={key} className="border-b border-white/8 py-6">
              <h3 className="text-[0.98rem] font-semibold text-white/90">
                {t(`product.shared.${key}.t`)}
              </h3>
              <p className="mt-2 max-w-[56ch] text-[0.86rem] leading-relaxed text-white/52">
                {t(`product.shared.${key}.d`)}
              </p>
            </div>
          ))}
        </div>
        <div data-reveal className="mt-9 flex flex-wrap gap-3">
          <Link to="/signup" className="btn btn-primary" data-magnet>
            {t("home.cta.primary")} <ArrowRight size={16} />
          </Link>
          <Link to="/docs" className="btn btn-ghost" data-magnet>
            {t("nav.docs")}
          </Link>
        </div>
      </Section>
    </>
  );
}
