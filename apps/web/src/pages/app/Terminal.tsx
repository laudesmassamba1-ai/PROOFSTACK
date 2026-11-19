import { FitAddon } from "@xterm/addon-fit";
import { Terminal as Xterm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Plus, RotateCw, Terminal as TerminalIcon, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import "../../styles/terminal.css";

/**
 * A shell in the application.
 *
 * The transport is deliberately plain: a session is created over HTTP, output arrives as
 * Server-Sent Events and keystrokes go back as small JSON posts. Same origin, same per-run
 * cookie, no WebSocket handshake to keep alive — and a terminal survives the page's own
 * navigation because the process lives in the engine, not in the component.
 */

interface TerminalSession {
  id: string;
  shell: string;
  mode: "pty" | "pipe";
  cwd: string;
  cols: number;
  rows: number;
}

function decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  // `String.fromCharCode(...bytes)` overflows the call stack on long pastes; chunk it.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function post(path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function TerminalPage() {
  const { locale } = useI18n();
  const fr = locale === "fr";
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Xterm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [status, setStatus] = useState<"starting" | "ready" | "exited" | "error">("starting");
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    const id = sessionRef.current?.id;
    sessionRef.current = null;
    if (id) void post("/api/terminal/kill", { session: id }).catch(() => undefined);
  }, []);

  const connect = useCallback(
    async (replace: boolean) => {
      const term = termRef.current;
      const fit = fitRef.current;
      if (!term || !fit) return;
      setStatus("starting");
      setError(null);
      stop();
      fit.fit();
      try {
        const response = await post("/api/terminal/start", {
          cols: term.cols,
          rows: term.rows,
          replace,
        });
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? fr
                ? "Le terminal est disponible dans l'application desktop."
                : "The terminal is available in the desktop application."
              : `HTTP ${response.status}`
          );
        }
        const info = (await response.json()) as TerminalSession;
        sessionRef.current = info;
        setSession(info);
        setStatus("ready");
        const source = new EventSource(
          `/api/terminal/stream?session=${encodeURIComponent(info.id)}`
        );
        sourceRef.current = source;
        source.addEventListener("ready", () => {
          // A reconnect replays the session's history; resetting first keeps it identical
          // instead of appending the same output twice.
          term.reset();
        });
        source.addEventListener("data", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as { data?: string };
            if (payload.data) term.write(decode(payload.data));
          } catch {
            // A malformed frame is dropped; the stream continues.
          }
        });
        source.addEventListener("exit", () => {
          setStatus("exited");
          source.close();
          sourceRef.current = null;
          term.write(`\r\n\x1b[38;5;244m${fr ? "Session terminée" : "Session ended"}\x1b[0m\r\n`);
        });
        source.onerror = () => {
          // EventSource reconnects on its own; the `ready` handler resets the screen.
        };
      } catch (cause) {
        setStatus("error");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [fr, stop]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Xterm({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 4_000,
      allowProposedApi: false,
      theme: {
        background: "#0c0f0e",
        foreground: "#e7e4da",
        cursor: "#8fe3c6",
        cursorAccent: "#0c0f0e",
        selectionBackground: "rgba(143, 227, 198, 0.22)",
        black: "#1a1f1d",
        red: "#f07b72",
        green: "#8fe3c6",
        yellow: "#e5c07b",
        blue: "#7fb6e8",
        magenta: "#c79be8",
        cyan: "#78e3cb",
        white: "#e7e4da",
        brightBlack: "#5b625e",
        brightRed: "#ff958b",
        brightGreen: "#a8f0d8",
        brightYellow: "#f2d69c",
        brightBlue: "#a3cbf0",
        brightMagenta: "#dcb9f2",
        brightCyan: "#9af0de",
        brightWhite: "#fbf9f3",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;
    requestAnimationFrame(() => {
      fit.fit();
      void connect(false);
    });

    const onData = term.onData((data) => {
      const id = sessionRef.current?.id;
      if (!id) return;
      void post("/api/terminal/input", { session: id, data: encode(data) }).catch(() => undefined);
    });
    const onResize = term.onResize(({ cols, rows }) => {
      const id = sessionRef.current?.id;
      if (!id) return;
      void post("/api/terminal/resize", { session: id, cols, rows }).catch(() => undefined);
    });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // Hidden containers report a zero size; the next visible resize fixes it.
      }
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      onData.dispose();
      onResize.dispose();
      sourceRef.current?.close();
      sourceRef.current = null;
      const id = sessionRef.current?.id;
      sessionRef.current = null;
      if (id) void post("/api/terminal/kill", { session: id }).catch(() => undefined);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // Created once; a new session is an explicit action, not a re-render.
    // biome-ignore lint/correctness/useExhaustiveDependencies: the terminal owns its lifecycle.
  }, []);

  const restart = () => {
    const term = termRef.current;
    term?.reset();
    term?.clear();
    void connect(true);
  };

  const label =
    status === "starting"
      ? fr
        ? "Connexion"
        : "Connecting"
      : status === "exited"
        ? fr
          ? "Terminé"
          : "Ended"
        : status === "error"
          ? fr
            ? "Indisponible"
            : "Unavailable"
          : "Live";

  return (
    <>
      <PageHeader
        eyebrow="Shell"
        title="Terminal"
        description={
          session
            ? `${session.cwd}${session.mode === "pipe" ? (fr ? " · mode ligne" : " · line mode") : ""}`
            : fr
              ? "Un shell sur cette machine."
              : "A shell on this machine."
        }
        actions={
          <div className="terminal-actions">
            <span className={`terminal-status is-${status}`}>
              <span className="terminal-dot" aria-hidden /> {label}
            </span>
            <button type="button" className="app-btn app-btn-sm" onClick={restart}>
              <RotateCw size={13} /> {fr ? "Relancer" : "Restart"}
            </button>
            <button
              type="button"
              className="app-btn app-btn-sm"
              onClick={() => {
                termRef.current?.clear();
                termRef.current?.focus();
              }}
            >
              <Trash2 size={13} /> {fr ? "Effacer" : "Clear"}
            </button>
            <button
              type="button"
              className="app-btn app-btn-sm"
              onClick={() => {
                termRef.current?.reset();
                void connect(true);
              }}
              aria-label={fr ? "Nouvelle session" : "New session"}
            >
              <Plus size={13} />
            </button>
          </div>
        }
      />

      {error && (
        <div className="terminal-error" role="alert">
          <TerminalIcon size={15} />
          <span>{error}</span>
        </div>
      )}

      <div className="terminal-shell">
        <div
          className="terminal-host"
          ref={hostRef}
          role="application"
          aria-label={fr ? "Terminal" : "Terminal"}
        />
      </div>
    </>
  );
}
