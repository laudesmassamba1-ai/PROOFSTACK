import { Minus, Square, X } from "lucide-react";

/**
 * The three native window actions, shared by the workspace and the sign-in screen.
 *
 * A frameless Electron window has no OS chrome: if a route forgets these controls (or the
 * draggable strip around them), the window cannot be moved or closed. Keeping one component
 * means every desktop route has the same usable title bar.
 */
export function WindowControls({ floating = false }: { floating?: boolean }) {
  if (!window.proofcoreDesktop) return null;
  return (
    <div className={`app-window-controls ${floating ? "is-floating" : ""}`}>
      <button
        type="button"
        onClick={() => void window.proofcoreDesktop?.window("minimize")}
        aria-label="Réduire la fenêtre"
      >
        <Minus size={13} />
      </button>
      <button
        type="button"
        onClick={() => void window.proofcoreDesktop?.window("maximize")}
        aria-label="Agrandir ou restaurer la fenêtre"
      >
        <Square size={11} />
      </button>
      <button
        type="button"
        className="is-close"
        onClick={() => void window.proofcoreDesktop?.window("close")}
        aria-label="Fermer la fenêtre"
      >
        <X size={14} />
      </button>
    </div>
  );
}
