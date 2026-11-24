/**
 * Une seule direction artistique : l'instrument noir ASCII.
 * L'ancienne édition papier (galerie) a été retirée — plus de comparateur,
 * plus de `?da=`, plus de choix mémorisé.
 */
export type DAMode = "dark";

/** La DA est fixe : dark, partout, toujours. */
export function resolveDAMode(): DAMode {
  return "dark";
}

export function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** Ancien point d'entrée du choix visitateur — ne choisit plus rien. */
export function rememberDAMode(_mode: DAMode): void {
  /* une seule DA : rien à retenir */
}

import { useEffect, useState } from "react";

/** React hook: the active art direction, live across comparer commits. */
export function useDAMode(): DAMode {
  const [mode, setMode] = useState<DAMode>(() => resolveDAMode());
  useEffect(() => {
    const onChange = () => setMode(resolveDAMode());
    window.addEventListener("da-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("da-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return mode;
}
