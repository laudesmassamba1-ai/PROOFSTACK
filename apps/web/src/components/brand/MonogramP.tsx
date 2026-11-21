import type React from "react";

// Simple stylized PROOFCORE monogram, designed to be recognizable at small sizes.
// This is intentionally minimal and scalable via viewBox.
export const MonogramP: React.FC<{ color?: string; stroke?: string; size?: number }> = ({
  // `color` stays in the prop type for API compatibility but the mark is drawn
  // from the brand gradient; it is intentionally not destructured.
  stroke = "#9af0e0",
  size = 120,
}) => {
  const sz = size;
  return (
    <svg
      width={sz}
      height={sz}
      viewBox="0 0 120 120"
      aria-label="ProofCore monogram"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#78e3cb" offset="0" />
          <stop stopColor="#70c9db" offset="1" />
        </linearGradient>
      </defs>
      {/* Stem */}
      <rect x="16" y="18" width="18" height="84" rx="9" fill="url(#grad)" />
      {/* Bowl */}
      <path
        d="M34 24 C60 24, 84 38, 84 66 C84 88, 60 98, 34 98"
        stroke={stroke}
        strokeWidth="12"
        strokeLinecap="round"
        fill="none"
      />
      {/* Inner cut to suggest three connected systems (WORLD, FLOW, EXIT) as subtle negative space */}
      <path
        d="M36 70 C50 60, 66 60, 78 68"
        stroke={stroke}
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
};
export default MonogramP;
