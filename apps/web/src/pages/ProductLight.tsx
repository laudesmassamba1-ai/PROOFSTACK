import { Boxes, GitBranch, Layers, Monitor, ShieldCheck, Terminal, Wrench } from "lucide-react";
import { Link } from "react-router";
import { ModuleShowcase } from "../components/marketing/ModuleShowcase.js";
import { useI18n } from "../i18n/index.js";

/**
 * The paper edition of /product: the machinery as an editorial page. The dark
 * module wall stays as an embedded instrument; the assistant speaks through a
 * timeline; the shared architecture becomes a numbered index. Different bones
 * from the dark page's card grid.
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

export function ProductLight() {
  const { t } = useI18n();
  return (
    <div className="lh">
      <section className="lh-section" style={{ paddingBottom: 0 }}>
        <div className="lh-section-head">
          <p className="lh-eyebrow">{t("modules.eyebrow")}</p>
          <h1 className="lh-hero-title" style={{ fontSize: "clamp(2.4rem, 4.6vw, 3.8rem)" }}>
            {t("product.title")}
          </h1>
          <p className="lh-lede">{t("product.lede")}</p>
        </div>
      </section>

      <section className="lh-section" style={{ paddingTop: "2rem" }}>
        <ModuleShowcase />
      </section>

      {/* the assistant: a timeline, the paper edition's way of stating machinery */}
      <section className="lh-section lh-deeper">
        <div className="lh-ai-grid">
          <div className="lh-ai-copy">
            <p className="lh-eyebrow">{t("product.assistant.eyebrow")}</p>
            <h2 className="lh-title-md">{t("product.assistant.title")}</h2>
            <p className="lh-lede">{t("product.assistant.lede")}</p>
          </div>
          <ol className="lh-timeline">
            {ASSISTANT.map(({ key, icon: Icon }) => (
              <li key={key} className="lh-timeline-step" data-reveal>
                <span className="lh-timeline-num">
                  <Icon size={13} />
                </span>
                <div>
                  <h3 className="lh-step-title">{t(`product.assistant.${key}.t`)}</h3>
                  <p className="lh-step-body">{t(`product.assistant.${key}.d`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* the shared machinery: an index, like the landing's module rows */}
      <section className="lh-section">
        <div className="lh-section-head">
          <p className="lh-eyebrow">{t("product.shared.eyebrow")}</p>
          <h2 className="lh-title-md">{t("product.shared.title")}</h2>
        </div>
        <div className="lh-index">
          {SHARED.map(({ key, icon: Icon }, index) => (
            <article key={key} className="lh-row" data-reveal>
              <span className="lh-row-num">{String(index + 1).padStart(2, "0")}</span>
              <span className="lh-row-main">
                <span className="lh-row-name" style={{ fontSize: "clamp(1.25rem, 2vw, 1.7rem)" }}>
                  {t(`product.shared.${key}.t`)}
                </span>
                <span className="lh-row-question">{t(`product.shared.${key}.d`)}</span>
              </span>
              <span className="lh-row-arrow" aria-hidden="true">
                <Icon size={20} />
              </span>
            </article>
          ))}
        </div>
        <div data-reveal className="lh-cta-row" style={{ marginTop: "2.2rem" }}>
          {(["world", "flow", "exit", "fail", "clean"] as const).map((module) => (
            <Link key={module} to={`/${module}`} className="lh-underline-link">
              {module.toUpperCase()}
            </Link>
          ))}
          <Link to="/platform" className="lh-btn lh-btn-solid">
            {t("nav.platform")}
          </Link>
        </div>
      </section>
    </div>
  );
}
