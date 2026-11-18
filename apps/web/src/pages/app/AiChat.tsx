import {
  BadgeCheck,
  ChevronDown,
  Eraser,
  Globe,
  Lock,
  PanelLeft,
  Plug,
  Plus,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiMark } from "../../components/brand/AiMark.js";
import { useI18n } from "../../i18n/index.js";
import { useSession } from "../../lib/session.js";

interface EffortLevel {
  id: "quick" | "balanced" | "deep" | "ultra";
  label: string;
  hint: string;
  burn: string;
}

interface ConversationSummary {
  id: string;
  title: string;
  effort: string;
  updatedAt: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  trace?: { tool: string; summary: string }[];
  error?: string;
}

interface ProfileState {
  configured: boolean;
  providerId?: string;
  providerKind?: string;
  providerLabel?: string;
  baseUrl?: string;
  model?: string;
  keyFingerprint?: string;
}

const EFFORTS: EffortLevel[] = [
  { id: "quick", label: "Rapide", hint: "Réponse directe, 1 outil max", burn: "1×" },
  { id: "balanced", label: "Équilibré", hint: "Données utiles, réponse focalisée", burn: "2×" },
  { id: "deep", label: "Approfondi", hint: "Croise runs, findings et audits", burn: "4×" },
  {
    id: "ultra",
    label: "Ultra",
    hint: "Audit complet multi-sources, rapport structuré",
    burn: "8×",
  },
];

const TOOL_ICONS: Record<string, typeof BadgeCheck> = {
  fail_scan: ShieldAlert,
  clean_audit: BadgeCheck,
  fetch_web: Globe,
};

/** Short notes only. The provider list itself is read from /api/v1/ai/providers. */
const PROVIDER_HINTS: Record<string, string> = {
  groq: "très rapide, gratuit",
  openrouter: "tous les modèles",
  cerebras: "le plus rapide",
  ollama: "100 % local",
  anthropic: "Claude",
  google: "Gemini",
};

interface ProviderOption {
  id: string;
  label: string;
  kind: string;
  keyOptional?: boolean;
}

/** MCP connection recipes: PROOFCORE tools inside the user's coding agent. */
const MCP_RECIPES = [
  {
    id: "claude-code",
    label: "Claude Code",
    file: ".mcp.json",
    snippet: JSON.stringify(
      { mcpServers: { proofcore: { command: "proofcore", args: ["mcp"] } } },
      null,
      2
    ),
  },
  {
    id: "codex",
    label: "Codex CLI",
    file: "~/.codex/config.toml",
    snippet: `[mcp_servers.proofcore]\ncommand = "proofcore"\nargs = ["mcp"]`,
  },
  {
    id: "opencode",
    label: "OpenCode",
    file: "~/.config/opencode/config.json",
    snippet: JSON.stringify(
      { mcp: { proofcore: { type: "local", command: ["proofcore", "mcp"] } } },
      null,
      2
    ),
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    file: "~/.gemini/settings.json",
    snippet: JSON.stringify(
      { mcpServers: { proofcore: { command: "proofcore", args: ["mcp"] } } },
      null,
      2
    ),
  },
  {
    id: "cursor",
    label: "Cursor",
    file: "~/.cursor/mcp.json",
    snippet: JSON.stringify(
      { mcpServers: { proofcore: { command: "proofcore", args: ["mcp"] } } },
      null,
      2
    ),
  },
];

/**
 * Reads the API error envelope.
 *
 * The server answers `{ error: { code, message, details } }`. Rendering `data.message`
 * produced a useless generic string and `data.error` produced "[object Object]" — which
 * is exactly why a refused key looked like a silent failure.
 */
async function readApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string; code?: string } | string;
    message?: string;
  } | null;
  if (payload) {
    if (typeof payload.error === "string" && payload.error) return payload.error;
    if (payload.error && typeof payload.error === "object" && payload.error.message) {
      const code = payload.error.code ? ` (${payload.error.code})` : "";
      return `${payload.error.message}${code}`;
    }
    if (payload.message) return payload.message;
  }
  return `${fallback} (HTTP ${response.status})`;
}

