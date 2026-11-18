import {
  Bot,
  ChevronDown,
  Eraser,
  Gauge,
  Globe,
  Lock,
  PanelLeft,
  Plug,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/index.js";
import { useSession } from "../../lib/session.js";

interface EffortLevel {
  id: "quick" | "balanced" | "deep" | "ultra";
  label: string;
  hint: string;
  burn: string;
  tone: string;
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
  baseUrl?: string;
  model?: string;
  keyFingerprint?: string;
}

const EFFORTS: EffortLevel[] = [
  {
    id: "quick",
    label: "Rapide",
    hint: "Réponse directe, 1 outil max",
    burn: "1×",
    tone: "text-emerald-500",
  },
  {
    id: "balanced",
    label: "Équilibré",
    hint: "Données utiles, réponse focalisée",
    burn: "2×",
    tone: "text-sky-500",
  },
  {
    id: "deep",
    label: "Approfondi",
    hint: "Croise runs, findings et audits",
    burn: "4×",
    tone: "text-violet-500",
  },
  {
    id: "ultra",
    label: "Ultra",
    hint: "Audit complet multi-sources, rapport structuré",
    burn: "8×",
    tone: "text-amber-500",
  },
];

const TOOL_ICONS: Record<string, typeof Bot> = {
  fail_scan: ShieldAlert,
  clean_audit: Sparkles,
  fetch_web: Globe,
};

/** One-click provider presets: pick one, paste the key, done. All OpenAI-compatible. */
interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
  note?: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1"],
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen-2.5-32b"],
    note: "très rapide, généreux gratuit",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      "openai/gpt-4o-mini",
      "anthropic/claude-sonnet-4",
      "meta-llama/llama-3.3-70b-instruct",
    ],
    note: "tous les modèles, une clé",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-pro"],
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-small-latest"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "together",
    label: "Together",
    baseUrl: "https://api.together.xyz/v1",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo"],
  },
  {
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    models: ["llama-3.3-70b", "llama3.1-8b"],
    note: "inférence la plus rapide",
  },
  { id: "xai", label: "xAI", baseUrl: "https://api.x.ai/v1", models: ["grok-3", "grok-3-mini"] },
  {
    id: "ollama",
    label: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama3.2", "qwen2.5", "mistral"],
    note: "100 % local, aucune clé",
  },
];

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

function uid(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function Markdownish({ text }: { text: string }): React.ReactElement {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        const key = `b${index}-${block.slice(0, 12)}`;
        if (block.startsWith("### ") || block.startsWith("## ") || block.startsWith("# ")) {
          return (
            <h4 key={key} className="pt-1 text-sm font-semibold tracking-tight text-foreground">
              {block.replace(/^#+\s*/, "")}
            </h4>
          );
        }
        if (/^[-*]\s/m.test(block)) {
          return (
            <ul
              key={key}
              className="ml-4 list-disc space-y-1 text-[13.5px] leading-relaxed text-foreground/90"
            >
              {block.split("\n").map((line) => (
                <li key={`${key}-${line.slice(0, 12)}`}>{line.replace(/^[-*]\s*/, "")}</li>
              ))}
            </ul>
          );
        }
        return (
          <p
            key={key}
            className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground/90"
          >
            {block}
          </p>
        );
      })}
    </div>
  );
}

