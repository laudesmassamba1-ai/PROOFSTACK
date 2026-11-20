import type React from "react";
import { useI18n } from "../../i18n/index.js";
import { useReveal } from "../../lib/useReveal.js";

/**
 * The hero's product artifact: a compact, stylized proofcore report card.
 *
 * It is pure CSS/HTML — no images, no fake screenshot — and it stays honest the
 * same way the CLI preview does: the bar carries the label "example run · not a
 * live execution" as part of the UI, not a footnote. The finding mirrors the
 * real report language (expected vs received value, exact reproduction
 * command) and the CLEAN score is the module's own 0–100 scale.
 *
 * Motion: the card rises once on load, then the lines appear one after another
 * (staggered with the `--d` custom property, driven by `.reveal`/`.is-in`),
 * the status dot breathes, and the score bar fills. All of it is CSS-owned, so
 * the global prefers-reduced-motion reset ends every animation instantly.
 */

function Line({
  children,
  className = "",
  delay,
}: {
  children: React.ReactNode;
  className?: string;
  delay: string;
}) {
  return (
    <p className={`run-line ${className}`} style={{ "--d": delay } as React.CSSProperties}>
      {children}
    </p>
  );
}

export function RunArtifact({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const { ref } = useReveal<HTMLDivElement>({ threshold: 0.2 });

  return (
    <div ref={ref} className={`terminal-preview terminal-grid run-artifact reveal ${className}`}>
      <div className="terminal-preview-bar flex items-center gap-2.5 px-4 py-3">
        <span className="run-dot" aria-hidden="true" />
        <span className="whitespace-nowrap font-mono text-[0.64rem] tracking-[0.12em] text-white/55">
          {t("hero.artifact.title")}
        </span>
        <span className="run-artifact-tag ml-auto truncate">{t("hero.artifact.note")}</span>
      </div>

      <div className="run-lines px-4 py-4 sm:px-5">
        <Line delay="80ms">
          <span className="text-white/30">$ </span>
          <span className="text-brand-mint">proofcore test --module world,exit</span>
        </Line>

        <Line delay="260ms" className="text-white/38">
          PROOFCORE · run #4f2a-91c · local execution
        </Line>

        <Line delay="460ms">
          <span className="font-semibold text-brand-emerald">[PASS]</span>{" "}
          <span className="text-white/70">WORLD · currency formats</span>{" "}
          <span className="text-white/38">— 12/12 cases</span>
        </Line>

        <Line delay="680ms">
          <span className="module-fail module-accent-text font-semibold">[FAIL]</span>{" "}
          <span className="text-white/70">EXIT · export round trip</span>{" "}
          <span className="text-white/38">— case exit-014</span>
        </Line>

        <Line delay="860ms" className="run-line-detail">
          expected <span className="text-white/70">"12,00&nbsp;€"</span> · received{" "}
          <span className="module-fail module-accent-text">"12.00&nbsp;€"</span>
        </Line>

        <Line delay="1000ms" className="run-line-detail">
          <span className="text-white/38">fix:</span>{" "}
          <span className="text-white/62">proofcore report --case exit-014</span>
        </Line>

        <div className="run-line run-score" style={{ "--d": "1180ms" } as React.CSSProperties}>
          <span className="font-mono text-[0.66rem] tracking-[0.14em] text-white/55">CLEAN</span>
          <span className="run-score-bar" aria-hidden="true">
            <span className="run-score-fill" />
          </span>
          <span className="run-score-num">87/100</span>
        </div>
      </div>
    </div>
  );
}
