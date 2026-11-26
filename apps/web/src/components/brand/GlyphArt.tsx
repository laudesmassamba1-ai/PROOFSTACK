import { useEffect, useRef } from "react";

/**
 * ── Assets produit (nouvelle génération) ──────────────────────────────────
 * Deux instruments dessinés en glyphes ASCII, cohérents avec le héros :
 * `NameStrip` — les cinq noms de modules se forment caractère par caractère
 * dans une bande-noire ; `ModuleGlyph` — le sceau de chaque module rendu en
 * caractères sur une petite trame. Tout est canvas 2D local : aucun asset
 * bitmap, aucune bibliothèque, et le rendu est recouvert par une trame
 * statique sous prefers-reduced-motion.
 */

const REDUCED = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Appareil modeste ou petit écran : le canvas tourne, mais à l'économie —
 *  définition réduite et 8 images par seconde au lieu de 60. La trame ASCII
 *  scintille lentement : l'œil ne fait pas la différence, la puce si. */
const LITE = (): boolean =>
  typeof window !== "undefined" &&
  (window.matchMedia("(max-width: 767px)").matches || (navigator.hardwareConcurrency ?? 8) <= 4);

/** Boucle rAF gatée par IntersectionObserver — rien ne tourne hors écran. */
function useGlyphLoop(
  canvasRef: { current: HTMLCanvasElement | null },
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void
): void {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let visible = true;
    const lite = LITE();
    const fit = (): number => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      return dpr;
    };
    if (REDUCED()) {
      const dpr = fit();
      drawRef.current(ctx, canvas.width / dpr, canvas.height / dpr, 4.2);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0];
      visible = entry ? entry.isIntersecting : false;
      if (visible && !raf) tick();
    });
    io.observe(canvas);
    const t0 = performance.now();
    const tick = (): void => {
      raf = visible ? requestAnimationFrame(tick) : 0;
      if (!visible) return;
      const dpr = fit();
      drawRef.current(
        ctx,
        canvas.width / dpr,
        canvas.height / dpr,
        (performance.now() - t0) / 1000
      );
    };
    tick();
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [canvasRef.current]);
}

const GLYPHS = "▓▒░#*+=·";

/** Deux palettes : "dark" pour les surfaces noires du site, "ink" pour les
 *  feuilles papier de l'application. Le clignotement est vermillon dans les
 *  deux — l'indigo d'origine n'existe plus dans la DA. */
const GLYPH_TONES = {
  dark: {
    dim: "rgba(255,255,255,0.34)",
    bright: (alpha: number) => `rgba(255,255,255,${0.62 + 0.3 * (alpha / 255)})`,
    flickDim: "rgba(228,56,31,0.55)",
    flickBright: "rgba(228,56,31,0.9)",
  },
  ink: {
    dim: "rgba(10,10,11,0.3)",
    bright: (alpha: number) => `rgba(10,10,11,${0.55 + 0.35 * (alpha / 255)})`,
    flickDim: "rgba(228,56,31,0.5)",
    flickBright: "rgba(228,56,31,0.85)",
  },
} as const;

type GlyphTone = keyof typeof GLYPH_TONES;

const cell = (
  alpha: number,
  scramble: number,
  x: number,
  y: number,
  t: number,
  tone: GlyphTone = "dark"
): { ch: string | undefined; color: string | undefined } => {
  if (alpha < 40) return { ch: undefined, color: undefined };
  const palette = GLYPH_TONES[tone];
  const flick = scramble > 0 ? Math.floor((x * 31 + y * 17 + t * 11) % 9) % 4 === 0 : false;
  if (alpha < 120) {
    return {
      ch: scramble > 0.5 ? GLYPHS[(x * 7 + y * 13) % GLYPHS.length] : "·",
      color: flick ? palette.flickDim : palette.dim,
    };
  }
  const pick =
    scramble > 0.02
      ? GLYPHS[Math.floor((x * 11 + y * 29 + t * 13 + scramble * 7) % GLYPHS.length)]
      : "▓";
  return {
    ch: pick,
    color: flick && scramble > 0.5 ? palette.flickBright : palette.bright(alpha),
  };
};

/** Échantillonne un tracé vectoriel offscreen en grille de caractères.
 *  Le canvas de travail est un singleton réutilisé : le créer et le jeter à
 *  chaque image met le ramasse-miettes à genoux sur un téléphone modeste. */
