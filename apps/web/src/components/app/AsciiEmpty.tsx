import { useEffect, useRef } from "react";

/**
 * AsciiEmpty — état vide en ascii art.
 *
 * Le bonhomme fil de fer lisait « maquette ». Un panneau ascii raconte la même
 * chose dans la langue de la marque : la machine attend, le curseur clignote.
 * Le glyphe est dessiné une fois (pas d'animation lourde), seul un curseur
 * vermillon pulse en CSS ; prefers-reduced-motion fige le curseur.
 */

const FRAME = [
  "┌───────────────────────────┐",
  "│                           │",
  "│   ·  ·  ·     ·           │",
  "│        ░░░░░              │",
  "│   ·   ░█████░   ·   ·     │",
  "│       ░░░░░░░             │",
  "│                           │",
  "│   ·        ·        ·     │",
  "└───────────────────────────┘",
];

export function AsciiEmpty() {
  const ref = useRef<HTMLPreElement | null>(null);

  /* Un caractère sur sept respire très lentement : la trame n'est pas une image
     morte, elle attend. Fait en rAF à 4 Hz effectifs — presque gratuit. */
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 250) {
        last = now;
        frame += 1;
        const lines = FRAME.map((line, y) =>
          line
            .split("")
            .map((ch, x) => {
              if (ch === " " && (x * 7 + y * 13 + frame) % 23 === 0) return "·";
              return ch;
            })
            .join("")
        );
        node.textContent = lines.join("\n");
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="ascii-empty" aria-hidden="true">
      <pre ref={ref} className="ascii-empty-art">
        {FRAME.join("\n")}
      </pre>
      <span className="ascii-empty-cursor" />
    </div>
  );
}
