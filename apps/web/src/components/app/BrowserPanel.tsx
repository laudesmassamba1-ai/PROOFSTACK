import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Minus,
  Monitor,
  Plus,
  RotateCw,
  Search,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { postJson } from "../../lib/api.js";

/**
 * The internal browser.
 *
 * In the desktop application the page is drawn by Electron's own Chromium: a native view
 * laid over the space this panel reserves. Clicks, scrolls, keys, cookies and JavaScript are
 * the real thing, and nothing leaves the machine to render it. The interface owns the chrome
 * — tabs, address bar, find, zoom — because a browser inside an application should look like
 * the application, not like a browser window glued into it.
 *
 * In a plain web tab there is no local Chromium to borrow. That case keeps the previous
 * server-rendered preview, and says so on the badge: a screenshot of a page is useful, and
 * calling it a browser would not be.
 */

interface NativeTab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface NativeBrowserState {
  open: boolean;
  activeTabId: string | null;
  tabs: NativeTab[];
  find: { active: boolean; text: string; matches: number; activeMatch: number };
}

interface NativeBrowserApi {
  create: (payload: { url?: string }) => Promise<NativeBrowserState>;
  state: () => Promise<NativeBrowserState>;
  newTab: (payload?: { url?: string }) => Promise<NativeBrowserState>;
  selectTab: (tabId: string) => Promise<NativeBrowserState>;
  closeTab: (tabId: string) => Promise<NativeBrowserState>;
  navigate: (url: string) => Promise<NativeBrowserState>;
  back: () => Promise<NativeBrowserState>;
  forward: () => Promise<NativeBrowserState>;
  reload: () => Promise<NativeBrowserState>;
  stop: () => Promise<NativeBrowserState>;
  setBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<boolean>;
  setVisible: (visible: boolean) => Promise<boolean>;
  find: (
    text: string,
    options?: { forward?: boolean; findNext?: boolean }
  ) => Promise<NativeBrowserState["find"]>;
  findStop: () => Promise<unknown>;
  zoom: (delta?: number, reset?: boolean) => Promise<number>;
  devtools: () => Promise<boolean>;
  external: (url: string) => Promise<boolean>;
  destroy: () => Promise<boolean>;
  onState: (callback: (state: NativeBrowserState) => void) => () => void;
  onError: (callback: (payload: { description: string; url?: string }) => void) => () => void;
  onDownload: (callback: (payload: { filename: string; state: string }) => void) => () => void;
  onFocusAddress: (callback: () => void) => () => void;
  onFocusFind: (callback: () => void) => () => void;
}

