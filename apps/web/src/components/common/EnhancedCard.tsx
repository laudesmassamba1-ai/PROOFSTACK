import React, { type ReactNode, useMemo, useRef, useState } from "react";

export function EnhancedCard({
  children,
  enable3d = true,
  className = "",
}: {
  children: ReactNode;
  enable3d?: boolean;
  className?: string;
}) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement | null>(null);

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
      enable3d
        ? {
            transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
            transformStyle: "preserve-3d" as any,
          }
        : undefined,
    [tilt.x, tilt.y, enable3d]
  );

  return (
    <div ref={ref} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} style={style} className={className}>
      {children}
    </div>
  );
}

export default EnhancedCard;
