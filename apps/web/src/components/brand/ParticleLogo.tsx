import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../../lib/theme.js";
import { Mark } from "./Logo.js";
import { LOGO_LAYERS, LOGO_PATH, LOGO_VIEWBOX } from "./logoGeometry.js";

/**
 * PROOFSTACK's signature motion: a field of particles drifts as a wave, converges
 * into the three-layer P, holds its integrity, then dissolves back into the wave.
 *
 * Canvas 2D is deliberate. The field is a few thousand points, not a 3D scene:
 * WebGL would add a large dependency and a second rendering model for no visual
 * gain. Points are sampled from the same SVG path that draws the static logo, so
 * the particle mark is the actual brand geometry rather than an approximation.
 *
 * Performance properties:
 *  - deterministic distribution (hash of particle index, no Math.random);
 *  - one canvas, fillRect points, 30 fps ceiling, DPR capped at 2;
 *  - fewer points on mobile and low-power/performanceMode="low";
 *  - rAF stopped when the canvas is off screen, cleaned up on unmount;
 *  - pointer tracking only on fine pointers, never on touch;
 *  - a static SVG is rendered when motion is reduced or Canvas is unavailable.
 */

export type ParticlePalette = readonly [string, string, string];

export interface ParticleLogoProps {
  className?: string;
  style?: React.CSSProperties;
  /** 0..1; multiplies the sampled logo point count. Default 1. */
  density?: number;
  /** 0..1; wave displacement. Default 1. */
  waveIntensity?: number;
  /** CSS-pixel base size of a particle. Default 1.35. */
  particleSize?: number;
  /** Wave/breathing speed multiplier. Default 1. */
  animationSpeed?: number;
  /** Three colours, back to front. */
  colorPalette?: ParticlePalette;
  /** Pointer influence radius in CSS pixels. Default 150. */
  interactionRadius?: number;
  /** Formation duration in ms. Default 2600. */
  logoFormationDuration?: number;
  /** Override the media query. */
  reducedMotion?: boolean;
  performanceMode?: "auto" | "low" | "high";
  /** Where the logo forms on wide screens. Default "right". */
  focus?: "center" | "right";
}

interface Particle {
  baseX: number;
  baseY: number;
  targetX: number;
  targetY: number;
  size: number;
  phase: number;
  delay: number;
  color: string;
  alpha: number;
}

const DEFAULT_PALETTE: ParticlePalette = ["#70C9DB", "#78E3CB", "#73D68B"];

function hash(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

/** Sample the filled P plates on a 96×96 offscreen canvas. */
function sampleLogo(): { x: number; y: number }[] {
  const canvas = document.createElement("canvas");
  canvas.width = LOGO_VIEWBOX;
  canvas.height = LOGO_VIEWBOX;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  const path = new Path2D(LOGO_PATH);
  context.fillStyle = "#ffffff";
  for (const layer of LOGO_LAYERS) {
    context.save();
    context.translate(layer.offset, layer.offset);
    context.fill(path, "evenodd");
    context.restore();
  }
  const pixels = context.getImageData(0, 0, LOGO_VIEWBOX, LOGO_VIEWBOX).data;
  const points: { x: number; y: number }[] = [];
  for (let y = 0; y < LOGO_VIEWBOX; y += 1) {
    for (let x = 0; x < LOGO_VIEWBOX; x += 1) {
      const alpha = pixels[(y * LOGO_VIEWBOX + x) * 4 + 3] ?? 0;
      if (alpha > 128) points.push({ x, y });
    }
  }
  return points;
}

function particleBudget(
  width: number,
  mode: ParticleLogoProps["performanceMode"],
  density: number
) {
  if (mode === "low") return 900;
  if (mode === "high") return 3400;
  const cores = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 4) : 4;
  const mobile = width < 720;
  const cap = mobile || cores <= 4 ? 1500 : 3000;
  return Math.max(500, Math.round(cap * Math.max(0.35, Math.min(1, density))));
}

