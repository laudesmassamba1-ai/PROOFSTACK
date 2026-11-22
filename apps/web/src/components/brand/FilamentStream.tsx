import { useEffect, useRef } from "react";

/**
 * The comparer's divider, drawn as liquid gold.
 *
 * A narrow canvas paints a vertical stream of molten gold — a gradient whose
 * highlight slides downward forever, seeded with small droplets that catch
 * light as they fall and respawn at the top. Pure rAF, no dependencies, and
 * reduced-motion renders a single still pour instead of a loop.
 */
export function GoldStream(): React.ReactElement {
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

    interface Drop {
      x: number;
      y: number;
      speed: number;
      size: number;
      wobble: number;
      phase: number;
      alpha: number;
    }
    const drops: Drop[] = Array.from({ length: 22 }, () => ({
      x: Math.random(),
      y: Math.random(),
      speed: 0.04 + Math.random() * 0.09,
      size: 0.8 + Math.random() * 1.8,
      wobble: 0.4 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.25 + Math.random() * 0.65,
    }));

    let time = 0;

    const drawStill = (): void => {
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#8a6a1f");
      gradient.addColorStop(0.35, "#f5d06f");
      gradient.addColorStop(0.55, "#fff3c4");
      gradient.addColorStop(0.8, "#d4a843");
      gradient.addColorStop(1, "#8a6a1f");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    };

    const draw = (): void => {
      time += 0.016;
      ctx.clearRect(0, 0, width, height);

      // the pour: a vertical gradient whose bright band slides downward
      const shift = (time * 0.55) % 1;
      const gradient = ctx.createLinearGradient(
        0,
        -height + shift * height * 2,
        0,
        height + shift * height * 2
      );
      gradient.addColorStop(0, "#7a5c18");
      gradient.addColorStop(0.28, "#e8c25a");
      gradient.addColorStop(0.42, "#fff3c4");
      gradient.addColorStop(0.58, "#ffd970");
      gradient.addColorStop(0.78, "#b8912f");
      gradient.addColorStop(1, "#6e5314");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // droplets catching the light as they fall
      for (const drop of drops) {
        drop.y += drop.speed * 0.016 * 60;
        if (drop.y > 1.02) {
          drop.y = -0.02;
          drop.x = Math.random();
          drop.speed = 0.04 + Math.random() * 0.09;
          drop.alpha = 0.25 + Math.random() * 0.65;
        }
        const x = drop.x * width + Math.sin(time * drop.wobble + drop.phase) * (width * 0.22);
        const y = drop.y * height;
        const r = drop.size;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 244, 200, ${drop.alpha})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${drop.alpha * 0.8})`;
        ctx.fill();
      }

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
