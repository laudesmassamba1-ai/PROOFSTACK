import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { SplitChars } from "../components/brand/SplitChars.js";
import { useI18n } from "../i18n/index.js";
import { useReveal } from "../lib/useReveal.js";

/**
 * The light art direction's landing — "the paper edition".
 *
 * A genuinely different composition, not a re-skin: Instrument Serif speaks
 * (sentence case, italic accents in indigo), Instrument Sans carries the text,
 * the modules are an editorial index instead of a dark wall, the AI audit is a
 * document instead of a terminal, and the journey is a numbered path. Motion
 * runs letter by letter and in continuous bands (marquee), against the dark
 * identity's spring-and-mask vocabulary.
 *
 * Every fact is reused from the shared i18n keys — the two identities sell the
 * same product, they just speak it differently.
 */

const MODULES = [
  { id: "world", tokens: "locale · RTL · currency · date-format" },
  { id: "flow", tokens: "checkout · retry · timeout · webhook" },
  { id: "exit", tokens: "export · round-trip · schema · checksum" },
  { id: "fail", tokens: "headers · cookies · csp · disclosure" },
  { id: "clean", tokens: "headings · alt-text · labels · viewport" },
] as const;

const STATS = [
  { value: 5, key: "home.stats.modules", note: "WORLD · FLOW · EXIT · FAIL · CLEAN" },
  { value: 3, key: "home.stats.commands", note: "init → test → report" },
  { value: 11, key: "home.stats.entities", note: "project · run · finding · report…" },
  { value: 4, key: "home.stats.formats", note: "text · JSON · JUnit · HTML" },
] as const;

const RUNS = [
  { module: "WORLD", passed: 12, failed: 1 },
  { module: "FLOW", passed: 8, failed: 2 },
  { module: "EXIT", passed: 9, failed: 0 },
] as const;

/** Serif count-up: springs like the dark strip, but the figure is typographic. */
function Stat({
  value,
  label,
  note,
  active,
}: {
  value: number;
  label: string;
  note: string;
  active: boolean;
}) {
  const { t } = useI18n();
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      const p = Math.min(1, (now - start) / 1200);
      setDisplay(Math.round(value * (1 - 2 ** (-11 * p) * Math.cos((p * Math.PI) / 0.9))));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, value]);
  return (
    <div className="lh-stat">
      <p className="lh-stat-value">{display}</p>
      <p className="lh-stat-label">{t(label as never)}</p>
      <p className="lh-stat-note">{note}</p>
    </div>
  );
}

