import type { ReactNode } from "react";

/**
 * A card wrapper.
 *
 * It used to tilt in 3D under the pointer. That was decorative, and it deformed the
 * content underneath while it moved: text shifted, borders clipped, and a card that was
 * being read became harder to read. The prop stays so existing call sites keep compiling,
 * but the layer is now plain — motion lives in page transitions, not in the content.
 */
export function EnhancedCard({
  children,
  className = "",
}: {
  children: ReactNode;
  /** Kept for API compatibility; there is no 3D layer any more. */
  enable3d?: boolean;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}

export default EnhancedCard;
