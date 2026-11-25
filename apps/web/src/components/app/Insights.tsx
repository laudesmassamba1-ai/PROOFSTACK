import { useMemo } from "react";
import { severityLabel } from "../../lib/appLabels.js";

/**
 * Small dependency-free SVG charts for the workspace insights.
 * They render only real measured data; an empty period renders as an empty
 * chart with a label, never as fabricated bars.
 */

export interface RunPerDay {
  day: string;
  total: number;
  passed: number;
  failed: number;
}

export function RunsTrend({
  runs = [],
  locale,
}: {
  runs?: RunPerDay[];
  locale: string;
}): React.ReactElement {
  const width = 640;
  const height = 160;
  const padding = { top: 12, right: 8, bottom: 22, left: 30 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const max = Math.max(1, ...runs.map((entry) => Math.max(entry.passed, entry.failed)));
  const barW = runs.length > 0 ? innerW / runs.length : 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={locale === "fr" ? "Vérifications par jour" : "Checks per day"}
    >
      {[0.5, 1].map((fraction) => (
        <line
          key={fraction}
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + innerH * (1 - fraction)}
          y2={padding.top + innerH * (1 - fraction)}
          className="stroke-border/40"
          strokeDasharray="3 4"
        />
      ))}
      <text
        x={padding.left - 6}
        y={padding.top + 4}
        textAnchor="end"
        className="fill-muted-foreground"
        fontSize="9"
      >
        {max}
      </text>
      {runs.map((entry, index) => {
        const passedH = (entry.passed / max) * innerH;
        const failedH = (entry.failed / max) * innerH;
        const x = padding.left + index * barW;
        return (
          <g key={entry.day}>
            {passedH > 0 && (
              <rect
                x={x + barW * 0.15}
                y={padding.top + innerH - passedH}
                width={barW * 0.7}
                height={passedH}
                rx={2}
                className="fill-success/70"
              />
            )}
            {failedH > 0 && (
              <rect
                x={x + barW * 0.15}
                y={padding.top + innerH - passedH - failedH}
                width={barW * 0.7}
                height={failedH}
                rx={2}
                className="fill-danger/80"
              />
            )}
            {(index % Math.ceil(runs.length / 7) === 0 || runs.length <= 7) && (
              <text
                x={x + barW / 2}
                y={height - 6}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize="9"
              >
                {entry.day.slice(5)}
              </text>
            )}
          </g>
        );
      })}
      {runs.length === 0 && (
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize="11"
        >
          {locale === "fr" ? "Aucun run sur la période" : "No runs in this period"}
        </text>
      )}
    </svg>
  );
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;
/* Severity maps onto the token palette: the same red that badges danger, the
 * same amber that badges warning — never its own off-palette hues. */
const SEVERITY_COLORS: Record<string, string> = {
  critical: "var(--danger)",
  high: "var(--danger)",
  medium: "var(--warning)",
  low: "var(--brand-cyan)",
  info: "var(--text-secondary)",
};

export function SeverityBreakdown({
  counts = [],
  locale,
}: {
  counts?: { severity: string; count: number }[];
  locale: string;
}): React.ReactElement {
  const normalized = useMemo(() => {
    const map = new Map(counts.map((entry) => [entry.severity.toLowerCase(), entry.count]));
    return SEVERITY_ORDER.map((severity) => ({
      severity,
      count: map.get(severity) ?? 0,
    })).filter(
      (entry) => entry.count > 0 || entry.severity === "critical" || entry.severity === "high"
    );
  }, [counts]);
  const max = Math.max(1, ...normalized.map((entry) => entry.count));

  return (
    <div className="space-y-2.5">
      {normalized.map((entry) => (
        <div key={entry.severity} className="flex items-center gap-3">
          <span className="w-16 text-[11px] font-medium capitalize text-muted-foreground">
            {severityLabel(entry.severity, locale === "fr")}
          </span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(entry.count > 0 ? 4 : 0, (entry.count / max) * 100)}%`,
                backgroundColor: SEVERITY_COLORS[entry.severity] ?? "#94a3b8",
              }}
            />
          </div>
          <span className="w-8 text-right text-xs font-semibold tabular-nums">{entry.count}</span>
        </div>
      ))}
      {normalized.every((entry) => entry.count === 0) && (
        <p className="pt-1 text-xs text-muted-foreground">
          {locale === "fr"
            ? "Aucun échec sur la période — rien à mesurer."
            : "No failures in this period — nothing to measure."}
        </p>
      )}
    </div>
  );
}

export function ModulePassRates({
  modules = [],
}: {
  modules?: { module: string; passed: number; failed: number; total: number }[];
}): React.ReactElement {
  return (
    <div className="space-y-3">
      {modules.map((entry) => {
        const rate = entry.total > 0 ? Math.round((entry.passed / entry.total) * 100) : null;
        return (
          <div key={entry.module} className="flex items-center gap-3">
            <span className="w-14 text-[11px] font-bold tracking-wide text-foreground/80">
              {entry.module.toUpperCase()}
            </span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              {rate !== null && (
                <div
                  className={`h-full rounded-full ${rate >= 90 ? "bg-success" : rate >= 60 ? "bg-warning" : "bg-danger"}`}
                  style={{ width: `${rate}%` }}
                />
              )}
            </div>
            <span className="w-12 text-right text-xs font-semibold tabular-nums">
              {rate === null ? "—" : `${rate}%`}
            </span>
          </div>
        );
      })}
      {modules.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
    </div>
  );
}