export function HomeLight() {
  const { t, locale } = useI18n();
  const fr = locale === "fr";
  const hero = useReveal<HTMLDivElement>();
  const heroRef = hero.ref;
  const heroIn = hero.inView;
  const stats = useReveal<HTMLDivElement>();
  const statsRef = stats.ref;
  const statsIn = stats.inView;
  const progressRef = useRef<HTMLDivElement | null>(null);

  // Scroll progress: a 2px indigo line under the nav, scaleX only.
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true) {
      if (progressRef.current) progressRef.current.style.display = "none";
      return;
    }
    let raf = 0;
    const update = (): void => {
      raf = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      if (progressRef.current) {
        progressRef.current.style.transform = `scaleX(${progress})`;
      }
    };
    const onScroll = (): void => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="lh">
      <div ref={progressRef} className="lh-progress" aria-hidden="true" />

      {/* ---------- hero ---------- */}
      <section className="lh-hero">
        <div ref={heroRef} className={`lh-hero-grid ${heroIn ? "is-in" : ""}`}>
          <div className="lh-hero-copy">
            <p className="lh-eyebrow">{t("hero.eyebrow")}</p>
            <h1 className="lh-hero-title">
              <SplitChars text={t("hero.title.pre")} />{" "}
              <em className="lh-hero-accent">
                <SplitChars
                  text={t("hero.title.accent")}
                  from={(t("hero.title.pre") || "").length + 1}
                />
              </em>
            </h1>
            <p className="lh-lede">{t("hero.lede")}</p>
            <div className="lh-cta-row">
              <Link to="/signup" className="lh-btn lh-btn-solid" data-magnet>
                {t("hero.cta.primary")} <ArrowRight size={15} />
              </Link>
              <Link to="/download" className="lh-underline-link" data-magnet>
                {t("hero.cta.download")}
              </Link>
            </div>
            <p className="lh-hero-cli">
              <code>{t("hero.cli")}</code>
            </p>
          </div>

          <div className="lh-hero-proof" data-tilt>
            <div className="lh-proof-head">
              <span className="lh-proof-dot" />
              proofcore test — {fr ? "extrait du rapport" : "report extract"}
            </div>
            <div className="lh-proof-body">
              {RUNS.map((run) => (
                <div key={run.module} className="lh-proof-line">
                  <span className="lh-proof-module">{run.module}</span>
                  <span className="lh-proof-bar" aria-hidden="true">
                    <i
                      style={{
                        width: `${Math.round((run.passed / (run.passed + run.failed)) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="lh-proof-count">
                    {run.passed} {fr ? "réussis" : "passed"} · {run.failed}{" "}
                    {fr ? "échoués" : "failed"}
                  </span>
                </div>
              ))}
              <div className="lh-proof-total">
                <span>29 {fr ? "réussis" : "passed"}</span>
                <span>3 {fr ? "échoués" : "failed"}</span>
                <span>00:18.42</span>
              </div>
            </div>
            <p className="lh-proof-foot">
              {fr ? "Exemple enregistré — pas un appel live" : "Recorded example — not a live call"}
            </p>
          </div>
        </div>
      </section>

      {/* ---------- marquee ---------- */}
      <div className="lh-marquee" aria-hidden="true">
        <div className="lh-marquee-track">
          {[0, 1].map((copy) => (
            <div key={copy} className="lh-marquee-run">
              {["WORLD", "FLOW", "EXIT", "FAIL", "CLEAN"].map((module) => (
                <span key={`${copy}-${module}`} className="lh-marquee-item">
                  {module} <i>·</i>
                </span>
              ))}
              {["json", "junit xml", "html", "cli text"].map((format) => (
                <span key={`${copy}-f-${format}`} className="lh-marquee-item lh-marquee-mono">
                  {format} <i>·</i>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ---------- modules: editorial index ---------- */}
      <section className="lh-section">
        <div className="lh-section-head">
          <p className="lh-eyebrow">{t("home.modules.eyebrow")}</p>
          <h2 className="lh-title-md">{t("home.modules.title")}</h2>
        </div>
        <div className="lh-index">
          {MODULES.map((module, index) => (
            <Link key={module.id} to={`/${module.id}`} className="lh-row" data-reveal>
              <span className="lh-row-num">{String(index + 1).padStart(2, "0")}</span>
              <span className="lh-row-main">
                <span className="lh-row-name">{t(`modules.${module.id}.name` as never)}</span>
                <span className="lh-row-tag"> — {t(`modules.${module.id}.tag` as never)}</span>
                <span className="lh-row-question">{t(`question.${module.id}` as never)}</span>
                <span className="lh-row-tokens">{module.tokens}</span>
              </span>
              <span className="lh-row-arrow" aria-hidden="true">
                <ArrowUpRight size={18} />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- AI reading: a document, not a terminal ---------- */}
      <section className="lh-section lh-deeper">
        <div className="lh-ai-grid">
          <div className="lh-ai-copy">
            <p className="lh-eyebrow">{t("home.ai.eyebrow")}</p>
            <h2 className="lh-title-md">{t("home.ai.title")}</h2>
            <p className="lh-lede">{t("home.ai.lede")}</p>
            <div className="lh-cta-row">
              <Link to="/signup" className="lh-btn lh-btn-solid">
                {t("home.ai.cta")}
              </Link>
              <Link to="/docs" className="lh-underline-link">
                {t("home.ai.docs")}
              </Link>
            </div>
          </div>
          <div className="lh-ai-side">
            <ol className="lh-timeline">
              {(["1", "2", "3"] as const).map((index) => (
                <li key={index} className="lh-timeline-step" data-reveal>
                  <span className="lh-timeline-num">{index}</span>
                  <div>
                    <h3 className="lh-step-title">{t(`home.ai.point.${index}.t` as never)}</h3>
                    <p className="lh-step-body">{t(`home.ai.point.${index}.d` as never)}</p>
                  </div>
                </li>
              ))}
            </ol>
            <figure className="lh-doc" data-reveal>
              <figcaption className="lh-doc-head">
                <span className="lh-doc-badge">
                  <Check size={11} />
                  {fr ? "audit enregistré" : "recorded audit"}
                </span>
                <span>{t("home.ai.sample.effort")}</span>
              </figcaption>
              <div className="lh-doc-body">
                <p className="lh-doc-title">{t("home.ai.sample.title")}</p>
                <p className="lh-doc-verdict">{t("home.ai.sample.verdict")}</p>
                <ul className="lh-doc-list">
                  {(["i1", "i2", "i3"] as const).map((key) => (
                    <li key={key}>{t(`home.ai.sample.${key}` as never)}</li>
                  ))}
                </ul>
                <p className="lh-doc-fix">
                  <Check size={13} /> {t("home.ai.sample.fix")}
                </p>
              </div>
            </figure>
          </div>
        </div>
      </section>

      {/* ---------- stats ---------- */}
      <section className="lh-stats" ref={statsRef}>
        {STATS.map((stat) => (
          <Stat
            key={stat.key}
            value={stat.value}
            label={stat.key}
            note={stat.note}
            active={statsIn}
          />
        ))}
      </section>

      {/* ---------- workflow: a numbered path ---------- */}
      <section className="lh-section">
        <div className="lh-section-head">
          <p className="lh-eyebrow">{t("home.workflow.eyebrow")}</p>
          <h2 className="lh-title-md">{t("home.workflow.title")}</h2>
        </div>
        <ol className="lh-path">
          {(["1", "2", "3"] as const).map((step) => (
            <li key={step} className="lh-path-step" data-reveal>
              <span className="lh-path-num">{step}</span>
              <h3 className="lh-step-title">{t(`home.workflow.${step}.title` as never)}</h3>
              <p className="lh-step-body">{t(`home.workflow.${step}.body` as never)}</p>
            </li>
          ))}
        </ol>
        <div className="lh-cta-row lh-cta-center">
          <Link to="/docs" className="lh-btn lh-btn-solid">
            {t("hero.cta.docs")} <ArrowRight size={15} />
          </Link>
          <Link to="/pricing" className="lh-underline-link">
            {t("nav.pricing")}
          </Link>
        </div>
      </section>
    </div>
  );
}
