import { ArrowUpRight, BadgeCheck, Globe2, PackageOpen, Route, ShieldAlert } from "lucide-react";
import { Link } from "react-router";
import { useI18n } from "../../i18n/index.js";

/**
 * The module wall.
 *
 * It used to be white tiles floating on a blue→violet→pink→orange gradient. Nothing else
 * on the site uses that field, and it fought the one thing the product is: a precision
 * instrument that reads a product and reports facts. So the wall is now dark, hairline-
 * ruled and instrument-like — each module owns one accent, carries the technical tokens
 * it actually examines, and moves only on hover (a lifted card, a lit edge, a filling
 * meter). The tokens are language-neutral on purpose: they are the check vocabulary, not
 * marketing words.
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

export function ModuleShowcase() {
  const { t } = useI18n();

  return (
    <div className="module-wall">
      <div className="module-wall-grid">
        {MODULES.map((module, index) => {
          const Icon = module.icon;
          return (
            <Link
              key={module.id}
              to={`/${module.id}`}
              className={`module-panel module-${module.id} spot-card`}
              data-tilt
              style={{ "--i": index } as React.CSSProperties}
            >
              <span className="module-panel-glow" aria-hidden="true" />
              <div className="module-panel-head">
                <span className="module-panel-icon">
                  <Icon size={18} />
                </span>
                <span className="module-panel-id">{module.id.toUpperCase()}</span>
                <ArrowUpRight size={16} className="module-panel-arrow" />
              </div>
              <h3 className="module-panel-title">{t(`modules.${module.id}.name`)}</h3>
              <p className="module-panel-tag">{t(`modules.${module.id}.tag`)}</p>
              <p className="module-panel-q">{t(`question.${module.id}`)}</p>
              <ul className="module-panel-tokens">
                {module.tokens.map((token) => (
                  <li key={token}>{token}</li>
                ))}
              </ul>
              <p className="module-panel-out">
                <span className="module-panel-out-dot" aria-hidden="true" />
                {module.output}
              </p>
            </Link>
          );
        })}

        {/* The sixth cell: the engine that carries the five. Filling it keeps the wall a
            complete rectangle instead of ending on a hole. */}
        <div className="module-panel module-wall-foot">
          <p className="module-panel-id">{t("mkt.wall.foot.kicker")}</p>
          <p className="module-wall-foot-title">{t("mkt.wall.foot.title")}</p>
          <p className="module-wall-foot-body">{t("mkt.wall.foot.body")}</p>
          <div className="module-wall-states" aria-hidden="true">
            {["PENDING", "RUNNING", "PASS", "WARN", "FAIL", "SKIPPED"].map((state) => (
              <span key={state} className={`wall-state wall-state-${state.toLowerCase()}`}>
                {state}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
