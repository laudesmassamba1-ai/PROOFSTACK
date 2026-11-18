import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../../lib/theme.js";

/**
 * Module objects are state-bearing. Their element count comes from real run totals,
 * capped only so the silhouette stays legible. The adjacent screen always states the
 * exact totals; colour is never the only signal.
 */
interface ObjectProps {
  passed: number;
  failed: number;
  total: number;
}

function useObjectMotion<T extends SVGSVGElement>() {
  const ref = useRef<T>(null);
  const reduced = usePrefersReducedMotion();
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry?.isIntersecting ?? true),
      { rootMargin: "80px" }
    );
    observer.observe(node);
    const onVisibility = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { ref, running: !reduced && onScreen && tabVisible };
}

function useUid() {
  return useId().replace(/[^a-zA-Z0-9]/g, "");
}

export function WorldObject({ passed, failed, total }: ObjectProps) {
  const uid = useUid();
  const { ref, running } = useObjectMotion<SVGSVGElement>();
  const shown = Math.min(Math.max(passed + failed, 0), 10);
  const passedShown = Math.min(passed, shown);
  const items = Array.from({ length: shown }, (_, index) => {
    const angle = (index / Math.max(1, shown)) * Math.PI * 2 - Math.PI / 2;
    return {
      // Stable within a run: position + state. Index alone changes when a result
      // lands and would remount the SVG node mid-animation.
      key: `sat-${index}-${index < passedShown ? "pass" : "fail"}`,
      x: 140 + Math.cos(angle) * 94,
      y: 108 + Math.sin(angle) * 42,
      passed: index < passedShown,
    };
  });
  const hasData = total > 0;

  return (
    <svg
      ref={ref}
      viewBox="0 0 280 220"
      className={`module-object module-object-world ${running ? "is-running" : ""}`}
      role="img"
      aria-label={
        hasData
          ? `WORLD orbit: ${passed} passed and ${failed} failed cases in the latest run`
          : "WORLD orbit unlit: no run received"
      }
    >
      <defs>
        <radialGradient id={`${uid}-sphere`} cx="32%" cy="24%" r="78%">
          <stop offset="0%" stopColor="#c9d4ff" />
          <stop offset="28%" stopColor="#6d8bff" />
          <stop offset="62%" stopColor="#2f5bff" />
          <stop offset="100%" stopColor="#14256b" />
        </radialGradient>
        <radialGradient id={`${uid}-halo`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5cf2c4" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#5cf2c4" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-ring`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f7f9ff" stopOpacity="0.9" />
          <stop offset="42%" stopColor="#83a4ff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0e1c52" stopOpacity="0.1" />
        </linearGradient>
        <filter id={`${uid}-soft`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <clipPath id={`${uid}-globe-clip`}>
          <circle cx="140" cy="108" r="44" />
        </clipPath>
        <linearGradient id={`${uid}-scan`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#5cf2c4" stopOpacity="0" />
          <stop offset="70%" stopColor="#5cf2c4" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#d9fff2" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <ellipse
        cx="140"
        cy="198"
        rx="82"
        ry="12"
        fill="#0a0a0b"
        opacity="0.16"
        filter={`url(#${uid}-soft)`}
      />
      {hasData ? (
        <ellipse cx="140" cy="108" rx="104" ry="52" fill={`url(#${uid}-halo)`} opacity="0.5" />
      ) : null}
      <g className="world-rings" style={{ transformOrigin: "140px 108px" }}>
        <ellipse
          className="world-ring world-ring-a"
          fill="none"
          stroke={`url(#${uid}-ring)`}
          strokeWidth="1.4"
          opacity={hasData ? 0.9 : 0.28}
          strokeDasharray={hasData ? undefined : "3 7"}
        />
        <ellipse
          className="world-ring world-ring-b"
          cx="140"
          cy="108"
          rx="84"
          ry="76"
          fill="none"
          stroke={`url(#${uid}-ring)`}
          strokeWidth="1"
          opacity={hasData ? 0.55 : 0.2}
          transform="rotate(34 140 108)"
          strokeDasharray={hasData ? undefined : "3 8"}
        />
        {hasData ? (
          <g className="world-satellites">
            {items.map((item, satIndex) => (
              <g
                key={item.key}
                className="world-sat"
                style={{ "--sat-i": satIndex } as CSSProperties}
              >
                <circle cx={item.x} cy={item.y} r="7" fill="var(--object-halo)" opacity="0.16" />
                <circle
                  cx={item.x}
                  cy={item.y}
                  r="4.2"
                  fill={item.passed ? "#5cf2c4" : "#ff6d70"}
                  stroke="#faf8f3"
                  strokeWidth="1.4"
                />
                <circle cx={item.x - 1.2} cy={item.y - 1.5} r="1.1" fill="#ffffff" opacity="0.9" />
              </g>
            ))}
          </g>
        ) : null}
      </g>
      <circle
        className="world-sphere"
        cx="140"
        cy="108"
        r="44"
        fill={`url(#${uid}-sphere)`}
        opacity={hasData ? 1 : 0.42}
      />
      {/* Radar sweep: one activation pass on entry, a continuous scan on hover. */}
      <g className="world-scan" clipPath={`url(#${uid}-globe-clip)`} opacity={hasData ? 0.75 : 0.3}>
        <path d="M140 108 L140 58 A50 50 0 0 1 183 87 Z" fill={`url(#${uid}-scan)`} />
      </g>
      <ellipse
        cx="124"
        cy="88"
        rx="18"
        ry="11"
        fill="#ffffff"
        opacity={hasData ? 0.24 : 0.1}
        transform="rotate(-28 124 88)"
      />
      <circle cx="140" cy="108" r="44" fill="none" stroke="var(--object-ring)" />
      <path
        d="M110 128c17 13 43 16 63 5"
        fill="none"
        stroke="#5cf2c4"
        strokeOpacity={hasData ? 0.42 : 0.12}
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function FlowObject({ passed, failed, total }: ObjectProps) {
  const uid = useUid();
  const { ref, running } = useObjectMotion<SVGSVGElement>();
  const count = Math.min(Math.max(passed + failed, 0), 7);
  const passedShown = Math.min(passed, count);
  const hasData = total > 0;
  const links = Array.from({ length: hasData ? count : 5 }, (_, index) => {
    const x = 58 + (index % 4) * 55;
    const y = 148 - Math.floor(index / 4) * 48 + (index % 2) * 9;
    return {
      // Stable within a run: position + state, not array index.
      key: `link-${index}-${hasData && index >= passedShown ? "fail" : index < passedShown ? "pass" : "idle"}`,
      x,
      y,
      rotate: -16 + index * 4,
      passed: index < passedShown,
      failed: hasData && index >= passedShown,
    };
  });

  return (
    <svg
      ref={ref}
      viewBox="0 0 280 220"
      className={`module-object module-object-flow ${hasData ? "has-data" : ""} ${running ? "is-running" : ""}`}
      role="img"
      aria-label={
        hasData
          ? `FLOW chain: ${passed} passed and ${failed} failed cases in the latest run`
          : "FLOW chain matte: no run received"
      }
    >
      <defs>
        <linearGradient id={`${uid}-chrome`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f7fffc" />
          <stop offset="24%" stopColor="#9cf7da" />
          <stop offset="54%" stopColor="#33aa88" />
          <stop offset="78%" stopColor="#b9ffe9" />
          <stop offset="100%" stopColor="#19725e" />
        </linearGradient>
        <linearGradient id={`${uid}-matte`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#d7d2c8" />
          <stop offset="100%" stopColor="#8d8980" />
        </linearGradient>
        <filter id={`${uid}-shadow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <ellipse
        cx="142"
        cy="198"
        rx="100"
        ry="12"
        fill="#0a0a0b"
        opacity="0.16"
        filter={`url(#${uid}-shadow)`}
      />
      {links.map((link, linkIndex) => (
        <g
          key={link.key}
          transform={`translate(${link.x} ${link.y}) rotate(${link.rotate})`}
          className={`flow-link ${link.failed ? "flow-link-broken" : ""}`.trim()}
          style={{ "--flow-i": linkIndex } as CSSProperties}
        >
          <g className="flow-link-inner">
            <path
              d="M-22 0h44"
              stroke={link.failed ? "#b62c36" : "#7a766d"}
              strokeWidth="2"
              opacity="0.35"
            />
            <ellipse
              cx="0"
              cy="0"
              rx="28"
              ry="16"
              fill="none"
              stroke={
                link.failed ? "#b62c36" : link.passed ? `url(#${uid}-chrome)` : `url(#${uid}-matte)`
              }
              strokeWidth="9"
              strokeDasharray={link.failed ? "34 12" : undefined}
            />
            <ellipse
              cx="-5"
              cy="-7"
              rx="14"
              ry="5"
              fill="#ffffff"
              opacity={link.passed ? 0.42 : 0.18}
            />
          </g>
        </g>
      ))}
      {!hasData ? (
        <path
          d="M42 182h198"
          stroke="#8d8980"
          strokeWidth="1"
          strokeDasharray="2 6"
          opacity="0.65"
        />
      ) : null}
    </svg>
  );
}

export function ExitObject({ passed, failed, total }: ObjectProps) {
  const uid = useUid();
  const { ref, running } = useObjectMotion<SVGSVGElement>();
  const count = Math.min(Math.max(passed + failed, 0), 5);
  const failedShown = Math.min(failed, count);
  const hasData = total > 0;
  const slabs = Array.from({ length: count }, (_, index) => ({
    key: `slab-${index}-${index < failedShown ? "fail" : "pass"}`,
    y: 166 - index * 24,
    failed: index < failedShown,
  }));

  return (
    <svg
      ref={ref}
      viewBox="0 0 280 220"
      className={`module-object module-object-exit ${hasData ? "has-data" : ""} ${running ? "is-running" : ""}`}
      role="img"
      aria-label={
        hasData
          ? `EXIT stack: ${passed} passed and ${failed} failed cases in the latest run`
          : "EXIT tray empty: no run received"
      }
    >
      <defs>
        <linearGradient id={`${uid}-amber`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff2c8" />
          <stop offset="26%" stopColor="#ffc84e" />
          <stop offset="72%" stopColor="#e48b00" />
          <stop offset="100%" stopColor="#9f5200" />
        </linearGradient>
        <linearGradient id={`${uid}-side`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c77700" />
          <stop offset="100%" stopColor="#7f3d00" />
        </linearGradient>
        <filter id={`${uid}-shadow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      <ellipse
        className="exit-shadow"
        cx="140"
        cy="198"
        rx="92"
        ry="12"
        fill="#0a0a0b"
        opacity="0.18"
        filter={`url(#${uid}-shadow)`}
      />
      {!hasData ? (
        <g className="exit-tray">
          {/* Waiting for the first run: the tray draws itself in, then a ghost
           * slab keeps rising out of it — data ready to leave. */}
          <path
            className="exit-tray-line exit-tray-top"
            d="M58 168l82-38 82 38-82 38z"
            pathLength={100}
            fill="none"
            stroke="#8d8980"
            strokeDasharray="4 7"
          />
          <path
            className="exit-tray-line exit-tray-side"
            d="M58 168v13l82 38 82-38v-13"
            pathLength={100}
            fill="none"
            stroke="#8d8980"
            strokeDasharray="4 7"
            opacity="0.65"
          />
          <g className="exit-ghost">
            <path
              d="M58 158l82-38 82 38-82 38z"
              fill={`url(#${uid}-amber)`}
              opacity="0.3"
              stroke="#ffc84e"
              strokeOpacity="0.55"
            />
          </g>
        </g>
      ) : (
        <g className="exit-stack">
          {slabs.map((slab, slabIndex) => (
            <g
              key={slab.key}
              transform={`translate(${slab.failed ? 9 : 0} ${slab.y})`}
              className="exit-slab"
              style={{ "--exit-i": slabIndex } as CSSProperties}
            >
              <g className="exit-slab-inner">
                <path
                  d="M58 0l82-37 82 37-82 37z"
                  fill={`url(#${uid}-amber)`}
                  stroke="#6d3900"
                  strokeOpacity="0.25"
                />
                <path d="M58 0v15l82 37 82-37V0" fill={`url(#${uid}-side)`} opacity="0.92" />
                <path
                  d="M76 -3l66-29 44 20"
                  fill="none"
                  stroke="#fff8dc"
                  strokeOpacity="0.48"
                  strokeWidth="1.2"
                />
                {slab.failed ? (
                  <>
                    <path d="M136 -38v16" stroke="#b62c36" strokeWidth="3" />
                    <path d="M136 16v16" stroke="#b62c36" strokeWidth="3" />
                  </>
                ) : null}
              </g>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

export function ModuleObject({
  module,
  ...props
}: ObjectProps & { module: "world" | "flow" | "exit" | "fail" | "clean" }) {
  if (module === "world") return <WorldObject {...props} />;
  if (module === "flow") return <FlowObject {...props} />;
  if (module === "fail") return <AuditObject {...props} variant="fail" />;
  if (module === "clean") return <AuditObject {...props} variant="clean" />;
  return <ExitObject {...props} />;
}

/** FAIL/CLEAN audits: a gauge whose needle and arc carry the real pass rate.
 * Entry: the arc fills up while the needle swings from zero and settles on the
 * score (one beat of overshoot, like a physical meter). Hover: a diagnostic
 * sweep — the needle walks the whole scale, then comes back to the truth. All
 * motion is CSS on custom properties so the resting state is always the value. */
function AuditObject({
  passed,
  total,
  variant,
}: {
  passed: number;
  failed?: number;
  total: number;
  variant: "fail" | "clean";
}) {
  const { ref, running } = useObjectMotion<SVGSVGElement>();
  const rate = total > 0 ? passed / total : 0;
  const angle = -90 + Math.min(1, Math.max(0, rate)) * 180;
  const color = variant === "fail" ? "#f43f5e" : "#10b981";
  const arcLen = Math.PI * 60 * Math.min(1, Math.max(0, rate));
  return (
    <svg
      ref={ref}
      viewBox="0 0 200 140"
      className={`module-object module-object-audit audit-${variant} ${running ? "is-running" : ""}`}
      role="img"
      aria-label={`${variant} audit score`}
    >
      <path
        d="M40 110 A60 60 0 0 1 160 110"
        fill="none"
        stroke="var(--object-track)"
        strokeWidth="10"
        strokeLinecap="round"
        className="audit-track"
      />
      <path
        className="audit-arc"
        d="M40 110 A60 60 0 0 1 160 110"
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${arcLen} 999`}
        style={{ "--arc-len": `${arcLen}px` } as CSSProperties}
      />
      <g className="audit-needle" style={{ "--audit-angle": `${angle}deg` } as CSSProperties}>
        {/* The needle is drawn pointing straight up; the CSS rotation carries
         * the score — the transform animation never fights the geometry. */}
        <line
          x1="100"
          y1="110"
          x2="100"
          y2="66"
          stroke="var(--object-glyph)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      <circle cx="100" cy="110" r="5" fill="var(--object-glyph)" className="audit-hub" />
      {/* The score sits above the arc: it never collides with the gauge band. */}
      <text
        x="100"
        y="38"
        textAnchor="middle"
        fill="var(--object-glyph)"
        fontSize="24"
        fontWeight="700"
        className="audit-score"
      >
        {total > 0 ? `${Math.round(rate * 100)}` : "—"}
      </text>
    </svg>
  );
}
