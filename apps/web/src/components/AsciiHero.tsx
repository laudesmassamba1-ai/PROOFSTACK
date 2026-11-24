import { ArrowRight } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { Link } from "react-router";
import { useI18n } from "../i18n/index.js";
import { TechText } from "./brand/TechText.js";

/**
 * AsciiHero — le héros « personal website » : la photo est redessinée par une
 * grille de glyphes Canvas2D (pipeline complet de l'effet 21st.dev, porté en
 * React). Les cellules échantillonnent la photo, les glyphes la redessinent en
 * color-dodge au-dessus du fond voilé, l'onde scintille en boucle.
 *
 * Le pipeline : fond (bgMode/bgBlur/bgOpacity) → échantillonnage par cellule
 * → rendu par mode → réglages couleur → teinte → flou → post-effets → lumières
 * → masque → animation (style/vitesse/intensité).
 * `prefers-reduced-motion` : une trame statique, pas de boucle.
 */

export type PfxKey =
  | "vignette"
  | "scanLines"
  | "chromatic"
  | "bloom"
  | "filmGrain"
  | "glitch"
  | "pixelate"
  | "halftone"
  | "filmDust";

export type AsciiHeroParams = {
  renderMode: string;
  bgMode: "original" | "blur" | "solid" | "none";
  bgBlur: number;
  bgOpacity: number;
  cellSize: number;
  coverage: number;
  invert: boolean;
  styleBlend: GlobalCompositeOperation;
  charSet: string;
  customChars: string;
  brightness: number;
  contrast: number;
  edgeEmphasis: number;
  density: number;
  tint: string;
  tintOpacity: number;
  overlayBlend: GlobalCompositeOperation;
  saturation: number;
  grayscale: number;
  blurType: "off" | "gaussian" | "directional";
  blurAmount: number;
  blurAngle: number;
  pfx: Record<PfxKey, { enabled: boolean; intensity: number }>;
  animated: boolean;
  animStyle: "shimmer" | "wave" | "pulse" | "ripple" | "flicker";
  animSpeed: { enabled: boolean; intensity: number };
  animIntensity: { enabled: boolean; intensity: number };
  lights: { enabled: boolean; points: { x: number; y: number; r: number; i: number }[] };
  mask: { enabled: boolean; invert: boolean; dataUrl: string | null };
};

const IMG_SRC = "/hero/nature-wave.webp";

/** Les réglages de l'effet d'origine (21st.dev, hero personal website). */
export const ASCII_HERO_PARAMS: AsciiHeroParams = {
  renderMode: "characters",
  bgMode: "original",
  bgBlur: 12,
  bgOpacity: 30,
  cellSize: 9,
  coverage: 37,
  invert: false,
  styleBlend: "color-dodge",
  charSet: "standard",
  customChars: "",
  brightness: 0,
  contrast: 158,
  edgeEmphasis: 0,
  density: 20,
  tint: "#3ca6ff",
  tintOpacity: 0,
  overlayBlend: "multiply",
  saturation: 100,
  grayscale: 0,
  blurType: "off",
  blurAmount: 35,
  blurAngle: 0,
  pfx: {
    vignette: { enabled: false, intensity: 38 },
    scanLines: { enabled: false, intensity: 40 },
    chromatic: { enabled: false, intensity: 15 },
    bloom: { enabled: false, intensity: 25 },
    filmGrain: { enabled: false, intensity: 30 },
    glitch: { enabled: false, intensity: 20 },
    pixelate: { enabled: false, intensity: 15 },
    halftone: { enabled: false, intensity: 20 },
    filmDust: { enabled: false, intensity: 20 },
  },
  animated: true,
  animStyle: "shimmer",
  animSpeed: { enabled: true, intensity: 100 },
  animIntensity: { enabled: true, intensity: 60 },
  lights: { enabled: false, points: [] },
  mask: { enabled: false, invert: false, dataUrl: null },
};

const RAMP_STANDARD = " .`'\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
const CHARSETS: Record<string, string> = {
  standard: RAMP_STANDARD,
  minimal: " .:*#",
  blocks: " ░▒▓█",
  binary: " .01",
};

const clamp01 = (v: number): number => (v < 0 ? 0 : Math.min(v, 1));
const hash = (n: number): number => {
  const s = Math.sin(n) * 43758.5453123;
  return s - Math.floor(s);
};

type Bucket = { size: number; list: number[]; colors: string[] };
type Sample = {
  cols: number;
  rows: number;
  cells: Float32Array; // lum, r, g, b, edge, jitter — 6 par cellule
  fast: Bucket[]; // chemin rapide « characters », groupé par taille de police
};

