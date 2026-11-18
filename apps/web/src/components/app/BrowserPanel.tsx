import { ArrowLeft, ArrowRight, Monitor, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { postJson } from "../../lib/api.js";

/**
 * The browser panel, docked beside the chat.
 *
 * The page is not an iframe: almost every real site refuses to be framed, and a refusal
 * shows up as a blank box that looks like a bug in this app. What is on screen is the real
 * Chromium on the server, captured after each action — so a click here is a click there.
 *
 * The coordinate mapping is explicit: the image is displayed at some CSS width, the server
 * viewport is 1280×800, and every click is scaled into the server's units. Without that,
 * clicks drift towards the middle of the page as soon as the panel is not exactly 1280 px
 * wide.
 */

const SERVER_VIEWPORT = { width: 1280, height: 800 };

/**
 * Launching a Chromium and rendering a page takes ten to twenty seconds. The default API
 * timeout is six, so the panel used to give up before the first image and look broken:
 * every call here carries its own budget, sized to what the server actually does.
 */
const START_TIMEOUT_MS = 90_000;
const ACTION_TIMEOUT_MS = 60_000;

export interface BrowserState {
  sessionId: string;
  url: string;
  title: string;
  screenshot?: string;
  console: { type: string; text: string }[];
}

export function BrowserPanel({
  workspaceId,
  initialUrl,
  fr,
  onClose,
}: {
  workspaceId: string;
  initialUrl?: string;
  fr: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<BrowserState | null>(null);
  const [address, setAddress] = useState(initialUrl ?? "https://example.com");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const startedRef = useRef(false);

  const start = useCallback(
    async (url: string) => {
      setStatus("loading");
      setError(null);
      try {
        const result = await postJson<BrowserState>(
          "/api/v1/browser/session",
          { workspaceId, url },
          START_TIMEOUT_MS
        );
        setState(result);
        setAddress(result.url);
        setStatus("idle");
      } catch (cause) {
        setStatus("error");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [workspaceId]
  );

  const act = useCallback(
    async (action: Record<string, unknown>) => {
      if (!state) return;
      setStatus("loading");
      setError(null);
      try {
        const result = await postJson<BrowserState>(
          "/api/v1/browser/action",
          { sessionId: state.sessionId, action },
          ACTION_TIMEOUT_MS
        );
        setState(result);
        setAddress(result.url);
        setStatus("idle");
      } catch (cause) {
        setStatus("error");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [state]
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start(initialUrl ?? "https://example.com");
  }, [initialUrl, start]);

  useEffect(() => {
    return () => {
      // Closing the panel closes the browser: a live session costs money and holds a slot.
      if (state?.sessionId) {
        void postJson("/api/v1/browser/close", { sessionId: state.sessionId }).catch(
          () => undefined
        );
      }
    };
  }, [state?.sessionId]);

  const clickAt = (event: React.MouseEvent<HTMLImageElement>) => {
    const image = imageRef.current;
    if (!image || !state || status === "loading") return;
    const rect = image.getBoundingClientRect();
    // `object-fit: contain` letterboxes the picture inside the element: the drawn area is
    // smaller than the box, and clicking the box's edges must not be scaled as if it were
    // the page. Compute the drawn rectangle, then map through it.
    const scale = Math.min(
      rect.width / SERVER_VIEWPORT.width,
      rect.height / SERVER_VIEWPORT.height
    );
    const drawnWidth = SERVER_VIEWPORT.width * scale;
    const drawnHeight = SERVER_VIEWPORT.height * scale;
    const originX = rect.left + (rect.width - drawnWidth) / 2;
    const originY = rect.top;
    const x = ((event.clientX - originX) / drawnWidth) * SERVER_VIEWPORT.width;
    const y = ((event.clientY - originY) / drawnHeight) * SERVER_VIEWPORT.height;
    if (x < 0 || y < 0 || x > SERVER_VIEWPORT.width || y > SERVER_VIEWPORT.height) return;
    void act({ kind: "click", x: Math.round(x), y: Math.round(y) });
  };

  return (
    <section className="pc-browser" aria-label={fr ? "Navigateur" : "Browser"}>
      <header className="pc-browser-bar">
        <button
          type="button"
          className="pc-browser-icon"
          aria-label={fr ? "Précédent" : "Back"}
          onClick={() => void act({ kind: "back" })}
          disabled={!state || status === "loading"}
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          className="pc-browser-icon"
          aria-label={fr ? "Recharger" : "Reload"}
          onClick={() => void act({ kind: "reload" })}
          disabled={!state || status === "loading"}
        >
          <RotateCw size={13} />
        </button>
        <form
          className="pc-browser-address"
          onSubmit={(event) => {
            event.preventDefault();
            const next = address.trim();
            if (!next) return;
            if (state) void act({ kind: "navigate", url: next });
            else void start(next);
          }}
        >
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="https://…"
            spellCheck={false}
            aria-label={fr ? "Adresse" : "Address"}
          />
          {status === "loading" && <span className="pc-browser-spinner" aria-hidden />}
          <button type="submit" className="pc-browser-go">
            <ArrowRight size={13} />
          </button>
        </form>
        <span
          className="pc-browser-live"
          title={fr ? "Chromium réel, piloté à distance" : "Real Chromium, driven remotely"}
        >
          <Monitor size={11} />{" "}
          {state ? (fr ? "en direct" : "live") : fr ? "démarrage" : "starting"}
        </span>
        <button
          type="button"
          className="pc-browser-icon"
          aria-label={fr ? "Fermer" : "Close"}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </header>

      {error && <div className="pc-browser-error">{error}</div>}

      <div className="pc-browser-viewport">
        {state?.screenshot ? (
          // A click anywhere lands in the page, which is the point. The address bar is the
          // keyboard path, so this image is deliberately a mouse surface, not a button.
          /* biome-ignore lint/a11y/useKeyWithClickEvents: a click carries a coordinate,
             which no key can express; the keyboard path is the address bar above. */
          <img
            ref={imageRef}
            src={state.screenshot}
            alt={state.title || state.url}
            onClick={clickAt}
            className={status === "loading" ? "is-loading" : undefined}
            draggable={false}
          />
        ) : (
          <div className="pc-browser-empty">
            {status === "error" ? null : fr ? "Ouverture du navigateur…" : "Opening the browser…"}
          </div>
        )}
      </div>

      <footer className="pc-browser-foot">
        <span className="pc-browser-title" title={state?.url}>
          {state?.title || (fr ? "sans titre" : "untitled")}
        </span>
        <span className="pc-browser-hint">
          {fr ? "clique dans la page pour interagir" : "click in the page to interact"}
        </span>
        {state && state.console.filter((entry) => entry.type === "error").length > 0 && (
          <span className="pc-browser-console">
            {state.console.filter((entry) => entry.type === "error").length}{" "}
            {fr ? "erreur(s) console" : "console error(s)"}
          </span>
        )}
      </footer>
    </section>
  );
}
