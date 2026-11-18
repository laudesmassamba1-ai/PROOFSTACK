import type React from "react";

/**
 * The PROOFCORE intelligence mark.
 *
 * A starburst of tapered rays drawn once and reused everywhere AI is speaking:
 * chat avatar, empty-state greeting, navigation. It replaces the generic
 * "sparkle/star" icon that read as a toy next to the rest of the identity.
 *
 * Geometry: 12 rays of varying length around a centre, like an asterisk drawn
 * with a brush — recognisable at 16px, elegant at 96px. Colour is inherited via
 * `currentColor`, so it stays coherent in both themes for free.
 */

const RAYS = [
  { angle: 0, length: 1 },
  { angle: 30, length: 0.62 },
  { angle: 60, length: 0.86 },
  { angle: 90, length: 0.58 },
  { angle: 120, length: 0.94 },
  { angle: 150, length: 0.6 },
  { angle: 180, length: 1 },
  { angle: 210, length: 0.62 },
  { angle: 240, length: 0.86 },
  { angle: 270, length: 0.58 },
  { angle: 300, length: 0.94 },
  { angle: 315, length: 0.55 },
];

const RAY_WIDTH = 5.2;
const INNER = 10;
const OUTER = 21;

function rayPath(angleDeg: number, length: number): string {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const outer = INNER + (OUTER - INNER) * length;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Perpendicular offset for the tapered shaft.
  const nx = -sin * (RAY_WIDTH / 2);
  const ny = cos * (RAY_WIDTH / 2);
  const tipX = 24 + cos * outer;
  const tipY = 24 + sin * outer;
  const baseX = 24 + cos * INNER;
  const baseY = 24 + sin * INNER;
  // Slightly rounded tip by nudging the two base corners inward.
  return `M ${24 + nx} ${24 + ny} L ${tipX} ${tipY} L ${24 - nx} ${24 - ny} L ${baseX - nx * 0.4} ${
    baseY - ny * 0.4
  } Z`;
}

interface AiMarkProps {
  size?: number;
  className?: string;
  title?: string;
  /** Decorative by default; set a title to make it meaningful. */
  decorative?: boolean;
}

export function AiMark({
  size = 20,
  className,
  title,
  decorative = true,
}: AiMarkProps): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="currentColor"
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : (title ?? "Intelligence")}
      className={className}
    >
      {title && !decorative ? <title>{title}</title> : null}
      {RAYS.map((ray) => (
        <path key={ray.angle} d={rayPath(ray.angle, ray.length)} />
      ))}
    </svg>
  );
}