let scratch: { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

function rasterize(
  w: number,
  h: number,
  step: number,
  paint: (c: CanvasRenderingContext2D) => void
): Uint8ClampedArray {
  if (!scratch) {
    const cv = document.createElement("canvas");
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return new Uint8ClampedArray(0);
    scratch = { cv, ctx };
  }
  const off = scratch.cv;
  const c = scratch.ctx;
  const cw = Math.ceil(w);
  const ch = Math.ceil(h);
  if (off.width !== cw || off.height !== ch) {
    off.width = cw;
    off.height = ch;
  } else {
    c.clearRect(0, 0, cw, ch);
  }
  c.strokeStyle = "#fff";
  c.fillStyle = "#fff";
  c.lineWidth = Math.max(2, step * 0.5);
  /* Les sceaux sont dessinés dans une boîte fixe de 200 unités : on l'ajuste
   * au canvas pour que le glyphe occupe la pièce, quelle que soit sa taille —
   * sinon le sceau flotte, minuscule, au coin d'une grande carte. */
  const fit = Math.min(w, h) / 224;
  c.translate((w - 200 * fit) / 2, (h - 200 * fit) / 2);
  c.scale(fit, fit);
  paint(c);
  return c.getImageData(0, 0, off.width, off.height).data;
}

function paintGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  data: Uint8ClampedArray,
  iw: number,
  step: number,
  t: number,
  scramble = 0,
  tone: GlyphTone = "dark"
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.font = `${step + 1}px ui-monospace, monospace`;
  ctx.textBaseline = "top";
  for (let gy = 0; gy + step <= h; gy += step) {
    for (let gx = 0; gx + step <= w; gx += step) {
      const px = Math.min(iw - 1, Math.round(gx + step / 2));
      const py = Math.min(iw - 1, Math.round(gy + step / 2));
      const idx = (py * iw + px) * 4;
      const a = data[idx + 3] ?? 0;
      if (a < 40) continue;
      const g = cell(a, scramble, gx / step, gy / step, t, tone);
      if (!g.ch || !g.color) continue;
      ctx.fillStyle = g.color;
      ctx.fillText(g.ch, gx, gy - step * 0.12);
    }
  }
}

/* ── Bande : les noms de modules se forment en glyphes ──────────────────── */

const NAMES = ["WORLD", "FLOW", "EXIT", "FAIL", "CLEAN"] as const;
const RESOLVE_AT = NAMES.map((_, i) => 0.9 + i * 0.55);

function nameLayout(w: number, _h: number): { font: number; total: number; gap: number } {
  const font = Math.max(18, Math.min(52, Math.floor(w / 26)));
  const gap = font * 0.9;
  return { font, total: 0, gap };
}

