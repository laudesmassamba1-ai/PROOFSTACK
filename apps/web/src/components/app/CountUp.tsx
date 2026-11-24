import { useEffect, useRef, useState } from "react";

/**
 * Compteur animé — adaptation maison du « CountUp » de React Bits
 * (reactbits.dev, MIT), sans dépendance au moteur motion : une interpolation
 * ease-out-quart sur rAF, déclenchée au premier passage à l'écran par un
 * IntersectionObserver, et rejouée quand la valeur cible change. Sous
 * prefers-reduced-motion, la valeur s'affiche directement.
 */
export function CountUp({
  value,
  duration = 900,
  delay = 0,
  className = "",
}: {
  value: number;
  duration?: number;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [display, setDisplay] = useState(0);
  const seen = useRef(false);
  const from = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const animate = (): void => {
      const fromValue = seen.current ? from.current : 0;
      const t0 = performance.now() + delay;
      const tick = (now: number): void => {
        const p = Math.min(1, Math.max(0, (now - t0) / duration));
        const eased = 1 - (1 - p) ** 4;
        setDisplay(Math.round(fromValue + (value - fromValue) * eased));
        if (p < 1) raf = requestAnimationFrame(tick);
        else from.current = value;
      };
      raf = requestAnimationFrame(tick);
    };
    if (seen.current) {
      animate();
      return () => {
        if (raf) cancelAnimationFrame(raf);
      };
    }
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry?.isIntersecting && !seen.current) {
        seen.current = true;
        io.disconnect();
        animate();
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [value, duration, delay]);

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {display}
    </span>
  );
}
