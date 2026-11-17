import React, { type CSSProperties, type ReactNode, useMemo, useRef, useState } from "react";

/**
 * Non-destructive, opt-in 3D enhancement layer for cards.
 *
 * Accessibility rules enforced here:
 *  - the tilt follows the pointer only; it never captures keyboard focus and
 *    never wraps interactive content in its own handlers, so tab order and
 *    screen-reader semantics are untouched;
 *  - `prefers-reduced-motion` disables the transform entirely;
 *  - without opt-in (localStorage `proofcore_3d_enabled` or a body data
 *    attribute) the component renders as a plain div with zero style.
 */
export function EnhancedCard({
  children,
  enable3d = undefined,
  className = "",
}: {
  children: ReactNode;
  enable3d?: boolean;
  className?: string;
}) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  React.useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    setReducedMotion(query.matches);
    const listener = (event: MediaQueryListEvent): void => setReducedMotion(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  // Global toggle (localStorage or data-enhanced3d on body)
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

  const effectiveEnabled = (enable3d ?? isGloballyEnabled) && !reducedMotion;

  const onMouseMove = (event: React.MouseEvent): void => {
    const element = ref.current;
    if (!element || !effectiveEnabled) return;
    const rect = element.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    setTilt({ x: (py - 0.5) * -14, y: (px - 0.5) * 14 });
  };

  const onMouseLeave = (): void => setTilt({ x: 0, y: 0 });

  const style = useMemo<CSSProperties | undefined>(() => {
    if (!effectiveEnabled) return undefined;
    return {
      transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
      transformStyle: "preserve-3d",
      transition: "transform 120ms linear",
    };
  }, [tilt.x, tilt.y, effectiveEnabled]);

  return (
    // Pointer-driven tilt on a wrapper: mouse handlers on a div are intentional
    // decoration, not interaction, so the element stays a plain presentational div.
    // biome-ignore lint/a11y/noStaticElementInteractions: pure pointer decoration, never a control
    <div
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={style}
      className={className}
    >
      {children}
    </div>
  );
}

export default EnhancedCard;
