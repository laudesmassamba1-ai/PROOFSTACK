/**
 * The paper edition's ornaments — drawn, not rendered.
 *
 * The light art direction treats its pages like a manuscript read in morning
 * light: an ink underline that the hand draws beneath the headline, a stamp
 * that lands on the report card like a notary's mark, a fleuron to close an
 * index entry. Everything is inline SVG so the strokes inherit the paper's
 * colors and draw themselves with stroke-dashoffset (static when motion is
 * reduced — the ink is already dry).
 */
import { useEffect, useRef, useState } from "react";

/** A hand-ruled underline beneath the serif headline, drawn once in indigo ink. */
export function InkUnderline({ className }: { className?: string }) {
  const ref = useRef<SVGPathElement | null>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (reduced) {
      setDrawn(true);
      return;
    }
    const id = window.setTimeout(() => setDrawn(true), 1350);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <svg
      className={className}
      viewBox="0 0 320 14"
      fill="none"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <path
        ref={ref}
        d="M4 9 C 60 4, 120 10, 168 6 S 268 9, 316 5"
        stroke="var(--lh-accent)"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity={0.85}
        style={{
          strokeDasharray: 330,
          strokeDashoffset: drawn ? 0 : 330,
          transition: "stroke-dashoffset 1.15s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
      {/* the pen pressed twice, like real ink */}
      <path
        d="M28 12 C 90 8, 150 12, 200 9"
        stroke="var(--lh-accent)"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity={0.35}
        style={{
          strokeDasharray: 190,
          strokeDashoffset: drawn ? 0 : 190,
          transition: "stroke-dashoffset 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.25s",
        }}
      />
    </svg>
  );
}

/**
 * The notary's stamp on the report card — CONFORME with the run's verdicts.
 * It lands after the card has risen: scale 1.5 → 1 with a fast settle, slight
 * rotation, ink that is not quite perfect (double ring, uneven alpha).
 */
export function Stamp({
  ok,
  skip,
  time,
  fr,
}: {
  ok: number;
  skip: number;
  time: string;
  fr: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (reduced) {
      setLanded(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          window.setTimeout(() => setLanded(true), 950);
          io.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`lh-stamp ${landed ? "is-landed" : ""}`}
      aria-label={
        fr
          ? `vérifié conforme — ${ok} vérifications réussies, ${skip} ignorées, à ${time}`
          : `verified — ${ok} checks passed, ${skip} skipped, at ${time}`
      }
      role="img"
    >
      <span className="lh-stamp-rule" aria-hidden="true" />
      <span className="lh-stamp-word">{fr ? "CONFORME" : "VERIFIED"}</span>
      <span className="lh-stamp-meta">
        {ok}/{ok + skip} · {time}
      </span>
      <span className="lh-stamp-rule" aria-hidden="true" />
    </div>
  );
}

/** A fleuron — the printer's flower that closes an editorial entry. */
export function Fleuron({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3 C 13.6 7, 17 10.4, 21 12 C 17 13.6, 13.6 17, 12 21 C 10.4 17, 7 13.6, 3 12 C 7 10.4, 10.4 7, 12 3 Z"
        stroke="var(--lh-accent)"
        strokeWidth="1.1"
        strokeLinejoin="round"
        opacity="0.8"
      />
      <circle cx="12" cy="12" r="1.6" fill="var(--lh-accent)" opacity="0.8" />
    </svg>
  );
}
