import React, { type ReactNode, useMemo, useRef, useState } from "react";

// Non-destructive, opt-in 3D enhancement layer for cards.
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

  // Global toggle (localStorage or data-enhanced3d on body)
  const isGloballyEnabled = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      const v = window.localStorage?.getItem("proofstack_3d_enabled");
      if (v === "true") return true;
      if (v === "false") return false;
    } catch {
      // ignore
    }
    const ds = (window.document?.body?.dataset?.enhanced3d as string) ?? null;
    return ds === "true";
  }, []);

  const effectiveEnabled = enable3d !== undefined ? enable3d : isGloballyEnabled;

  const onMouseMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotateX = (py - 0.5) * -14;
    const rotateY = (px - 0.5) * 14;
    setTilt({ x: rotateX, y: rotateY });
  };

  const onMouseLeave = () => setTilt({ x: 0, y: 0 });

  const style = useMemo(
    () =>
      effectiveEnabled
        ? {
            transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
            transformStyle: "preserve-3d" as any
          }
        : undefined,
    [tilt.x, tilt.y, effectiveEnabled]
  );

  return (
    <div ref={ref} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} style={style} className={className}>
      {children}
    </div>
  );
}

export default EnhancedCard;
