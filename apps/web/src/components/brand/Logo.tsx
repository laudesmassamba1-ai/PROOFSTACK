/**
 * PROOFSTACK identity.
 *
 * Concept: three structural components converge into one verified structure. The
 * mark is an isometric solid built from exactly three faces — WORLD, FLOW, EXIT —
 * with a verification notch cut across the top. It is one object, not three icons
 * standing next to each other, because the product's claim is unity of engine.
 */

export type LogoVariant = "default" | "mono" | "onLight";

interface MarkProps {
  size?: number;
  variant?: LogoVariant;
  className?: string;
  title?: string;
}

const PALETTE: Record<LogoVariant, { top: string; left: string; right: string; notch: string }> = {
  default: { top: "#78E3CB", left: "#315FC8", right: "#73D68B", notch: "#050708" },
  mono: { top: "#F2F6FA", left: "#9AA9B8", right: "#D7E2EC", notch: "#050708" },
  onLight: { top: "#2FA98C", left: "#315FC8", right: "#1B2F77", notch: "#FFFFFF" },
};

export function Mark({ size = 34, variant = "default", className, title }: MarkProps) {
  const colors = PALETTE[variant];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      role="img"
      aria-label={title ?? "PROOFSTACK"}
      className={className}
    >
      {title ? <title>{title}</title> : null}
      {/* three faces, one solid */}
      <path d="M20 4.5 34.2 12.4 20 20.3 5.8 12.4Z" fill={colors.top} />
      <path d="M5.8 12.4 20 20.3v15.2L5.8 27.6Z" fill={colors.left} />
      <path d="M34.2 12.4 20 20.3v15.2l14.2-7.9Z" fill={colors.right} opacity={variant === "mono" ? 0.75 : 0.92} />
      {/* verification notch across the top face */}
      <path
        d="M12.6 12.9 17.4 16.2 27.1 10.4"
        stroke={colors.notch}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

interface WordmarkProps {
  className?: string;
  size?: number;
  showMark?: boolean;
  variant?: LogoVariant;
}

export function Wordmark({ className, size = 18, showMark = true, variant = "default" }: WordmarkProps) {
  return (
    <span className={`inline-flex items-center gap-3 ${className ?? ""}`}>
      {showMark ? <Mark size={Math.round(size * 1.55)} variant={variant} /> : null}
      <span
        className="wordmark select-none"
        style={{
          fontSize: size,
          lineHeight: 1,
          color: variant === "onLight" ? "#142033" : "#F2F6FA",
        }}
      >
        PROOFSTACK
      </span>
    </span>
  );
}

/** Hero lockup: the wordmark draws in, letter by letter, on load. */
export function HeroLockup({ size = 64 }: { size?: number }) {
  const letters = "PROOFSTACK".split("");
  return (
    <span className="inline-flex items-end gap-4">
      <Mark size={Math.round(size * 0.9)} className="rise" />
      <span
        aria-label="PROOFSTACK"
        role="heading"
        style={{ fontSize: size, lineHeight: 1 }}
        className="wordmark inline-flex"
      >
        {letters.map((letter, index) => (
          <span
            key={`${letter}-${index}`}
            className="rise inline-block"
            style={{ animationDelay: `${120 + index * 55}ms` }}
            aria-hidden="true"
          >
            {letter}
          </span>
        ))}
      </span>
    </span>
  );
}
