import type { CSSProperties } from "react";

/**
 * Module objects for the marketing wall.
 *
 * Five distinct silhouettes, one lighting language. They are not Lucide icons in a
 * coloured square: each one is a small, tangible instrument that suggests what the
 * module actually reads. All inline SVG, no dependency, no WebGL, no image download.
 *
 *   WORLD — an iridescent orbit: a sphere with two tilted rings and one satellite per
 *           locale profile.
 *   FLOW  — a chrome chain: linked loops tracing a path, one loop per journey stage.
 *   EXIT  — velvet slabs: stacked layers with a visible seam where data can be lost.
 *   FAIL  — a scanner arc sweeping a surface with a hairline fault line.
 *   CLEAN — a dial with a needle and a measured arc, the UI score made physical.
 *
 * The objects are decorative: the panel already states the module name, tokens and
 * output in text. They are `aria-hidden` and never carry information alone.
 */

export type ObjectId = "world" | "flow" | "exit" | "fail" | "clean";

export function ModuleObjectArt({ id, className }: { id: ObjectId; className?: string }) {
  const common = {
    viewBox: "0 0 120 96",
    className: `module-art module-art-${id} ${className ?? ""}`,
    "aria-hidden": true as const,
    role: "presentation" as const,
    focusable: "false" as const,
  };

  if (id === "world") {
    return (
      <svg {...common}>
        <title>WORLD module object</title>
        <defs>
          <radialGradient id="wo-sphere" cx="34%" cy="28%" r="78%">
            <stop offset="0%" stopColor="#dffdf4" />
            <stop offset="42%" stopColor="#78e3cb" />
            <stop offset="100%" stopColor="#1b5f78" />
          </radialGradient>
          <linearGradient id="wo-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c9fff0" />
            <stop offset="50%" stopColor="#70c9db" />
            <stop offset="100%" stopColor="#3a5ec4" />
          </linearGradient>
        </defs>
        <ellipse
          cx="60"
          cy="50"
          rx="48"
          ry="17"
          fill="none"
          stroke="url(#wo-ring)"
          strokeWidth="2"
          transform="rotate(-16 60 50)"
          opacity=".9"
        />
        <ellipse
          cx="60"
          cy="50"
          rx="42"
          ry="14"
          fill="none"
          stroke="url(#wo-ring)"
          strokeWidth="1.2"
          transform="rotate(26 60 50)"
          opacity=".65"
        />
        <circle cx="60" cy="50" r="23" fill="url(#wo-sphere)" />
        <circle cx="60" cy="50" r="23" fill="none" stroke="#e8fff8" strokeOpacity=".35" />
        <circle cx="53" cy="42" r="6" fill="#fff" opacity=".35" />
        <circle cx="96" cy="37" r="2.6" fill="#a8ffe4" />
        <circle cx="24" cy="63" r="2" fill="#70c9db" />
      </svg>
    );
  }

  if (id === "flow") {
    const links = [26, 48, 70, 92];
    return (
      <svg {...common}>
        <title>FLOW module object</title>
        <defs>
          <linearGradient id="fl-link" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor="#eafff8" />
            <stop offset="45%" stopColor="#5cf2c4" />
            <stop offset="100%" stopColor="#0e9e86" />
          </linearGradient>
        </defs>
        <path d="M14 50 H106" stroke="#ffffff" strokeOpacity=".08" strokeWidth="1" />
        {links.map((x, i) => (
          <g key={x} transform={`rotate(${i % 2 ? 24 : -24} ${x} 50)`}>
            <rect
              x={x - 9}
              y="36"
              width="18"
              height="28"
              rx="9"
              fill="none"
              stroke="url(#fl-link)"
              strokeWidth="4.5"
            />
            <rect x={x - 6} y="40" width="5" height="7" rx="2.5" fill="#fff" opacity=".45" />
          </g>
        ))}
        <circle cx="106" cy="50" r="3" fill="#5cf2c4" />
      </svg>
    );
  }

  if (id === "exit") {
    return (
      <svg {...common}>
        <title>EXIT module object</title>
        <defs>
          <linearGradient id="ex-slab" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor="#ffe6b8" />
            <stop offset="45%" stopColor="#ffb020" />
            <stop offset="100%" stopColor="#a65d00" />
          </linearGradient>
        </defs>
        {[0, 1, 2].map((i) => (
          <g key={i} transform={`translate(${i * 4} ${-i * 8})`}>
            <rect
              x="24"
              y={54 + i * 2}
              width="68"
              height="13"
              rx="5"
              fill="url(#ex-slab)"
              opacity={0.62 + i * 0.14}
            />
            <rect x="28" y={57 + i * 2} width="44" height="2" rx="1" fill="#fff6df" opacity=".45" />
          </g>
        ))}
        {/* The seam: the top slab is visibly offset, the round-trip difference made form. */}
        <path d="M96 50 l8 -6" stroke="#fff0cc" strokeWidth="1.2" opacity=".8" />
      </svg>
    );
  }

  if (id === "fail") {
    return (
      <svg {...common}>
        <title>FAIL module object</title>
        <defs>
          <linearGradient id="fa-arc" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ff8fa3" stopOpacity="0" />
            <stop offset="70%" stopColor="#f07884" />
            <stop offset="100%" stopColor="#ffd0d6" />
          </linearGradient>
        </defs>
        <path
          d="M20 68 A40 40 0 0 1 100 68"
          fill="none"
          stroke="#ffffff"
          strokeOpacity=".1"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <path
          d="M20 68 A40 40 0 0 1 88 38"
          fill="none"
          stroke="url(#fa-arc)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M60 30 L60 68"
          stroke="#f07884"
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity=".8"
        />
        <path
          d="M52 60 l8 8 8 -8"
          fill="none"
          stroke="#ffd0d6"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="60" cy="68" r="3" fill="#f07884" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <title>CLEAN module object</title>
      <defs>
        <linearGradient id="cl-arc" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#70c9db" />
          <stop offset="100%" stopColor="#73d68b" />
        </linearGradient>
      </defs>
      <path
        d="M26 72 A34 34 0 0 1 94 72"
        fill="none"
        stroke="#ffffff"
        strokeOpacity=".1"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M26 72 A34 34 0 0 1 82 46"
        fill="none"
        stroke="url(#cl-arc)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M60 72 L78 49" stroke="#eafff6" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="60" cy="72" r="4" fill="#73d68b" />
      <text x="60" y="90" textAnchor="middle" fill="#dff8ef" fontSize="9" fontFamily="monospace">
        /100
      </text>
    </svg>
  );
}

/** The sixth cell's object: the single engine carrying the five modules. */
export function EngineObjectArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 96"
      className={`module-art module-art-engine ${className ?? ""}`}
      aria-hidden="true"
      role="presentation"
      focusable="false"
    >
      <title>Shared engine object</title>
      <g fill="none" stroke="#78e3cb" strokeWidth="1.2" opacity=".75">
        <circle cx="60" cy="48" r="30" />
        <circle cx="60" cy="48" r="20" strokeDasharray="2 4" />
        <path d="M60 18 v60 M30 48 h60" opacity=".35" />
      </g>
      {[0, 72, 144, 216, 288].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x = 60 + Math.cos(rad) * 30;
        const y = 48 + Math.sin(rad) * 30;
        return <circle key={deg} cx={x} cy={y} r="2.6" fill="#a8ffe4" />;
      })}
      <circle cx="60" cy="48" r="7" fill="#78e3cb" opacity=".85" />
      <circle cx="57" cy="45" r="2.4" fill="#fff" opacity=".7" />
    </svg>
  );
}

/** Kept for callers that want the style as a CSS variable. */
export function objectStyle(accent: string): CSSProperties {
  return { "--object-accent": accent } as CSSProperties;
}
