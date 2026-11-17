import { useEffect, useId, useRef, useState } from "react";
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
          cx="140"
          cy="108"
          rx="102"
          ry="47"
          fill="none"
          stroke={`url(#${uid}-ring)`}
          strokeWidth="1.4"
          opacity={hasData ? 0.9 : 0.28}
          strokeDasharray={hasData ? undefined : "3 7"}
        />
        <ellipse
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
            {items.map((item, index) => (
              <g key={index}>
                <circle cx={item.x} cy={item.y} r="7" fill="#ffffff" opacity="0.16" />
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
      <circle cx="140" cy="108" r="44" fill={`url(#${uid}-sphere)`} opacity={hasData ? 1 : 0.42} />
      <ellipse
        cx="124"
        cy="88"
        rx="18"
        ry="11"
        fill="#ffffff"
        opacity={hasData ? 0.24 : 0.1}
        transform="rotate(-28 124 88)"
      />
      <circle cx="140" cy="108" r="44" fill="none" stroke="#ffffff" strokeOpacity="0.2" />
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
  const { ref } = useObjectMotion<SVGSVGElement>();
  const count = Math.min(Math.max(passed + failed, 0), 7);
  const passedShown = Math.min(passed, count);
  const hasData = total > 0;
  const links = Array.from({ length: hasData ? count : 5 }, (_, index) => {
    const x = 58 + (index % 4) * 55;
    const y = 148 - Math.floor(index / 4) * 48 + (index % 2) * 9;
    return {
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
      className={`module-object module-object-flow ${hasData ? "has-data" : ""}`}
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
      {links.map((link, index) => (
        <g
          key={index}
          transform={`translate(${link.x} ${link.y}) rotate(${link.rotate})`}
          className={link.failed ? "flow-link-broken" : undefined}
        >
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
  const { ref } = useObjectMotion<SVGSVGElement>();
  const count = Math.min(Math.max(passed + failed, 0), 5);
  const failedShown = Math.min(failed, count);
  const hasData = total > 0;
  const slabs = Array.from({ length: count }, (_, index) => ({
    y: 166 - index * 24,
    failed: index < failedShown,
  }));

  return (
    <svg
      ref={ref}
      viewBox="0 0 280 220"
      className={`module-object module-object-exit ${hasData ? "has-data" : ""}`}
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
        cx="140"
        cy="198"
        rx="92"
        ry="12"
        fill="#0a0a0b"
        opacity="0.18"
        filter={`url(#${uid}-shadow)`}
      />
      {!hasData ? (
        <g>
          <path d="M58 168l82-38 82 38-82 38z" fill="none" stroke="#8d8980" strokeDasharray="4 7" />
          <path
            d="M58 168v13l82 38 82-38v-13"
            fill="none"
            stroke="#8d8980"
            strokeDasharray="4 7"
            opacity="0.65"
          />
        </g>
      ) : (
        <g className="exit-stack">
          {slabs.map((slab, index) => (
            <g key={index} transform={`translate(${slab.failed ? 9 : 0} ${slab.y})`}>
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
          ))}
        </g>
      )}
    </svg>
  );
}

export function ModuleObject({
  module,
  ...props
}: ObjectProps & { module: "world" | "flow" | "exit" }) {
  if (module === "world") return <WorldObject {...props} />;
  if (module === "flow") return <FlowObject {...props} />;
  return <ExitObject {...props} />;
}
