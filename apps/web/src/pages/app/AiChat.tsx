import {
  ArrowUpRight,
  BadgeCheck,
  Brain,
  ChevronDown,
  Eraser,
  FileCode2,
  FileText,
  FolderGit2,
  FolderKanban,
  Gauge,
  Globe,
  History,
  LayoutDashboard,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
  PanelLeft,
  Paperclip,
  Plug,
  Plus,
  RadioTower,
  RefreshCw,
  ScanSearch,
  Search,
  Send,
  ShieldAlert,
  Terminal,
  Trash2,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserPanel } from "../../components/app/BrowserPanel.js";
import {
  ChatMarkdown,
  MessageActions,
  printConversation,
} from "../../components/app/ChatMarkdown.js";
import { LoadMore } from "../../components/app/LoadMore.js";
import { useI18n } from "../../i18n/index.js";
import {
  type Attachment,
  AttachmentError,
  attachmentSummary,
  composeMessage,
  extractAttachment,
  MAX_TOTAL,
} from "../../lib/attachments.js";
import { useSession } from "../../lib/session.js";
import "../../styles/chat-browser.css";

interface EffortLevel {
  id: "quick" | "balanced" | "deep" | "ultra";
  label: { fr: string; en: string };
  hint: { fr: string; en: string };
  burn: string;
  /**
   * How many independent reviewers this level runs. Kept in step with the server's
   * EFFORT_TUNING by `GET /api/v1/ai/effort`; this table is only the pre-load default so
   * the picker is never empty.
   */
  subagents: number;
}

interface ConversationSummary {
  id: string;
  title: string;
  effort: string;
  updatedAt: string;
}

interface UsageContext {
  used: number;
  budget: number;
  remaining: number;
  trimmed: number;
}

/** Real provider counts for one assistant turn, plus the input budget enforced. */
interface TurnUsage {
  input: number;
  output: number;
  total?: number;
  context?: UsageContext;
  outputBudget?: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  usage?: TurnUsage;
  trace?: AgentTraceStep[];
  /** Reviewer notes as the server reported them, failures included. */
  reviews?: { id: string; label: string; ok: boolean; note: string }[];
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
  {
    id: "quick",
    subagents: 2,
    label: { fr: "Rapide", en: "Quick" },
    hint: { fr: "Direct, 2 relecteurs", en: "Direct, 2 reviewers" },
    burn: "1×",
  },
  {
    id: "balanced",
    subagents: 3,
    label: { fr: "Équilibré", en: "Balanced" },
    hint: { fr: "Données utiles, 3 relecteurs", en: "Useful data, 3 reviewers" },
    burn: "2×",
  },
  {
    id: "deep",
    subagents: 4,
    label: { fr: "Approfondi", en: "Deep" },
    hint: {
      fr: "Croise runs et audits · 4 relecteurs",
      en: "Cross-references runs and audits · 4 reviewers",
    },
    burn: "4×",
  },
  {
    id: "ultra",
    subagents: 5,
    label: { fr: "Ultra", en: "Ultra" },
    hint: {
      fr: "Audit multi-sources · 5 relecteurs",
      en: "Multi-source audit · 5 reviewers",
    },
    burn: "8×",
  },
];

const TOOL_ICONS: Record<string, typeof BadgeCheck> = {
  fail_scan: ShieldAlert,
  clean_audit: BadgeCheck,
  fetch_web: Globe,
};

/** Short notes only. The provider list itself is read from /api/v1/ai/providers. */
const PROVIDER_HINTS: Record<string, { fr: string; en: string }> = {
  groq: { fr: "très rapide, gratuit", en: "very fast, free tier" },
  openrouter: { fr: "tous les modèles", en: "every model" },
  cerebras: { fr: "le plus rapide", en: "the fastest" },
  ollama: { fr: "100 % local", en: "100% local" },
  anthropic: { fr: "Claude", en: "Claude" },
  google: { fr: "Gemini", en: "Gemini" },
};

interface ProviderOption {
  id: string;
  label: string;
  kind: string;
  keyOptional?: boolean;
}

/**
 * A tool the assistant ran, plus what it can show.
 *
 * Most tools only have a one-line summary. `browse_url` also returns a `view`: the page as a
 * real browser saw it, with a screenshot. The model never receives the image — it gets the
 * text — so the picture is for the person reading, which is also why it is optional.
 */
interface AgentTraceStep {
  tool: string;
  summary: string;
  view?: {
    kind: "browser";
    url: string;
    basis: string;
    title?: string | null;
    status?: number | null;
    screenshot?: string;
    note?: string;
    openInBrowser?: boolean;
    sessionId?: string;
  };
}

/** The in-app browser: what the assistant actually opened, not a description of it. */
function BrowserView({
  view,
  fr,
  onOpen,
}: {
  view: NonNullable<AgentTraceStep["view"]>;
  fr: boolean;
  onOpen?: (url: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <figure className="chat-browser">
      <figcaption className="chat-browser-bar">
        <Globe size={12} />
        <span className="chat-browser-url" title={view.url}>
          {view.url}
        </span>
        <span
          className={`chat-browser-basis ${view.basis === "rendered_dom" ? "is-rendered" : ""}`}
        >
          {view.basis === "rendered_dom"
            ? fr
              ? "rendu réel"
              : "rendered"
            : fr
              ? "HTML serveur"
              : "server HTML"}
        </span>
        {view.screenshot && (
          <button
            type="button"
            className="chat-browser-toggle"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? (fr ? "masquer" : "hide") : fr ? "afficher" : "show"}
          </button>
        )}
        {onOpen && (
          <button type="button" className="chat-browser-open" onClick={() => onOpen(view.url)}>
            {fr ? "ouvrir le navigateur" : "open the browser"}
          </button>
        )}
      </figcaption>
      {view.screenshot && open && (
        <img src={view.screenshot} alt={view.title ?? view.url} loading="lazy" />
      )}
      {!view.screenshot && (
        <p className="chat-browser-note">
          {view.note ??
            (fr
              ? "Aucune capture : le rendu n'est pas configuré."
              : "No screenshot: no renderer is configured.")}
        </p>
      )}
    </figure>
  );
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
    if (data.error?.details?.managed === false) {
      return fr
        ? "L'assistant IA n'est pas activé sur ce déploiement. Les contrôles et les rapports fonctionnent sans IA ; tu peux connecter ta propre clé dans les réglages."
        : "The AI assistant is not enabled on this deployment. Controls and reports work without AI; you can connect your own key in the settings.";
    }
    return fr
      ? "Aucun modèle connecté. Ouvre les réglages."
      : "No model connected. Open the settings.";
  }
  if (code === "managed_ai_quota") {
    const minutes =
      typeof data.error?.details?.retryAfterSeconds === "number"
        ? Math.max(1, Math.ceil((data.error.details.retryAfterSeconds as number) / 60))
        : null;
    const horizon = minutes
      ? fr
        ? `Réessaie dans ${minutes} min`
        : `Retry in ${minutes} min`
      : fr
        ? "Réessaie plus tard"
        : "Retry later";
    return fr
      ? `Quota mensuel de l'assistant géré atteint. ${horizon}, ou connecte ta propre clé.`
      : `The managed assistant's monthly quota is reached. ${horizon}, or connect your own key.`;
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
      ? "La passerelle a coupé la requête avant la réponse (délai dépassé). Réessaie ; si ça se répète, baisse le niveau d'effort, Ultra enchaîne beaucoup d'appels d'outils."
      : "The gateway cut the request before the answer (timeout). Retry; if it repeats, lower the effort level, Ultra chains many tool calls.";
  }
  if (message) return message;
  if (raw && raw.length < 200 && !raw.trimStart().startsWith("<")) return raw;
  return fr ? `La demande a échoué (HTTP ${status}).` : `The request failed (HTTP ${status}).`;
}

