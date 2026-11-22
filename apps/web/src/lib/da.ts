/**
 * The two art directions of the marketing site.
 *
 * "dark"  — the instrument on black: the original identity, particle wave on
 *           brand-black, mint accents.
 * "light" — the report edition: flat light surface, white cards, hairline
 *           ink borders, the dark zones kept as embedded instruments.
 *
 * The visitor chooses between them with the split comparer: a draggable bar
 * shows both identities side by side; pushing the bar to an edge eliminates
 * one of them and the choice is remembered. A `?da=` URL parameter overrides
 * the remembered choice (the comparer's two panes use it to force each side).
 */
export type DAMode = "dark" | "light";

const STORAGE_KEY = "proofcore.da";

export function readDAFromSearch(): DAMode | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("da");
  return value === "light" || value === "dark" ? value : null;
}

export function readDAChoice(): DAMode | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** Resolve the mode: URL parameter wins, then the remembered choice, then dark. */
export function resolveDAMode(): DAMode {
  return readDAFromSearch() ?? readDAChoice() ?? "dark";
}

/** Remember the visitor's choice (only called by an explicit elimination). */
export function rememberDAMode(mode: DAMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode: the choice lives for this session only */
  }
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

/** True when this page runs inside the comparer's own pane. */
export function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
