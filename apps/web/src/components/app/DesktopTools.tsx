import {
  Cpu,
  Download,
  Globe2,
  Info,
  Loader2,
  MonitorPlay,
  RefreshCw,
  Stethoscope,
  Terminal,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/index.js";

type DesktopAction = Parameters<NonNullable<Window["proofcoreDesktop"]>["action"]>[0];

const ACTIONS: { action: DesktopAction; fr: string; en: string; icon: typeof Terminal }[] = [
  {
    action: "open-console",
    fr: "Console locale",
    en: "Local console",
    icon: Terminal,
  },
  {
    action: "open-agent",
    fr: "Agent IA local",
    en: "Local AI agent",
    icon: MonitorPlay,
  },
  {
    action: "tests",
    fr: "Lancer les tests",
    en: "Run local tests",
    icon: Terminal,
  },
  {
    action: "doctor",
    fr: "Vérifier les conflits",
    en: "Check conflicts",
    icon: Stethoscope,
  },
  {
    action: "update",
    fr: "Mettre à jour le moteur",
    en: "Update the engine",
    icon: RefreshCw,
  },
  {
    action: "about",
    fr: "À propos",
    en: "About",
    icon: Info,
  },
  {
    action: "open-site",
    fr: "Ouvrir le site",
    en: "Open the site",
    icon: Globe2,
  },
];

/**
 * The native menu is deliberately gone. Everything it used to expose lives here, in
 * the same paper-and-ink language as the workspace, and command output stays in the
 * window instead of opening an unstyled system dialog.
 */
export function DesktopTools() {
  const { locale } = useI18n();
  const fr = locale === "fr";
  const bridge = typeof window !== "undefined" ? window.proofcoreDesktop : undefined;
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState<DesktopAction | null>(null);
  const [output, setOutput] = useState("");
  const [failed, setFailed] = useState(false);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!bridge) return;
    void bridge
      .info()
      .then((info) => setVersion(info.version))
      .catch(() => undefined);
    void bridge
      .updateState()
      .then(setUpdate)
      .catch(() => undefined);
    return bridge.onUpdate(setUpdate);
  }, [bridge]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!bridge) return null;

  const run = async (action: DesktopAction) => {
    if (action === "open-agent" || action === "open-console" || action === "open-site") {
      setOpen(false);
    }
    setBusy(action);
    setFailed(false);
    setOutput("");
    try {
      const result = await bridge.action(action);
      setOutput(result.output);
      setFailed(!result.ok);
    } catch (error) {
      setFailed(true);
      setOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="app-desktop-tools" ref={rootRef}>
      <button
        type="button"
        className={`app-desktop-trigger ${open ? "is-active" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={fr ? "Outils" : "Tools"}
        onClick={() => setOpen((value) => !value)}
      >
        <Cpu size={14} />
        <span>{fr ? "Moteur" : "Engine"}</span>
        <span className="app-desktop-pulse" aria-hidden />
      </button>

      {open ? (
        <section
          className="app-desktop-panel"
          role="dialog"
          aria-label={fr ? "Moteur local" : "Local engine"}
        >
          <header className="app-desktop-panel-head">
            <div>
              <p className="app-eyebrow">{fr ? "Sur cette machine" : "On this machine"}</p>
              <h2>{fr ? "Moteur local" : "Local engine"}</h2>
            </div>
            <button
              type="button"
              className="app-desktop-close"
              onClick={() => setOpen(false)}
              aria-label={fr ? "Fermer" : "Close"}
            >
              <X size={15} />
            </button>
          </header>

          <p className="app-desktop-copy">
            {fr
              ? "Diagnostics et maintenance de cette machine."
              : "Diagnostics and maintenance for this machine."}
          </p>

          <div className="app-desktop-actions">
            {ACTIONS.map(({ action, fr: labelFr, en: labelEn, icon: Icon }) => (
              <button
                key={action}
                type="button"
                className="app-desktop-action"
                onClick={() => void run(action)}
                disabled={busy !== null}
              >
                <span className="app-desktop-action-icon">
                  {busy === action ? (
                    <Loader2 size={15} className="app-spin" />
                  ) : (
                    <Icon size={15} />
                  )}
                </span>
                <span>{fr ? labelFr : labelEn}</span>
              </button>
            ))}
          </div>

          {update && update.status !== "idle" && update.status !== "current" ? (
            <div
              className={`app-desktop-update ${update.status === "error" ? "is-error" : ""}`}
              role="status"
            >
              <Download size={14} />
              <span>
                {update.status === "checking"
                  ? fr
                    ? "Recherche de mise à jour…"
                    : "Checking for updates…"
                  : update.status === "available" || update.status === "downloading"
                    ? fr
                      ? `Version ${update.version ?? ""} en téléchargement (${update.percent} %)`
                      : `Version ${update.version ?? ""} downloading (${update.percent}%)`
                    : update.status === "ready"
                      ? fr
                        ? `Version ${update.version ?? ""} prête`
                        : `Version ${update.version ?? ""} ready`
                      : (update.message ?? "Update error")}
              </span>
              {update.status === "ready" ? (
                <button type="button" onClick={() => void run("install-update")}>
                  {fr ? "Installer" : "Install"}
                </button>
              ) : null}
            </div>
          ) : null}

          {output ? (
            <pre className={`app-desktop-output ${failed ? "is-error" : ""}`} aria-live="polite">
              {output}
            </pre>
          ) : null}

          <footer className="app-desktop-foot">
            <span>{version ? `v${version}` : "PROOFCORE"}</span>
            <button
              type="button"
              onClick={() => {
                setOutput("");
                setFailed(false);
              }}
              disabled={!output}
            >
              {fr ? "Effacer" : "Clear"}
            </button>
          </footer>
        </section>
      ) : null}
    </div>
  );
}
