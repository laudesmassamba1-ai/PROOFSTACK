import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last line of defence for the render tree.
 *
 * Without it, any thrown error during a render unmounts the whole React root
 * and leaves a black, silent viewport — indistinguishable from a dead app. The
 * fallback is drawn with the same paper/ink tokens as the rest of the product,
 * so even the failure state stays on-brand in both themes.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the signal in the console for diagnosis; the UI stays honest below.
    console.error("Render crashed:", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="app-shell app-centered-shell">
        <div className="app-frame app-service-frame">
          <p className="app-eyebrow">PROOFCORE / ERREUR D'AFFICHAGE</p>
          <h1 className="app-display app-service-title">{"L'écran a perdu le fil"}</h1>
          <p className="app-support">
            {
              "Un élément de cette page n'a pas réussi à s'afficher. Rechargez : vos données ne sont pas perdues."
            }
          </p>
          <button
            type="button"
            className="app-btn app-btn-primary mt-6"
            onClick={() => window.location.reload()}
          >
            Recharger la page
          </button>
          <details className="app-service-details">
            <summary>Détails techniques</summary>
            <code className="app-mono">{error.message}</code>
          </details>
        </div>
      </div>
    );
  }
}
