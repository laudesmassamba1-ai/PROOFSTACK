/**
 * The engine's seismograph — a quiet strip beneath the hero.
 *
 * A stylus draws a line across the night, and the engine's findings tick past
 * it: small vertical marks in the status palette (pass = mint, warn = amber,
 * fail = red), spaced like events on a drum of paper. The line never stops,
 * but it is in no hurry — this is an instrument recording, not a progress bar.
 * Reduced motion renders a pre-inked strip, as if the drum had already turned.
 */
import { useEffect, useRef } from "react";

const COLORS: Record<string, string> = {
  pass: "120, 227, 203",
  warn: "245, 208, 111",
  fail: "240, 110, 110",
};

export function SeismoStrip({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    let x = 0;
    const events: Array<{ x: number; kind: string; amp: number }> = [];
    let raf = 0;
    let last = 0;
    let visible = true;
    const SPEED = 26; // px per second — one crossing takes ~55s at 1440

    const build = (): void => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (px: number): void => {
      const roll = Math.random();
      const kind = roll > 0.93 ? "fail" : roll > 0.82 ? "warn" : "pass";
      events.push({
        x: px,
        kind,
        amp:
          kind === "fail"
            ? h * 0.34
            : kind === "warn"
              ? h * 0.22
              : h * 0.1 + Math.random() * h * 0.14,
      });
    };

    const draw = (now: number): void => {
      const dt = Math.min(64, now - last);
      last = now;
      if (!reduced) x = (x + (dt / 1000) * SPEED) % w;
      ctx.clearRect(0, 0, w, h);
      const mid = h / 2;

      // the drum's ruled lines
      ctx.strokeStyle = "rgba(214, 226, 224, 0.07)";
      ctx.lineWidth = 1;
      for (const fy of [0.18, 0.82]) {
        ctx.beginPath();
        ctx.moveTo(0, h * fy);
        ctx.lineTo(w, h * fy);
        ctx.stroke();
      }

      // the tracing line: a quiet sine around the middle
      ctx.strokeStyle = "rgba(214, 226, 224, 0.32)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let px = 0; px <= w; px += 3) {
        const y =
          mid + Math.sin((px + x * 2.4) * 0.012) * h * 0.08 * Math.sin(px * 0.004 + x * 0.003);
        if (px === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();

      // events: drawn ahead of the stylus like a drum already inked
      if (events.length < 26) {
        for (let i = events.length; i < 26; i += 1) spawn(Math.random() * w);
      }
      for (const e of events) {
        const alpha = 0.55;
        ctx.strokeStyle = `rgba(${COLORS[e.kind]}, ${alpha})`;
        ctx.lineWidth = e.kind === "fail" ? 1.6 : 1.1;
        ctx.beginPath();
        ctx.moveTo(
          e.x,
          mid + Math.sin((e.x + x * 2.4) * 0.012) * h * 0.08 * Math.sin(e.x * 0.004 + x * 0.003)
        );
        ctx.lineTo(e.x, mid - e.amp);
        ctx.stroke();
      }

      // the stylus: a bright needle with a soft bloom
      if (!reduced) {
        const glow = ctx.createRadialGradient(x, mid, 0, x, mid, 26);
        glow.addColorStop(0, "rgba(120, 227, 203, 0.5)");
        glow.addColorStop(1, "rgba(120, 227, 203, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(x - 26, mid - 26, 52, 52);
        ctx.strokeStyle = "rgba(230, 248, 243, 0.9)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x, h * 0.94);
        ctx.lineTo(x, mid + 3);
        ctx.stroke();
      }

      if (visible && !reduced) raf = requestAnimationFrame(draw);
    };

    build();
    if (reduced) {
      for (let i = 0; i < 26; i += 1) spawn(Math.random() * w);
      draw(performance.now());
    } else {
      last = performance.now();
      raf = requestAnimationFrame(draw);
    }

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible && !reduced && !raf) {
          last = performance.now();
          raf = requestAnimationFrame(draw);
        }
      },
      { threshold: 0.02 }
    );
    io.observe(canvas);

    const onResize = (): void => {
      build();
      if (reduced) draw(performance.now());
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      tabIndex={-1}
      style={{ display: "block", width: "100%", height: "88px" }}
    />
  );
}
