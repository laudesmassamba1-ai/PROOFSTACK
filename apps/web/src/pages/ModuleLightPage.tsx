import { CircleAlert, CircleCheck } from "lucide-react";
import { Link } from "react-router";
import { useI18n } from "../i18n/index.js";
import { CONTENT, CONTENT_FR, type ModuleName } from "./ModulePage.js";

/**
 * The paper edition of a module page: the checks become an editorial index,
 * the CLI sample becomes a document, the build status becomes a two-column
 * ledger. Same facts as the dark page, different bones.
 */
export function ModuleLightPage({ name }: { name: ModuleName }) {
  const { t, locale } = useI18n();
  const fr = locale === "fr";
  const content = (fr ? CONTENT_FR : CONTENT)[name];

  return (
    <div className="lh">
      <section className="lh-section" style={{ paddingBottom: 0 }}>
        <div className="lh-section-head">
          <p className="lh-eyebrow">
            {content.name.toUpperCase()} · {content.tag}
          </p>
          <h1 className="lh-hero-title" style={{ fontSize: "clamp(2.4rem, 4.6vw, 3.9rem)" }}>
            {content.headline}
          </h1>
          <p className="lh-lede">{content.lede}</p>
          <p className="lh-row-question" style={{ fontStyle: "italic", maxWidth: "52ch" }}>
            {t(`question.${name}` as never)}
          </p>
          <p className="lh-hero-cli">
            <code>{content.command}</code>
          </p>
        </div>
      </section>

      {/* what it actually checks: an index with hairlines */}
      <section className="lh-section">
        <div className="lh-section-head">
          <h2 className="lh-title-md">
            {fr ? "Pas une liste d’intentions" : "Not a checklist of intentions"}
          </h2>
        </div>
        <div className="lh-index">
          {content.checks.map((check, index) => (
            <article key={check.label} className="lh-row" data-reveal>
              <span className="lh-row-num">{String(index + 1).padStart(2, "0")}</span>
              <span className="lh-row-main">
                <span className="lh-row-name" style={{ fontSize: "clamp(1.15rem, 1.8vw, 1.5rem)" }}>
                  {check.label}
                </span>
                <span className="lh-row-question">{check.detail}</span>
              </span>
            </article>
          ))}
        </div>
      </section>

      {/* the sample and the ledger side by side */}
      <section className="lh-section lh-deeper">
        <div className="lh-ai-grid">
          <figure className="lh-doc" data-reveal>
            <figcaption className="lh-doc-head">
              <span>{fr ? "Sortie CLI" : "CLI output"}</span>
              <span>mono</span>
            </figcaption>
            <pre className="lh-doc-pre">
              <code>{content.sample}</code>
            </pre>
          </figure>
          <div>
            <h2 className="lh-title-md" style={{ fontSize: "1.6rem" }}>
              {fr ? "État de construction du module" : "Build status of this module"}
            </h2>
            <ul className="lh-ledger">
              {content.implemented.map((item) => (
                <li key={item} className="lh-ledger-line">
                  <CircleCheck size={16} className="text-[#15803d]" />
                  <span>{item}</span>
                </li>
              ))}
              {content.pending.map((item) => (
                <li key={item} className="lh-ledger-line">
                  <CircleAlert size={16} className="text-[#b45309]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="lh-cta-row" style={{ marginTop: "1.8rem" }}>
              {(["world", "flow", "exit", "fail", "clean"] as ModuleName[])
                .filter((other) => other !== name)
                .map((other) => (
                  <Link key={other} to={`/${other}`} className="lh-underline-link">
                    {other.toUpperCase()}
                  </Link>
                ))}
              <Link to="/pricing" className="lh-btn lh-btn-solid">
                {t("nav.pricing")}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
