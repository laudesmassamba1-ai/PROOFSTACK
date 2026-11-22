import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/index.js";
import { type DAMode, inIframe, readDAChoice, rememberDAMode } from "../../lib/da.js";
import { GoldStream } from "./GoldStream.js";

/**
 * The DA comparer: one window, two art directions.
 *
 * Two panes of the landing page render side by side — dark on the left, light
 * on the right — each clipped at the draggable bar. Scrolling one pane scrolls
 * the other, so the visitor navigates the same page in both identities at once.
 * Push the bar into an edge and that side wins: the choice is remembered, the
 * overlay dissolves, and the site continues in the kept art direction.
 */
const EDGE = 64; // px from an edge where the bar commits the choice

export function DaComparer() {
  const { t, locale } = useI18n();
  const fr = locale === "fr";
  // Auto-open only until the visitor has made a choice; afterwards the site
  // continues in the kept direction and a discreet chip reopens the comparison.
  const [open, setOpen] = useState(() => !inIframe() && !readDAChoice());
  const [fraction, setFraction] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const leftRef = useRef<HTMLIFrameElement | null>(null);
  const rightRef = useRef<HTMLIFrameElement | null>(null);

  const commit = useCallback((mode: DAMode) => {
    rememberDAMode(mode);
    // the storage event is cross-tab only; tell this document too
    window.dispatchEvent(new Event("da-changed"));
    setOpen(false);
  }, []);

  // Bar dragging: pointer events on the whole overlay while dragging.
  useEffect(() => {
    if (!open || !dragging) return;
    const move = (event: PointerEvent) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = event.clientX - rect.left;
      setFraction(Math.min(1, Math.max(0, x / rect.width)));
    };
    const up = (event: PointerEvent) => {
      setDragging(false);
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = event.clientX - rect.left;
      if (x <= EDGE) commit("dark");
      else if (rect.width - x <= EDGE) commit("light");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [open, dragging, commit]);

  // Scroll sync without messaging: the panes are same-origin, so the parent
  // attaches scroll listeners to their documents directly. An echo flag is
  // consumed by the first scroll event of the applied scroll, and the
  // last-forwarded ratio stops any residual oscillation. Listeners attach when
  // each pane finishes loading and survive SPA navigations inside the pane.
  useEffect(() => {
    if (!open) return;
    const panes = [
      { frame: leftRef.current, mode: "dark" as const },
      { frame: rightRef.current, mode: "light" as const },
    ];
    const cleanups: (() => void)[] = [];
    const state: Record<"dark" | "light", { echo: boolean; lastSent: number }> = {
      dark: { echo: false, lastSent: -1 },
      light: { echo: false, lastSent: -1 },
    };
    const attach = (): void => {
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
      for (const pane of panes) {
        const doc = pane.frame?.contentDocument;
        const win = pane.frame?.contentWindow;
        if (!doc || !win) continue;
        const otherMode: "dark" | "light" = pane.mode === "dark" ? "light" : "dark";
        const other = (pane.mode === "dark" ? panes[1] : panes[0]) ?? panes[0];
        const ratioOf = (): number => {
          const w = pane.frame?.contentWindow;
          const d = pane.frame?.contentDocument;
          if (!w || !d) return 0;
          const max = d.documentElement.scrollHeight - w.innerHeight;
          return max > 0 ? Math.min(1, Math.max(0, w.scrollY / max)) : 0;
        };
        const onScroll = (): void => {
          const mine = state[pane.mode];
          if (mine.echo) {
            mine.echo = false;
            return;
          }
          const ratio = ratioOf();
          if (Math.abs(ratio - mine.lastSent) < 0.001) return;
          mine.lastSent = ratio;
          const otherFrame = other?.frame;
          const owin = otherFrame?.contentWindow;
          const odoc = otherFrame?.contentDocument;
          if (!otherFrame || !owin || !odoc) return;
          state[otherMode].echo = true;
          // instant: the panes' smooth scrolling would rain intermediate events
          // that echo back and fight the leader
          const max = odoc.documentElement.scrollHeight - owin.innerHeight;
          owin.scrollTo({ top: max * ratio, behavior: "instant" });
        };
        doc.addEventListener("scroll", onScroll, { passive: true });
        cleanups.push(() => doc.removeEventListener("scroll", onScroll));
      }
    };
    attach();
    const interval = window.setInterval(attach, 700);
    return () => {
      window.clearInterval(interval);
      for (const cleanup of cleanups) cleanup();
    };
  }, [open]);

  if (inIframe()) return null;

  if (!open) {
    return (
      <button
        type="button"
        className="da-reopen"
        onClick={() => setOpen(true)}
        aria-label={
          fr
            ? "Rouvrir le comparateur des deux directions artistiques"
            : "Reopen the art direction comparer"
        }
      >
        ◐ {fr ? "Comparer les DA" : "Compare DAs"}
      </button>
    );
  }

  const leftClip = `inset(0 ${100 - fraction * 100}% 0 0)`;
  const rightClip = `inset(0 0 0 ${fraction * 100}%)`;

  return (
    <div
      ref={rootRef}
      className="da-comparer"
      role="dialog"
      aria-label={fr ? "Comparateur des deux directions artistiques" : "Art direction comparer"}
    >
      <iframe
        ref={leftRef}
        src="/?da=dark"
        title={fr ? "Direction sombre (actuelle)" : "Dark direction (current)"}
        className="da-pane"
        style={{ clipPath: leftClip }}
      />
      <iframe
        ref={rightRef}
        src="/?da=light"
        title={fr ? "Direction claire (Stripe)" : "Light direction (Stripe)"}
        className="da-pane"
        style={{ clipPath: rightClip }}
      />

      {/* the bar: drag to compare, push to an edge to keep one identity */}
      <div
        className="da-bar"
        style={{ left: `${fraction * 100}%` }}
        onPointerDown={(event) => {
          event.preventDefault();
          // capture the pointer: once the drag crosses into a pane's iframe,
          // only the capturing element keeps receiving the moves
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            setFraction((value) => Math.max(0, value - 0.04));
          }
          if (event.key === "ArrowRight") {
            setFraction((value) => Math.min(1, value + 0.04));
          }
          if (event.key === "Enter") {
            commit(fraction < 0.5 ? "dark" : "light");
          }
        }}
        role="slider"
        tabIndex={0}
        aria-label={
          fr
            ? "Barre de comparaison — glisser vers un bord pour garder une seule direction"
            : "Comparison bar — drag to an edge to keep one direction"
        }
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
      >
        <GoldStream />
        <span className="da-bar-handle" aria-hidden="true" />
      </div>

      {/* floating labels name each side at its own edge */}
      <span className="da-tag da-tag-dark">
        {fr ? "Actuelle — instrument noir" : "Current — black instrument"}
      </span>
      <span className="da-tag da-tag-light">Stripe — {fr ? "calme clair" : "light calm"}</span>

      <button type="button" className="da-close" onClick={() => setOpen(false)}>
        {fr ? "Continuer sans choisir" : "Continue without choosing"}
      </button>

      <p className="da-hint">
        {fr
          ? "Glissez la barre pour comparer. Poussez-la vers un bord : la direction de ce bord est gardée, l'autre disparaît."
          : "Drag the bar to compare. Push it to an edge: that edge's direction is kept, the other disappears."}
      </p>
    </div>
  );
}
