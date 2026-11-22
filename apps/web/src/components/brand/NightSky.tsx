/**
 * The dark art direction's sky — "the night the software ran".
 *
 * A slow field of stars behind the hero. Some stars are findings: they carry a
 * status color and pulse like a heartbeat. A constellation rises through them —
 * a path of nodes joined by lines that draw themselves once, climbing toward
 * the wordmark, one node per module. Every few seconds a shooting star crosses:
 * a check that passed while you were reading.
 *
 * Contemplative by design: drift is measured in pixels per second, not frames.
 * Reduced motion renders the finished sky — stars set, constellation drawn, no
 * shooting stars — because the night is the point, not the animation.
 */
import { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  r: number;
  depth: number;
  phase: number;
  speed: number;
  status?: "pass" | "warn" | "fail";
}

interface Node {
  x: number;
  y: number;
  status: "pass" | "warn" | "fail";
  label: number; // module index 0..4
}

const NODE_STATUS: Node["status"][] = ["pass", "pass", "warn", "fail", "pass"];
const STATUS_COLOR: Record<string, string> = {
  pass: "120, 227, 203",
  warn: "245, 208, 111",
  fail: "240, 110, 110",
};

/** A gentle upward path — the run climbing from first check to signed report. */
function constellationPath(w: number, h: number): Node[] {
  const pts: Array<[number, number]> = [
    [0.12, 0.78],
    [0.2, 0.6],
    [0.31, 0.68],
    [0.38, 0.46],
    [0.5, 0.55],
    [0.56, 0.32],
    [0.67, 0.42],
    [0.73, 0.24],
    [0.82, 0.34],
    [0.88, 0.16],
  ];
  return pts.map(([fx, fy], i) => ({
    x: fx * w,
    y: fy * h,
    status: NODE_STATUS[i % NODE_STATUS.length] ?? "pass",
    label: i,
  }));
}

export function NightSky({ className }: { className?: string }) {
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
    let stars: Star[] = [];
    let nodes: Node[] = [];
    let raf = 0;
    let visible = true;
    let last = 0;

    const build = (): void => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(210, Math.round((w * h) / 6800));
      stars = Array.from({ length: count }, () => {
        const depth = 0.25 + Math.random() * 0.75;
        const roll = Math.random();
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: (0.4 + Math.random() * 1.15) * depth,
          depth,
          phase: Math.random() * Math.PI * 2,
          speed: 0.12 + Math.random() * 0.3,
          status: roll > 0.94 ? "fail" : roll > 0.86 ? "warn" : roll > 0.6 ? "pass" : undefined,
        } as Star;
      });
      nodes = constellationPath(w, h);
    };

    const draw = (now: number): void => {
      const dt = Math.min(64, now - last);
      last = now;
      const t = now / 1000;
      ctx.clearRect(0, 0, w, h);

      // stars: twinkle is slow, drift slower
      for (const s of stars) {
        const tw = 0.55 + 0.45 * Math.sin(s.phase + t * s.speed);
        if (!reduced) {
          s.x -= s.speed * s.depth * dt * 0.0022;
          s.y -= s.speed * s.depth * dt * 0.0011;
          if (s.x < -4) s.x = w + 4;
          if (s.y < -4) s.y = h + 4;
        }
        const alpha = (0.16 + 0.5 * tw) * s.depth;
        if (s.status) {
          ctx.fillStyle = `rgba(${STATUS_COLOR[s.status]}, ${alpha * 0.9})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r + 0.35, 0, Math.PI * 2);
          ctx.fill();
          // a finding breathes: a halo that swells over ~4s
          const pulse = (Math.sin(t * 0.55 + s.phase) + 1) / 2;
          ctx.strokeStyle = `rgba(${STATUS_COLOR[s.status]}, ${0.22 * tw})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r + 2.5 + pulse * 3.5, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(214, 226, 224, ${alpha})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // constellation: lines draw once over ~2.2s, nodes ping as the line lands
      const drawProgress = reduced ? 1 : Math.min(1, (t - 1.1) / 2.2);
      if (drawProgress > 0) {
        ctx.lineJoin = "round";
        for (let i = 0; i < nodes.length - 1; i += 1) {
          const a = nodes[i];
          const b = nodes[i + 1];
          if (!a || !b) continue;
          const seg = i / (nodes.length - 1);
          if (drawProgress <= seg) break;
          const segT = Math.min(1, (drawProgress - seg) * (nodes.length - 1));
          ctx.strokeStyle = "rgba(214, 226, 224, 0.3)";
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(a.x + (b.x - a.x) * segT, a.y + (b.y - a.y) * segT);
          ctx.stroke();
        }
        for (let i = 0; i < nodes.length; i += 1) {
          const n = nodes[i];
          if (!n) break;
          if (drawProgress * (nodes.length - 1) < i - 1) break;
          const ping = reduced
            ? 0.5
            : Math.max(0, 1 - Math.max(0, drawProgress * (nodes.length - 1) - i) * 1.6);
          ctx.fillStyle = `rgba(${STATUS_COLOR[n.status]}, ${0.75 + 0.25 * ping})`;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 2.1 + ping * 2.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = `rgba(${STATUS_COLOR[n.status]}, ${0.35 * (1 - ping)})`;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 3 + ping * 7, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // shooting star: a check that passed, at most once every ~9s
      if (!reduced) {
        const cycle = (t % 9) / 9;
        if (cycle < 0.07) {
          const p = cycle / 0.07;
          const sx = w * (0.15 + 0.5 * Math.sin(t * 0.7));
          const sy = h * 0.3;
          const len = 90;
          const dx = Math.cos(-0.5) * len * p;
          const dy = Math.sin(0.32) * len * p;
          const x0 = sx + dx - Math.cos(-0.5) * len;
          const y0 = sy + dy - Math.sin(0.32) * len;
          const grad = ctx.createLinearGradient(x0, y0, sx + dx, sy + dy);
          grad.addColorStop(0, "rgba(120, 227, 203, 0)");
          grad.addColorStop(1, `rgba(214, 240, 235, ${0.75 * Math.sin(p * Math.PI)})`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(sx + dx, sy + dy);
          ctx.stroke();
        }
      }

      if (visible && !reduced) raf = requestAnimationFrame(draw);
    };

    build();
    if (reduced) {
      draw(1000);
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

    let resizeTimer = 0;
    const onResize = (): void => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        build();
        if (reduced) draw(1000);
      }, 180);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", onResize);
      window.clearTimeout(resizeTimer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}
