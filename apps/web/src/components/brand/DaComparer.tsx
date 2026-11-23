import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/index.js";
import { type DAMode, inIframe, readDAChoice, rememberDAMode } from "../../lib/da.js";
import { FilamentStream } from "./FilamentStream.js";

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
const MOBILE_QUERY = "(max-width: 767px)"; // phones get a plain toggle button

export function DaComparer() {
  const { locale } = useI18n();
  const fr = locale === "fr";
  // Auto-open only until the visitor has made a choice; afterwards the site
  // continues in the kept direction and a discreet chip reopens the comparison.
  const [open, setOpen] = useState(() => !inIframe() && !readDAChoice());
  // phones don't get the split: a plain toggle button switches the direction
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(MOBILE_QUERY).matches === true
  );
  useEffect(() => {
    const query = window.matchMedia?.(MOBILE_QUERY);
    if (!query) return;
    const onChange = (event: MediaQueryListEvent): void => {
      setMobile(event.matches);
      if (event.matches) setOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const [fraction, setFraction] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const leftRef = useRef<HTMLIFrameElement | null>(null);
  const rightRef = useRef<HTMLIFrameElement | null>(null);

  const commit = useCallback((mode: DAMode) => {
    rememberDAMode(mode);
    // the storage event is cross-tab only; tell this document too
    window.dispatchEvent(new Event("da-changed"));
    // the kept pane is the page the visitor was actually looking at: land on it,
    // not on whatever the top window happened to show behind the overlay
    const frame = (mode === "dark" ? leftRef : rightRef).current;
    let target: string | null = null;
    try {
      const loc = frame?.contentWindow?.location;
      if (loc && loc.origin === window.location.origin) {
        const url = new URL(loc.href);
        url.searchParams.delete("da");
        target = url.pathname + url.search + url.hash;
      }
    } catch {
      /* cross-origin pane: keep the top window where it is */
    }
    setOpen(false);
    if (
      target &&
      target !== window.location.pathname + window.location.search + window.location.hash
    ) {
      window.location.assign(target);
    }
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
      // the bundle sweeps the direction it is pushed toward: push it onto the
      // black side and the run is swept away — the report is kept, and vice versa
      const x = event.clientX - rect.left;
      if (x <= EDGE) commit("light");
      else if (rect.width - x <= EDGE) commit("dark");
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

  if (inIframe() || mobile) return null;

  if (!open) {
    return (
      <button
        type="button"
        className="da-reopen"
        onClick={() => setOpen(true)}
        aria-label={
          fr ? "Rouvrir le comparateur des deux directions" : "Reopen the direction comparer"
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
        title={fr ? "Direction exécution (noir)" : "Run direction (black)"}
        className="da-pane"
        style={{ clipPath: leftClip }}
      />
      <iframe
        ref={rightRef}
        src="/?da=light"
        title={fr ? "Direction rapport (papier)" : "Report direction (paper)"}
        className="da-pane"
        style={{ clipPath: rightClip }}
      />

      {/* the exercise has a name: this is the before/after CLEAN grades */}
      <div className="da-headline">
        <span className="da-headline-title">
          {fr ? (
            <>
              Avant et après <em>CLEAN</em>
            </>
          ) : (
            <>
              Before and after <em>CLEAN</em>
            </>
          )}
        </span>
        <button type="button" className="da-close" onClick={() => setOpen(false)}>
          {fr ? "Continuer sans choisir" : "Continue without choosing"}
        </button>
      </div>

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
            commit(fraction < 0.5 ? "light" : "dark");
          }
        }}
        role="slider"
        tabIndex={0}
        aria-label={
          fr
            ? "Ligne de preuve — glisser le faisceau vers un bord pour balayer cette direction et garder l'autre"
            : "Evidence line — drag the bundle to an edge to sweep that direction away and keep the other"
        }
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
      >
        <FilamentStream />
        <span className="da-bar-handle" aria-hidden="true" />
      </div>

      {/* floating labels name each side at its own edge */}
      <span className="da-tag da-tag-dark">
        {fr ? "L'exécution — instrument noir" : "The run — black instrument"}
      </span>
      <span className="da-tag da-tag-light">
        {fr ? "Le rapport — édition papier" : "The report — paper edition"}
      </span>
    </div>
  );
}