export function ParticleLogo({
  className,
  density = 1,
  waveIntensity = 1,
  particleSize = 1.35,
  animationSpeed = 1,
  colorPalette = DEFAULT_PALETTE,
  interactionRadius = 150,
  logoFormationDuration = 2600,
  reducedMotion,
  performanceMode = "auto",
  focus = "right",
}: ParticleLogoProps) {
  const prefersReduced = usePrefersReducedMotion();
  const reduced = reducedMotion ?? prefersReduced;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);

  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context || typeof Path2D === "undefined") return;

    const targets = sampleLogo();
    if (targets.length === 0) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let particles: Particle[] = [];
    let raf = 0;
    let lastDraw = 0;
    let visible = true;
    let pointerActive = false;
    let pointerX = 0;
    let pointerY = 0;
    let running = false;
    const started = performance.now();
    const formationStart = 900;
    const holdDuration = 2500;
    const dissolutionDuration = 2200;
    const wavePause = 1200;
    const cycle =
      formationStart + logoFormationDuration + holdDuration + dissolutionDuration + wavePause;
    const formEnd = formationStart + logoFormationDuration;
    const holdEnd = formEnd + holdDuration;
    const dissolveEnd = holdEnd + dissolutionDuration;

    const layout = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const build = (): void => {
      const budget = particleBudget(width, performanceMode, density);
      const step = Math.max(1, Math.ceil(targets.length / budget));
      const chosen = targets.filter((_, index) => index % step === 0);
      const logoScale = Math.min(
        (width * (width < 760 ? 0.62 : focus === "right" ? 0.43 : 0.58)) / LOGO_VIEWBOX,
        (height * 0.62) / LOGO_VIEWBOX
      );
      const logoX = width * (width > 760 && focus === "right" ? 0.7 : 0.5);
      const logoY = height * 0.5;
      particles = chosen.map((point, index) => {
        const nx = point.x / LOGO_VIEWBOX;
        const ny = point.y / LOGO_VIEWBOX;
        const tier = ny < 0.36 ? 0 : ny < 0.7 ? 1 : 2;
        return {
          baseX: hash(index, 1) * width,
          baseY: hash(index, 2) * height,
          targetX: logoX + (point.x - LOGO_VIEWBOX / 2) * logoScale,
          targetY: logoY + (point.y - LOGO_VIEWBOX / 2) * logoScale,
          size: (0.65 + hash(index, 3) * 1.25) * particleSize,
          phase: hash(index, 4) * Math.PI * 2,
          delay: hash(index, 5) * 0.34,
          color: colorPalette[tier] ?? colorPalette[1] ?? "#78E3CB",
          alpha: 0.3 + hash(index, 6) * 0.55 + nx * 0.15,
        };
      });
    };

    const draw = (now: number): void => {
      if (!running) return;
      raf = requestAnimationFrame(draw);
      if (!visible) return;
      if (now - lastDraw < 33) return;
      lastDraw = now;
      const elapsed = (now - started) % cycle;
      const seconds = now / 1000;
      const waveTime = seconds * animationSpeed;

      context.clearRect(0, 0, width, height);
      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        if (!particle) continue;
        const waveX =
          particle.baseX +
          Math.sin(waveTime * 0.7 + particle.phase) * 15 * waveIntensity +
          Math.cos(particle.baseY * 0.009 + waveTime * 0.45) * 6 * waveIntensity;
        const waveY =
          particle.baseY +
          Math.cos(particle.baseX * 0.007 + waveTime * 0.58 + particle.phase) * 13 * waveIntensity +
          Math.sin(waveTime * 0.31 + particle.phase * 0.5) * 5 * waveIntensity;

        let mix = 0;
        if (elapsed >= formationStart && elapsed < formEnd) {
          const local =
            (elapsed - formationStart - particle.delay * 700) /
            Math.max(1, logoFormationDuration - 700);
          mix = smoothstep(local);
        } else if (elapsed >= formEnd && elapsed < holdEnd) {
          mix = 1;
        } else if (elapsed >= holdEnd && elapsed < dissolveEnd) {
          const local =
            (elapsed - holdEnd - particle.delay * 600) / Math.max(1, dissolutionDuration - 600);
          mix = 1 - smoothstep(local);
        }

        const integrity = mix > 0.98 ? 1 : 0;
        const sway = integrity
          ? Math.sin(waveTime * 1.1 + particle.phase) * 0.65
          : Math.sin(waveTime * 0.8 + particle.phase) * 1.4 * mix;
        let x = waveX + (particle.targetX + sway - waveX) * mix;
        let y =
          waveY + (particle.targetY + Math.cos(waveTime + particle.phase) * 0.5 - waveY) * mix;

        if (pointerActive) {
          const dx = x - pointerX;
          const dy = y - pointerY;
          const distance = Math.hypot(dx, dy);
          if (distance > 0 && distance < interactionRadius) {
            const force = (1 - distance / interactionRadius) ** 2 * (4 + 8 * (1 - mix));
            x += (dx / distance) * force - (dy / distance) * force * 0.35;
            y += (dy / distance) * force + (dx / distance) * force * 0.35;
          }
        }

        context.globalAlpha = Math.min(1, particle.alpha * (0.72 + mix * 0.35));
        context.fillStyle = particle.color;
        context.fillRect(x, y, particle.size, particle.size);
      }
      context.globalAlpha = 1;
    };

    const startLoop = (): void => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(draw);
    };

    const stopLoop = (): void => {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const onResize = (): void => {
      layout();
      build();
      if (!running) {
        context.clearRect(0, 0, width, height);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible) startLoop();
        else stopLoop();
      },
      { threshold: 0.01 }
    );

    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") stopLoop();
      else if (visible) startLoop();
    };

    const onPointerMove = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      pointerX = event.clientX - rect.left;
      pointerY = event.clientY - rect.top;
      pointerActive = true;
    };
    const onPointerLeave = (): void => {
      pointerActive = false;
    };

    const finePointer = window.matchMedia?.("(pointer: fine)").matches ?? false;
    layout();
    build();
    setCanvasReady(true);
    startLoop();
    observer.observe(canvas);
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("visibilitychange", onVisibility);
    if (finePointer) {
      canvas.addEventListener("pointermove", onPointerMove, { passive: true });
      canvas.addEventListener("pointerleave", onPointerLeave);
    }

    return () => {
      stopLoop();
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("visibilitychange", onVisibility);
      if (finePointer) {
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerleave", onPointerLeave);
      }
    };
  }, [
    animationSpeed,
    colorPalette,
    density,
    focus,
    interactionRadius,
    logoFormationDuration,
    particleSize,
    performanceMode,
    reduced,
    waveIntensity,
  ]);

  return (
    <div className={`particle-logo ${className ?? ""}`} aria-hidden="true">
      <Mark
        className={`particle-fallback ${canvasReady && !reduced ? "is-hidden" : ""}`}
        size={196}
      />
      {!reduced ? (
        <canvas ref={canvasRef} className="particle-canvas" tabIndex={-1} aria-hidden="true" />
      ) : null}
    </div>
  );
}
