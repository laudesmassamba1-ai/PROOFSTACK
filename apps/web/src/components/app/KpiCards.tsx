import { type ReactNode, useRef } from "react";
import { CountUp } from "./CountUp.js";

/**
 * Cartes KPI contrastées de l'aperçu — inspiration registre : la carte à
 * bordure réactive façon « SpotlightCard » de React Bits (un halo suit le
 * pointeur, porté par deux variables CSS sans dépendance) et les nombres
 * animés façon « Number Ticker » de Magic UI (via notre CountUp maison).
 * Chaque carte porte un fait réel du workspace — aucune valeur inventée.
 */

type Tone = "neutral" | "success" | "danger" | "cyan";

export function KpiCard({
  label,
  value,
  suffix,
  tone = "neutral",
  note,
  meter,
}: {
  label: string;
  value: number;
  suffix?: string;
  tone?: Tone;
  note?: ReactNode;
  meter?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const move = (event: React.PointerEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    el.style.setProperty("--my", `${event.clientY - rect.top}px`);
  };
  return (
    <div
      ref={ref}
      className={`kpi-card kpi-${tone}`}
      onPointerMove={move}
      onPointerLeave={(event) => {
        event.currentTarget.style.removeProperty("--mx");
        event.currentTarget.style.removeProperty("--my");
      }}
    >
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">
        <CountUp value={value} />
        {suffix ? <span className="kpi-suffix">{suffix}</span> : null}
      </p>
      {typeof meter === "number" ? (
        <span className="kpi-meter" aria-hidden>
          <span style={{ width: `${Math.min(100, Math.max(0, meter))}%` }} />
        </span>
      ) : null}
      {note ? <p className="kpi-note">{note}</p> : null}
    </div>
  );
}

export function KpiRow({
  kpis,
}: {
  kpis: {
    key: string;
    label: string;
    value: number;
    suffix?: string;
    tone?: Tone;
    note?: ReactNode;
    meter?: number;
  }[];
}) {
  return (
    <div className="kpi-grid" data-reveal>
      {kpis.map((kpi) => (
        <KpiCard
          key={kpi.key}
          label={kpi.label}
          value={kpi.value}
          suffix={kpi.suffix}
          tone={kpi.tone}
          note={kpi.note}
          meter={kpi.meter}
        />
      ))}
    </div>
  );
}