function animFactor(
  p: AsciiHeroParams,
  x: number,
  y: number,
  t: number,
  seed: number,
  cols: number,
  rows: number,
  reduceMotion: boolean
): number {
  if (!p.animated || reduceMotion) return 1;
  const speed = p.animSpeed.enabled ? p.animSpeed.intensity / 100 : 0;
  const amp = p.animIntensity.enabled ? p.animIntensity.intensity / 100 : 0;
  if (!speed || !amp) return 1;
  let a: number;
  switch (p.animStyle) {
    case "wave":
      a = 0.5 + 0.5 * Math.sin(x * 0.11 + y * 0.07 - t * speed * 3);
      break;
    case "pulse":
      a = 0.5 + 0.5 * Math.sin(t * speed * 4 + (x + y) * 0.02);
      break;
    case "ripple": {
      const d = Math.hypot(x - cols / 2, y - rows / 2);
      a = 0.5 + 0.5 * Math.sin(d * 0.16 - t * speed * 5);
      break;
    }
    case "flicker":
      a = hash(seed * 911 + Math.floor(t * speed * 8));
      break;
    default: // shimmer
      a = 0.5 + 0.5 * Math.sin(t * speed * 6 + seed * Math.PI * 2);
  }
  return 1 - amp * a;
}

function drawCharacters(
  ctx: CanvasRenderingContext2D,
  p: AsciiHeroParams,
  s: Sample,
  t: number
): void {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cov = p.coverage / 100;
  const ramp = p.customChars || CHARSETS[p.charSet] || RAMP_STANDARD;
  const levels = Math.max(2, Math.min(ramp.length, Math.round(p.density) + 2));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const bucket of s.fast) {
    ctx.font = `${bucket.size.toFixed(1)}px ui-monospace, "JetBrains Mono", monospace`;
    let lastColor = "";
    const list = bucket.list;
    for (let i = 0; i < list.length; i += 4) {
      const x = list[i] ?? 0;
      const y = list[i + 1] ?? 0;
      const colorStr = bucket.colors[i / 4] ?? "#fff";
      const seed = list[i + 3] ?? 0;
      const gx = Math.floor(x / p.cellSize);
      const gy = Math.floor(y / p.cellSize);
      const lum = s.cells[(gy * s.cols + gx) * 6] ?? 0;
      if (lum < 1 - cov - 0.08 * hash(seed * 53)) continue;
      ctx.globalAlpha = animFactor(p, gx, gy, t, seed, s.cols, s.rows, reduceMotion);
      if (colorStr !== lastColor) {
        ctx.fillStyle = colorStr;
        lastColor = colorStr;
      }
      const l = clamp01(lum);
      ctx.fillText(ramp[Math.min(levels - 1, Math.floor(l * levels))] || " ", x, y);
    }
  }
  ctx.globalAlpha = 1;
}

