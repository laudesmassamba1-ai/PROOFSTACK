import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Boxes,
  FileBarChart2,
  Globe2,
  Plug,
  Route,
  ShieldCheck,
  Timer,
  Unplug,
} from "lucide-react";
import { Link } from "react-router";
import { useI18n } from "../../i18n/index.js";
import { usePrefersReducedMotion } from "../../lib/theme.js";

/**
 * Reference B translated into product language: white modular tiles floating over a
 * blue→violet→pink→orange field, deep-blue line icons, small auxiliary chips, layered
 * depth. Built with CSS transforms and gradients only — no WebGL, no 3D library, no
 * bitmap export, so it costs nothing on modest hardware.
 */
export function ModuleShowcase() {
  const { t } = useI18n();
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (reduced) return;
    const node = ref.current;
    if (!node) return;
    const onMove = (event: PointerEvent): void => {
      const rect = node.getBoundingClientRect();
      const nx = (event.clientX - rect.left) / rect.width - 0.5;
      const ny = (event.clientY - rect.top) / rect.height - 0.5;
      setTilt({ x: Math.max(-1, Math.min(1, nx * 2)), y: Math.max(-1, Math.min(1, ny * 2)) });
    };
    const onLeave = (): void => setTilt({ x: 0, y: 0 });
    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerleave", onLeave);
    return () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced]);

  const depth = (factor: number): string =>
    `translate3d(${tilt.x * factor * 10}px, ${tilt.y * factor * 8}px, ${factor * 30}px)`;

  return (
    <div
      ref={ref}
      className="spectrum-field relative overflow-hidden rounded-[28px] px-5 py-12 sm:px-8 lg:py-16"
      style={{ perspective: "1400px" }}
    >
      <div
        className="relative mx-auto grid max-w-[1050px] gap-5"
        style={{ transformStyle: "preserve-3d" }}
      >
        <div className="grid gap-5 md:grid-cols-3">
          <Tile
            title={t("modules.world.name")}
            subtitle={t("modules.world.tag")}
            body={t("question.world")}
            icon={<Globe2 size={26} className="tile-ink" />}
            style={{ transform: depth(1.2) }}
            to="/world"
            openLabel={t("modules.open")}
          />
          <Tile
            title={t("modules.flow.name")}
            subtitle={t("modules.flow.tag")}
            body={t("question.flow")}
            icon={<Route size={26} className="tile-ink" />}
            style={{ transform: depth(0.6) }}
            to="/flow"
            openLabel={t("modules.open")}
            raised
          />
          <Tile
            title={t("modules.exit.name")}
            subtitle={t("modules.exit.tag")}
            body={t("question.exit")}
            icon={<Unplug size={26} className="tile-ink" />}
            style={{ transform: depth(1.5) }}
            to="/exit"
            openLabel={t("modules.open")}
          />
        </div>

        <div className="grid gap-5 md:grid-cols-[1.25fr_1fr]">
          <div className="tile p-5" style={{ transform: depth(0.35) }}>
            <div className="flex items-start gap-4">
              <span className="tile-chip flex size-11 shrink-0 items-center justify-center">
                <Boxes size={20} className="tile-ink" />
              </span>
              <div>
                <h3 className="text-[1.05rem] font-semibold">One shared execution engine</h3>
                <p className="mt-1.5 text-[0.88rem] leading-relaxed text-[#4a5a72]">
                  Project, environment, suite, case, run, assertion, finding, evidence, report. The same eleven entities
                  carry a locale fixture, a checkout journey and an export round trip — which is why one CLI, one SDK and
                  one dashboard can serve all three modules.
                </p>
                <div className="mt-4 flex flex-wrap gap-2 font-mono text-[0.72rem] text-[#1b2f77]">
                  {["PENDING", "RUNNING", "PASSED", "FAILED", "WARNING", "SKIPPED", "ERROR"].map((status) => (
                    <span key={status} className="rounded-md bg-[#eef1f8] px-2 py-1">
                      {status}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <MiniTile icon={<FileBarChart2 size={18} className="tile-ink" />} label="Reports" note="JSON · JUnit · HTML" style={{ transform: depth(1.8) }} />
            <MiniTile icon={<ShieldCheck size={18} className="tile-ink" />} label="Validation" note="schema + checksums" style={{ transform: depth(2.2) }} />
            <MiniTile icon={<Plug size={18} className="tile-ink" />} label="Integrations" note="GitHub Actions, CI" style={{ transform: depth(1.4) }} />
            <MiniTile icon={<Timer size={18} className="tile-ink" />} label="Automation" note="timeouts, retries" style={{ transform: depth(2) }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({
  title,
  subtitle,
  body,
  icon,
  to,
  openLabel,
  raised,
  style,
}: {
  title: string;
  subtitle: string;
  body: string;
  icon: React.ReactNode;
  to: string;
  openLabel: string;
  raised?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div className="tile p-5" style={style}>
      <div className="flex items-center justify-between">
        <span className="tile-chip flex size-11 items-center justify-center">{icon}</span>
        {raised ? <span className="rounded-full bg-[#eef1f8] px-2.5 py-1 font-mono text-[0.66rem] text-[#1b2f77]">core</span> : null}
      </div>
      <h3 className="mt-4 text-[1.15rem] font-semibold tracking-tight">{title}</h3>
      <p className="text-[0.78rem] uppercase tracking-[0.14em] text-[#68778a]">{subtitle}</p>
      <p className="mt-3 text-[0.86rem] leading-relaxed text-[#4a5a72]">{body}</p>
      <Link
        to={to}
        className="mt-4 inline-flex items-center gap-1.5 text-[0.84rem] font-medium text-[#315FC8] hover:underline"
      >
        {openLabel} <ArrowUpRight size={15} />
      </Link>
    </div>
  );
}

function MiniTile({
  icon,
  label,
  note,
  style,
}: {
  icon: React.ReactNode;
  label: string;
  note: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className="tile flex items-center gap-3 px-4 py-3.5" style={style}>
      <span className="tile-chip flex size-9 shrink-0 items-center justify-center">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[0.86rem] font-semibold">{label}</p>
        <p className="truncate font-mono text-[0.7rem] text-[#68778a]">{note}</p>
      </div>
    </div>
  );
}
