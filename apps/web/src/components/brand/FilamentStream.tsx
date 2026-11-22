import { useEffect, useRef } from "react";

/**
 * The comparer's divider: a bundle of fine, non-straight filaments.
 *
 * A dozen hairline wires hang across the split, each wandering horizontally
 * with its own drift and phase — closer to a suspended electric arc than to a
 * rule. They are the product's own imagery: current, signal, the line a
 * verification run draws between pass and fail. A few bright sparks travel
 * along the wires. Reduced motion renders the bundle still.
 */
export function FilamentStream(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    let raf = 0;
    let width = 0;
    let height = 0;

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = width;
      canvas.height = height;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    interface Filament {
      base: number; // 0..1 across the bar
      amplitude: number; // fraction of width
      drift: number; // slow horizontal wander speed
      phase: number;
      segments: number;
      width: number;
      alpha: number;
      hue: readonly [string, string]; // core colour, bright colour
      sag: number; // resting curvature
    }

    const GOLD: readonly [string, string] = ["rgba(214,168,64,0.75)", "rgba(255,226,140,1)"];
    const PALE: readonly [string, string] = ["rgba(255,244,200,0.5)", "rgba(255,250,225,1)"];
    const MINT: readonly [string, string] = ["rgba(120,227,203,0.45)", "rgba(160,240,215,0.95)"];

    const filaments: Filament[] = [
      {
        base: 0.5,
        amplitude: 0.1,
        drift: 0.11,
        phase: 0.0,
        segments: 30,
        width: 0.9,
        alpha: 1,
        hue: GOLD,
        sag: 0,
      },
      {
        base: 0.44,
        amplitude: 0.16,
        drift: 0.07,
        phase: 1.3,
        segments: 26,
        width: 0.65,
        alpha: 0.8,
        hue: PALE,
        sag: 0.35,
      },
      {
        base: 0.57,
        amplitude: 0.15,
        drift: 0.09,
        phase: 2.6,
        segments: 26,
        width: 0.65,
        alpha: 0.6,
        hue: PALE,
        sag: -0.3,
      },
      {
        base: 0.48,
        amplitude: 0.22,
        drift: 0.05,
        phase: 4.1,
        segments: 22,
        width: 0.5,
        alpha: 0.55,
        hue: MINT,
        sag: 0.2,
      },
      {
        base: 0.53,
        amplitude: 0.2,
        drift: 0.06,
        phase: 5.2,
        segments: 22,
        width: 0.5,
        alpha: 0.5,
        hue: MINT,
        sag: -0.18,
      },
      {
        base: 0.5,
        amplitude: 0.3,
        drift: 0.035,
        phase: 3.1,
        segments: 18,
        width: 0.42,
        alpha: 0.45,
        hue: PALE,
        sag: 0.5,
      },
      {
        base: 0.5,
        amplitude: 0.26,
        drift: 0.045,
        phase: 0.7,
        segments: 18,
        width: 0.42,
        alpha: 0.4,
        hue: GOLD,
        sag: -0.42,
      },
      {
        base: 0.46,
        amplitude: 0.34,
        drift: 0.028,
        phase: 5.9,
        segments: 14,
        width: 0.38,
        alpha: 0.34,
        hue: PALE,
        sag: 0.15,
      },
      {
        base: 0.55,
        amplitude: 0.32,
        drift: 0.03,
        phase: 2.2,
        segments: 14,
        width: 0.38,
        alpha: 0.32,
        hue: GOLD,
        sag: -0.12,
      },
      {
        base: 0.5,
        amplitude: 0.38,
        drift: 0.02,
        phase: 4.8,
        segments: 12,
        width: 0.34,
        alpha: 0.28,
        hue: MINT,
        sag: 0,
      },
    ];

    interface Spark {
      filament: number;
      t: number; // 0..1 along the wire
      speed: number;
      life: number;
    }
    const sparks: Spark[] = [
      { filament: 0, t: 0.1, speed: 0.16, life: 1 },
      { filament: 2, t: 0.55, speed: -0.12, life: 0.7 },
      { filament: 4, t: 0.8, speed: 0.09, life: 0.5 },
    ];

    // one filament: a vertical polyline whose points wander with layered sines
    const drawFilament = (f: Filament, time: number): void => {
      const points: { x: number; y: number }[] = [];
      for (let s = 0; s <= f.segments; s++) {
        const v = s / f.segments;
        const y = v * height;
        const wander =
          Math.sin(v * Math.PI * 2 * (1 + f.segments * 0.04) + time * f.drift * 9 + f.phase) *
            f.amplitude +
          Math.sin(v * Math.PI * 3.7 + time * f.drift * 4 + f.phase * 2) * f.amplitude * 0.6 +
          f.sag * Math.sin(Math.PI * v) * f.amplitude;
        points.push({ x: f.base * width + wander * width, y });
      }
      // the wire brightens near the travelling spark
      const spark = sparks.find((sp) => sp.filament === filaments.indexOf(f) && sp.life > 0);
      const glowAt = spark ? spark.t : -1;

      ctx.beginPath();
      for (const [i, point] of points.entries()) {
        const prev = i > 0 ? points[i - 1] : undefined;
        if (!prev) ctx.moveTo(point.x, point.y);
        else {
          const mx = (prev.x + point.x) / 2 + (point.x - prev.x) * 0.2;
          const my = (prev.y + point.y) / 2;
          ctx.quadraticCurveTo(prev.x, my, point.x, point.y);
        }
      }
      ctx.strokeStyle = f.hue[0];
      ctx.lineWidth = f.width;
      ctx.globalAlpha = f.alpha;
      ctx.stroke();

      if (spark && glowAt >= 0) {
        const idx = Math.min(f.segments, Math.max(0, Math.round(glowAt * f.segments)));
        const p = points[idx];
        if (p) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, f.width * 3.2, 0, Math.PI * 2);
          ctx.fillStyle = f.hue[1];
          ctx.globalAlpha = 0.85 * spark.life;
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    let time = 0;

    const drawStill = (): void => {
      for (const f of filaments) drawFilament(f, 0);
    };

    const draw = (): void => {
      time += 0.016;
      ctx.clearRect(0, 0, width, height);

      // sparks travel and respawn
      for (const spark of sparks) {
        spark.t += spark.speed * 0.016 * 60 * 0.02;
        spark.life -= 0.0022;
        if (spark.life <= 0 || spark.t > 1 || spark.t < 0) {
          spark.t = spark.speed > 0 ? 0 : 1;
          spark.life = 0.5 + Math.random() * 0.6;
          spark.speed = (Math.random() > 0.5 ? 1 : -1) * (0.08 + Math.random() * 0.12);
          spark.filament = Math.floor(Math.random() * filaments.length);
        }
      }

      for (const f of filaments) drawFilament(f, time);
      raf = requestAnimationFrame(draw);
    };

    if (reduced) {
      drawStill();
      return () => observer.disconnect();
    }
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="da-bar-canvas" aria-hidden="true" />;
}