function drawMode(
  ctx: CanvasRenderingContext2D,
  p: AsciiHeroParams,
  s: Sample,
  t: number,
  cov: number
): void {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const { cols, rows, cells } = s;
  const sz = p.cellSize;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const o = (y * cols + x) * 6;
      const seed = cells[o + 5] ?? 0;
      const l0 = cells[o] ?? 0;
      if (l0 < 1 - cov - 0.08 * hash(seed * 53)) continue;
      const anim = animFactor(p, x, y, t, seed, cols, rows, reduceMotion);
      const l = clamp01(l0 * (0.35 + 0.65 * anim) + (1 - anim) * 0.15);
      const r = (cells[o + 1] ?? 0) * 255;
      const g = (cells[o + 2] ?? 0) * 255;
      const b = (cells[o + 3] ?? 0) * 255;
      const a = 0.3 + 0.7 * l;
      const col = `rgba(${r | 0},${g | 0},${b | 0},${a.toFixed(3)})`;
      const cx = x * sz + sz / 2;
      const cy = y * sz + sz / 2;
      switch (p.renderMode) {
        case "dots":
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(cx, cy, sz * 0.48 * (0.2 + 0.8 * l), 0, 7);
          ctx.fill();
          break;
        case "mosaic":
        case "pixel":
          ctx.fillStyle = col;
          ctx.fillRect(x * sz, y * sz, sz, sz);
          break;
        case "cross": {
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(1, sz * 0.12);
          const len = sz * (0.3 + 0.65 * l);
          ctx.beginPath();
          ctx.moveTo(cx - len / 2, cy);
          ctx.lineTo(cx + len / 2, cy);
          ctx.moveTo(cx, cy - len / 2);
          ctx.lineTo(cx, cy + len / 2);
          ctx.stroke();
          break;
        }
        case "diamond": {
          const d = sz * (0.25 + 0.35 * l);
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(cx, cy - d);
          ctx.lineTo(cx + d, cy);
          ctx.lineTo(cx, cy + d);
          ctx.lineTo(cx - d, cy);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case "voxel": {
          const d = sz * (0.3 + 0.55 * l);
          ctx.fillStyle = col;
          ctx.fillRect(cx - d / 2, cy - d / 2, d, d);
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillRect(cx - d / 2, cy + d / 2 - d * 0.2, d, d * 0.2);
          ctx.fillStyle = "rgba(255,255,255,0.18)";
          ctx.fillRect(cx - d / 2, cy - d / 2, d, d * 0.15);
          break;
        }
        case "lego":
          ctx.fillStyle = col;
          ctx.fillRect(x * sz + 1, y * sz + 1, sz - 2, sz - 2);
          ctx.fillStyle = "rgba(255,255,255,0.22)";
          ctx.beginPath();
          ctx.arc(cx, cy, sz * 0.22, 0, 7);
          ctx.fill();
          break;
        case "lines": {
          const h = sz * (0.15 + 0.8 * l);
          ctx.fillStyle = col;
          ctx.fillRect(x * sz + 1, y * sz + (sz - h) / 2, sz - 2, h);
          break;
        }
        case "diagonal":
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(1, sz * 0.14 * (0.4 + 0.9 * l));
          ctx.beginPath();
          ctx.moveTo(x * sz + 1, y * sz + sz - 1);
          ctx.lineTo(x * sz + sz - 1, y * sz + 1);
          ctx.stroke();
          break;
        case "hexdump": {
          const hex = "0123456789ABCDEF";
          ctx.font = `${(sz * 0.95).toFixed(1)}px ui-monospace, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = col;
          ctx.fillText(hex[(hash(x * 3 + y * 17 + Math.floor(t * 0.6)) * 16) | 0] ?? "0", cx, cy);
          break;
        }
        case "hearts":
          ctx.font = `${(sz * 0.95).toFixed(1)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = col;
          ctx.fillText(l > 0.5 ? "♥" : "♡", cx, cy);
          break;
        case "stars": {
          const R = sz * 0.45 * (0.3 + 0.7 * l);
          ctx.fillStyle = col;
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const rr = i % 2 ? R * 0.38 : R;
            const an = (i / 8) * Math.PI * 2 - Math.PI / 2;
            ctx[i ? "lineTo" : "moveTo"](cx + Math.cos(an) * rr, cy + Math.sin(an) * rr);
          }
          ctx.closePath();
          ctx.fill();
          break;
        }
        case "hexagons": {
          const R = sz * 0.62;
          const hx = cx + (y % 2 ? sz / 2 : 0);
          ctx.fillStyle = col;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const an = (i / 6) * Math.PI * 2 + Math.PI / 6;
            ctx[i ? "lineTo" : "moveTo"](hx + Math.cos(an) * R, cy + Math.sin(an) * R);
          }
          ctx.closePath();
          ctx.fill();
          break;
        }
        case "bubbles":
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(1, sz * 0.07);
          ctx.beginPath();
          ctx.arc(cx, cy, sz * 0.46 * (0.25 + 0.75 * l), 0, 7);
          ctx.stroke();
          break;
        case "rings": {
          const n = 1 + Math.round(l * 3);
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(1, sz * 0.08);
          for (let i = 1; i <= n; i++) {
            ctx.beginPath();
            ctx.arc(cx, cy, (sz * 0.46 * i) / n, 0, 7);
            ctx.stroke();
          }
          break;
        }
        case "hatch": {
          const n = 1 + Math.round(l * 4);
          ctx.strokeStyle = col;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const o2 = (i + seed) * (sz / n);
            ctx.moveTo(x * sz + o2, y * sz);
            ctx.lineTo(x * sz + o2 - sz * 0.3, y * sz + sz);
          }
          ctx.stroke();
          break;
        }
        case "disco": {
          const hue = (t * 60 + seed * 360) % 360;
          ctx.fillStyle = `hsla(${hue | 0},90%,60%,${a.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(cx, cy, sz * 0.42 * (0.3 + 0.7 * Math.abs(Math.sin(t * 4 + seed * 9))), 0, 7);
          ctx.fill();
          break;
        }
        case "dither": {
          const B = [15, 8, 13, 2, 6, 3, 10, 5, 12, 1, 9, 4, 7, 0, 11, 14];
          if (l * 16 > (B[(y & 3) * 4 + (x & 3)] ?? 15)) {
            ctx.fillStyle = col;
            ctx.fillRect(x * sz + sz / 4, y * sz + sz / 4, sz / 2, sz / 2);
          }
          break;
        }
        case "triangles": {
          const e = cells[o + 4] ?? 0;
          const flip = e > 0.25;
          const shade = 0.35 + 0.65 * l;
          ctx.fillStyle = `rgba(${(r * shade) | 0},${(g * shade) | 0},${(b * shade) | 0},0.95)`;
          ctx.beginPath();
          if (flip) {
            ctx.moveTo(x * sz, y * sz);
            ctx.lineTo(x * sz + sz, y * sz);
            ctx.lineTo(x * sz + sz, y * sz + sz);
          } else {
            ctx.moveTo(x * sz, y * sz);
            ctx.lineTo(x * sz + sz, y * sz);
            ctx.lineTo(x * sz, y * sz + sz);
          }
          ctx.closePath();
          ctx.fill();
          const shade2 = 0.2 + 0.5 * l;
          ctx.fillStyle = `rgba(${(r * shade2) | 0},${(g * shade2) | 0},${(b * shade2) | 0},0.95)`;
          ctx.beginPath();
          if (flip) {
            ctx.moveTo(x * sz, y * sz);
            ctx.lineTo(x * sz, y * sz + sz);
            ctx.lineTo(x * sz + sz, y * sz + sz);
          } else {
            ctx.moveTo(x * sz + sz, y * sz);
            ctx.lineTo(x * sz + sz, y * sz + sz);
            ctx.lineTo(x * sz, y * sz + sz);
          }
          ctx.closePath();
          ctx.fill();
          break;
        }
        default:
          // halfblocks : ▀▄ avec détail vertical double
          ctx.fillStyle = col;
          ctx.fillRect(x * sz, y * sz, sz, sz / 2);
          ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${(0.25 + 0.75 * clamp01(l * (0.6 + 0.6 * hash(seed * 31)))).toFixed(3)})`;
          ctx.fillRect(x * sz, y * sz + sz / 2, sz, sz / 2);
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillRect(x * sz + sz * 0.45, y * sz, Math.max(1, sz * 0.08), sz);
      }
    }
  }
}