/**
 * Explains a failed chat call in the user's terms.
 *
 * A 502 from the edge carries no JSON at all, while a provider refusal carries the
 * provider's own words. Both used to surface as "the request failed (HTTP 502)".
 */
function describeFailure(
  status: number,
  data: { error?: { code?: string; message?: string; details?: Record<string, unknown> } },
  raw: string,
  fr: boolean
): string {
  const code = data.error?.code ?? "";
  const message = data.error?.message;
  if (
    code === "ai_model_not_found" ||
    (/model/i.test(message ?? "") && /not.*(exist|access|offer)/i.test(message ?? ""))
  ) {
    return fr
      ? `${message ?? "Ce modèle n'existe pas sur cette clé."} Ouvre les réglages du modèle et choisis-en un dans la liste.`
      : `${message ?? "This model does not exist on this key."} Open the model settings and pick one from the list.`;
  }
  if (code === "ai_invalid_key") {
    return fr
      ? "Le fournisseur a refusé la clé enregistrée. Remplace-la dans les réglages."
      : "The provider rejected the saved key. Replace it in the settings.";
  }
  if (code === "ai_not_configured") {
    return fr
      ? "Aucun modèle connecté. Ouvre les réglages."
      : "No model connected. Open the settings.";
  }
  if (code === "ai_rate_limited") {
    return fr
      ? "Trop de demandes cette heure-ci. Réessaie plus tard."
      : "Too many requests this hour. Try again later.";
  }
  if (code === "ai_turn_budget") {
    return fr
      ? "La question demandait trop d'étapes. Précise-la, ou baisse le niveau d'effort."
      : "The question needed too many steps. Narrow it, or lower the effort level.";
  }
  if (code === "payload_too_large" || status === 413) {
    return fr
      ? "Message trop long pour une seule demande."
      : "Message too long for a single request.";
  }
  if (status === 502 || status === 504) {
    return fr
      ? "La passerelle a coupé la requête avant la réponse (délai dépassé). Réessaie : si ça se répète, baisse le niveau d'effort — Ultra enchaîne beaucoup d'appels d'outils."
      : "The gateway cut the request before the answer (timeout). Retry; if it repeats, lower the effort level — Ultra chains many tool calls.";
  }
  if (message) return message;
  if (raw && raw.length < 200 && !raw.trimStart().startsWith("<")) return raw;
  return fr ? `La demande a échoué (HTTP ${status}).` : `The request failed (HTTP ${status}).`;
}

