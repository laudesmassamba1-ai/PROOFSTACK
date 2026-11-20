import { CircleCheck, Gauge, Timer } from "lucide-react";
import { LOGO_PATH, LOGO_VIEWBOX } from "./logoGeometry.js";

/**
 * The hero's one object.
 *
 * Reference 1 puts a single luminous subject over concentric rings, cropped by the
 * frame, with tiny captions floating in the empty corners. This is the same idea
 * carried by our own mark: the three-layer P, rendered as one iridescent plate,
 * floating inside three orbital rings.
 *
 * It is decorative — the hero's promise is in the copy — so the whole stage is
 * `aria-hidden` and the three chips repeat facts that are stated in text nearby
 * ("29 passed · 3 findings", the 0–100 score, the 18s run). Nothing here is the only
 * place a piece of information exists.
 */
export function OrbitStage() {
  return (
    <div className="orbit-stage" aria-hidden="true" data-scrub="orbit">
      <svg
        className="orbit-rings"
        viewBox="0 0 600 600"
        fill="none"
        aria-hidden="true"
        focusable="false"
        preserveAspectRatio="xMidYMid meet"
      >
        <g className="orbit-ring-group">
          <ellipse className="orbit-ring" cx="300" cy="300" rx="286" ry="150" />
          <ellipse
            className="orbit-ring orbit-ring--bright"
            cx="300"
            cy="300"
            rx="286"
            ry="150"
            transform="rotate(1 300 300)"
          />
        </g>
        <g className="orbit-ring-group orbit-ring-group--reverse">
          <ellipse className="orbit-ring" cx="300" cy="300" rx="244" ry="238" opacity="0.7" />
          <circle className="orbit-ring" cx="300" cy="300" r="186" opacity="0.45" />
        </g>
        <ellipse className="orbit-ring" cx="300" cy="300" rx="210" ry="92" opacity="0.35" />
        {/* Two satellites, on opposite orbits. */}
        <circle cx="88" cy="300" r="3.2" fill="#78e3cb" />
        <circle cx="512" cy="300" r="2.4" fill="#8b7bf7" />
        <circle cx="300" cy="90" r="2" fill="#e967a6" opacity="0.8" />
      </svg>

      <span className="orbit-chip orbit-chip--pass">
        <CircleCheck size={12} />
        29 PASSED · 3 FOUND
      </span>
      <span className="orbit-chip orbit-chip--score">
        <Gauge size={12} />
        SCORE 87 / 100
      </span>
      <span className="orbit-chip orbit-chip--run">
        <Timer size={12} />
        RUN 18.4 S
      </span>

      <svg
        className="orbit-mark"
        viewBox={`0 0 ${LOGO_VIEWBOX} ${LOGO_VIEWBOX}`}
        fill="none"
        role="presentation"
      >
        <defs>
          <linearGradient id="orbit-plate" x1="8%" y1="0%" x2="92%" y2="100%">
            <stop offset="0%" stopColor="#9ff5df" />
            <stop offset="34%" stopColor="#70c9db" />
            <stop offset="66%" stopColor="#8b7bf7" />
            <stop offset="100%" stopColor="#e967a6" />
          </linearGradient>
          <linearGradient id="orbit-plate-2" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e967a6" stopOpacity="0.85" />
            <stop offset="52%" stopColor="#8b7bf7" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#78e3cb" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        {/* Three offset plates: the same construction as the logo, in one material. */}
        <path
          className="orbit-mark-shape"
          d={LOGO_PATH}
          fill="url(#orbit-plate-2)"
          fillRule="evenodd"
          opacity="0.42"
          transform="translate(26 26)"
        />
        <path
          d={LOGO_PATH}
          fill="url(#orbit-plate)"
          fillRule="evenodd"
          stroke="#05090d"
          strokeWidth="5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
