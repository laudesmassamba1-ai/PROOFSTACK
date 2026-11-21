import { useEffect, useState } from "react";
import { type MessageKey, useI18n } from "../../i18n/index.js";
import { useReveal } from "../../lib/useReveal.js";

/**
 * Quiet stats strip under the hero. Every number is a structural fact the site
 * already states elsewhere — five modules, three commands from init to report,
 * the eleven shared entities behind the engine, four report formats — so the
 * strip adds no new claim, it just counts them up once when it first enters
 * the viewport.
 *
 * The count-up is a plain linear requestAnimationFrame loop (no easing
 * excess), triggered by the reveal hook's `inView`, and it is skipped entirely
 * under prefers-reduced-motion: the final value renders statically.
 */
const STATS: { value: number; label: MessageKey; note: string }[] = [
  { value: 5, label: "home.stats.modules", note: "WORLD · FLOW · EXIT · FAIL · CLEAN" },
  { value: 3, label: "home.stats.commands", note: "init → test → report" },
  { value: 11, label: "home.stats.entities", note: "project · run · finding · report…" },
  { value: 4, label: "home.stats.formats", note: "text · JSON · JUnit · HTML" },
];

function Stat({
  value,
  label,
  note,
  active,
}: {
  value: number;
  label: MessageKey;
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
    // Spring-eased count-up, not linear: the value arrives fast, overshoots a
    // fraction and settles — the number feels weighed, not clocked.
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / 1100);
      const eased = 1 - 2 ** (-11 * t) * Math.cos((t * Math.PI) / 0.9);
      setDisplay(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, value]);

  return (
    <div className="stat-strip-item">
      <p className="stat-strip-value">{display}</p>
      <p className="stat-strip-label">{t(label)}</p>
      <p className="stat-strip-note">{note}</p>
    </div>
  );
}

export function StatStrip({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const { ref, inView } = useReveal<HTMLDivElement>({ threshold: 0.35 });

  return (
    <section aria-label={t("home.stats.label")} className="mx-auto max-w-[1240px] px-5 lg:px-8">
      <div ref={ref} className={`stat-strip reveal ${className}`}>
        {STATS.map((stat) => (
          <Stat key={stat.label} {...stat} active={inView} />
        ))}
      </div>
    </section>
  );
}