function drawContour(
  ctx: CanvasRenderingContext2D,
  s: Sample,
  p: AsciiHeroParams,
  w: number,
  h: number
): void {
  const sz = p.cellSize;
  const levels = 6;
  ctx.lineWidth = 1.1;
  for (let li = 0; li < levels; li++) {
    const iso = (li + 0.6) / levels;
    ctx.strokeStyle = `rgba(230,240,255,${(0.1 + 0.32 * (1 - li / levels)).toFixed(3)})`;
    ctx.beginPath();
    for (let y = 0; y < s.rows - 1; y++) {
      for (let x = 0; x < s.cols - 1; x++) {
        const a = s.cells[(y * s.cols + x) * 6] ?? 0;
        const b = s.cells[(y * s.cols + x + 1) * 6] ?? 0;
        const c = s.cells[((y + 1) * s.cols + x + 1) * 6] ?? 0;
        const d = s.cells[((y + 1) * s.cols + x) * 6] ?? 0;
        const idx = (a > iso ? 1 : 0) | (b > iso ? 2 : 0) | (c > iso ? 4 : 0) | (d > iso ? 8 : 0);
        if (idx === 0 || idx === 15) continue;
        const X = x * sz;
        const Y = y * sz;
        const ip = (v: number, k: number) => (iso - v) / Math.max(1e-6, k - v);
        const top = [X + sz * ip(a, b), Y] as const;
        const right = [X + sz, Y + sz * ip(b, c)] as const;
        const bot = [X + sz * ip(d, c), Y + sz] as const;
        const left = [X, Y + sz * ip(a, d)] as const;
        const seg = (p1: readonly (number | undefined)[], p2: readonly (number | undefined)[]) => {
          ctx.moveTo(p1[0] ?? 0, p1[1] ?? 0);
          ctx.lineTo(p2[0] ?? 0, p2[1] ?? 0);
        };
        switch (idx) {
          case 1:
          case 14:
            seg(left, top);
            break;
          case 2:
          case 13:
            seg(top, right);
            break;
          case 3:
          case 12:
            seg(left, right);
            break;
          case 4:
          case 11:
            seg(right, bot);
            break;
          case 6:
          case 9:
            seg(top, bot);
            break;
          case 7:
          case 8:
            seg(left, bot);
            break;
          case 5:
            seg(left, top);
            seg(right, bot);
            break;
          case 10:
            seg(top, right);
            seg(bot, left);
            break;
        }
        void w;
        void h;
      }
    }
    ctx.stroke();
  }
}

