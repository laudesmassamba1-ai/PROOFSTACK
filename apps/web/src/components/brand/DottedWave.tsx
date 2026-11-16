import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "../../lib/theme.js";

/**
 * The luminous dotted wave (reference A), rendered procedurally on a canvas.
 *
 * Why canvas instead of an image or thousands of DOM nodes: a single 2D canvas with
 * ~1.6k circles costs less than one large PNG and far less than 1.6k SVG nodes, and
 * it stays smooth on modest hardware because it draws at 30 fps, pauses when off
 * screen, and draws a single static frame when the visitor prefers reduced motion.
 */

interface DottedWaveProps {
  className?: string;
  /** Grid step in CSS pixels. Larger = fewer dots. */
  step?: number;
  /** 0..1 — how bright the band is. */
  intensity?: number;
  /** Sweep the band toward the right edge like the reference composition. */
  bias?: number;
}

interface Dot {
  x: number;
  y: number;
  r: number;
  a: number;
  hue: number;
  /** 1 for the few dots that get a halo; kept small so the frame stays cheap. */
  glow: number;
}

const MINT = [120, 227, 203];
const CYAN = [112, 201, 219];
const PALE = [220, 245, 227];

function mix(a: number[], b: number[], t: number): string {
  const r = Math.round(a[0]! + (b[0]! - a[0]!) * t);
  const g = Math.round(a[1]! + (b[1]! - a[1]!) * t);
  const bl = Math.round(a[2]! + (b[2]! - a[2]!) * t);
  return `rgb(${r} ${g} ${bl})`;
}

export function DottedWave({ className, step = 16, intensity = 1, bias = 0.62 }: DottedWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let phase = 0;
    let frame = 0;
    let lastDraw = 0;
    let visible = true;
    let raf = 0;
    let dots: Dot[] = [];

    const layout = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /**
     * The band is a vertical S-curve whose amplitude grows toward the right, where
     * the reference shows the dense luminous wall. Dot size and alpha fall off with
     * distance to the band, which is what gives the field its depth.
     */
    const build = (): void => {
      dots = [];
      const cols = Math.ceil(width / step);
      const rows = Math.ceil(height / step);
      for (let c = 0; c <= cols; c++) {
        const x = c * step;
        const nx = width === 0 ? 0 : x / width;
        // The band sweeps from a thin thread on the left to a luminous wall on the
        // right, which is what makes the reference read as motion rather than texture.
        const amplitude = height * (0.06 + 0.26 * nx ** 1.5);
        const centre =
          height * 0.5 +
          amplitude * Math.sin(nx * 3.4 + phase) -
          height * 0.16 * Math.sin(nx * 1.35 - phase * 0.45);
        const thickness = height * (0.035 + 0.13 * nx ** 2.2);

        for (let r = 0; r <= rows; r++) {
          const y = r * step;
          const distance = Math.abs(y - centre) / thickness;
          if (distance > 1) continue;
          const falloff = 1 - distance;
          const density = 0.22 + 0.78 * nx ** 2;
          const a = falloff ** 2.4 * density * intensity;
          if (a < 0.05) continue;
          dots.push({
            x,
            y: y + 3.5 * Math.sin(nx * 7 + r * 0.42 + phase) * falloff,
            r: 0.55 + 1.35 * falloff ** 1.4 * density,
            a: Math.min(1, a * 1.35),
            hue: Math.min(1, distance ** 1.2 * 0.7 + nx * 0.4),
            glow: falloff > 0.72 && nx > 0.55 ? 1 : 0,
          });
        }
      }
    };

    const paint = (): void => {
      context.clearRect(0, 0, width, height);
      for (const dot of dots) {
        const colour =
          dot.hue < 0.5 ? mix(CYAN, MINT, dot.hue * 2) : mix(MINT, PALE, (dot.hue - 0.5) * 2);
        if (dot.glow) {
          context.globalAlpha = dot.a * 0.16;
          context.fillStyle = colour;
          context.beginPath();
          context.arc(dot.x, dot.y, dot.r * 3.4, 0, Math.PI * 2);
          context.fill();
        }
        context.globalAlpha = dot.a;
        context.fillStyle = colour;
        context.beginPath();
        context.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
    };

    const tick = (time: number): void => {
      raf = requestAnimationFrame(tick);
      if (!visible) return;
      // 30 fps ceiling: the wave is ambience, not a benchmark.
      if (time - lastDraw < 33) return;
      lastDraw = time;
      frame++;
      phase = frame * 0.008;
      build();
      paint();
    };

    const start = (): void => {
      layout();
      build();
      paint();
      if (reduced) return; // one static frame
      raf = requestAnimationFrame(tick);
    };

    start();

    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
      },
      { threshold: 0.01 }
    );
    observer.observe(canvas);

    const onResize = (): void => {
      layout();
      build();
      paint();
    };
    window.addEventListener("resize", onResize, { passive: true });

    const onVisibility = (): void => {
      visible = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [bias, intensity, reduced, step]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" tabIndex={-1} />;
}
