import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../../lib/theme.js";
import { Mark } from "./Logo.js";
import { LOGO_LAYERS, LOGO_PATH, LOGO_VIEWBOX } from "./logoGeometry.js";

/**
 * PROOFCORE's signature motion: a field of particles drifts as a wave, converges
 * into the three-layer P, holds its integrity, then dissolves back into the wave.
 *
 * Canvas 2D is deliberate. The field is a few thousand points, not a 3D scene:
 * WebGL would add a large dependency and a second rendering model for no visual
 * gain. Points are sampled from the same SVG path that draws the static logo, so
 * the particle mark is the actual brand geometry rather than an approximation.
 *
 * The ambient field is a *structured* wave, decoded from reference da1: a sweep of
 * curved bands that enters thin on one side and swells toward the crest, dots
 * modulated by a gaussian across each band, colour running cyan → mint → pale
 * green along the depth axis, brightest at the crest. During the formation phase
 * the same particles converge into the brand mark and hold, then dissolve back —
 * the loop reads as one continuous material, not two systems.
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
  /** Three colours, crest → mid → base of the band. */
  colorPalette?: ParticlePalette;
  /** Pointer influence radius in CSS pixels. Default 150. */
  interactionRadius?: number;
  /** Formation duration in ms. Default 2600. */
  logoFormationDuration?: number;
  /** Override the media query. */
  reducedMotion?: boolean;
  performanceMode?: "auto" | "low" | "high";
  /** Where the sweep concentrates on wide screens. Default "right". */
  focus?: "center" | "right";
}