function drawMatrix(
  ctx: CanvasRenderingContext2D,
  s: Sample,
  drops: { y: number; v: number }[],
  dt: number,
  w: number,
  h: number
): void {
  const sz = 9;
  const cols = Math.ceil(w / sz);
  const rows = Math.ceil(h / sz);
  if (drops.length !== cols) {
    drops.length = 0;
    for (let i = 0; i < cols; i++) drops.push({ y: hash(i * 91) * rows, v: 4 + hash(i * 7) * 8 });
  }
  ctx.font = `${(sz * 0.95).toFixed(1)}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let x = 0; x < cols; x++) {
    const d = drops[x];
    if (!d) continue;
    d.y = (d.y + d.v * dt) % (rows + 12);
    for (let k = 0; k < 9; k++) {
      const yy = Math.floor(d.y - k);
      if (yy < 0 || yy >= rows) continue;
      const fade = 1 - k / 9;
      ctx.fillStyle =
        k === 0 ? "rgba(210,255,220,0.95)" : `rgba(60,166,255,${(0.55 * fade).toFixed(3)})`;
      ctx.fillText(
        RAMP_STANDARD[(hash(x * 131 + yy * 17) * RAMP_STANDARD.length) | 0] ?? " ",
        x * sz + sz / 2,
        yy * sz + sz / 2
      );
    }
  }
  void s;
}

/** Les post-effets, empilés dans l'ordre de la clé. */
function applyPostFx(
  ctx: CanvasRenderingContext2D,
  p: AsciiHeroParams,
  t: number,
  w: number,
  h: number,
  grain: HTMLCanvasElement
): void {
  for (const [name, fx] of Object.entries(p.pfx) as [
    PfxKey,
    { enabled: boolean; intensity: number },
  ][]) {
    if (!fx.enabled || !fx.intensity) continue;
    const i = fx.intensity / 100;
    switch (name) {
      case "scanLines":
        ctx.fillStyle = `rgba(0,0,0,${(i * 0.5).toFixed(3)})`;
        for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
        break;
      case "vignette": {
        const g = ctx.createRadialGradient(
          w / 2,
          h / 2,
          Math.min(w, h) * 0.35,
          w / 2,
          h / 2,
          Math.max(w, h) * 0.72
        );
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${(i * 0.85).toFixed(3)})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case "filmGrain": {
        const ox = (hash(Math.floor(t * 11)) * 128) | 0;
        const oy = (hash(Math.floor(t * 11) + 7) * 128) | 0;
        ctx.save();
        ctx.globalCompositeOperation = "overlay";
        ctx.globalAlpha = i * 0.55;
        for (let y = -oy; y < h; y += 128)
          for (let x = -ox; x < w; x += 128) ctx.drawImage(grain, x, y);
        ctx.restore();
        break;
      }
      case "filmDust": {
        const n = (i * 60) | 0;
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        for (let k = 0; k < n; k++) {
          const x = hash(k * 3.1 + Math.floor(t * 7) * 13) * w;
          const y = hash(k * 7.7 + Math.floor(t * 7) * 29) * h;
          ctx.fillRect(x, y, 1.6, 1.6);
        }
        break;
      }
      case "glitch": {
        if (hash(Math.floor(t * 5)) > 0.55) break;
        const tmp = document.createElement("canvas");
        tmp.width = w;
        tmp.height = h;
        const tctx = tmp.getContext("2d");
        if (!tctx) break;
        const n = 3 + ((i * 10) | 0);
        for (let k = 0; k < n; k++) {
          const sy = (hash(k * 31 + Math.floor(t * 9)) * h) | 0;
          const hh = 6 + ((hash(k * 77) * 40) | 0);
          const dx = ((hash(k * 13) - 0.5) * i * 90) | 0;
          tctx.clearRect(0, 0, w, h);
          tctx.drawImage(ctx.canvas, 0, sy, w, hh, 0, 0, w, hh);
          ctx.drawImage(tmp, 0, 0, w, hh, dx, sy, w, hh);
        }
        break;
      }
      case "bloom": {
        const tmp = document.createElement("canvas");
        tmp.width = w;
        tmp.height = h;
        const tctx = tmp.getContext("2d");
        if (!tctx) break;
        tctx.filter = "brightness(1.35) contrast(190%) blur(14px)";
        tctx.drawImage(ctx.canvas, 0, 0);
        tctx.filter = "none";
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = i * 0.7;
        ctx.drawImage(tmp, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        break;
      }
      case "pixelate": {
        const tmp = document.createElement("canvas");
        const f = 2 + Math.round(i * 22);
        tmp.width = Math.max(2, Math.round(w / f));
        tmp.height = Math.max(2, Math.round(h / f));
        const tctx = tmp.getContext("2d");
        if (!tctx) break;
        tctx.drawImage(ctx.canvas, 0, 0, tmp.width, tmp.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, w, h);
        ctx.imageSmoothingEnabled = true;
        break;
      }
      default:
        break; // chromatic et halftone : présents dans la démo complète, inactifs ici
    }
  }
}

function buildSample(
  img: HTMLImageElement,
  p: AsciiHeroParams,
  w: number,
  h: number,
  sc: HTMLCanvasElement
): Sample {
  const cols = Math.ceil(w / p.cellSize);
  const rows = Math.ceil(h / p.cellSize);
  sc.width = cols;
  sc.height = rows;
  const scx = sc.getContext("2d", { willReadFrequently: true });
  const cells = new Float32Array(cols * rows * 6);
  if (!scx) return { cols, rows, cells, fast: [] };
  scx.imageSmoothingEnabled = true;
  scx.drawImage(img, 0, 0, cols, rows);
  const d = scx.getImageData(0, 0, cols, rows).data;
  const cb = p.brightness / 100;
  const cc = p.contrast / 100;
  const sat = p.saturation / 100;
  const gray = p.grayscale / 100;
  const bySize = new Map<number, { size: number; list: number[]; colors: string[] }>();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      let r = (d[i] ?? 0) / 255;
      let g = (d[i + 1] ?? 0) / 255;
      let b = (d[i + 2] ?? 0) / 255;
      let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const xl = Math.max(0, x - 1);
      const xr = Math.min(cols - 1, x + 1);
      const yu = Math.max(0, y - 1);
      const yd = Math.min(rows - 1, y + 1);
      const lumX = (xx: number, yy: number) => d[(yy * cols + xx) * 4] ?? 0;
      const edge = Math.min(
        1,
        Math.hypot((lumX(xr, y) - lumX(xl, y)) / 510, (lumX(x, yd) - lumX(x, yu)) / 510)
      );
      lum = clamp01((clamp01(lum) - 0.5) * cc + 0.5 + cb) * (p.invert ? -1 : 1);
      if (p.edgeEmphasis) lum = clamp01(lum + (p.edgeEmphasis / 100) * edge);
      const a = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = a + (r - a) * sat * (1 - gray);
      g = a + (g - a) * sat * (1 - gray);
      b = a + (b - a) * sat * (1 - gray);
      const adj = (v: number) => clamp01((v - 0.5) * cc + 0.5 + cb);
      r = adj(r);
      g = adj(g);
      b = adj(b);
      const o = (y * cols + x) * 6;
      const seed = hash((x * 73856093) ^ (y * 19349663));
      cells[o] = lum;
      cells[o + 1] = r;
      cells[o + 2] = g;
      cells[o + 3] = b;
      cells[o + 4] = edge;
      cells[o + 5] = seed;
      // chemin rapide « characters » : glyphes/tailles/couleurs figés, groupés par taille
      const size =
        Math.round(p.cellSize * (0.62 + 0.75 * clamp01(lum)) * (1 + edge * 0.25) * 2) / 2;
      let bucket: Bucket | undefined = bySize.get(size);
      bucket = bySize.get(size) ?? undefined;
      if (!bucket) {
        bucket = { size, list: [], colors: [] };
        bySize.set(size, bucket);
      }
      bucket.list.push(x * p.cellSize + p.cellSize / 2, y * p.cellSize + p.cellSize / 2, 0, seed);
      bucket.colors.push(
        `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${(0.2 + 0.8 * clamp01(lum)).toFixed(3)})`
      );
    }
  }
  const fast = [...bySize.entries()].sort((m, n) => m[0] - n[0]).map(([, v]) => v);
  return { cols, rows, cells, fast };
}

/**
 * Le héros plein écran : grille de glyphes animée + copy du produit par-dessus.
 * `copy` est passé par la page (titre, lede, CTA) pour rester i18n-agnostique.
 */
export function AsciiHero({
  children,
  params = ASCII_HERO_PARAMS,
}: {
  children: ReactNode;
  params?: AsciiHeroParams;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let disposed = false;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // surfaces de travail (hors React, détruites au démontage)
    const bgCv = document.createElement("canvas");
    const bgx = bgCv.getContext("2d");
    const glyphCv = document.createElement("canvas");
    const gx2 = glyphCv.getContext("2d");
    const scCv = document.createElement("canvas");
    const grain = document.createElement("canvas");
    grain.width = 128;
    grain.height = 128;
    const gctx = grain.getContext("2d");
    if (gctx) {
      const d = gctx.createImageData(128, 128);
      for (let i = 0; i < d.data.length; i += 4) {
        const v = 110 + ((Math.random() * 90) | 0);
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
        d.data[i + 3] = 255;
      }
      gctx.putImageData(d, 0, 0);
    }
    const img = new Image();
    img.src = IMG_SRC;
    const drops: { y: number; v: number }[] = [];
    let sample: Sample | null = null;
    let dirtyBg = true;

    const buildBg = (): void => {
      const { width: w, height: h } = canvas;
      if (!bgx) return;
      bgx.globalCompositeOperation = "source-over";
      bgx.globalAlpha = 1;
      bgx.filter = "none";
      bgx.fillStyle = "#000";
      bgx.fillRect(0, 0, w, h);
      if (params.bgMode === "none") return;
      if (params.bgMode === "solid") {
        bgx.fillStyle = "#0b0b0e";
        bgx.fillRect(0, 0, w, h);
        return;
      }
      bgx.globalAlpha = params.bgOpacity / 100;
      bgx.filter = `blur(${params.bgBlur}px) brightness(${100 + params.brightness}%) contrast(${params.contrast}%) saturate(${params.saturation}%) grayscale(${params.grayscale}%)`;
      bgx.drawImage(img, 0, 0, w, h);
      bgx.filter = "none";
      bgx.globalAlpha = 1;
      if (params.blurType === "gaussian" || params.blurType === "directional") {
        // flou supplémentaire paramétrique, appliqué au fond statique
        const tmp = document.createElement("canvas");
        tmp.width = w;
        tmp.height = h;
        const tctx = tmp.getContext("2d");
        if (!tctx) return;
        if (params.blurType === "gaussian") {
          tctx.filter = `blur(${params.blurAmount / 6}px)`;
          tctx.drawImage(bgCv, 0, 0);
          tctx.filter = "none";
        } else {
          const a = (params.blurAngle * Math.PI) / 180;
          const n = 10;
          for (let i = 0; i < n; i++) {
            const off = ((i / (n - 1) - 0.5) * params.blurAmount) / 40;
            tctx.globalAlpha = 1 / n;
            tctx.drawImage(bgCv, Math.cos(a) * off, Math.sin(a) * off);
          }
          tctx.globalAlpha = 1;
        }
        bgx.drawImage(tmp, 0, 0);
      }
    };

    const resize = (): void => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (!w || !h) return;
      canvas.width = w;
      canvas.height = h;
      bgCv.width = w;
      bgCv.height = h;
      glyphCv.width = w;
      glyphCv.height = h;
      sample = img.complete && img.naturalWidth ? buildSample(img, params, w, h, scCv) : null;
      dirtyBg = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const start = performance.now();
    const frame = (now: number): void => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const { width: w, height: h } = canvas;
      if (!w || !h) return;
      if (!img.complete) return;
      if (!sample || sample.cols !== Math.ceil(w / params.cellSize)) {
        sample = buildSample(img, params, w, h, scCv);
        dirtyBg = true;
      }
      if (dirtyBg) {
        buildBg();
        dirtyBg = false;
      }
      const t = (now - start) / 1000;
      const dt = Math.min(0.1, 1 / 60);
      // 1. fond en cache
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(bgCv, 0, 0);
      // 2-3. glyphes sur la couche dédiée
      if (gx2) {
        gx2.clearRect(0, 0, w, h);
        if (sample) drawGlyphTo(gx2, params, sample, t, dt, drops, img, w, h);
        // 4. un seul composite de la couche sur le fond
        ctx.globalCompositeOperation = params.styleBlend;
        ctx.drawImage(glyphCv, 0, 0);
        ctx.globalCompositeOperation = "source-over";
      }
      // teinte éventuelle
      if (params.tintOpacity > 0) {
        ctx.globalCompositeOperation = params.overlayBlend;
        ctx.globalAlpha = params.tintOpacity;
        ctx.fillStyle = params.tint;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      // post-effets + lumières + masque
      applyPostFx(ctx, params, t, w, h, grain);
      if (params.lights.enabled) {
        ctx.globalCompositeOperation = "lighter";
        for (const L of params.lights.points) {
          const g = ctx.createRadialGradient(
            L.x * w,
            L.y * h,
            0,
            L.x * w,
            L.y * h,
            (L.r * w) / 100
          );
          g.addColorStop(0, `rgba(255,244,214,${(L.i / 100).toFixed(3)})`);
          g.addColorStop(1, "rgba(255,244,214,0)");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.globalCompositeOperation = "source-over";
      }
      if (reduceMotion) return; // une seule trame, pas de boucle
    };
    // pour reduceMotion on rend une trame puis on s'arrête
    img.decode().finally(() => {
      resize();
      if (reduceMotion) {
        frame(performance.now());
      } else {
        raf = requestAnimationFrame(frame);
      }
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [params]);

  return (
    <section
      ref={wrapRef}
      className="ascii-hero relative flex min-h-[92vh] w-full items-center justify-center overflow-hidden bg-black text-white"
    >
      <canvas
        ref={canvasRef}
        tabIndex={-1}
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background: "radial-gradient(circle at center, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0) 100%)",
        }}
      />
      <div className="relative z-[2] mx-auto flex w-full max-w-[1240px] flex-col items-center px-5 py-24 text-center lg:px-8">
        {children ?? (
          <AsciiHeroCopy
            eyebrow={t("hero.eyebrow")}
            titlePre={t("hero.title.pre")}
            titlePre2={t("hero.title.pre2")}
            titleMid={t("hero.title.mid")}
            titleAccent={t("hero.title.accent")}
            lede={t("hero.lede")}
            cli={t("hero.cli")}
            cta={t("hero.cta.primary")}
          />
        )}
      </div>
    </section>
  );
}

function drawGlyphTo(
  ctx: CanvasRenderingContext2D,
  p: AsciiHeroParams,
  s: Sample,
  t: number,
  dt: number,
  drops: { y: number; v: number }[],
  img: HTMLImageElement,
  w: number,
  h: number
): void {
  if (p.renderMode === "contour") {
    drawContour(ctx, s, p, w, h);
  } else if (p.renderMode === "matrix") {
    drawMatrix(ctx, s, drops, dt, w, h);
  } else if (p.renderMode === "characters") {
    drawCharacters(ctx, p, s, t);
  } else {
    drawMode(ctx, p, s, t, p.coverage / 100);
  }
  void img;
}

/** Copy du héros (i18n de la page) — réutilisable si la page veut la disposer autrement. */
export function AsciiHeroCopy({
  eyebrow,
  titlePre,
  titlePre2,
  titleMid,
  titleAccent,
  lede,
  cli,
  cta,
}: {
  eyebrow: string;
  titlePre: string;
  titlePre2: string;
  titleMid: string;
  titleAccent: string;
  lede: string;
  cli: string;
  cta: string;
}) {
  return (
    <>
      <p className="ascii-eyebrow">{eyebrow}</p>
      <h1 className="ascii-title">
        {titlePre} <span className="ascii-title-soft">{titlePre2}</span> {titleMid}
        <span className="ascii-title-accent">{titleAccent}</span>
      </h1>
      {/* The wordmark as an instrument: the product inspects software, so the mark
          inspecting itself belongs in the hero. Letters turn to outline under the
          pointer and can be dragged off their baseline — the same dissection the
          engine performs on a page. `aria-hidden`: the h1 above already says the
          name; a second reading of the same word is noise, not description. */}
      <div className="ascii-tech" aria-hidden="true">
        <TechText
          text="PROOFCORE"
          fontWeight={800}
          fontSize={150}
          letterSpacing={-0.03}
          align="center"
          reach={170}
          dashLength={4}
          dashGap={2}
          strokeWidth={1.4}
          specks={12}
          intro="metrics"
          introDuration={1.6}
          guides
          className="ascii-tech-canvas"
        />
      </div>
      <p className="ascii-lede">{lede}</p>
      <p className="ascii-cli">{cli}</p>
      <Link to="/signup" className="ascii-cta">
        {cta} <ArrowRight size={18} />
      </Link>
    </>
  );
}