function uid(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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
        {active.label[fr ? "fr" : "en"]}{" "}
        <span className="chat-effort-burn">
          · {active.burn} · {active.subagents} {fr ? "agents" : "agents"}
        </span>
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
                  {level.label[fr ? "fr" : "en"]}{" "}
                  <span className="chat-effort-burn">· {level.burn}</span>
                </span>
                <span className="chat-effort-hint">{level.hint[fr ? "fr" : "en"]}</span>
                <span className="chat-effort-agents">
                  <Users size={11} />
                  {level.subagents} {fr ? "sous-agents" : "sub-agents"}
                </span>
              </span>
            </button>
          ))}
          <p className="chat-effort-note">
            {fr
              ? "Chaque niveau lance au moins deux sous-agents de relecture, puis une synthèse. Plus l'effort monte, plus il y a de relecteurs, et plus de jetons consommés sur votre propre clé."
              : "Every level runs at least two reviewing sub-agents, then a synthesis. Higher effort means more reviewers, and more tokens spent on your own key."}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The reviewer panel.
 *
 * It is shown even when every reviewer failed, because "no reviewer answered" is
 * information the reader needs before trusting the answer above it. Collapsed by default:
 * the notes are evidence, not the product.
 */
function ReviewPanel({
  reviews,
  fr,
}: {
  reviews: { id: string; label: string; ok: boolean; note: string }[];
  fr: boolean;
}): React.ReactElement {
  const failed = reviews.filter((review) => !review.ok).length;
  return (
    <details className="chat-review">
      <summary className="chat-review-summary">
        <Users size={12} />
        {fr
          ? `${reviews.length - failed}/${reviews.length} relecteurs ont répondu`
          : `${reviews.length - failed}/${reviews.length} reviewers answered`}
        {failed > 0 ? (
          <span className="chat-review-warn">{fr ? "· certains ont échoué" : "· some failed"}</span>
        ) : null}
      </summary>
      <ul className="chat-review-list">
        {reviews.map((review) => (
          <li key={review.id} className={review.ok ? "" : "is-failed"}>
            <span className="chat-review-label">{review.label}</span>
            <span className="chat-review-note">
              {review.ok
                ? review.note
                : fr
                  ? "Ce relecteur n'a pas répondu (fournisseur indisponible). La réponse n'a pas été recoupée sur cet angle."
                  : "This reviewer did not answer (provider unavailable), so that angle was not cross-checked."}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function compactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.max(0, Math.round(value)));
}

/**
 * What this conversation has spent, and how much room the next question still has.
 *
 * The number comes from the provider's own `usage`, not from a character estimate: an
 * estimate shown as a bill would be a lie. The bar tracks the enforced input budget the
 * server trims history to, so it can go down when a turn is short.
 */
function TokenMeter({
  input,
  output,
  contextUsed,
  budget,
  fr,
}: {
  input: number;
  output: number;
  contextUsed: number;
  budget: number;
  fr: boolean;
}): React.ReactElement {
  const pct = budget > 0 ? Math.min(100, Math.round((contextUsed / budget) * 100)) : 0;
  const tone = pct >= 90 ? "is-hot" : pct >= 75 ? "is-warm" : "";
  const remaining = Math.max(0, budget - contextUsed);
  const label = fr
    ? `Contexte : ${compactTokens(contextUsed)} sur ${compactTokens(budget)} jetons, ${compactTokens(remaining)} restants. ${compactTokens(input)} entrée et ${compactTokens(output)} sortie consommés dans cette conversation.`
    : `Context: ${compactTokens(contextUsed)} of ${compactTokens(budget)} tokens, ${compactTokens(remaining)} left. ${compactTokens(input)} input and ${compactTokens(output)} output spent in this conversation.`;
  return (
    <div className={`chat-tokens ${tone}`} title={label}>
      <Gauge size={12} aria-hidden />
      <span className="chat-tokens-label">
        <span>{fr ? "Contexte" : "Context"}</span>
        <strong>{compactTokens(contextUsed)}</strong>
        <span className="chat-tokens-of">/ {compactTokens(budget)}</span>
      </span>
      <span
        className="chat-tokens-track"
        role="progressbar"
        aria-label={fr ? "Contexte utilisé" : "Context used"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={
          fr
            ? `${compactTokens(contextUsed)} utilisés sur ${compactTokens(budget)}, ${compactTokens(remaining)} restants`
            : `${compactTokens(contextUsed)} used of ${compactTokens(budget)}, ${compactTokens(remaining)} left`
        }
      >
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="chat-tokens-left">
        {fr ? "reste" : "left"} {compactTokens(remaining)}
      </span>
      <span className="chat-tokens-cum">{compactTokens(input + output)} tok</span>
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
  attachments,
  onAttach,
  onRemoveAttachment,
  onDismissNotice,
  extracting,
  notice,
  onTools,
  tokens,
  toolCount,
}: {
  draft: string;
  setDraft: (value: string) => void;
  onSend: () => void;
  busy: boolean;
  effort: EffortLevel["id"];
  onEffort: (id: EffortLevel["id"]) => void;
  fr: boolean;
  attachments: Attachment[];
  onAttach: (files: File[]) => void;
  onRemoveAttachment: (index: number) => void;
  onDismissNotice: () => void;
  extracting: boolean;
  notice: { title: string; detail: string } | null;
  onTools: () => void;
  tokens: { input: number; output: number; contextUsed: number; budget: number };
  toolCount: number;
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="chat-composer">
      {attachments.length > 0 || extracting || notice ? (
        <div className="chat-attach-row">
          {attachments.map((attachment, index) => (
            <span
              key={`${attachment.name}:${attachmentSummary(attachment)}`}
              className="chat-attach-chip"
            >
              <FileText size={11} aria-hidden />
              <span className="chat-attach-name" title={attachmentSummary(attachment)}>
                {attachmentSummary(attachment)}
              </span>
              <button
                type="button"
                className="chat-attach-remove"
                aria-label={fr ? `Retirer ${attachment.name}` : `Remove ${attachment.name}`}
                onClick={() => onRemoveAttachment(index)}
              >
                <X size={10} aria-hidden />
              </button>
            </span>
          ))}
          {extracting ? (
            <span className="chat-attach-chip is-pending">
              <Loader2 size={11} className="chat-spin" aria-hidden />
              {fr ? "Extraction du texte…" : "Extracting text…"}
            </span>
          ) : null}
          {notice ? (
            <span className="chat-attach-chip is-error" role="alert">
              <span className="chat-attach-name" title={notice.detail}>
                {notice.title} — {notice.detail}
              </span>
              <button
                type="button"
                className="chat-attach-remove"
                aria-label={fr ? "Fermer l'avertissement" : "Dismiss warning"}
                onClick={onDismissNotice}
              >
                <X size={10} aria-hidden />
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSend();
          }
        }}
        rows={Math.min(7, Math.max(1, draft.split("\n").length))}
        placeholder={fr ? "Comment puis-je vous aider aujourd'hui ?" : "How can I help you today?"}
        aria-label={fr ? "Message à envoyer à l'assistant" : "Message to send to the assistant"}
        className="chat-composer-input"
      />
      <div className="chat-composer-bar">
        <div className="chat-composer-tools">
          <EffortPicker effort={effort} onSelect={onEffort} fr={fr} />
          <TokenMeter
            input={tokens.input}
            output={tokens.output}
            contextUsed={tokens.contextUsed}
            budget={tokens.budget}
            fr={fr}
          />
          <button
            type="button"
            className="chat-attach-btn"
            aria-label={fr ? "Outils de l'assistant" : "Assistant tools"}
            title={
              fr
                ? `Les ${toolCount} outils : audits, navigateur, code, mémoire`
                : `The ${toolCount} tools: audits, browser, code, memory`
            }
            onClick={onTools}
          >
            <Wrench size={13} aria-hidden />
          </button>
          <button
            type="button"
            className="chat-attach-btn"
            aria-label={
              fr
                ? "Joindre un document (texte, .md, .csv, .json, code, PDF textuel)"
                : "Attach a document (text, .md, .csv, .json, code, text PDF)"
            }
            title={
              fr
                ? "Joindre un document — texte, code, CSV, JSON ou PDF textuel"
                : "Attach a document — text, code, CSV, JSON or a text PDF"
            }
            onClick={() => inputRef.current?.click()}
          >
            <Paperclip size={13} aria-hidden />
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            aria-label={fr ? "Joindre un document" : "Attach a document"}
            className="sr-only"
            accept={
              ".txt,.md,.markdown,.csv,.tsv,.json,.log,.yml,.yaml,.toml,.ini,.xml,.html,.htm,.svg,.css,.scss,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.sh,.sql,.env,.gitignore,.pdf"
            }
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = ""; // re-selecting the same file must fire change
              if (files.length > 0) onAttach(files);
            }}
          />
        </div>
        <button
          type="button"
          onClick={onSend}
          disabled={busy || (!draft.trim() && attachments.length === 0)}
          className="chat-send"
          aria-label={fr ? "Envoyer" : "Send"}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

/* ---------- les outils de l'assistant (le catalogue du serveur) ---------- */

type ChatTool = {
  name: string;
  icon: React.ReactElement;
  fr: string;
  en: string;
  starter: { fr: string; en: string };
  /** From GET /api/v1/ai/tools: read, analysis, write or sensitive. */
  permission?: string;
};

/** Miroir des TOOLS de l'API (apps/api/src/routes/ai.ts) : le serveur exécute,
 *  cette liste explique et pré-remplit. Ne jamais promettre un outil qui
 *  n'existe pas côté serveur. */
const CHAT_TOOLS: ChatTool[] = [
  {
    name: "workspace_overview",
    icon: <LayoutDashboard />,
    fr: "Instantané de l'espace : projets, exécutions, statuts, constats.",
    en: "Workspace snapshot: projects, runs, statuses, findings.",
    starter: {
      fr: "Fais le point sur mon espace de travail : projets, dernières exécutions, constats ouverts.",
      en: "Take stock of my workspace: projects, latest runs, open findings.",
    },
  },
  {
    name: "list_projects",
    icon: <FolderKanban />,
    fr: "Les projets avec URL de base, environnement et modules.",
    en: "Projects with base URL, environment and modules.",
    starter: {
      fr: "Liste mes projets et leurs configurations.",
      en: "List my projects and their configurations.",
    },
  },
  {
    name: "recent_runs",
    icon: <History />,
    fr: "Les dernières exécutions de tests et leurs résultats.",
    en: "Latest test runs and their results.",
    starter: {
      fr: "Montre-moi les dernières exécutions de tests et leurs résultats.",
      en: "Show me the latest test runs and their results.",
    },
  },
  {
    name: "recent_findings",
    icon: <ShieldAlert />,
    fr: "Les constats FAILED récents, avec les détails exacts.",
    en: "Recent FAILED findings with exact details.",
    starter: {
      fr: "Quels sont les constats ouverts les plus récents ? Donne les détails exacts.",
      en: "Which findings are open most recently? Give exact details.",
    },
  },
  {
    name: "get_report",
    icon: <FileText />,
    fr: "Le rapport d'une exécution : identité, vérifications, constats.",
    en: "A run's report: identity, checks, findings.",
    starter: {
      fr: "Résume le dernier rapport d'exécution.",
      en: "Summarize the latest run report.",
    },
  },
  {
    name: "project_code",
    icon: <FileCode2 />,
    fr: "Lire le code source importé du projet.",
    en: "Read the project's imported source code.",
    starter: {
      fr: "Explore le code source importé de ce projet et décris son architecture.",
      en: "Explore this project's imported source and describe its architecture.",
    },
  },
  {
    name: "fetch_web",
    icon: <Globe />,
    fr: "Récupérer une page web publique en texte.",
    en: "Fetch a public web page as text.",
    starter: {
      fr: "Récupère le contenu de cette page : https://",
      en: "Fetch the content of this page: https://",
    },
  },
  {
    name: "fail_scan",
    icon: <ShieldAlert />,
    fr: "Scan FAIL d'une page ou d'un endpoint (sécurité, en-têtes).",
    en: "FAIL scan of a page or endpoint (security, headers).",
    starter: {
      fr: "Lance un scan FAIL sur cette page : https://",
      en: "Run a FAIL scan on this page: https://",
    },
  },
  {
    name: "clean_audit",
    icon: <BadgeCheck />,
    fr: "Audit CLEAN d'une page : qualité d'interface, score /100.",
    en: "CLEAN audit of a page: UI quality, score /100.",
    starter: {
      fr: "Lance un audit CLEAN sur cette page : https://",
      en: "Run a CLEAN audit on this page: https://",
    },
  },
  {
    name: "site_audit",
    icon: <ScanSearch />,
    fr: "Crawl complet FAIL + CLEAN multi-pages, session incluse.",
    en: "Full FAIL + CLEAN multi-page crawl, session included.",
    starter: {
      fr: "Lance un audit de site complet sur cette adresse : https://",
      en: "Run a full site audit on this address: https://",
    },
  },
  {
    name: "read_repo",
    icon: <FolderGit2 />,
    fr: "Lire un dépôt GitHub connecté.",
    en: "Read a connected GitHub repository.",
    starter: {
      fr: "Lit le dépôt GitHub connecté et résume sa structure.",
      en: "Read the connected GitHub repo and summarize its structure.",
    },
  },
  {
    name: "browse_url",
    icon: <Monitor />,
    fr: "Voir la page dans le navigateur intégré (rendu réel).",
    en: "See the page in the embedded browser (real render).",
    starter: {
      fr: "Ouvre cette page dans le navigateur intégré : https://",
      en: "Open this page in the embedded browser: https://",
    },
  },
  {
    name: "probe_url",
    icon: <RadioTower />,
    fr: "Sonder un endpoint API : méthode, en-têtes, réponse.",
    en: "Probe an API endpoint: method, headers, response.",
    starter: {
      fr: "Sonde cet endpoint API : https://",
      en: "Probe this API endpoint: https://",
    },
  },
  {
    name: "browser_open",
    icon: <Globe />,
    fr: "Ouvrir une page réelle et garder la session pour agir dedans.",
    en: "Open a real page and keep the session to act in it.",
    starter: {
      fr: "Ouvre cette page et dis-moi ce qu'il y a à faire : https://",
      en: "Open this page and tell me what can be done there: https://",
    },
  },
  {
    name: "browser_act",
    icon: <ArrowUpRight />,
    fr: "Cliquer, saisir, défiler dans la page ouverte.",
    en: "Click, type or scroll in the open page.",
    starter: {
      fr: "Dans la page ouverte, clique sur ",
      en: "In the open page, click ",
    },
  },
  {
    name: "browser_read",
    icon: <ScanSearch />,
    fr: "Relire l'état de la page ouverte (texte, éléments, capture).",
    en: "Read the open page again (text, elements, screenshot).",
    starter: {
      fr: "Relis la page ouverte et montre-moi les éléments interactifs.",
      en: "Read the open page again and show me the interactive elements.",
    },
  },
  {
    name: "browser_close",
    icon: <X />,
    fr: "Fermer la session navigateur et libérer l'onglet.",
    en: "Close the browser session and release its tab.",
    starter: {
      fr: "Ferme la session navigateur.",
      en: "Close the browser session.",
    },
  },
  {
    name: "remember",
    icon: <Brain />,
    fr: "Retenir durablement un fait sur le projet.",
    en: "Durably remember a fact about the project.",
    starter: {
      fr: "Retiens ceci sur le projet : ",
      en: "Remember this about the project: ",
    },
  },
];

/* ---------- panneau d'outils ---------- */

function ChatToolsPanel({
  open,
  onClose,
  onPick,
  fr,
  tools,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (tool: ChatTool) => void;
  fr: boolean;
  tools: ChatTool[];
}): React.ReactElement | null {
  if (!open) return null;
  return (
    <>
      <button
        type="button"
        className="chat-tools-backdrop"
        aria-label={fr ? "Fermer les outils" : "Close tools"}
        onClick={onClose}
      />
      <section className="chat-tools" role="dialog" aria-label={fr ? "Outils" : "Tools"}>
        <header className="chat-tools-head">
          <p className="app-eyebrow">{fr ? "OUTILS DE L'ASSISTANT" : "ASSISTANT TOOLS"}</p>
          <button
            type="button"
            onClick={onClose}
            className="chat-icon-btn"
            aria-label={fr ? "Fermer" : "Close"}
          >
            <X size={14} />
          </button>
        </header>
        <p className="chat-tools-note">
          {fr
            ? "Le serveur exécute, l'assistant décide quand s'en servir — et chaque appel est tracé dans la conversation. Cliquez pour pré-remplir."
            : "The server executes, the assistant decides when to use them — and every call is traced in the conversation. Click to pre-fill."}
        </p>
        <ul className="chat-tools-list">
          {tools.map((tool, index) => (
            <li key={tool.name} style={{ "--i": index } as React.CSSProperties}>
              <button type="button" onClick={() => onPick(tool)}>
                <span className="chat-tools-icon">{tool.icon}</span>
                <span className="chat-tools-text">
                  <code>{tool.name}</code>
                  <span>{fr ? tool.fr : tool.en}</span>
                </span>
                {tool.permission ? (
                  <span className={`chat-tools-perm is-${tool.permission}`}>
                    {fr
                      ? ({
                          read: "lecture",
                          analysis: "analyse",
                          write: "écriture",
                          sensitive: "sensible",
                        }[tool.permission as "read" | "analysis" | "write" | "sensitive"] ??
                        tool.permission)
                      : tool.permission}
                  </span>
                ) : null}
                <ArrowUpRight size={13} className="chat-tools-go" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/* ---------- the page ---------- */

export function AiChatPage(): React.ReactElement {
  const { locale } = useI18n();
  const { user, workspaces, workspaceId: activeWorkspaceId } = useSession();
  const fr = locale === "fr";

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationTotal, setConversationTotal] = useState(0);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [conversationFilter, setConversationFilter] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Values unused for now (the notice UI is not wired yet); the setters are, so the
  // attachment flow can report progress without a second refactor.
  const [extracting, setExtracting] = useState(false);
  const [attachNotice, setAttachNotice] = useState<{ title: string; detail: string } | null>(null);
  const [effort, setEffort] = useState<EffortLevel["id"]>("balanced");
  /**
   * Workspace memory, loaded with the page. It is displayed here because memory only
   * earns trust if the person can read it and delete what is wrong — and because seeing
   * "12 faits" is how a user understands that a new model will not start from zero.
   */
  const [memory, setMemory] = useState<
    { id: string; kind: string; text: string; source: string }[]
  >([]);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");
  /** What the assistant decided to keep after the last turn, shown once. */
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The browser opens beside the chat, not inside the transcript: a page you can click is a
  // panel, not a message.
  const [browserOpen, setBrowserOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  // The server owns the catalogue; the curated list only supplies icons and phrasing.
  // A tool added on the API appears here without a second edit, and its permission class
  // is shown before it can be used.
  const [catalogue, setCatalogue] = useState<ChatTool[]>(CHAT_TOOLS);
  const [immersive, setImmersive] = useState(false);
  const [browserUrl, setBrowserUrl] = useState<string | undefined>(undefined);
  // On a phone the history is an overlay, not a column: opening it by default would
  // hide the conversation the user came for. It starts closed below 900px and opens
  // only on request.
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window === "undefined" || !window.matchMedia("(max-width: 900px)").matches
  );

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 900px)");
    const close = () => {
      if (narrow.matches) setSidebarOpen(false);
    };
    narrow.addEventListener("change", close);
    return () => narrow.removeEventListener("change", close);
  }, []);

  useEffect(() => {
    if (!sidebarOpen || !window.matchMedia("(max-width: 900px)").matches) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("proofcore.chat.immersive", { detail: immersive }));
    return () => {
      window.dispatchEvent(new CustomEvent("proofcore.chat.immersive", { detail: false }));
    };
  }, [immersive]);
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [baseUrlDraft, setBaseUrlDraft] = useState("https://api.openai.com/v1");
  const [activePreset, setActivePreset] = useState<string>("openai");
  const [modelDraft, setModelDraft] = useState("gpt-4o-mini");
  const [keyDraft, setKeyDraft] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** Catalogue of the *connected* provider, loaded when the dialog opens. */
  const [profileModels, setProfileModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [applyingModel, setApplyingModel] = useState(false);
  /** True while the user is deliberately replacing the stored key. */
  const [replacingKey, setReplacingKey] = useState(false);
  const [providers, setProviders] = useState<ProviderOption[]>([
    { id: "openai", label: "OpenAI", kind: "openai" },
    { id: "anthropic", label: "Anthropic (Claude)", kind: "anthropic" },
  ]);
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
    // The list is paged now: it used to stop at 50 rows with no way to reach an older
    // conversation, and nothing in the UI said so.
    fetch(`/api/v1/ai/conversations?workspaceId=${activeWorkspaceId}&limit=50`, {
      credentials: "include",
    })
      .then((response) => (response.ok ? response.json() : { items: [], total: 0 }))
      .then((data) => {
        setConversations(data.items ?? []);
        setConversationTotal(data.total ?? data.items?.length ?? 0);
      })
      .catch(() => {
        setConversations([]);
        setConversationTotal(0);
      });
  }, [activeWorkspaceId]);

  const loadMoreConversations = async () => {
    if (!activeWorkspaceId || loadingMoreConversations) return;
    setLoadingMoreConversations(true);
    try {
      const response = await fetch(
        `/api/v1/ai/conversations?workspaceId=${activeWorkspaceId}&limit=50&offset=${conversations.length}`,
        { credentials: "include" }
      );
      if (response.ok) {
        const data = (await response.json()) as { items: ConversationSummary[]; total: number };
        setConversations((items) => [...items, ...(data.items ?? [])]);
        setConversationTotal(data.total ?? 0);
      }
    } finally {
      setLoadingMoreConversations(false);
    }
  };

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

  // Two scroll modes. "pinned" is the default: the thread follows new content
  // while the reader is near the bottom. When the user sends a message the pin
  // is forced ON until the answer lands — reading position never wins over a
  // question that was just asked. Scrolling up by hand releases the pin and
  // shows the jump-back button instead.
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const lastFollowKeyRef = useRef("");
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || messages.length === 0) return;
    const last = messages[messages.length - 1];
    const key = `${last?.id}:${last?.content?.length}:${last?.trace?.length}`;
    if (lastFollowKeyRef.current === key) return;
    lastFollowKeyRef.current = key;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (pinnedRef.current) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
      return;
    }
    if (distance > 260) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Release the pin only when the reader scrolls UP on purpose: during the
  // programmatic glide to the answer the distance is still large for a few
  // frames, and reading that as "user scrolled up" would strand them mid-way.
  const lastScrollTopRef = useRef(0);
  const onThreadScroll = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const top = scroller.scrollTop;
    const movingUp = top < lastScrollTopRef.current - 2;
    lastScrollTopRef.current = top;
    const distance = scroller.scrollHeight - top - scroller.clientHeight;
    if (movingUp) pinnedRef.current = false;
    if (distance < 40) pinnedRef.current = true;
    setShowJump(distance > 420 && !pinnedRef.current);
  }, []);

  const jumpToLatest = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    pinnedRef.current = true;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, []);

  const loadMemory = useCallback(async () => {
    if (!activeWorkspaceId) return;
    const response = await fetch(
      `/api/v1/ai/memory?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
      { credentials: "include" }
    );
    if (!response.ok) return;
    const body = (await response.json()) as {
      facts?: { id: string; kind: string; text: string; source: string }[];
    };
    setMemory(Array.isArray(body.facts) ? body.facts : []);
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

  const rememberFact = useCallback(async () => {
    const text = memoryDraft.trim();
    if (!text || !activeWorkspaceId) return;
    const response = await fetch("/api/v1/ai/memory", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: activeWorkspaceId, kind: "convention", text }),
    });
    if (response.ok) {
      setMemoryDraft("");
      await loadMemory();
    }
  }, [memoryDraft, activeWorkspaceId, loadMemory]);

  const forgetFact = useCallback(
    async (id: string) => {
      if (!activeWorkspaceId) return;
      const response = await fetch(`/api/v1/ai/memory/${id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: activeWorkspaceId }),
      });
      if (response.ok) setMemory((facts) => facts.filter((fact) => fact.id !== id));
    },
    [activeWorkspaceId]
  );

  const loadConversation = useCallback(async (id: string) => {
    setActiveId(id);
    /* sur téléphone l'historique recouvre le fil : il se referme dès l'ouverture */
    if (window.matchMedia("(max-width: 900px)").matches) setSidebarOpen(false);
    const response = await fetch(`/api/v1/ai/conversations/${id}`, { credentials: "include" });
    if (!response.ok) return;
    const data = (await response.json()) as {
      messages: {
        role: "user" | "assistant";
        content: string;
        trace?: AgentTraceStep[];
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
        usage: (message as { usage?: TurnUsage }).usage,
      }))
    );
    // A freshly opened conversation reads newest-first: pin to the bottom.
    pinnedRef.current = true;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
    });
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
      setConversationTotal((value) => Math.max(0, value - 1));
      if (activeId === id) startNewChat();
    },
    [activeId, startNewChat]
  );

  /**
   * The models the stored key can actually use.
   *
   * Read from the provider through the server, which is the only side that holds the
   * key. Without it the picker had a single option — the current model — so "change the
   * model" opened a menu with nothing to choose, which is the bug this fixes.
   */
  const loadProfileModels = useCallback(async () => {
    if (!profile?.configured) {
      setProfileModels([]);
      return;
    }
    setModelsLoading(true);
    try {
      const response = await fetch("/api/v1/ai/profile/test", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: profile.providerId ?? "custom",
          // A custom provider has no address of its own: without its base URL the server
          // cannot list the models and answers 400, which used to leave the picker with
          // a single option and no explanation.
          ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
        }),
      });
      if (!response.ok) {
        setProfileModels([]);
        return;
      }
      const data = (await response.json()) as { chatModels?: string[]; models?: string[] };
      const list = data.chatModels ?? data.models ?? [];
      setProfileModels(Array.isArray(list) ? list : []);
    } catch {
      setProfileModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [profile?.configured, profile?.providerId, profile?.baseUrl]);

  // Loaded when the dialog opens and whenever the connected provider changes.
  useEffect(() => {
    if (settingsOpen) void loadProfileModels();
  }, [settingsOpen, loadProfileModels]);

  /**
   * Applies a model to the already-stored key.
   *
   * It sends `model` alone: the server keeps the encrypted key and re-validates the id
   * against the provider before storing it. The dialog stays open and confirms, because
   * closing on success is what made the previous flow feel like nothing happened.
   */
  const applyModel = useCallback(
    async (model: string) => {
      if (!model || model === profile?.model) return;
      setApplyingModel(true);
      setProfileError(null);
      try {
        const response = await fetch("/api/v1/ai/profile", {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            providerId: profile?.providerId ?? activePreset,
            ...(profile?.providerId === "custom" && profile.baseUrl
              ? { baseUrl: profile.baseUrl }
              : {}),
            model,
          }),
        });
        const raw = await response.text();
        if (!response.ok) {
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = null;
          }
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
        const data = JSON.parse(raw) as ProfileState & { chatModels?: string[] };
        setProfile((current) => ({ ...(current ?? {}), ...data, configured: true }));
        if (data.chatModels) setProfileModels(data.chatModels);
        setModelDraft("");
        setTestResult({
          ok: true,
          message: fr
            ? `Modèle appliqué : ${data.model ?? model}`
            : `Model applied: ${data.model ?? model}`,
        });
      } catch (error) {
        setProfileError(error instanceof Error ? error.message : "Network error");
      } finally {
        setApplyingModel(false);
      }
    },
    [profile?.providerId, profile?.model, profile?.baseUrl, activePreset, fr]
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
      if (data.chatModels) setProfileModels(data.chatModels);
      setKeyDraft("");
      setModelDraft("");
      setTestResult(null);
      setSettingsOpen(false);
    } finally {
      setProfileSaving(false);
    }
  }, [activePreset, baseUrlDraft, modelDraft, keyDraft, fr]);

  /**
   * Conversation cost. The server stores real `usage` on each assistant message, so a
   * reload shows the same numbers; older messages without usage contribute nothing.
   */
  const tokenStats = useMemo(() => {
    let input = 0;
    let output = 0;
    let contextUsed = 0;
    let budget = 32_000;
    let lastInput = 0;
    for (const message of messages) {
      if (!message.usage) continue;
      input += message.usage.input;
      output += message.usage.output;
      lastInput = message.usage.input;
      if (message.usage.context) {
        contextUsed = message.usage.context.used;
        budget = message.usage.context.budget;
      }
    }
    // Conversations persisted before context accounting existed have no `context`:
    // the last call's input is the honest floor for what is in the window.
    if (contextUsed === 0) contextUsed = Math.min(budget, lastInput);
    return { input, output, contextUsed, budget };
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/v1/ai/tools", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (data: { tools?: { name: string; description: string; permission: string }[] } | null) => {
          if (cancelled || !data?.tools?.length) return;
          setCatalogue(
            data.tools.map((tool) => {
              const curated = CHAT_TOOLS.find((item) => item.name === tool.name);
              return curated
                ? { ...curated, permission: tool.permission }
                : {
                    name: tool.name,
                    icon: <Wrench size={13} />,
                    fr: tool.description,
                    en: tool.description,
                    starter: {
                      fr: `Utilise l'outil ${tool.name} sur mon espace de travail.`,
                      en: `Use the ${tool.name} tool on my workspace.`,
                    },
                    permission: tool.permission,
                  };
            })
          );
        }
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || busy || !activeWorkspaceId) return;
    if (!profile?.configured) {
      setSettingsOpen(true);
      return;
    }
    // The model receives the attachments' extracted text; the bubble shows the
    // plain question plus a summary line.
    const outgoing = composeMessage(text, attachments);
    const shown =
      attachments.length > 0
        ? `${text || (fr ? "Analyse des pièces jointes" : "Analyse the attachments")}\n\n📎 ${attachments
            .map((attachment) => attachment.name)
            .join(" · ")}`
        : text;
    setDraft("");
    setAttachments([]);
    const userMessage: ChatMessage = { id: uid(), role: "user", content: shown };
    const pendingId = uid();
    setMessages((items) => [
      ...items,
      userMessage,
      { id: pendingId, role: "assistant", content: "" },
    ]);
    // Asking a question is the strongest reading intent there is: the thread
    // pins to the bottom and the answer scrolls into view when it lands.
    pinnedRef.current = true;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
    setShowJump(false);
    setBusy(true);
    try {
      const response = await fetch("/api/v1/ai/chat", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          ...(activeId ? { conversationId: activeId } : {}),
          message: outgoing,
          effort,
        }),
      });
      const raw = await response.text();
      let data: {
        conversationId?: string;
        title?: string;
        message?: string;
        trace?: AgentTraceStep[];
        subagents?: { id: string; label: string; ok: boolean; note: string }[];
        memory?: {
          facts: number;
          added?: { kind: string; text: string; created: boolean }[];
        };
        usage?: TurnUsage;
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
          item.id === pendingId
            ? {
                ...item,
                content: data.message ?? "",
                trace: data.trace,
                reviews: data.subagents,
                usage: data.usage,
              }
            : item
        )
      );
      // The assistant may have written a fact during this turn: reload so the counter
      // and the list are never stale, and say out loud what it decided to keep.
      const written = (data.memory?.added ?? []).filter((fact) => fact.created);
      setMemoryNotice(
        written.length > 0 ? written.map((fact) => `${fact.kind} · ${fact.text}`).join(" — ") : null
      );
      void loadMemory();
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
  }, [draft, attachments, busy, activeWorkspaceId, profile, activeId, effort, fr, loadMemory]);

  /** Reads each dropped/selected file, keeps successes, surfaces failures honestly. */
  const handleAttach = useCallback(
    async (files: File[]) => {
      setExtracting(true);
      setAttachNotice(null);
      const kept: Attachment[] = [];
      let total = attachments.reduce((sum, attachment) => sum + attachment.text.length, 0);
      let failure: { title: string; detail: string } | null = null;
      for (const file of files) {
        try {
          const attachment = await extractAttachment(file);
          if (total + attachment.text.length > MAX_TOTAL) {
            failure = {
              title: file.name,
              detail: fr
                ? "Budget de texte atteint — retirez une pièce jointe ou envoyez-la dans un message séparé."
                : "Text budget reached — remove an attachment or send it in a separate message.",
            };
            break;
          }
          total += attachment.text.length;
          kept.push(attachment);
        } catch (caught) {
          if (caught instanceof AttachmentError) {
            failure = { title: caught.title, detail: caught.detail };
          } else {
            failure = {
              title: file.name,
              detail: fr ? "Lecture impossible." : "Could not read the file.",
            };
          }
        }
      }
      if (kept.length > 0) setAttachments((items) => [...items, ...kept]);
      setAttachNotice(failure);
      setExtracting(false);
    },
    [attachments, fr]
  );

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
      {sidebarOpen ? (
        <button
          type="button"
          className="chat-sidebar-backdrop"
          aria-label={fr ? "Fermer les conversations" : "Close conversations"}
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
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
          {/* Only offered when no local search is narrowing the list: otherwise "more"
              would look like it applies to the filtered result. */}
          {conversationFilter.trim() === "" ? (
            <LoadMore
              shown={conversations.length}
              total={conversationTotal}
              loading={loadingMoreConversations}
              onLoad={() => void loadMoreConversations()}
              fr={fr}
              noun={fr ? "conversations" : "conversations"}
              label={fr ? "Charger 50 de plus" : "Load 50 more"}
            />
          ) : null}
        </div>

        <div className="chat-memory">
          <button
            type="button"
            className="chat-memory-head"
            onClick={() => setMemoryOpen((open) => !open)}
            aria-expanded={memoryOpen}
          >
            <Brain size={13} />
            <span>
              {fr ? "Mémoire du projet" : "Project memory"} · {memory.length}
            </span>
            <ChevronDown
              size={12}
              className={`chat-memory-chevron${memoryOpen ? " is-open" : ""}`}
            />
          </button>
          {memoryNotice ? (
            <p className="chat-memory-notice">
              <Brain size={12} aria-hidden="true" />
              <span>
                {fr ? "Retenu par l'assistant : " : "Kept by the assistant: "}
                {memoryNotice}
              </span>
            </p>
          ) : null}
          {memoryOpen ? (
            <div className="chat-memory-body">
              <p className="chat-memory-note">
                {fr
                  ? "Ce que l'assistant sait déjà de ce projet. Il le reçoit à chaque tour, quel que soit le modèle connecté — et c'est lui qui décide quoi retenir, pas vous."
                  : "What the assistant already knows about this project. It is given to every turn, whichever model is connected — and it decides what to keep, not you."}
              </p>
              {memory.length === 0 ? (
                <p className="chat-memory-empty">
                  {fr
                    ? "Rien encore. Dès qu'il apprend une convention, une décision ou une leçon durable, l'assistant l'écrit ici de lui-même."
                    : "Nothing yet. As soon as it learns a durable convention, decision or lesson, the assistant writes it here on its own."}
                </p>
              ) : (
                <ul className="chat-memory-list">
                  {memory.map((fact) => (
                    <li key={fact.id}>
                      <span className="chat-memory-kind">{fact.kind}</span>
                      <span className="chat-memory-text">{fact.text}</span>
                      <button
                        type="button"
                        onClick={() => void forgetFact(fact.id)}
                        aria-label={fr ? "Oublier ce fait" : "Forget this fact"}
                      >
                        <X size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="chat-memory-add">
                <input
                  value={memoryDraft}
                  onChange={(event) => setMemoryDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void rememberFact();
                  }}
                  placeholder={fr ? "Ajouter un fait durable…" : "Add a durable fact…"}
                  maxLength={400}
                />
                <button
                  type="button"
                  onClick={() => void rememberFact()}
                  disabled={memoryDraft.trim().length < 4}
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
          ) : null}
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
      <div className={`chat-main${browserOpen ? " has-browser" : ""}`}>
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
            <Brain size={15} className="text-accent" />
            {fr ? "Assistant PROOFCORE" : "PROOFCORE Assistant"}
          </div>
          {activeWorkspace && <span className="chat-workspace-chip">{activeWorkspace.name}</span>}
          <button
            type="button"
            className={`chat-action-btn ${browserOpen ? "is-on" : ""}`}
            onClick={() => setBrowserOpen((open) => !open)}
            aria-pressed={browserOpen}
            aria-label={fr ? "Navigateur" : "Browser"}
          >
            <Monitor size={13} />
            <span className="chat-action-label">{fr ? "Navigateur" : "Browser"}</span>
          </button>
          <button
            type="button"
            className={`chat-action-btn ${toolsOpen ? "is-on" : ""}`}
            onClick={() => setToolsOpen((open) => !open)}
            aria-pressed={toolsOpen}
            aria-label={fr ? "Outils" : "Tools"}
          >
            <Wrench size={13} />
            <span className="chat-action-label">{fr ? "Outils" : "Tools"}</span>
          </button>
          <button
            type="button"
            className="chat-icon-btn"
            onClick={() => setImmersive((value) => !value)}
            aria-pressed={immersive}
            aria-label={
              immersive
                ? fr
                  ? "Quitter le plein écran"
                  : "Exit full screen"
                : fr
                  ? "Plein écran"
                  : "Full screen"
            }
            title={
              immersive
                ? fr
                  ? "Quitter le plein écran"
                  : "Exit full screen"
                : fr
                  ? "Plein écran"
                  : "Full screen"
            }
          >
            {immersive ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            type="button"
            className="chat-action-btn chat-topbar-export"
            onClick={() =>
              printConversation(
                messages.map((message) => ({ role: message.role, content: message.content })),
                activeWorkspace
                  ? `${fr ? "Conversation" : "Conversation"} · ${activeWorkspace.name}`
                  : fr
                    ? "Conversation PROOFCORE"
                    : "PROOFCORE conversation"
              )
            }
            disabled={messages.length === 0}
          >
            {fr ? "Imprimer / PDF" : "Print / PDF"}
          </button>
        </header>

        <div className="chat-split">
          <div className="chat-column">
            {/* empty state: centered greeting + composer, like the reference */}
            {!hasMessages && (
              <div className="chat-greeting">
                <Terminal size={44} className="chat-greeting-mark" aria-hidden />
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
                    attachments={attachments}
                    onAttach={(files) => void handleAttach(files)}
                    onRemoveAttachment={(index) =>
                      setAttachments((items) => items.filter((_, i) => i !== index))
                    }
                    onDismissNotice={() => setAttachNotice(null)}
                    onTools={() => setToolsOpen(true)}
                    extracting={extracting}
                    notice={attachNotice}
                    tokens={tokenStats}
                    toolCount={catalogue.length}
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
                <div ref={scrollRef} className="chat-scroll" onScroll={onThreadScroll}>
                  <div className="chat-thread">
                    {messages.map((message) =>
                      message.role === "user" ? (
                        <div key={message.id} className="chat-msg chat-msg-user">
                          <div className="chat-msg-user-bubble">{message.content}</div>
                        </div>
                      ) : (
                        <div key={message.id} className="chat-msg chat-msg-ai">
                          <div className="chat-msg-avatar">
                            <Brain size={14} />
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
                            {message.trace
                              ?.filter((step) => step.view?.kind === "browser")
                              .map((step) => (
                                <BrowserView
                                  key={`view:${step.view?.url}:${step.summary}`}
                                  view={step.view as NonNullable<AgentTraceStep["view"]>}
                                  fr={fr}
                                  onOpen={
                                    step.view?.openInBrowser
                                      ? (url) => {
                                          setBrowserUrl(url);
                                          setBrowserOpen(true);
                                        }
                                      : undefined
                                  }
                                />
                              ))}
                            {message.reviews && message.reviews.length > 0 && (
                              <ReviewPanel reviews={message.reviews} fr={fr} />
                            )}
                            {message.error ? (
                              <div className="chat-error">{message.error}</div>
                            ) : message.content ? (
                              <>
                                <ChatMarkdown text={message.content} />
                                <MessageActions text={message.content} fr={fr} />
                                {message.usage ? (
                                  <p className="chat-msg-usage">
                                    <span>
                                      ↑ {compactTokens(message.usage.input)} {fr ? "entrée" : "in"}
                                    </span>
                                    <span>
                                      ↓ {compactTokens(message.usage.output)}{" "}
                                      {fr ? "sortie" : "out"}
                                    </span>
                                  </p>
                                ) : null}
                              </>
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

                {showJump ? (
                  <div className="chat-jump-zone">
                    <button
                      type="button"
                      className="chat-jump"
                      onClick={jumpToLatest}
                      aria-label={fr ? "Revenir au dernier message" : "Jump to latest message"}
                    >
                      <ChevronDown size={14} aria-hidden />
                      {fr ? "Dernier message" : "Latest message"}
                    </button>
                  </div>
                ) : null}

                <div className="chat-composer-zone is-docked">
                  <Composer
                    draft={draft}
                    setDraft={setDraft}
                    onSend={() => void send()}
                    busy={busy}
                    effort={effort}
                    onEffort={setEffort}
                    fr={fr}
                    attachments={attachments}
                    onAttach={(files) => void handleAttach(files)}
                    onRemoveAttachment={(index) =>
                      setAttachments((items) => items.filter((_, i) => i !== index))
                    }
                    onDismissNotice={() => setAttachNotice(null)}
                    onTools={() => setToolsOpen(true)}
                    extracting={extracting}
                    notice={attachNotice}
                    tokens={tokenStats}
                    toolCount={catalogue.length}
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
          {browserOpen && activeWorkspaceId && (
            <BrowserPanel
              workspaceId={activeWorkspaceId}
              {...(browserUrl ? { initialUrl: browserUrl } : {})}
              fr={fr}
              hidden={settingsOpen}
              onClose={() => setBrowserOpen(false)}
            />
          )}
        </div>
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
                <Plug size={15} />
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
                ? "Votre clé reste privée. Vous pouvez la remplacer ou la supprimer à tout moment."
                : "Your key stays private. Replace or delete it at any time."}
            </p>
            <div className="mt-4 space-y-3">
              {/* While a model is connected the dialog has one job: let the user change
                  the model or replace the key, without pretending they must start over. */}
              {profile?.configured && !replacingKey ? (
                <p className="chat-dialog-state">
                  {fr
                    ? "Un modèle est connecté. Change de modèle ou remplace la clé ci-dessous ; rien d'autre n'est nécessaire."
                    : "A model is connected. Change the model or replace the key below; nothing else is needed."}
                </p>
              ) : null}

              {!profile?.configured || replacingKey ? (
                <>
                  <div>
                    <p className="app-label">
                      1. {fr ? "Choisis le fournisseur" : "Choose the provider"}
                    </p>
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
                            title={note?.[fr ? "fr" : "en"] ?? preset.label}
                            className={`chat-provider ${active ? "is-active" : ""}`}
                          >
                            <span className="truncate">{preset.label}</span>
                            {note ? (
                              <span className="chat-provider-note">{note[fr ? "fr" : "en"]}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {activePreset === "custom" ? (
                    <label className="block text-xs font-medium">
                      {fr ? "URL de base" : "Base URL"}
                      <input
                        value={baseUrlDraft}
                        onChange={(event) => setBaseUrlDraft(event.target.value)}
                        className="app-input"
                        placeholder="https://api.example.com/v1"
                      />
                    </label>
                  ) : null}

                  <div className="chat-key-form">
                    <p className="app-label">
                      2.{" "}
                      {profile?.configured
                        ? fr
                          ? "Nouvelle clé (vide = garder l'actuelle)"
                          : "New key (empty = keep the current one)"
                        : fr
                          ? "Colle ta clé API"
                          : "Paste your API key"}
                    </p>
                    <input
                      type="password"
                      value={keyDraft}
                      onChange={(event) => setKeyDraft(event.target.value)}
                      className="app-input font-mono"
                      placeholder={activePreset === "ollama" ? "ollama" : "sk-…"}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="chat-key-hint">
                      {fr
                        ? "Créée chez le fournisseur, jamais stockée en clair ici. PROOFCORE lit la liste des modèles de la clé et choisit le meilleur modèle de conversation — tu n'as rien à connaître."
                        : "Created at the provider, never stored in clear here. PROOFCORE reads the key's model list and picks the best chat model — nothing to know on your side."}
                    </p>
                  </div>
                </>
              ) : null}

              {/* Connected state. The model picker lists what the stored key can really
                  use, read from the provider through the server, and applies on demand. */}
              {profile?.configured ? (
                <div className="chat-connected">
                  <div className="chat-connected-head">
                    <span className="chat-connected-dot" aria-hidden="true" />
                    <p className="chat-connected-name">
                      {profile.providerLabel ?? profile.providerId ?? "—"}
                    </p>
                    <span className="chat-connected-model">{profile.model}</span>
                  </div>

                  <div className="chat-connected-actions">
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen((open) => !open)}
                      aria-expanded={advancedOpen}
                      className="chat-connected-link"
                    >
                      {fr ? "Changer de modèle" : "Change model"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReplacingKey((value) => !value);
                        setTestResult(null);
                        setProfileError(null);
                      }}
                      aria-expanded={replacingKey}
                      className="chat-connected-link"
                    >
                      {replacingKey
                        ? fr
                          ? "Annuler le remplacement"
                          : "Cancel replacement"
                        : fr
                          ? "Remplacer la clé"
                          : "Replace the key"}
                    </button>
                  </div>

                  {advancedOpen ? (
                    <div className="chat-model-picker">
                      <label className="chat-model-label" htmlFor="ai-model-select">
                        {fr ? "Modèle de conversation" : "Chat model"}
                      </label>
                      <select
                        id="ai-model-select"
                        className="app-select font-mono text-[11px]"
                        value={modelDraft || profile.model}
                        onChange={(event) => setModelDraft(event.target.value)}
                        disabled={modelsLoading}
                      >
                        {/* The current model stays first even before the catalogue
                            answers: an empty menu would look broken. */}
                        {[profile.model, ...profileModels.filter((m) => m !== profile.model)].map(
                          (model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          )
                        )}
                      </select>
                      <div className="chat-model-actions">
                        <button
                          type="button"
                          className="app-btn app-btn-primary app-btn-sm"
                          disabled={applyingModel || !modelDraft || modelDraft === profile.model}
                          onClick={() => void applyModel(modelDraft)}
                        >
                          {applyingModel
                            ? fr
                              ? "Application…"
                              : "Applying…"
                            : fr
                              ? "Appliquer"
                              : "Apply"}
                        </button>
                        <button
                          type="button"
                          className="app-btn app-btn-sm"
                          onClick={() => void loadProfileModels()}
                          disabled={modelsLoading}
                        >
                          <RefreshCw size={12} className={modelsLoading ? "animate-spin" : ""} />
                          {fr ? "Recharger la liste" : "Reload the list"}
                        </button>
                      </div>
                      <p className="chat-model-note">
                        {modelsLoading
                          ? fr
                            ? "Lecture des modèles disponibles sur ta clé…"
                            : "Reading the models available on your key…"
                          : fr
                            ? `${profileModels.length} modèle(s) lus depuis ta clé. Un modèle absent de cette liste ne fonctionnera pas.`
                            : `${profileModels.length} model(s) read from your key. A model absent from this list will not work.`}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
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
                    // The dialog stays open: the user just removed the key, so the next
                    // thing they want is the field to enter the new one.
                    setProfile({ configured: false });
                    setProfileModels([]);
                    setAdvancedOpen(false);
                    setReplacingKey(false);
                    setKeyDraft("");
                    setModelDraft("");
                    setTestResult(null);
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
                {/* A connected model needs no "Connect" button: pressing it again would
                    re-send the provider form the user did not change. The primary action
                    becomes closing the panel, which is what they came to do. */}
                {profile?.configured && !replacingKey ? (
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(false)}
                    className="app-btn app-btn-primary app-btn-sm"
                  >
                    {fr ? "Terminé" : "Done"}
                  </button>
                ) : (
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
                )}
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

      <ChatToolsPanel
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        onPick={(tool) => {
          setDraft(fr ? tool.starter.fr : tool.starter.en);
          setToolsOpen(false);
          window.setTimeout(() => {
            document.querySelector<HTMLTextAreaElement>(".chat-composer-input")?.focus();
          }, 60);
        }}
        fr={fr}
        tools={catalogue}
      />
    </div>
  );
}
