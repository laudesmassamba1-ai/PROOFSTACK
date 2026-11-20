import { ArrowUpRight, BadgeCheck, Globe2, PackageOpen, Route, ShieldAlert } from "lucide-react";
import { Link } from "react-router";
import { useI18n } from "../../i18n/index.js";

/**
 * The module wall, as a bento board.
 *
 * Placement is the argument: WORLD owns the large cell because it is the module with
 * the widest surface (locale fixtures), FLOW sits beside it, and the three audits share
 * the second row at equal weight — EXIT (portability), FAIL (security), CLEAN (UI
 * quality). The engine band closes the board, so the grid reads "five readings of one
 * machine" instead of "six equal cards".
 *
 * Each card gets one accent, the technical vocabulary it actually reads (mono,
 * untranslated — it is the check vocabulary, not marketing), and the artifact it
 * leaves behind. Nothing animates in a loop; motion is reserve for the pointer.
 */

interface ModuleMeta {
  id: "world" | "flow" | "exit" | "fail" | "clean";
  icon: typeof Globe2;
  /** Technical vocabulary this module reads. Rendered in mono, untranslated. */
  tokens: readonly string[];
  /** What the module leaves behind. */
  output: string;
}

const MODULES: readonly ModuleMeta[] = [
  {
    id: "world",
    icon: Globe2,
    tokens: ["locale", "RTL", "currency", "date-format", "form-input"],
    output: "JSON · JUnit · HTML",
  },
  {
    id: "flow",
    icon: Route,
    tokens: ["checkout", "retry", "timeout", "webhook", "idempotency"],
    output: "JSON · JUnit · HTML",
  },
  {
    id: "exit",
    icon: PackageOpen,
    tokens: ["export", "round-trip", "schema", "checksum"],
    output: "JSON · JUnit · HTML",
  },
  {
    id: "fail",
    icon: ShieldAlert,
    tokens: ["headers", "cookies", "csp", "mixed-content", "disclosure"],
    output: "score / 100 · findings",
  },
  {
    id: "clean",
    icon: BadgeCheck,
    tokens: ["headings", "alt-text", "labels", "viewport", "weight"],
    output: "score / 100 · findings",
  },
];

export function ModuleShowcase({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const { t } = useI18n();
  // /product leads with the board directly under its h1, so the cards are h2 there;
  // on the homepage they sit under a section heading and stay h3.
  const Title = headingLevel === 2 ? "h2" : "h3";

  return (
    <div className="bento">
      {MODULES.map((module, index) => {
        const Icon = module.icon;
        return (
          <Link
            key={module.id}
            to={`/${module.id}`}
            className={`bento-card module-${module.id}`}
            data-spot
            style={{ "--i": index } as React.CSSProperties}
          >
            {index === 0 ? <BentoMotif /> : null}
            <div className="bento-head">
              <span className="bento-icon">
                <Icon size={17} />
              </span>
              <span className="bento-id">{module.id.toUpperCase()}</span>
              <span className="bento-index">{String(index + 1).padStart(2, "0")}</span>
              <ArrowUpRight size={15} className="bento-arrow" />
            </div>
            <Title className="bento-title">{t(`modules.${module.id}.name`)}</Title>
            <p className="bento-tag">{t(`modules.${module.id}.tag`)}</p>
            <p className="bento-q">{t(`question.${module.id}`)}</p>
            <ul className="bento-tokens">
              {module.tokens.map((token) => (
                <li key={token}>{token}</li>
              ))}
            </ul>
            <p className="bento-out">
              <i aria-hidden="true" />
              {module.output}
            </p>
          </Link>
        );
      })}

      {/* The band that carries the five. */}
      <div className="bento-card bento-engine" data-spot>
        <div>
          <p className="cine-mono">{t("mkt.wall.foot.kicker")}</p>
          <p className="bento-engine-title">{t("mkt.wall.foot.title")}</p>
          <p className="bento-engine-body">{t("mkt.wall.foot.body")}</p>
        </div>
        <div className="bento-states" aria-hidden="true">
          {["PENDING", "RUNNING", "PASS", "WARN", "FAIL", "SKIPPED"].map((state) => (
            <span key={state} className={`bento-state bento-state--${state.toLowerCase()}`}>
              {state}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A small orbit drawing for the large WORLD cell: three rings, one highlighted dot. */
function BentoMotif() {
  return (
    <svg className="bento-motif" viewBox="0 0 240 240" fill="none" aria-hidden="true">
      {/* pathLength="1" makes the stroke-dash draw-in uniform on every shape. */}
      <g stroke="currentColor" strokeOpacity="0.5" color="#78e3cb">
        <ellipse cx="120" cy="120" rx="112" ry="52" strokeWidth="1" pathLength="1" />
        <ellipse
          cx="120"
          cy="120"
          rx="112"
          ry="52"
          transform="rotate(58 120 120)"
          strokeWidth="1"
          pathLength="1"
        />
        <circle cx="120" cy="120" r="74" strokeWidth="1" strokeOpacity="0.35" pathLength="1" />
        <circle cx="120" cy="120" r="38" strokeWidth="1" strokeOpacity="0.25" pathLength="1" />
      </g>
      <circle cx="120" cy="120" r="6" fill="#78e3cb" />
      <circle cx="120" cy="120" r="14" stroke="#78e3cb" strokeOpacity="0.4" />
      <circle cx="40" cy="86" r="3" fill="#8b7bf7" />
      <circle cx="196" cy="158" r="2.5" fill="#e967a6" />
    </svg>
  );
}