function uid(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function Markdownish({ text }: { text: string }): React.ReactElement {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="chat-prose space-y-2">
      {blocks.map((block, index) => {
        const key = `b${index}-${block.slice(0, 12)}`;
        if (block.startsWith("### ") || block.startsWith("## ") || block.startsWith("# ")) {
          return (
            <h4 key={key}>{block.replace(/^#+\s*/, "")}</h4>
          );
        }
        if (/^[-*]\s/m.test(block)) {
          return (
            <ul key={key} className="space-y-1">
              {block.split("\n").map((line) => (
                <li key={`${key}-${line.slice(0, 12)}`}>{line.replace(/^[-*]\s*/, "")}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={key} className="whitespace-pre-wrap">
            {block}
          </p>
        );
      })}
    </div>
  );
}

/* ---------- pieces of the composer ---------- */

function EffortPicker({
  effort,
  onSelect,
  fr,
}: {
  effort: EffortLevel["id"];
  onSelect: (id: EffortLevel["id"]) => void;
  fr: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const active = EFFORTS.find((level) => level.id === effort) ?? EFFORTS[1];
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!active) return <span />;

  return (
    <div className="chat-effort" ref={wrapRef}>
      <button
        type="button"
        className="chat-effort-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        {active.label} <span className="chat-effort-burn">· {active.burn}</span>
        <ChevronDown
          size={12}
          style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 140ms" }}
        />
      </button>
      {open && (
        <div className="chat-effort-menu" role="menu">
          {EFFORTS.map((level) => (
            <button
              key={level.id}
              type="button"
              role="menuitem"
              className={`chat-effort-item ${effort === level.id ? "is-active" : ""}`}
              onClick={() => {
                onSelect(level.id);
                setOpen(false);
              }}
            >
              <span className="min-w-0 flex-1">
                <span className="chat-effort-name">
                  {level.label} <span className="chat-effort-burn">· {level.burn}</span>
                </span>
                <span className="chat-effort-hint">{level.hint}</span>
              </span>
            </button>
          ))}
          <p className="chat-effort-note">
            {fr
              ? "Plus l'effort est élevé, plus l'assistant interroge d'outils et consomme de crédits sur votre fournisseur IA."
              : "Higher effort means more tool calls and more credits burned on your AI provider."}
          </p>
        </div>
      )}
    </div>
  );
}

function Composer({
  draft,
  setDraft,
  onSend,
  busy,
  effort,
  onEffort,
  fr,
}: {
  draft: string;
  setDraft: (value: string) => void;
  onSend: () => void;
  busy: boolean;
  effort: EffortLevel["id"];
  onEffort: (id: EffortLevel["id"]) => void;
  fr: boolean;
}): React.ReactElement {
  return (
    <div className="chat-composer">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSend();
          }
        }}
        rows={Math.min(4, Math.max(1, draft.split("\n").length))}
        placeholder={
          fr ? "Comment puis-je vous aider aujourd'hui ?" : "How can I help you today?"
        }
        className="chat-composer-input"
      />
      <div className="chat-composer-bar">
        <EffortPicker effort={effort} onSelect={onEffort} fr={fr} />
        <button
          type="button"
          onClick={onSend}
          disabled={busy || !draft.trim()}
          className="chat-send"
          aria-label={fr ? "Envoyer" : "Send"}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

/* ---------- the page ---------- */

export function AiChatPage(): React.ReactElement {
  const { locale } = useI18n();
  const { user, workspaces, workspaceId: activeWorkspaceId } = useSession();
  const fr = locale === "fr";

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationFilter, setConversationFilter] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [effort, setEffort] = useState<EffortLevel["id"]>("balanced");
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [baseUrlDraft, setBaseUrlDraft] = useState("https://api.openai.com/v1");
  const [activePreset, setActivePreset] = useState<string>("openai");
  const [modelDraft, setModelDraft] = useState("gpt-4o-mini");
  const [keyDraft, setKeyDraft] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderOption[]>([
    { id: "openai", label: "OpenAI", kind: "openai" },
    { id: "anthropic", label: "Anthropic (Claude)", kind: "anthropic" },
  ]);
  const [chatModels, setChatModels] = useState<string[]>([]);
  const [profileError, setProfileError] = useState<string | null>(null);
  /** The provider list is server-owned: adding Claude must not need a web release. */
  const loadProviders = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/ai/providers", { credentials: "include" });
      if (!response.ok) return;
      const data = (await response.json()) as { items?: ProviderOption[] };
      if (data.items && data.items.length > 0) setProviders(data.items);
    } catch {
      // The built-in pair stays usable if the registry call fails.
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    latencyMs?: number;
    models?: string[];
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpTab, setMcpTab] = useState(MCP_RECIPES[0]?.id ?? "claude-code");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetch(`/api/v1/ai/conversations?workspaceId=${activeWorkspaceId}`, { credentials: "include" })
      .then((response) => (response.ok ? response.json() : { items: [] }))
      .then((data) => setConversations(data.items ?? []))
      .catch(() => setConversations([]));
  }, [activeWorkspaceId]);

  useEffect(() => {
    fetch("/api/v1/ai/profile", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : { configured: false }))
      .then((data) => {
        setProfile(data);
        if (data.configured) {
          setBaseUrlDraft(data.baseUrl ?? "");
          setModelDraft(data.model ?? "");
          // The stored provider id is authoritative; only a legacy row without one falls
          // back to "custom".
          setActivePreset(data.providerId ?? "custom");
        }
      })
      .catch(() => setProfile({ configured: false }));
  }, []);

  // Auto-scroll: attaching this callback ref to the end sentinel scrolls the
  // newest content into view without hook state.
  const endSentinel = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setActiveId(id);
    const response = await fetch(`/api/v1/ai/conversations/${id}`, { credentials: "include" });
    if (!response.ok) return;
    const data = (await response.json()) as {
      messages: {
        role: "user" | "assistant";
        content: string;
        trace?: { tool: string; summary: string }[];
      }[];
      effort: EffortLevel["id"];
    };
    setEffort(data.effort ?? "balanced");
    setMessages(
      (data.messages ?? []).map((message) => ({
        id: uid(),
        role: message.role,
        content: message.content,
        trace: message.trace,
      }))
    );
  }, []);

  const startNewChat = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setDraft("");
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      await fetch(`/api/v1/ai/conversations/${id}`, { method: "DELETE", credentials: "include" });
      setConversations((items) => items.filter((item) => item.id !== id));
      if (activeId === id) startNewChat();
    },
    [activeId, startNewChat]
  );

  const testConnection = useCallback(async () => {
    // `activePreset` and `baseUrlDraft` decide where the key is sent: both must be in
    // the dependency list or a stale provider would be tested.
    setTesting(true);
    setTestResult(null);
    setProfileError(null);
    try {
      const response = await fetch("/api/v1/ai/profile/test", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: activePreset,
          ...(activePreset === "custom" ? { baseUrl: baseUrlDraft } : {}),
          ...(modelDraft ? { model: modelDraft } : {}),
          ...(keyDraft ? { apiKey: keyDraft } : {}),
        }),
      });
      if (!response.ok) {
        setTestResult({ ok: false, message: await readApiError(response, "Test refused") });
        return;
      }
      const data = (await response.json()) as {
        ok: boolean;
        message: string;
        latencyMs?: number;
        models?: string[];
        chatModels?: string[];
        modelAvailable?: boolean;
        suggestedModel?: string;
      };
      // A model that is not on the key cannot work: switch to the suggested one
      // instead of letting the user discover it later in a failed chat.
      if (data.ok && data.modelAvailable === false) {
        const replacement = data.suggestedModel ?? data.chatModels?.[0];
        if (replacement) {
          setModelDraft(replacement);
          setProfileError(null);
        }
      }
      setTestResult({
        ok: data.ok,
        message: data.message,
        ...(data.latencyMs !== undefined ? { latencyMs: data.latencyMs } : {}),
        ...((data.chatModels ?? data.models) ? { models: data.chatModels ?? data.models } : {}),
      });
    } catch (error) {
      setTestResult({
        ok: false,
        message: error instanceof Error ? error.message : "Network error",
      });
    } finally {
      setTesting(false);
    }
  }, [activePreset, baseUrlDraft, modelDraft, keyDraft]);

  /**
   * Connects a provider: provider + key in, working model out.
   *
   * The user never types a model id. If they do (advanced picker), it is still validated
   * against the provider catalogue by the server before it is stored.
   */
  const connectProvider = useCallback(async () => {
    setProfileSaving(true);
    setProfileError(null);
    try {
      const response = await fetch("/api/v1/ai/profile", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: activePreset,
          ...(activePreset === "custom" ? { baseUrl: baseUrlDraft } : {}),
          ...(modelDraft ? { model: modelDraft } : {}),
          ...(keyDraft ? { apiKey: keyDraft } : {}),
        }),
      });
      const raw = await response.text();
      type ConnectResponse = ProfileState & {
        configured: true;
        chatModels?: string[];
        modelWasChosen?: boolean;
      };
      const parsed: unknown = (() => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })();
      if (!response.ok || !parsed) {
        setProfileError(
          describeFailure(
            response.status,
            (parsed ?? {}) as Parameters<typeof describeFailure>[1],
            raw,
            fr
          )
        );
        return;
      }
      const data = parsed as ConnectResponse;
      setProfile(data);
      if (data.chatModels) setChatModels(data.chatModels);
      setKeyDraft("");
      setModelDraft("");
      setTestResult(null);
      setSettingsOpen(false);
    } finally {
      setProfileSaving(false);
    }
  }, [activePreset, baseUrlDraft, modelDraft, keyDraft, fr]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy || !activeWorkspaceId) return;
    if (!profile?.configured) {
      setSettingsOpen(true);
      return;
    }
    setDraft("");
    const userMessage: ChatMessage = { id: uid(), role: "user", content: text };
    const pendingId = uid();
    setMessages((items) => [
      ...items,
      userMessage,
      { id: pendingId, role: "assistant", content: "" },
    ]);
    setBusy(true);
    try {
      const response = await fetch("/api/v1/ai/chat", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          ...(activeId ? { conversationId: activeId } : {}),
          message: text,
          effort,
        }),
      });
      const raw = await response.text();
      let data: {
        conversationId?: string;
        title?: string;
        message?: string;
        trace?: { tool: string; summary: string }[];
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      } = {};
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        data = {};
      }
      if (!response.ok) {
        const message = describeFailure(response.status, data, raw, fr);
        setMessages((items) =>
          items.map((item) =>
            item.id === pendingId ? { ...item, content: "", error: message } : item
          )
        );
        return;
      }
      if (data.conversationId) setActiveId(data.conversationId);
      setMessages((items) =>
        items.map((item) =>
          item.id === pendingId ? { ...item, content: data.message ?? "", trace: data.trace } : item
        )
      );
      if (!activeId) {
        setConversations((items) => [
          {
            id: data.conversationId ?? uid(),
            title: data.title ?? text.slice(0, 60),
            effort,
            updatedAt: new Date().toISOString(),
          },
          ...items,
        ]);
      }
    } catch {
      setMessages((items) =>
        items.map((item) =>
          item.id === pendingId
            ? { ...item, error: fr ? "Connexion interrompue." : "Connection interrupted." }
            : item
        )
      );
    } finally {
      setBusy(false);
    }
  }, [draft, busy, activeWorkspaceId, profile, activeId, effort, fr]);

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const firstName = (user?.name ?? "").split(/\s+/)[0] ?? "";
  const greeting = fr
    ? `Bonjour${firstName ? `, ${firstName}` : ""}`
    : `Hello${firstName ? `, ${firstName}` : ""}`;
  const filteredConversations = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(conversationFilter.trim().toLowerCase())
  );
  const hasMessages = messages.length > 0;

  return (
    <div className="chat-shell">
      {/* ---------------------------------------------------- sidebar */}
      <aside className={`chat-sidebar ${sidebarOpen ? "" : "is-collapsed"}`}>
        <div className="chat-sidebar-head">
          <button type="button" onClick={startNewChat} className="chat-new-chat">
            <span className="chat-new-chat-mark">
              <Plus size={13} />
            </span>
            {fr ? "Nouvelle conversation" : "New conversation"}
          </button>
          <button
            type="button"
            className="chat-icon-btn"
            onClick={() => setSidebarOpen(false)}
            aria-label={fr ? "Masquer l'historique" : "Hide history"}
          >
            <PanelLeft size={15} />
          </button>
        </div>

        <div className="chat-search">
          <Search size={13} aria-hidden />
          <input
            value={conversationFilter}
            onChange={(event) => setConversationFilter(event.target.value)}
            placeholder={fr ? "Rechercher…" : "Search…"}
            aria-label={fr ? "Rechercher une conversation" : "Search conversations"}
          />
        </div>

        <div className="chat-list">
          {filteredConversations.length === 0 && (
            <p className="chat-list-empty">
              {conversations.length === 0
                ? fr
                  ? "Aucune conversation pour l'instant."
                  : "No conversations yet."
                : fr
                  ? "Aucun résultat."
                  : "No matches."}
            </p>
          )}
          {filteredConversations.length > 0 && (
            <p className="chat-list-label">
              {fr
                ? `Conversations · ${filteredConversations.length}`
                : `Conversations · ${filteredConversations.length}`}
            </p>
          )}
          {filteredConversations.map((conversation) => (
            <div
              key={conversation.id}
              className="chat-row"
              aria-current={activeId === conversation.id}
            >
              <button
                type="button"
                onClick={() => void loadConversation(conversation.id)}
                className="chat-row-title"
                title={conversation.title}
              >
                {conversation.title}
              </button>
              <button
                type="button"
                onClick={() => void deleteConversation(conversation.id)}
                className="chat-row-delete"
                aria-label={fr ? "Supprimer" : "Delete"}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        <div className="chat-sidebar-foot">
          <button type="button" onClick={() => setSettingsOpen(true)}>
            <Lock size={13} />
            <span className="truncate">
              {profile?.configured
                ? `${profile.model} · ${fr ? "clé" : "key"} ${profile.keyFingerprint?.slice(0, 4) ?? ""}…`
                : fr
                  ? "Connecter un modèle"
                  : "Connect a model"}
            </span>
          </button>
        </div>
      </aside>

      {/* ------------------------------------------------- main column */}
      <div className="chat-main">
        <header className="chat-topbar">
          {!sidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="chat-icon-btn"
              aria-label={fr ? "Afficher l'historique" : "Show history"}
            >
              <PanelLeft size={15} />
            </button>
          )}
          <div className="chat-topbar-title">
            <AiMark size={15} className="text-accent" />
            {fr ? "Assistant PROOFCORE" : "PROOFCORE Assistant"}
          </div>
          {activeWorkspace && <span className="chat-workspace-chip">{activeWorkspace.name}</span>}
        </header>

        {/* empty state: centered greeting + composer, like the reference */}
        {!hasMessages && (
          <div className="chat-greeting">
            <AiMark size={44} className="chat-greeting-mark" decorative />
            <h1 className="chat-greeting-title">{greeting}</h1>
            <p className="chat-greeting-support">
              {fr
                ? "WORLD · FLOW · EXIT — vos données, vos audits, aucune invention."
                : "WORLD · FLOW · EXIT — your data, your audits, no invention."}
            </p>
            <div className="chat-composer-zone is-center w-full">
              <Composer
                draft={draft}
                setDraft={setDraft}
                onSend={() => void send()}
                busy={busy}
                effort={effort}
                onEffort={setEffort}
                fr={fr}
              />
              <p className="chat-disclaimer">
                {fr
                  ? "L'assistant lit vos vraies données d'espace de travail. Vérifiez les informations importantes."
                  : "The assistant reads your real workspace data. Verify important information."}
              </p>
            </div>
          </div>
        )}

        {/* conversation */}
        {hasMessages && (
          <>
            <div ref={scrollRef} className="chat-scroll">
              <div className="chat-thread">
                {messages.map((message) =>
                  message.role === "user" ? (
                    <div key={message.id} className="chat-msg chat-msg-user">
                      <div className="chat-msg-user-bubble">{message.content}</div>
                    </div>
                  ) : (
                    <div key={message.id} className="chat-msg chat-msg-ai">
                      <div className="chat-msg-avatar">
                        <AiMark size={15} />
                      </div>
                      <div className="chat-msg-body">
                        {message.trace && message.trace.length > 0 && (
                          <div className="chat-trace">
                            {message.trace.map((step) => {
                              const Icon = TOOL_ICONS[step.tool] ?? BadgeCheck;
                              return (
                                <span
                                  key={`${step.tool}:${step.summary}`}
                                  className="chat-trace-chip"
                                >
                                  <Icon size={10} /> {step.tool} · {step.summary}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {message.error ? (
                          <div className="chat-error">{message.error}</div>
                        ) : message.content ? (
                          <Markdownish text={message.content} />
                        ) : busy ? (
                          <div className="chat-thinking" aria-live="polite">
                            <span />
                            <span />
                            <span />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                )}
                <div ref={endSentinel} />
              </div>
            </div>

            <div className="chat-composer-zone is-docked">
              <Composer
                draft={draft}
                setDraft={setDraft}
                onSend={() => void send()}
                busy={busy}
                effort={effort}
                onEffort={setEffort}
                fr={fr}
              />
              <p className="chat-disclaimer">
                {fr
                  ? "L'assistant lit vos vraies données d'espace de travail. Vérifiez les informations importantes."
                  : "The assistant reads your real workspace data. Verify important information."}
              </p>
            </div>
          </>
        )}
      </div>

      {/* ---------------------------------------------- settings modal */}
      {settingsOpen && (
        <div
          className="chat-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <div className="chat-dialog">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2">
                <AiMark size={15} />
                {fr ? "Connexion du modèle IA" : "AI model connection"}
              </h3>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="chat-icon-btn"
                aria-label={fr ? "Fermer" : "Close"}
              >
                <X size={15} />
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {fr
                ? "Votre clé est chiffrée (AES-256-GCM) côté serveur et n'est jamais renvoyée au navigateur. Vous pouvez la remplacer ou la supprimer à tout moment."
                : "Your key is encrypted (AES-256-GCM) server-side and never returned to the browser. Replace or delete it anytime."}
            </p>
            <div className="mt-4 space-y-3">
              {/* Step 1 — which provider. The model is never asked for: the server reads
                  the provider catalogue and picks one from it. */}
              <div>
                <p className="app-label">1. {fr ? "Choisis le fournisseur" : "Choose the provider"}</p>
                <div className="chat-provider-grid">
                  {providers.map((preset) => {
                    const active = activePreset === preset.id;
                    const note = PROVIDER_HINTS[preset.id];
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setActivePreset(preset.id);
                          setModelDraft("");
                          setTestResult(null);
                          setProfileError(null);
                        }}
                        title={note ?? preset.label}
                        className={`chat-provider ${active ? "is-active" : ""}`}
                      >
                        <span className="truncate">{preset.label}</span>
                        {note && <span className="chat-provider-note">{note}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {activePreset === "custom" && (
                <label className="block text-xs font-medium">
                  {fr ? "URL de base" : "Base URL"}
                  <input
                    value={baseUrlDraft}
                    onChange={(event) => setBaseUrlDraft(event.target.value)}
                    className="app-input"
                    placeholder="https://api.example.com/v1"
                  />
                </label>
              )}

              {/* Step 2 — the key. That is all we need. */}
              <label className="block text-xs font-medium">
                2. {fr ? "Colle ta clé API" : "Paste your API key"}
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  className="app-input font-mono"
                  placeholder={
                    profile?.configured
                      ? fr
                        ? "Laisser vide pour conserver la clé actuelle"
                        : "Leave empty to keep the current key"
                      : activePreset === "ollama"
                        ? "ollama"
                        : "sk-…"
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className="mt-1 block text-[10.5px] font-normal leading-relaxed text-muted">
                  {fr
                    ? "Créée chez le fournisseur, jamais stockée en clair ici. PROOFCORE lit la liste des modèles de la clé et choisit le meilleur modèle de conversation — tu n'as rien à connaître."
                    : "Created at the provider, never stored in clear here. PROOFCORE reads the key's model list and picks the best chat model — nothing to know on your side."}
                </span>
              </label>

              {/* Connected state: what was chosen for the user, and how to change it. */}
              {profile?.configured && (
                <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-xs font-medium text-foreground">
                      {profile.providerLabel ?? profile.providerId ?? "—"}
                      <span className="ml-1.5 font-mono text-[10.5px] font-normal text-muted">
                        {profile.model}
                      </span>
                    </p>
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen((open) => !open)}
                      className="shrink-0 text-[10.5px] text-accent hover:underline"
                    >
                      {advancedOpen
                        ? fr
                          ? "Masquer"
                          : "Hide"
                        : fr
                          ? "Changer de modèle"
                          : "Change model"}
                    </button>
                  </div>
                  {advancedOpen && (
                    <div className="mt-2 space-y-2">
                      <select
                        value={profile.model}
                        onChange={(event) => setModelDraft(event.target.value)}
                        className="app-select font-mono text-[11px]"
                      >
                        {[
                          profile.model,
                          ...(chatModels ?? []).filter((m) => m !== profile.model),
                        ].map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                      {modelDraft && (
                        <button
                          type="button"
                          onClick={() => void connectProvider()}
                          disabled={profileSaving}
                          className="app-btn app-btn-primary app-btn-sm"
                        >
                          {fr ? "Appliquer" : "Apply"}
                        </button>
                      )}
                      <p className="text-[10px] leading-relaxed text-muted">
                        {fr
                          ? "Liste lue depuis ta clé. Un modèle absent de cette liste ne fonctionnera pas."
                          : "List read from your key. A model absent from it will not work."}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
            {profileError && <p className="chat-status is-error mt-3">{profileError}</p>}
            {testResult && (
              <div className={`chat-status mt-3 ${testResult.ok ? "is-ok" : "is-warn"}`}>
                <p className="font-medium">
                  {testResult.ok ? "✓ " : "× "}
                  {testResult.message}
                  {testResult.latencyMs !== undefined ? ` · ${testResult.latencyMs} ms` : ""}
                </p>
                {testResult.models && testResult.models.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {testResult.models.slice(0, 10).map((model) => (
                      <button
                        key={model}
                        type="button"
                        onClick={() => setModelDraft(model)}
                        className="chat-model-chip"
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="mt-5 flex items-center justify-between gap-2">
              {profile?.configured ? (
                <button
                  type="button"
                  onClick={async () => {
                    await fetch("/api/v1/ai/profile", { method: "DELETE", credentials: "include" });
                    setProfile({ configured: false });
                    setSettingsOpen(false);
                  }}
                  className="flex items-center gap-1.5 text-xs text-destructive hover:underline"
                >
                  <Eraser size={13} /> {fr ? "Supprimer la clé" : "Delete the key"}
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void testConnection()}
                  disabled={testing || (!keyDraft && !profile?.configured)}
                  className="app-btn app-btn-sm"
                >
                  {testing ? (fr ? "Test…" : "Testing…") : fr ? "Tester la clé" : "Test the key"}
                </button>
                <button
                  type="button"
                  onClick={() => void connectProvider()}
                  disabled={
                    profileSaving ||
                    (!keyDraft && !profile?.configured) ||
                    (activePreset === "custom" && !baseUrlDraft.trim())
                  }
                  className="app-btn app-btn-primary app-btn-sm"
                >
                  {profileSaving
                    ? fr
                      ? "Connexion…"
                      : "Connecting…"
                    : fr
                      ? "Connecter"
                      : "Connect"}
                </button>
              </div>
            </div>

            {/* MCP connect: use PROOFCORE tools inside any coding agent */}
            <div className="mt-4 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setMcpOpen((open) => !open)}
                className="flex w-full items-center justify-between text-xs font-medium text-foreground/85 transition hover:text-foreground"
              >
                <span className="flex items-center gap-2">
                  <Plug size={13} className="text-accent" />
                  {fr
                    ? "Connecter via MCP (Claude Code, Codex, OpenCode…)"
                    : "Connect via MCP (Claude Code, Codex, OpenCode…)"}
                </span>
                <ChevronDown
                  size={13}
                  className="text-muted transition"
                  style={{ transform: mcpOpen ? "rotate(180deg)" : undefined }}
                />
              </button>
              {mcpOpen && (
                <div className="mt-3">
                  <p className="text-[11px] leading-relaxed text-muted">
                    {fr
                      ? "Donne les outils PROOFCORE (WORLD, FLOW, EXIT, FAIL, CLEAN) à ton agent de code préféré : il lance les audits directement dans ton terminal, sur ton app locale."
                      : "Give PROOFCORE's tools (WORLD, FLOW, EXIT, FAIL, CLEAN) to your favorite coding agent: it runs the audits in your terminal, on your local app."}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {MCP_RECIPES.map((recipe) => (
                      <button
                        key={recipe.id}
                        type="button"
                        onClick={() => setMcpTab(recipe.id)}
                        className={`chat-model-chip ${mcpTab === recipe.id ? "is-active" : ""}`}
                        style={
                          mcpTab === recipe.id
                            ? { borderColor: "var(--ink)", fontWeight: 600 }
                            : undefined
                        }
                      >
                        {recipe.label}
                      </button>
                    ))}
                  </div>
                  {(() => {
                    const recipe = MCP_RECIPES.find((entry) => entry.id === mcpTab);
                    if (!recipe) return null;
                    return (
                      <div className="mt-2">
                        <div className="flex items-center justify-between">
                          <code className="text-[10px] text-muted">{recipe.file}</code>
                          <button
                            type="button"
                            onClick={() => void navigator.clipboard.writeText(recipe.snippet)}
                            className="chat-model-chip"
                          >
                            {fr ? "Copier" : "Copy"}
                          </button>
                        </div>
                        <pre className="chat-code-block mt-1">{recipe.snippet}</pre>
                        <p className="mt-1.5 text-[10.5px] text-muted">
                          {fr
                            ? "Nécessite le CLI : npm i -g proofcore"
                            : "Requires the CLI: npm i -g proofcore"}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
