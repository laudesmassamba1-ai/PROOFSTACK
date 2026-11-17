import {
  LOGO_LAYERS,
  LOGO_LIGHT_LAYERS,
  LOGO_MONO_LAYERS,
  LOGO_PATH,
  LOGO_VIEWBOX,
} from "./logoGeometry.js";

/**
 * PROOFSTACK identity.
 *
 * One geometric P, three offset plates. The three layers are the three modules
 * converging into one proof: WORLD at the back, FLOW in the middle, EXIT in front.
 * The mark is deliberately a single object, not three icons side by side, so it
 * stays recognizable at favicon size.
 */

export type LogoVariant = "default" | "mono" | "onLight";

interface MarkProps {
  size?: number;
  variant?: LogoVariant;
  className?: string;
  title?: string;
}

function layersFor(variant: LogoVariant) {
  if (variant === "mono") return LOGO_MONO_LAYERS;
  if (variant === "onLight") return LOGO_LIGHT_LAYERS;
  return LOGO_LAYERS;
}

function gapFor(variant: LogoVariant): string {
  return variant === "onLight" ? "#FFFFFF" : "#050708";
}

export function Mark({ size = 34, variant = "default", className, title }: MarkProps) {
  const layers = layersFor(variant);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${LOGO_VIEWBOX} ${LOGO_VIEWBOX}`}
      fill="none"
      role="img"
      aria-label={title ?? "PROOFSTACK"}
      className={className}
    >
      {title ? <title>{title}</title> : null}
      {layers.map((layer) => (
        <path
          key={layer.offset}
          d={LOGO_PATH}
          fill={layer.color}
          fillRule="evenodd"
          opacity={layer.opacity}
          stroke={gapFor(variant)}
          strokeWidth="2.4"
          strokeLinejoin="round"
          transform={`translate(${layer.offset} ${layer.offset})`}
        />
      ))}
    </svg>
  );
}

interface WordmarkProps {
  className?: string;
  size?: number;
  showMark?: boolean;
  variant?: LogoVariant;
}

export function Wordmark({
  className,
  size = 18,
  showMark = true,
  variant = "default",
}: WordmarkProps) {
  return (
    <span className={`inline-flex items-center gap-3 ${className ?? ""}`}>
      {showMark ? <Mark size={Math.round(size * 1.7)} variant={variant} /> : null}
      <span
        className="wordmark select-none"
        style={{
          fontSize: size,
          lineHeight: 1,
          color: variant === "onLight" ? "#142033" : "#F2F6FA",
        }}
      >
        {/* The mark supplies the first P; printing it again reads “PPROOFSTACK”. */}
        {showMark ? "ROOFSTACK" : "PROOFSTACK"}
      </span>
    </span>
  );
}

/** Stable keys for repeated letters in the animated wordmark. */
const WORDMARK_LETTERS = (() => {
  const seen = new Map<string, number>();
  // The geometric P is rendered separately as the mark.
  return "ROOFSTACK".split("").map((char) => {
    const occurrence = (seen.get(char) ?? 0) + 1;
    seen.set(char, occurrence);
    return { char, key: `${char}-${occurrence}` };
  });
})();

/** Hero lockup: the wordmark draws in, letter by letter, on load. */
export function HeroLockup({ size = 64 }: { size?: number }) {
  return (
    <span className="inline-flex max-w-full items-end gap-3 sm:gap-4">
      <Mark size={Math.round(size * 0.92)} className="rise hero-mark" />
      <span
        aria-hidden="true"
        style={{ "--hero-size": `${size}px` } as React.CSSProperties}
        className="wordmark hero-wordmark inline-flex"
      >
        {WORDMARK_LETTERS.map((letter, index) => (
          <span
            key={letter.key}
            className="rise inline-block"
            style={{ animationDelay: `${120 + index * 55}ms` }}
            aria-hidden="true"
          >
            {letter.char}
          </span>
        ))}
      </span>
    </span>
  );
}