export function NameStrip({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useGlyphLoop(ref, (ctx, w, h, t) => {
    const loop = 6.4;
    const tt = t % loop;
    const { font, gap } = nameLayout(w, h);
    const step = Math.max(5, Math.round(font / 6.4));
    /* Le même canvas de travail que rasterize : créé une fois, réutilisé à
     * chaque image — l'allocation par image noierait le GC d'un vieux téléphone. */
    if (!scratch) {
      const cv = document.createElement("canvas");
      const sctx = cv.getContext("2d", { willReadFrequently: true });
      if (!sctx) return;
      scratch = { cv, ctx: sctx };
    }
    const off = scratch.cv;
    const oc = scratch.ctx;
    const cw = Math.ceil(w);
    const ch = Math.ceil(h);
    if (off.width !== cw || off.height !== ch) {
      off.width = cw;
      off.height = ch;
    } else {
      oc.clearRect(0, 0, cw, ch);
    }
    oc.font = `700 ${font}px ui-monospace, monospace`;
    oc.textBaseline = "middle";
    const widths = NAMES.map((n) => oc.measureText(n).width);
    const total = widths.reduce<number>((a, b) => a + b, 0) + gap * (NAMES.length - 1);
    const y = h / 2;
    let sx = (w - total) / 2;
    const data = (() => {
      NAMES.forEach((name, i) => {
        const resolve = RESOLVE_AT[i] ?? 0;
        const resolved = tt > resolve + 0.5;
        const scramble = Math.max(0, Math.min(1, (resolve - tt) / 0.45));
        oc.globalAlpha = resolved ? 0.92 : 0.35 + 0.4 * (1 - scramble);
        oc.fillStyle = "#fff";
        oc.fillText(name, sx, y);
        if (resolved && tt > resolve)
          oc.fillRect(sx, y + font * 0.42, widths[i] ?? 0, Math.max(1, step * 0.14));
        sx += (widths[i] ?? 0) + gap;
      });
      oc.globalAlpha = 1;
      const img = oc.getImageData(0, 0, cw, ch);
      return { data: img.data, iw: cw };
    })();
    paintGrid(ctx, w, h, data.data, data.iw, step, tt, 0.18);
  });
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/8 bg-[#050708] ${className}`}
    >
      {/* Decorative and unnamed: assistive tech has no content to announce here. */}
      <canvas ref={ref} className="block h-28 w-full sm:h-36" />
    </div>
  );
}

/* ── Sceaux de modules en glyphes ───────────────────────────────────────── */

export type GlyphKind = "world" | "flow" | "exit" | "fail" | "clean";

function sigil(kind: GlyphKind, t: number): (c: CanvasRenderingContext2D) => void {
  return (c) => {
    const s = 100;
    switch (kind) {
      case "world": {
        c.beginPath();
        c.arc(s, s, s * 0.52, 0, Math.PI * 2);
        c.stroke();
        c.beginPath();
        c.ellipse(s, s, s * 0.52, s * 0.2, 0, 0, Math.PI * 2);
        c.stroke();
        c.beginPath();
        c.moveTo(s, s * 0.48);
        c.lineTo(s, s * 1.52);
        c.stroke();
        c.save();
        c.setLineDash([5, 6]);
        c.beginPath();
        c.arc(s, s, s * 0.68, -0.4 + Math.sin(t * 0.7) * 0.2, 2.4 + Math.sin(t * 0.7) * 0.2);
        c.stroke();
        c.restore();
        break;
      }
      case "flow": {
        const drift = Math.sin(t * 1.1) * 3;
        for (let i = 0; i < 4; i += 1) {
          const x = s - s * 0.42 + i * s * 0.24 + (i % 2 === 0 ? drift : -drift);
          const y = s + s * 0.16 - i * s * 0.14;
          c.beginPath();
          c.ellipse(x, y, s * 0.19, s * 0.1, 0, 0, Math.PI * 2);
          c.stroke();
        }
        c.save();
        c.setLineDash([4, 7]);
        c.beginPath();
        c.moveTo(s * 0.28, s * 1.42);
        c.lineTo(s * 1.72, s * 1.42);
        c.stroke();
        c.restore();
        break;
      }
      case "exit": {
        const bob = Math.sin(t * 1.3) * 4;
        c.beginPath();
        c.moveTo(s, s * 0.5 + bob);
        c.lineTo(s * 1.42, s + bob);
        c.lineTo(s, s * 1.5 + bob);
        c.lineTo(s * 0.58, s + bob);
        c.closePath();
        c.stroke();
        c.save();
        c.setLineDash([4, 6]);
        c.beginPath();
        c.moveTo(s, s * 1.62);
        c.lineTo(s, s * 1.34);
        c.stroke();
        c.restore();
        break;
      }
      case "fail":
      case "clean": {
        const left = kind === "fail";
        c.beginPath();
        c.arc(s, s * 1.2, s * 0.56, Math.PI * 1.08, Math.PI * 1.92);
        c.stroke();
        const angle = left ? Math.PI * 1.78 : Math.PI * 1.22;
        c.beginPath();
        c.moveTo(s, s * 1.2);
        c.lineTo(s + Math.cos(angle) * s * 0.5, s * 1.2 + Math.sin(angle) * s * 0.5);
        c.stroke();
        c.beginPath();
        c.arc(
          s + Math.cos(angle) * s * 0.5,
          s * 1.2 + Math.sin(angle) * s * 0.5,
          Math.max(2, s * 0.045),
          0,
          Math.PI * 2
        );
        c.fill();
        break;
      }
    }
  };
}

/** Cache des trames alpha quantifiées à 20 Hz — dix entrées, éviction FIFO. */
const rasterCache = new Map<string, { data: Uint8ClampedArray; iw: number }>();

export function ModuleGlyph({
  kind,
  tone = "dark",
  className = "",
}: {
  kind: GlyphKind;
  /** "dark" pour une surface noire, "ink" pour une feuille papier. */
  tone?: GlyphTone;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useGlyphLoop(ref, (ctx, w, h, t) => {
    const step = Math.max(4, Math.round(Math.min(w, h) / 36));
    /* La géométrie du sceau bouge lentement : on la quantifie à 20 Hz et on
     * met la trame alpha en cache. À 60 images par seconde, l'échantillonnage
     * vectoriel ne repasse qu'un cycle sur deux — le reste du temps, on
     * repeint seulement les caractères avec le vrai t pour le scintillement. */
    const tq = Math.round(t * 20) / 20;
    const key = `${kind}|${Math.ceil(w)}x${Math.ceil(h)}|${step}|${tq}`;
    let hit = rasterCache.get(key);
    if (!hit) {
      hit = { data: rasterize(w, h, step, sigil(kind, tq)), iw: Math.ceil(w) };
      rasterCache.set(key, hit);
      if (rasterCache.size > 10) {
        const oldest = rasterCache.keys().next().value;
        if (oldest !== undefined) rasterCache.delete(oldest);
      }
    }
    paintGrid(ctx, w, h, hit.data, hit.iw, step, t, 0.06, tone);
  });
  return <canvas ref={ref} className={`block h-full w-full ${className}`} />;
}