export function AiChatPage(): React.ReactElement {
  const { locale } = useI18n();
  const { workspaces, workspaceId: activeWorkspaceId } = useSession();
  const fr = locale === "fr";

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [effort, setEffort] = useState<EffortLevel["id"]>("balanced");
  const [effortOpen, setEffortOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [baseUrlDraft, setBaseUrlDraft] = useState("https://api.openai.com/v1");
  const [activePreset, setActivePreset] = useState<string>("openai");
  const [modelDraft, setModelDraft] = useState("gpt-4o-mini");
  const [keyDraft, setKeyDraft] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpTab, setMcpTab] = useState(MCP_RECIPES[0]?.id ?? "claude-code");
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeEffort: EffortLevel = useMemo(() => {
    const found = EFFORTS.find((level) => level.id === effort);
    const fallback = EFFORTS[1];
    return found ?? (fallback as EffortLevel);
  }, [effort]);

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
          const preset = PROVIDER_PRESETS.find((entry) => entry.baseUrl === data.baseUrl);
          setActivePreset(preset?.id ?? "custom");
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

  const saveProfile = useCallback(async () => {
    setProfileSaving(true);
    setProfileError(null);
    try {
      const response = await fetch("/api/v1/ai/profile", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: baseUrlDraft,
          model: modelDraft,
          ...(keyDraft ? { apiKey: keyDraft } : {}),
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        setProfileError(data.message ?? (fr ? "Échec de l'enregistrement." : "Save failed."));
        return;
      }
      const data = (await response.json()) as ProfileState & { configured: true };
      setProfile(data);
      setKeyDraft("");
      setSettingsOpen(false);
    } finally {
      setProfileSaving(false);
    }
  }, [baseUrlDraft, modelDraft, keyDraft, fr]);

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
      const data = (await response.json().catch(() => ({}))) as {
        conversationId?: string;
        title?: string;
        message?: string;
        trace?: { tool: string; summary: string }[];
        message_error?: string;
        error?: string;
      };
      if (!response.ok) {
        setMessages((items) =>
          items.map((item) =>
            item.id === pendingId
              ? {
                  ...item,
                  content: "",
                  error:
                    data.message ??
                    data.error ??
                    (fr ? "La demande a échoué." : "The request failed."),
                }
              : item
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

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* ---------------------------------------------------- sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-72" : "w-0"
        } shrink-0 overflow-hidden border-r border-border/60 bg-surface-1/60 transition-all duration-200`}
      >
        <div className="flex h-full w-72 flex-col">
          <div className="flex items-center justify-between px-3 pt-3">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {fr ? "Historique" : "History"}
            </span>
            <button
              type="button"
              onClick={startNewChat}
              className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/15"
            >
              <Plus className="h-3.5 w-3.5" /> {fr ? "Nouveau" : "New"}
            </button>
          </div>
          <div className="mt-2 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
            {conversations.length === 0 && (
              <p className="px-2 pt-6 text-center text-xs text-muted-foreground">
                {fr ? "Aucune conversation pour l'instant." : "No conversations yet."}
              </p>
            )}
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition ${
                  activeId === conversation.id
                    ? "bg-primary/10 text-primary"
                    : "text-foreground/75 hover:bg-surface-2"
                }`}
              >
                <button
                  type="button"
                  onClick={() => loadConversation(conversation.id)}
                  className="min-w-0 flex-1 truncate text-left"
                  title={conversation.title}
                >
                  {conversation.title}
                </button>
                <button
                  type="button"
                  onClick={() => deleteConversation(conversation.id)}
                  className="opacity-0 transition group-hover:opacity-100"
                  aria-label={fr ? "Supprimer" : "Delete"}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <Lock className="h-3.5 w-3.5" />
            {profile?.configured
              ? `${profile.model} · ${fr ? "clé" : "key"} ${profile.keyFingerprint?.slice(0, 4) ?? ""}…`
              : fr
                ? "Connecter un modèle"
                : "Connect a model"}
          </button>
        </div>
      </aside>

      {/* ------------------------------------------------- main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen((open) => !open)}
              className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
              aria-label={fr ? "Historique" : "History"}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <Bot className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">
              {fr ? "Assistant PROOFCORE" : "PROOFCORE Assistant"}
            </span>
            {activeWorkspace && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground">
                {activeWorkspace.name}
              </span>
            )}
          </div>
          {/* effort slider */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setEffortOpen((open) => !open)}
              className="flex items-center gap-2 rounded-full border border-border/70 bg-surface-1 px-3 py-1.5 text-xs font-medium transition hover:border-primary/40"
            >
              <Gauge className={`h-3.5 w-3.5 ${activeEffort.tone}`} />
              <span className={activeEffort.tone}>{activeEffort.label}</span>
              <span className="text-muted-foreground">· {activeEffort.burn}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
            {effortOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => setEffortOpen(false)}
                  aria-label={fr ? "Fermer" : "Close"}
                />
                <div className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-border bg-surface-1 p-2 shadow-xl">
                  {EFFORTS.map((level) => (
                    <button
                      key={level.id}
                      type="button"
                      onClick={() => {
                        setEffort(level.id);
                        setEffortOpen(false);
                      }}
                      className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                        effort === level.id ? "bg-primary/10" : "hover:bg-surface-2"
                      }`}
                    >
                      <Gauge className={`mt-0.5 h-4 w-4 ${level.tone}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold">
                          {level.label}{" "}
                          <span className="font-normal text-muted-foreground">· {level.burn}</span>
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {level.hint}
                        </span>
                      </span>
                      {effort === level.id && (
                        <span className="mt-1 h-2 w-2 rounded-full bg-primary" />
                      )}
                    </button>
                  ))}
                  <p className="px-3 pb-1.5 pt-2 text-[10.5px] leading-relaxed text-muted-foreground">
                    {fr
                      ? "Plus l'effort est élevé, plus l'assistant interroge d'outils et consomme de crédits sur votre fournisseur IA."
                      : "Higher effort means more tool calls and more credits burned on your AI provider."}
                  </p>
                </div>
              </>
            )}
          </div>
        </header>

        {/* messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.length === 0 && <EmptyState fr={fr} />}
            {messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
                    {message.content}
                  </div>
                </div>
              ) : (
                <div key={message.id} className="flex gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-fuchsia-600 text-primary-foreground shadow">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {message.trace && message.trace.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {message.trace.map((step) => {
                          const Icon = TOOL_ICONS[step.tool] ?? Bot;
                          return (
                            <span
                              key={`${step.tool}:${step.summary}`}
                              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-surface-1 px-2 py-0.5 text-[10.5px] text-muted-foreground"
                            >
                              <Icon className="h-3 w-3" /> {step.tool} · {step.summary}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {message.error ? (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {message.error}
                      </div>
                    ) : message.content ? (
                      <Markdownish text={message.content} />
                    ) : busy ? (
                      <div className="flex gap-1 py-2">
                        {[0, 1, 2].map((dot) => (
                          <span
                            key={dot}
                            className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60"
                            style={{ animationDelay: `${dot * 120}ms` }}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            )}
            <div ref={endSentinel} />
          </div>
        </div>

        {/* composer */}
        <div className="border-t border-border/60 bg-surface-1/40 px-4 py-3">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-end gap-2 rounded-2xl border border-border/70 bg-surface-1 p-2 shadow-sm focus-within:border-primary/50">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={Math.min(4, draft.split("\n").length)}
                placeholder={
                  fr
                    ? "Demandez une analyse, un audit FAIL ou CLEAN, une recherche…"
                    : "Ask for an analysis, a FAIL or CLEAN audit, research…"
                }
                className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground/70"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || !draft.trim()}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:brightness-110 disabled:opacity-40"
                aria-label={fr ? "Envoyer" : "Send"}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10.5px] text-muted-foreground">
              {fr
                ? "L'assistant lit vos vraies données d'espace de travail. Vérifiez les informations importantes."
                : "The assistant reads your real workspace data. Verify important information."}
            </p>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------- settings modal */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface-1 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Lock className="h-4 w-4 text-primary" />
                {fr ? "Connexion du modèle IA" : "AI model connection"}
              </h3>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-surface-2"
                aria-label={fr ? "Fermer" : "Close"}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {fr
                ? "Votre clé est chiffrée (AES-256-GCM) côté serveur et n'est jamais renvoyée au navigateur. Vous pouvez la remplacer ou la supprimer à tout moment."
                : "Your key is encrypted (AES-256-GCM) server-side and never returned to the browser. Replace or delete it anytime."}
            </p>
            <div className="mt-4 space-y-3">
              {/* provider presets: one click fills URL + model */}
              <div>
                <p className="text-xs font-medium">{fr ? "Fournisseur" : "Provider"}</p>
                <div className="mt-1.5 grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                  {PROVIDER_PRESETS.map((preset) => {
                    const active = baseUrlDraft === preset.baseUrl;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setBaseUrlDraft(preset.baseUrl);
                          setModelDraft(preset.models[0] ?? "");
                          setActivePreset(preset.id);
                        }}
                        title={preset.note ?? preset.baseUrl}
                        className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs transition ${
                          active
                            ? "border-primary/70 bg-primary/10 text-primary"
                            : "border-border/60 bg-surface-2 text-foreground/80 hover:border-primary/40"
                        }`}
                      >
                        <span className="font-medium">{preset.label}</span>
                        {preset.note && (
                          <span className="ml-1 truncate text-[9.5px] text-muted-foreground">
                            {preset.note}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setActivePreset("custom")}
                  className={`mt-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                    activePreset === "custom"
                      ? "border-primary/70 bg-primary/10 text-primary"
                      : "border-border/60 bg-surface-2 text-foreground/80 hover:border-primary/40"
                  }`}
                >
                  {fr ? "URL personnalisée…" : "Custom URL…"}
                </button>
              </div>
              {activePreset === "custom" && (
                <label className="block text-xs font-medium">
                  {fr ? "URL de base (compatible OpenAI)" : "Base URL (OpenAI-compatible)"}
                  <input
                    value={baseUrlDraft}
                    onChange={(event) => setBaseUrlDraft(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-border/70 bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary/60"
                    placeholder="https://api.openai.com/v1"
                  />
                </label>
              )}
              <label className="block text-xs font-medium">
                {fr ? "Modèle" : "Model"}
                <input
                  value={modelDraft}
                  onChange={(event) => setModelDraft(event.target.value)}
                  list="proofcore-model-list"
                  className="mt-1 w-full rounded-lg border border-border/70 bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary/60"
                  placeholder="gpt-4o-mini"
                />
                <datalist id="proofcore-model-list">
                  {PROVIDER_PRESETS.find((preset) => preset.baseUrl === baseUrlDraft)?.models.map(
                    (model) => (
                      <option key={model} value={model} />
                    )
                  )}
                </datalist>
              </label>
              <label className="block text-xs font-medium">
                {fr ? "Clé API" : "API key"}
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-border/70 bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary/60"
                  placeholder={
                    profile?.configured
                      ? fr
                        ? "Laisser vide pour conserver la clé actuelle"
                        : "Leave empty to keep the current key"
                      : "sk-…"
                  }
                />
              </label>
            </div>
            {profileError && <p className="mt-3 text-xs text-destructive">{profileError}</p>}
            <div className="mt-5 flex items-center justify-between">
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
                  <Eraser className="h-3.5 w-3.5" /> {fr ? "Supprimer la clé" : "Delete the key"}
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => void saveProfile()}
                disabled={profileSaving}
                className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
              >
                {profileSaving ? (fr ? "Enregistrement…" : "Saving…") : fr ? "Enregistrer" : "Save"}
              </button>
            </div>
          </div>
          {/* MCP connect: use PROOFCORE tools inside any coding agent */}
          <div className="mt-4 border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={() => setMcpOpen((open) => !open)}
              className="flex w-full items-center justify-between text-xs font-medium text-foreground/85 transition hover:text-foreground"
            >
              <span className="flex items-center gap-2">
                <Plug className="h-3.5 w-3.5 text-primary" />
                {fr
                  ? "Connecter via MCP (Claude Code, Codex, OpenCode…)"
                  : "Connect via MCP (Claude Code, Codex, OpenCode…)"}
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-muted-foreground transition ${mcpOpen ? "rotate-180" : ""}`}
              />
            </button>
            {mcpOpen && (
              <div className="mt-3">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
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
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                        mcpTab === recipe.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-surface-2 text-foreground/70 hover:bg-surface-1"
                      }`}
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
                        <code className="text-[10px] text-muted-foreground">{recipe.file}</code>
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(recipe.snippet)}
                          className="rounded-md border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground transition hover:text-foreground"
                        >
                          {fr ? "Copier" : "Copy"}
                        </button>
                      </div>
                      <pre className="mt-1 overflow-x-auto rounded-lg bg-[#07120d] p-3 font-mono text-[10.5px] leading-relaxed text-emerald-200/90">
                        {recipe.snippet}
                      </pre>
                      <p className="mt-1.5 text-[10.5px] text-muted-foreground">
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
      )}
    </div>
  );
}

function EmptyState({ fr }: { fr: boolean }): React.ReactElement {
  const suggestions = fr
    ? [
        {
          icon: ShieldAlert,
          title: "Audit FAIL",
          text: "« Analyse les failles de sécurité de https://mon-app.com »",
        },
        { icon: Sparkles, title: "Audit CLEAN", text: "« Note l'interface de mon app sur 100 »" },
        {
          icon: Globe,
          title: "Recherche",
          text: "« Cherche les bonnes pratiques de design 2026 »",
        },
        {
          icon: Bot,
          title: "Analyse des runs",
          text: "« Pourquoi le dernier run FLOW a échoué ? »",
        },
      ]
    : [
        {
          icon: ShieldAlert,
          title: "FAIL audit",
          text: '"Scan https://myapp.com for security flaws"',
        },
        { icon: Sparkles, title: "CLEAN audit", text: '"Score my app\'s UI out of 100"' },
        { icon: Globe, title: "Research", text: '"Research 2026 UI best practices"' },
        { icon: Bot, title: "Run analysis", text: '"Why did the last FLOW run fail?"' },
      ];
  return (
    <div className="py-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-fuchsia-600 text-primary-foreground shadow-lg">
        <Sparkles className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-lg font-semibold tracking-tight">
        {fr ? "Que pouvons-nous prouver aujourd'hui ?" : "What can we prove today?"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {fr
          ? "WORLD · FLOW · EXIT — vos données, vos audits, aucune invention."
          : "WORLD · FLOW · EXIT — your data, your audits, no invention."}
      </p>
      <div className="mx-auto mt-6 grid max-w-xl gap-2 sm:grid-cols-2">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.title}
            className="flex items-start gap-3 rounded-xl border border-border/60 bg-surface-1 px-4 py-3 text-left"
          >
            <suggestion.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-xs font-semibold">{suggestion.title}</p>
              <p className="truncate text-[11px] text-muted-foreground">{suggestion.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
