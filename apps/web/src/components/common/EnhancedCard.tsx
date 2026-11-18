import React, {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Opt-in 3D card layer, tuned for the "After Effects" feel the product asks for:
 *
 *  - the tilt is *lerped* every frame toward the cursor target, so the card
 *    glides instead of snapping, and springs back to rest on leave;
 *  - a glare highlight rides the cursor across the surface (CSS custom
 *    properties, no image asset);
 *  - everything runs on one rAF loop that stops itself at rest, so a page of
 *    idle cards costs zero frames;
 *  - accessibility rules stay intact: pointer-only, no focus capture, and
 *    `prefers-reduced-motion` disables the transform and glare entirely.
 *
 * Opt-in paths: the workspace "3D" toggle (localStorage `proofcore_3d_enabled`)
 * or the `enable3d` prop.
 */

const LERP = 0.12;
const REST_EPSILON = 0.001;
const MAX_DEG = 5;

interface Tilt {
  x: number;
  y: number;
  gx: number;
  gy: number;
}

function lerp(current: number, target: number): number {
  return current + (target - current) * LERP;
}

export function EnhancedCard({
  children,
  enable3d = undefined,
  className = "",
}: {
  children: ReactNode;
  enable3d?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<number>(0);
  const target = useRef<Tilt>({ x: 0, y: 0, gx: 50, gy: 50 });
  const current = useRef<Tilt>({ x: 0, y: 0, gx: 50, gy: 50 });
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    setReducedMotion(query.matches);
    const listener = (event: MediaQueryListEvent): void => setReducedMotion(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  const isGloballyEnabled = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      const value = window.localStorage?.getItem("proofcore_3d_enabled");
      if (value === "true") return true;
      if (value === "false") return false;
    } catch {
      // Storage can be blocked; the body attribute is the fallback.
    }
    const flag = (window.document?.body?.dataset?.enhanced3d as string) ?? null;
    return flag === "true";
  }, []);

  const enabled = (enable3d ?? isGloballyEnabled) && !reducedMotion;

  // One rAF loop while the card is away from rest; a lerped tilt reads like a
  // spring with damping, which is what After Effects' easy-spring feels like.
  const tick = React.useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const t = target.current;
    const c = current.current;
    c.x = lerp(c.x, t.x);
    c.y = lerp(c.y, t.y);
    c.gx = lerp(c.gx, t.gx);
    c.gy = lerp(c.gy, t.gy);
    const done =
      Math.abs(c.x - t.x) < REST_EPSILON &&
      Math.abs(c.y - t.y) < REST_EPSILON &&
      Math.abs(c.gx - t.gx) < 0.1 &&
      Math.abs(c.gy - t.gy) < 0.1;
    node.style.setProperty("--tilt-x", `${c.y.toFixed(3)}deg`);
    node.style.setProperty("--tilt-y", `${(-c.x).toFixed(3)}deg`);
    node.style.setProperty("--glare-x", `${c.gx.toFixed(2)}%`);
    node.style.setProperty("--glare-y", `${c.gy.toFixed(2)}%`);
    node.classList.toggle("is-tilting", !done);
    if (done) {
      current.current = { ...t };
      frame.current = 0;
      return;
    }
    frame.current = requestAnimationFrame(tick);
  }, []);

  const kick = React.useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onMouseMove = (event: React.MouseEvent): void => {
    const node = ref.current;
    if (!node || !enabled) return;
    const rect = node.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width;
    const ny = (event.clientY - rect.top) / rect.height;
    target.current = {
      x: (ny - 0.5) * MAX_DEG * 2,
      y: (nx - 0.5) * MAX_DEG * 2,
      gx: nx * 100,
      gy: ny * 100,
    };
    kick();
  };

  const onMouseLeave = (): void => {
    target.current = { x: 0, y: 0, gx: 50, gy: 50 };
    kick();
  };

  return (
    // Pointer-driven tilt on a wrapper: mouse handlers on a div are intentional
    // decoration, not interaction, so the element stays a plain presentational div.
    // biome-ignore lint/a11y/noStaticElementInteractions: pure pointer decoration, never a control
    <div
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={`enhanced-3d ${className}`}
      style={{ "--tilt-max": MAX_DEG } as CSSProperties}
      data-tilt-enabled={enabled ? "true" : undefined}
    >
      <span aria-hidden className="enhanced-3d-glare" />
      {children}
    </div>
  );
}

export default EnhancedCard;