/** A first page that belongs to the product rather than to example.com. */
function startPage(fr: boolean): string {
  const title = fr ? "Nouvel onglet" : "New tab";
  const hint = fr ? "Saisissez une adresse pour commencer." : "Type an address to begin.";
  const links = [
    { label: "PROOFCORE", href: "https://proofstack-iota.vercel.app/" },
    {
      label: fr ? "Documentation" : "Documentation",
      href: "https://proofstack-iota.vercel.app/docs",
    },
  ];
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  :root{color-scheme:light}
  html,body{height:100%}
  body{margin:0;display:grid;place-items:center;background:#f5f2e9;color:#1b1b19;
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  main{width:min(520px,82%);text-align:center}
  .mark{width:44px;height:44px;border-radius:12px;background:#1b1b19;color:#f5f2e9;
    display:grid;place-items:center;margin:0 auto 20px;font-weight:700;font-size:15px;letter-spacing:.06em}
  h1{font-size:19px;font-weight:600;margin:0 0 6px;letter-spacing:-.01em}
  p{font-size:13px;color:#6f6b61;margin:0 0 22px}
  a{display:inline-flex;margin:0 5px;padding:7px 13px;border:1px solid #d9d4c6;border-radius:999px;
    color:#2a2a26;text-decoration:none;font-size:12.5px;background:#fbf9f3}
  a:hover{border-color:#1b1b19}
</style></head>
<body><main><div class="mark">PC</div><h1>${title}</h1><p>${hint}</p>
${links.map((link) => `<a href="${link.href}">${link.label}</a>`).join("")}
</main></body></html>`)}`;
}

function NativeBrowser({
  initialUrl,
  fr,
  hidden,
  onClose,
}: {
  initialUrl?: string;
  fr: boolean;
  hidden?: boolean;
  onClose: () => void;
}) {
  const api = (window.proofcoreDesktop as { browser?: NativeBrowserApi } | undefined)?.browser;
  const [state, setState] = useState<NativeBrowserState | null>(null);
  const [address, setAddress] = useState(initialUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [zoom, setZoom] = useState(100);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const addressRef = useRef<HTMLInputElement | null>(null);
  const findRef = useRef<HTMLInputElement | null>(null);
  const lastBounds = useRef<string>("");

  const applyBounds = useCallback(() => {
    const element = viewportRef.current;
    if (!element || !api) return;
    const rect = element.getBoundingClientRect();
    const next = {
      x: Math.max(0, Math.round(rect.left)),
      y: Math.max(0, Math.round(rect.top)),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    };
    const key = `${next.x}:${next.y}:${next.width}:${next.height}`;
    if (key === lastBounds.current) return;
    lastBounds.current = key;
    void api.setBounds(next);
  }, [api]);

  // Create the page once; the element the view covers is what decides its rectangle.
  useEffect(() => {
    if (!api) return;
    let alive = true;
    const offs = [
      api.onState((next) => {
        if (!alive) return;
        setState(next);
        const active = next.tabs.find((tab) => tab.id === next.activeTabId);
        if (active?.url && active.url !== "about:blank") setAddress(active.url);
      }),
      api.onError((payload) => {
        if (alive) setError(`${payload.description}${payload.url ? ` · ${payload.url}` : ""}`);
      }),
      api.onDownload((payload) => {
        if (alive && payload.state === "completed") setNotice(`${payload.filename}`);
      }),
      api.onFocusAddress(() => {
        setFindOpen(false);
        addressRef.current?.focus();
        addressRef.current?.select();
      }),
      api.onFocusFind(() => {
        setFindOpen(true);
        requestAnimationFrame(() => findRef.current?.focus());
      }),
    ];
    void api
      .create({ url: initialUrl ?? startPage(fr) })
      .then((next) => {
        if (!alive) return;
        setState(next);
        requestAnimationFrame(applyBounds);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      alive = false;
      for (const off of offs) off();
      void api.destroy();
    };
    // The browser is created from the URL the panel was opened with; later navigations go
    // through the address bar, not through a remount. `initialUrl` and `fr` are read at
    // create time only: re-creating the page would close the user's tabs.
  }, [api, applyBounds, fr, initialUrl]);

  // Re-applies bounds when the layout under the native view changes; the ResizeObserver on
  // the element already fires for those (find bar, tabs), so only `api` is listed here.
  useEffect(() => {
    const element = viewportRef.current;
    if (!api || !element) return;
    const observer = new ResizeObserver(() => applyBounds());
    observer.observe(element);
    const onResize = () => applyBounds();
    window.addEventListener("resize", onResize);
    document.addEventListener("scroll", onResize, true);
    applyBounds();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onResize, true);
    };
  }, [api, applyBounds]);

  // A modal rendered by the page cannot appear above a native view. When one opens, the
  // view steps aside; when it closes, the page comes back at the same place.
  useEffect(() => {
    if (!api) return;
    void api.setVisible(!hidden);
    if (!hidden) requestAnimationFrame(applyBounds);
  }, [api, hidden, applyBounds]);

  const run = useCallback((action: () => Promise<unknown> | undefined) => {
    setError(null);
    void Promise.resolve(action()).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, []);

  const active = state?.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
  const matches = state?.find.active ? state.find : null;

  const submitAddress = (event: React.FormEvent) => {
    event.preventDefault();
    const next = address.trim();
    if (!next) return;
    setNotice(null);
    run(() => api?.navigate(next));
  };

  const openFind = () => {
    setFindOpen(true);
    requestAnimationFrame(() => findRef.current?.focus());
  };

  const closeFind = () => {
    setFindOpen(false);
    setFindText("");
    run(() => api?.findStop());
  };

  const changeFind = (value: string) => {
    setFindText(value);
    if (!value) {
      run(() => api?.findStop());
      return;
    }
    run(() => api?.find(value));
  };

  return (
    <section className="pc-browser pc-browser-native" aria-label={fr ? "Navigateur" : "Browser"}>
      <div className="pc-browser-tabs" role="tablist">
        {state?.tabs.map((tab) => {
          const label =
            tab.title || tab.url.replace(/^https?:\/\//, "") || (fr ? "Nouvel onglet" : "New tab");
          return (
            <div
              key={tab.id}
              className={`pc-browser-tab${tab.id === state.activeTabId ? " is-active" : ""}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === state.activeTabId}
                className="pc-browser-tab-main"
                onClick={() => run(() => api?.selectTab(tab.id))}
                title={tab.url}
              >
                {tab.loading ? (
                  <span className="pc-browser-spinner" aria-hidden />
                ) : (
                  <Globe size={11} />
                )}
                <span className="pc-browser-tab-label">{label}</span>
              </button>
              <button
                type="button"
                className="pc-browser-tab-close"
                aria-label={fr ? "Fermer l'onglet" : "Close tab"}
                onClick={(event) => {
                  event.stopPropagation();
                  run(() => api?.closeTab(tab.id));
                }}
              >
                <X size={10} />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="pc-browser-new-tab"
          aria-label={fr ? "Nouvel onglet" : "New tab"}
          onClick={() => run(() => api?.newTab({ url: startPage(fr) }))}
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          className="pc-browser-panel-close"
          aria-label={fr ? "Fermer le navigateur" : "Close browser"}
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>

      <header className="pc-browser-bar">
        <button
          type="button"
          className="pc-browser-icon"
          aria-label={fr ? "Précédent" : "Back"}
          onClick={() => run(() => api?.back())}
          disabled={!active?.canGoBack}
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          className="pc-browser-icon"
          aria-label={fr ? "Suivant" : "Forward"}
          onClick={() => run(() => api?.forward())}
          disabled={!active?.canGoForward}
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          className="pc-browser-icon"
          aria-label={active?.loading ? (fr ? "Arrêter" : "Stop") : fr ? "Recharger" : "Reload"}
          onClick={() => run(() => (active?.loading ? api?.stop() : api?.reload()))}
        >
          {active?.loading ? <X size={13} /> : <RotateCw size={13} />}
        </button>
        <form className="pc-browser-address" onSubmit={submitAddress}>
          <ShieldCheck size={12} className="pc-browser-scheme" aria-hidden />
          <input
            ref={addressRef}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={fr ? "Rechercher ou saisir une adresse" : "Search or enter address"}
            spellCheck={false}
            aria-label={fr ? "Adresse" : "Address"}
          />
          <button type="submit" className="pc-browser-go" aria-label={fr ? "Ouvrir" : "Open"}>
            <ArrowRight size={13} />
          </button>
        </form>
        <button
          type="button"
          className={`pc-browser-icon${findOpen ? " is-on" : ""}`}
          aria-label={fr ? "Rechercher dans la page" : "Find in page"}
          onClick={() => (findOpen ? closeFind() : openFind())}
        >
          <Search size={13} />
        </button>
        <button
          type="button"
          className="pc-browser-icon"
          aria-label={fr ? "Ouvrir dans le navigateur système" : "Open in system browser"}
          onClick={() => run(() => api?.external(active?.url ?? address))}
          disabled={!active?.url}
        >
          <ExternalLink size={13} />
        </button>
      </header>

      {findOpen && (
        <div className="pc-browser-find">
          <Search size={12} aria-hidden />
          <input
            ref={findRef}
            value={findText}
            onChange={(event) => changeFind(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                run(() => api?.find(findText, { findNext: true, forward: !event.shiftKey }));
              }
              if (event.key === "Escape") closeFind();
            }}
            placeholder={fr ? "Dans la page…" : "In page…"}
            aria-label={fr ? "Rechercher dans la page" : "Find in page"}
          />
          <span className="pc-browser-find-count">
            {matches && matches.matches > 0
              ? `${matches.activeMatch}/${matches.matches}`
              : findText
                ? fr
                  ? "aucun"
                  : "none"
                : ""}
          </span>
          <button
            type="button"
            className="pc-browser-icon"
            onClick={closeFind}
            aria-label={fr ? "Fermer" : "Close"}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {(error || notice) && (
        <div className={`pc-browser-error${notice ? " is-notice" : ""}`}>
          <span>{error ?? `${fr ? "Téléchargé" : "Downloaded"} · ${notice}`}</span>
          {error && (
            <button type="button" onClick={() => run(() => api?.reload())}>
              {fr ? "Recréer" : "Reload"}
            </button>
          )}
        </div>
      )}

      <div className="pc-browser-viewport pc-browser-native-viewport" ref={viewportRef}>
        {/* The native Chromium view is positioned over this element by the main process. */}
        {!state?.open && (
          <div className="pc-browser-empty">
            {fr ? "Ouverture du navigateur…" : "Opening the browser…"}
          </div>
        )}
      </div>

      <footer className="pc-browser-foot">
        <span className="pc-browser-title" title={active?.url}>
          {active?.title || active?.url || (fr ? "Nouvel onglet" : "New tab")}
        </span>
        <span className="pc-browser-live" title={fr ? "Chromium embarqué" : "Embedded Chromium"}>
          <Monitor size={10} /> {fr ? "natif" : "native"}
        </span>
        <div className="pc-browser-zoom">
          <button
            type="button"
            aria-label={fr ? "Zoom arrière" : "Zoom out"}
            onClick={() => run(async () => setZoom(100 + (await (api?.zoom(-0.5) ?? 0)) * 20))}
          >
            <Minus size={10} />
          </button>
          <span>{zoom}%</span>
          <button
            type="button"
            aria-label={fr ? "Zoom avant" : "Zoom in"}
            onClick={() => run(async () => setZoom(100 + (await (api?.zoom(0.5) ?? 0)) * 20))}
          >
            <Plus size={10} />
          </button>
          <button
            type="button"
            className="pc-browser-devtools"
            aria-label={fr ? "Outils de développement" : "Developer tools"}
            onClick={() => run(() => api?.devtools())}
          >
            <Wrench size={10} />
          </button>
        </div>
      </footer>
    </section>
  );
}

// ---------------------------------------------------------------- web fallback

const SERVER_VIEWPORT = { width: 1280, height: 800 };
const START_TIMEOUT_MS = 90_000;
const ACTION_TIMEOUT_MS = 60_000;

interface RemoteBrowserState {
  sessionId: string;
  url: string;
  title: string;
  screenshot?: string;
  console: { type: string; text: string }[];
}

/**
 * The server-rendered preview, for a plain web tab.
 *
 * A page is not an iframe: most sites refuse framing, and the refusal is a blank box that
 * looks like a bug here. What is on screen is the browser on the server after each action —
 * so a click here is a click there, scaled through the viewport rectangle.
 */
function RemoteBrowser({
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
  const [state, setState] = useState<RemoteBrowserState | null>(null);
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
        const result = await postJson<RemoteBrowserState>(
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
        const result = await postJson<RemoteBrowserState>(
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
          title={fr ? "Rendu par le serveur" : "Rendered by the server"}
        >
          <Monitor size={11} /> {fr ? "aperçu" : "preview"}
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

      {error && (
        <div className="pc-browser-error">
          <span>{error}</span>
          <button type="button" onClick={() => void start(address)}>
            {fr ? "Réessayer" : "Try again"}
          </button>
        </div>
      )}

      <div className="pc-browser-viewport">
        {state?.screenshot ? (
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

export function BrowserPanel({
  workspaceId,
  initialUrl,
  fr,
  hidden,
  onClose,
}: {
  workspaceId: string;
  initialUrl?: string;
  fr: boolean;
  /** Hide the native view while a dialog is open above the interface. */
  hidden?: boolean;
  onClose: () => void;
}) {
  const native = (window.proofcoreDesktop as { browser?: NativeBrowserApi } | undefined)?.browser;
  if (native) {
    return (
      <NativeBrowser
        {...(initialUrl ? { initialUrl } : {})}
        fr={fr}
        {...(hidden ? { hidden } : {})}
        onClose={onClose}
      />
    );
  }
  return (
    <RemoteBrowser
      workspaceId={workspaceId}
      {...(initialUrl ? { initialUrl } : {})}
      fr={fr}
      onClose={onClose}
    />
  );
}