interface Particle {
  /** 0..1 position along the band sweep. */
  u: number;
  /** −1..1 position across the band thickness. */
  v: number;
  targetX: number;
  targetY: number;
  size: number;
  phase: number;
  delay: number;
  color: string;
  alpha: number;
  /** Per-particle random seeds, hashed once. */
  r1: number;
  r2: number;
  r3: number;
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

/** Mix two hex colours without pulling in a colour library. */
function mixHex(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1, 3), 16);
  const pb = Number.parseInt(b.slice(1, 3), 16);
  const ga = Number.parseInt(a.slice(3, 5), 16);
  const gb = Number.parseInt(b.slice(3, 5), 16);
  const ba = Number.parseInt(a.slice(5, 7), 16);
  const bb = Number.parseInt(b.slice(5, 7), 16);
  const to = (x: number, y: number): string =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${to(pa, pb)}${to(ga, gb)}${to(ba, bb)}`;
}

/** Sample the filled P plates on a 96×96 offscreen canvas.
 *
 * Two quality decisions decoded from the reference:
 *  - pixels are *accepted probabilistically and jittered*, so the formed logo reads
 *    as an organic particle cloud instead of a rigid pixel lattice;
 *  - the sampler keeps the three-plate layering, which is what makes the mark read
 *    as one object with depth rather than a flat silhouette.
 */
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
      if (alpha <= 128) continue;
      const seed = y * LOGO_VIEWBOX + x;
      if (hash(seed, 11) > 0.78) continue;
      points.push({
        x: x + (hash(seed, 12) - 0.5) * 1.6,
        y: y + (hash(seed, 13) - 0.5) * 1.6,
      });
    }
  }
  return points;
}

function particleBudget(
  width: number,
  mode: ParticleLogoProps["performanceMode"],
  density: number
) {
  if (mode === "low") return 1100;
  if (mode === "high") return 4200;
  const cores = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 4) : 4;
  const mobile = width < 720;
  const cap = mobile || cores <= 4 ? 1800 : 3600;
  return Math.max(600, Math.round(cap * Math.max(0.35, Math.min(1, density))));
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
    /** Effective composition height: the wave is composed against what a visitor can
     * actually see, not the full overflowing section — otherwise the crest forms below
     * the fold and the field reads as a sparse scatter. */
    let bandHeight = 0;
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
    // Test hook: lets visual QA capture an exact phase of the cycle instead of
    // guessing wall-clock offsets (mount time varies between loads).
    if (import.meta.env.DEV) {
      (window as unknown as { __proofcoreWaveStart?: number }).__proofcoreWaveStart = started;
    }
    const formationStart = 1400;
    const holdDuration = 2600;
    const dissolutionDuration = 2400;
    const wavePause = 1600;
    const cycle =
      formationStart + logoFormationDuration + holdDuration + dissolutionDuration + wavePause;
    const formEnd = formationStart + logoFormationDuration;
    const holdEnd = formEnd + holdDuration;
    const dissolveEnd = holdEnd + dissolutionDuration;

    const layout = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      bandHeight = Math.min(height, (window.innerHeight || height) * 1.02);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const build = (): void => {
      const budget = particleBudget(width, performanceMode, density);
      const step = Math.max(1, Math.ceil(targets.length / budget));
      const chosen = targets.filter((_, index) => index % step === 0);
      const logoScale = Math.min(
        (width * (width < 760 ? 0.62 : focus === "right" ? 0.42 : 0.52)) / LOGO_VIEWBOX,
        (height * 0.56) / LOGO_VIEWBOX
      );
      const logoX = width * (width > 760 && focus === "right" ? 0.78 : 0.5);
      const logoY = height * 0.42;
      particles = chosen.map((point, index) => {
        // Structured band field: u sweeps horizontally, v spans the band's
        // thickness. The sweep is weighted to the right on wide screens, matching
        // reference da1's composition of thin origin → bright swelling crest.
        const u = hash(index, 1) ** (width < 760 ? 0.9 : 0.72);
        const v = (hash(index, 2) - 0.5) * 2;
        const ny = point.y / LOGO_VIEWBOX;
        const tier = ny < 0.36 ? 0 : ny < 0.7 ? 1 : 2;
        const falloff = Math.exp(-(v * v) * 2.1);
        return {
          u,
          v,
          targetX: logoX + (point.x - LOGO_VIEWBOX / 2) * logoScale,
          targetY: logoY + (point.y - LOGO_VIEWBOX / 2) * logoScale,
          size: (0.8 + 1.9 * falloff ** 1.15) * (0.65 + 0.85 * u ** 1.05) * particleSize,
          phase: hash(index, 4) * Math.PI * 2,
          delay: hash(index, 5) * 0.34,
          color:
            tier === 0
              ? mixHex(colorPalette[0], colorPalette[1], hash(index, 7))
              : tier === 1
                ? mixHex(colorPalette[1], colorPalette[2], hash(index, 7))
                : colorPalette[2],
          alpha: (0.24 + 0.76 * u ** 1.5) * (0.4 + 0.6 * falloff),
          r1: hash(index, 3),
          r2: hash(index, 6),
          r3: hash(index, 8),
        };
      });
    };

    /**
     * Band geometry at a moment in time. The sweep enters near the lower-left and
     * rises to the upper-right, thin at the tail, swelling toward the crest, with
     * a slow travelling ripple along the path.
     */
    const bandPoint = (
      particle: Particle,
      seconds: number
    ): { x: number; y: number; falloff: number } => {
      const u = Math.min(
        1,
        Math.max(
          0,
          particle.u + Math.sin(seconds * 0.22 + particle.r3 * 6.28) * 0.014 * waveIntensity
        )
      );
      const skew = focus === "right" && width > 760 ? 1 : 0.82;
      const centre =
        bandHeight * (0.96 - 0.54 * u ** 1.1 * skew) +
        bandHeight *
          0.1 *
          Math.sin(u * 2.9 + seconds * 0.45 * animationSpeed + particle.r2 * 0.9) *
          waveIntensity +
        Math.sin(seconds * 0.6 + particle.phase) * 7 * waveIntensity;
      const thickness = bandHeight * (0.035 + 0.36 * u ** 2.0);
      const drift =
        Math.cos(particle.u * 9 + seconds * 0.8 * animationSpeed + particle.phase) *
        thickness *
        0.06 *
        waveIntensity;
      // Ridges: three faint sub-bands inside the sweep, like the reference's
      // stacked wave lines. Purely an alpha modulation — no extra geometry.
      const ridge =
        0.68 + 0.32 * Math.cos(particle.v * 3.1 + u * 5.4 - seconds * 0.7 * animationSpeed);
      const y = centre + particle.v * thickness + drift;
      const falloff = Math.exp(-(particle.v * particle.v) * 2.1);
      return { x: particle.u * width, y, falloff: falloff * ridge };
    };

    const draw = (now: number): void => {
      if (!running) return;
      raf = requestAnimationFrame(draw);
      if (!visible) return;
      if (now - lastDraw < 33) return;
      lastDraw = now;
      const elapsed = (now - started) % cycle;
      const seconds = now / 1000;

      context.clearRect(0, 0, width, height);
      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        if (!particle) continue;
        const band = bandPoint(particle, seconds);

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
          ? Math.sin(seconds * 1.1 + particle.phase) * 0.65
          : Math.sin(seconds * 0.8 + particle.phase) * 1.5 * mix;
        let x = band.x + (particle.targetX + sway - band.x) * mix;
        let y =
          band.y + (particle.targetY + Math.cos(seconds + particle.phase) * 0.5 - band.y) * mix;

        if (pointerActive && mix < 1) {
          const dx = x - pointerX;
          const dy = y - pointerY;
          const distance = Math.hypot(dx, dy);
          if (distance > 0 && distance < interactionRadius) {
            const force = (1 - distance / interactionRadius) ** 2 * (4 + 9 * (1 - mix));
            x += (dx / distance) * force - (dy / distance) * force * 0.35;
            y += (dy / distance) * force + (dx / distance) * force * 0.35;
          }
        }

        // Twinkle keeps the formed logo alive without breaking its silhouette.
        const twinkle = 0.88 + 0.12 * Math.sin(seconds * 1.9 + particle.r2 * 6.28);
        const crest = band.falloff > 0.78 && particle.u > 0.5 ? 1 : 0;
        context.globalAlpha = Math.min(
          1,
          particle.alpha * twinkle * (0.9 + mix * 0.75) + crest * 0.14
        );
        context.fillStyle = particle.color;
        const size = particle.size * (1 + crest * 0.5 + mix * 0.3);
        if (size > 2.1) {
          // Larger dots render as circles — squares only read as pixels at this size.
          // A faint halo on the very brightest formed dots adds the reference's
          // luminosity; it is rare and small, or thousands of halos merge into fog.
          if (mix > 0.92 && size > 3.6) {
            context.globalAlpha *= 0.07;
            context.beginPath();
            context.arc(x, y, size * 1.8, 0, Math.PI * 2);
            context.fill();
            context.globalAlpha /= 0.07;
          }
          context.beginPath();
          context.arc(x, y, size / 2, 0, Math.PI * 2);
          context.fill();
        } else {
          context.fillRect(x, y, size, size);
        }
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
