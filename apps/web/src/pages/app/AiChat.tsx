import { Bot, Eraser, KeyRound, Send, ShieldCheck, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorState, Loading } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { useSession } from "../../lib/session.js";

/**
 * Chat with your own AI, wired to PROOFCORE's data.
 *
 * The model is the user's: the provider URL, model and API key are set here and
 * the key lives in this browser's localStorage only — the API forwards it to the
 * provider per request and stores nothing. What the AI reads is real: the
 * server executes read-only tools (projects, runs, findings, reports) scoped to
 * the active workspace, and every tool consultation is shown as a chip in the
 * conversation so nothing happens silently.
 */

interface ProviderSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
}

const STORAGE_SETTINGS = "proofcore.ai.settings";
const STORAGE_HISTORY = "proofcore.ai.history";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  trace?: { tool: string; summary: string }[];
  /** Stable per-message id for React keys; assigned at creation time. */
  id: string;
}

let messageCounter = 0;

function newMessage(
  role: ChatMessage["role"],
  content: string,
  trace?: ChatMessage["trace"]
): ChatMessage {
  messageCounter += 1;
  return { id: `m${Date.now()}_${messageCounter}`, role, content, ...(trace ? { trace } : {}) };
}

const DEFAULT_SETTINGS: ProviderSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKey: "",
};

function loadSettings(): ProviderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ProviderSettings>;
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : DEFAULT_SETTINGS.baseUrl,
      model: typeof parsed.model === "string" ? parsed.model : DEFAULT_SETTINGS.model,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is ChatMessage =>
          typeof entry === "object" &&
          entry !== null &&
          "role" in entry &&
          "content" in entry &&
          (entry.role === "user" || entry.role === "assistant") &&
          typeof entry.content === "string"
      )
      .slice(-40);
  } catch {
    return [];
  }
}

export function AiChat() {
  const { t } = useI18n();
  const session = useSession();
  const [settings, setSettings] = useState<ProviderSettings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(messages.slice(-40)));
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
  }, [settings]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || busy || !session.workspaceId) return;
    if (!settings.apiKey) {
      setShowSettings(true);
      setError(t("ai.needKey"));
      return;
    }
    setError(null);
    setInput("");
    const history = [...messages, newMessage("user", question)];
    setMessages(history);
    setBusy(true);
    try {
      const response = await apiFetch<{
        message: string;
        trace: { tool: string; summary: string }[];
      }>("/api/v1/ai/chat", {
        method: "POST",
        body: {
          workspaceId: session.workspaceId,
          provider: settings,
          messages: history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
        },
      });
      setMessages([...history, newMessage("assistant", response.message, response.trace)]);
    } catch (caught) {
      const apiError = caught as ApiError;
      setError(apiError?.message ?? (caught instanceof Error ? caught.message : t("ai.failed")));
    } finally {
      setBusy(false);
    }
  }, [busy, input, messages, session.workspaceId, settings, t]);

  if (session.status === "loading") return <Loading label="" />;
  if (session.status === "unreachable") {
    return (
      <ErrorState error={new Error(t("ai.unreachable"))} onRetry={() => window.location.reload()} />
    );
  }

  return (
    <>
      <PageHeader
        title={t("ai.title")}
        description={t("ai.description")}
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              className="app-btn"
              onClick={() => {
                if (messages.length === 0 || window.confirm(t("ai.confirmClear"))) {
                  setMessages([]);
                  setError(null);
                }
              }}
            >
              <Eraser size={14} /> {t("ai.clear")}
            </button>
            <button
              type="button"
              className={`app-btn ${settings.apiKey ? "" : "app-btn-primary"}`}
              onClick={() => setShowSettings((open) => !open)}
            >
              <KeyRound size={14} /> {settings.apiKey ? t("ai.settings") : t("ai.connect")}
            </button>
          </div>
        }
      />

      {showSettings ? (
        <div className="app-card mb-4 p-5">
          <p className="flex items-center gap-2 text-xs leading-relaxed text-muted">
            <ShieldCheck size={14} className="shrink-0" /> {t("ai.keyPrivacy")}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_0.6fr]">
            <label className="block">
              <span className="app-label">{t("ai.baseUrl")}</span>
              <input
                className="app-input"
                value={settings.baseUrl}
                onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })}
                spellCheck={false}
                dir="ltr"
              />
            </label>
            <label className="block">
              <span className="app-label">{t("ai.model")}</span>
              <input
                className="app-input"
                value={settings.model}
                onChange={(event) => setSettings({ ...settings, model: event.target.value })}
                spellCheck={false}
                dir="ltr"
              />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="app-label">{t("ai.apiKey")}</span>
            <input
              className="app-input"
              type="password"
              value={settings.apiKey}
              onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })}
              placeholder="sk-…"
              autoComplete="off"
              dir="ltr"
            />
          </label>
          <p className="mt-2 text-xs text-muted">{t("ai.keyStored")}</p>
        </div>
      ) : null}

      <div
        ref={listRef}
        className="app-card flex min-h-[300px] flex-col gap-4 overflow-y-auto p-5"
        style={{ maxHeight: "58vh" }}
      >
        {messages.length === 0 ? (
          <div className="m-auto max-w-sm text-center">
            <Bot aria-hidden className="mx-auto size-8 text-muted" />
            <p className="mt-3 text-sm text-muted">{t("ai.empty")}</p>
            <p className="mt-1 text-xs text-muted">{t("ai.emptyHint")}</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                message.role === "user"
                  ? "self-end bg-neutral-900 text-white dark:bg-white dark:text-black"
                  : "self-start border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
              }`}
            >
              {message.content || "…"}
              {message.trace && message.trace.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-neutral-200 pt-2 dark:border-neutral-800">
                  {message.trace.map((step) => (
                    <span
                      key={`${message.id}_${step.tool}_${step.summary}`}
                      className="app-mono inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[0.65rem] text-muted dark:bg-neutral-800"
                    >
                      <Wrench size={10} aria-hidden /> {step.tool} · {step.summary}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
        {busy ? (
          <div className="self-start text-xs text-muted" role="status">
            {t("ai.thinking")}
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          className="app-input flex-1"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t("ai.placeholder")}
          disabled={busy}
          maxLength={8000}
        />
        <button type="submit" className="app-btn app-btn-primary" disabled={busy || !input.trim()}>
          <Send size={14} /> {t("ai.send")}
        </button>
      </form>

      <p className="mt-3 text-xs leading-relaxed text-muted">{t("ai.note")}</p>
    </>
  );
}
