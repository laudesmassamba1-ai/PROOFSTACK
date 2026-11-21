import {
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Cpu,
  FilePenLine,
  FileText,
  FolderOpen,
  GitBranch,
  Loader2,
  Play,
  Search,
  ShieldCheck,
  Square,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ChatMarkdown } from "../../components/app/ChatMarkdown.js";
import { useI18n } from "../../i18n/index.js";
import "../../styles/local-agent.css";

interface LocalState {
  root: string;
  model: string;
  /** Why the account model could not be resolved, when it is not just "no profile yet". */
  modelReason?: string | null;
  allowWrite: boolean;
  sync: boolean;
  account: { email: string; apiUrl: string } | null;
}

interface UserEntry {
  id: string;
  kind: "user";
  text: string;
}

interface AssistantEntry {
  id: string;
  kind: "assistant";
  text: string;
  streaming?: boolean;
}

interface ToolEntry {
  id: string;
  kind: "tool";
  name: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error" | "refused";
  content?: string;
  reason?: string;
}

interface ApprovalEntry {
  id: string;
  kind: "approval";
  requestId: string;
  tool: string;
  args: Record<string, unknown>;
  preview: string | null;
  status: "pending" | "allowed" | "denied" | "expired";
}

type Entry = UserEntry | AssistantEntry | ToolEntry | ApprovalEntry;

interface AgentEvent {
  type: string;
  payload: Record<string, unknown>;
}

const TOOL_ICONS: Record<string, typeof Wrench> = {
  read_file: FileText,
  list_files: FolderOpen,
  search_code: Search,
  write_file: FilePenLine,
  apply_patch: FilePenLine,
  run_command: Terminal,
  run_tests: Play,
  run_sandboxed: ShieldCheck,
  git_status: GitBranch,
  git_diff: GitBranch,
  git_log: GitBranch,
  git_commit: GitBranch,
};

const PROMPTS = {
  fr: [
    "Explique l’architecture de ce dépôt.",
    "Trouve pourquoi les tests échouent.",
    "Propose un plan avant de modifier des fichiers.",
  ],
  en: [
    "Explain this repository architecture.",
    "Find why the tests are failing.",
    "Propose a plan before changing files.",
  ],
};

export function LocalAgentPage() {
  const { locale } = useI18n();
  const fr = locale === "fr";
  const [state, setState] = useState<LocalState | null>(null);
  const [stateError, setStateError] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [conversationKey, setConversationKey] = useState(
    () => `desktop-${Date.now().toString(36)}`
  );
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const counter = useRef(0);

  const nextId = useCallback(() => {
    counter.current += 1;
    return `e${Date.now().toString(36)}${counter.current}`;
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/state", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as LocalState;
      })
      .then((payload) => {
        if (alive) setState(payload);
      })
      .catch((error) => {
        if (alive) {
          setStateError(
            error instanceof Error
              ? error.message
              : fr
                ? "Le moteur local ne répond pas."
                : "The local engine did not answer."
          );
        }
      });
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [fr]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: entries and running are the scroll triggers
  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries, running]);

  const updateTool = useCallback((name: string, patch: Partial<ToolEntry>) => {
    setEntries((previous) => {
      for (let index = previous.length - 1; index >= 0; index--) {
        const entry = previous[index];
        if (entry?.kind === "tool" && entry.name === name && entry.status === "running") {
          return [
            ...previous.slice(0, index),
            { ...entry, ...patch },
            ...previous.slice(index + 1),
          ];
        }
      }
      return previous;
    });
  }, []);

  const handleEvent = useCallback(
    (event: AgentEvent) => {
      const payload = event.payload;
      if (event.type === "assistant_text" && typeof payload.text === "string") {
        const text = payload.text;
        setEntries((previous) => {
          const last = previous.at(-1);
          if (last?.kind === "assistant" && last.streaming) {
            return [...previous.slice(0, -1), { ...last, text: last.text + text }];
          }
          return [...previous, { id: nextId(), kind: "assistant", text, streaming: true }];
        });
        return;
      }
      if (event.type === "tool_call" && typeof payload.name === "string") {
        setEntries((previous) => [
          ...previous,
          {
            id: nextId(),
            kind: "tool",
            name: payload.name as string,
            args: (payload.args as Record<string, unknown>) ?? {},
            status: "running",
          },
        ]);
        return;
      }
      if (event.type === "tool_result" && typeof payload.name === "string") {
        updateTool(payload.name, {
          status: payload.isError === true ? "error" : "ok",
          ...(typeof payload.content === "string" ? { content: payload.content } : {}),
        });
        return;
      }
      if (event.type === "tool_refused" && typeof payload.name === "string") {
        updateTool(payload.name, {
          status: "refused",
          ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}),
        });
        return;
      }
      if (event.type === "approval" && typeof payload.id === "string") {
        setEntries((previous) => [
          ...previous,
          {
            id: nextId(),
            kind: "approval",
            requestId: payload.id as string,
            tool: String(payload.tool ?? "outil"),
            args: (payload.args as Record<string, unknown>) ?? {},
            preview: typeof payload.preview === "string" ? payload.preview : null,
            status: "pending",
          },
        ]);
        return;
      }
      if (event.type === "provider" && typeof payload.model === "string") {
        // The engine re-reads the account before a turn; reflect a model connected on the
        // site after this window opened instead of leaving the header on "non configuré".
        setState((previous) =>
          previous ? { ...previous, model: payload.model as string, modelReason: null } : previous
        );
        return;
      }
      if (event.type === "result") {
        setEntries((previous) => {
          const last = previous.at(-1);
          if (last?.kind === "assistant")
            return [...previous.slice(0, -1), { ...last, streaming: false }];
          if (typeof payload.text === "string" && payload.text) {
            return [...previous, { id: nextId(), kind: "assistant", text: payload.text }];
          }
          return previous;
        });
        return;
      }
      if (event.type === "done" && typeof payload.syncError === "string") {
        setNotice(
          fr
            ? `Conversation non synchronisée : ${payload.syncError}`
            : `Conversation not synced: ${payload.syncError}`
        );
      }
    },
    [fr, nextId, updateTool]
  );

  const send = async () => {
    const message = draft.trim();
    if (!message || running) return;
    setDraft("");
    setNotice("");
    setRunning(true);
    setEntries((previous) => [...previous, { id: nextId(), kind: "user", text: message }]);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, conversationKey }),
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error("Stream unavailable");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split = buffer.indexOf("\n\n");
        while (split >= 0) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          let type = "message";
          let data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) type = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (data) {
            try {
              handleEvent({ type, payload: JSON.parse(data) as Record<string, unknown> });
            } catch {
              // A truncated frame must not take down the conversation.
            }
          }
          split = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        setNotice(fr ? "Tour interrompu." : "Turn stopped.");
      } else {
        setNotice(
          (fr ? "L’agent local a échoué : " : "The local agent failed: ") +
            (error instanceof Error ? error.message : String(error))
        );
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
      setEntries((previous) =>
        previous.map((entry) =>
          entry.kind === "assistant" ? { ...entry, streaming: false } : entry
        )
      );
    }
  };

  const capabilities: Array<[typeof FileText, string]> = [
    [FileText, fr ? "Lire les fichiers" : "Read files"],
    [Search, fr ? "Chercher dans le code" : "Search code"],
    [FilePenLine, fr ? "Modifier avec diff" : "Edit with a diff"],
    [Terminal, fr ? "Exécuter des commandes" : "Run commands"],
    [Play, fr ? "Lancer les tests" : "Run tests"],
    [GitBranch, fr ? "Inspecter Git" : "Inspect Git"],
  ];

  const decide = async (entry: ApprovalEntry, allow: boolean) => {
    setEntries((previous) =>
      previous.map((item) =>
        item.kind === "approval" && item.id === entry.id
          ? { ...item, status: allow ? "allowed" : "denied" }
          : item
      )
    );
    try {
      await fetch("/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: entry.requestId, allow }),
        credentials: "include",
      });
    } catch {
      setNotice(
        fr ? "La réponse n’a pas atteint le moteur." : "The answer did not reach the engine."
      );
    }
  };

  return (
    <div className="app-page local-agent">
      <header className="local-agent-head">
        <div>
          <h1 className="local-agent-title">{fr ? "Console locale" : "Local console"}</h1>
        </div>
        <div className="local-agent-head-meta">
          <span className={`local-agent-status ${running ? "is-running" : ""}`}>
            <Cpu size={13} />
            {running ? (fr ? "En cours" : "Running") : fr ? "Prêt" : "Ready"}
          </span>
          {state ? <span className="local-agent-model">{state.model}</span> : null}
          <Link to="/app/ai" className="app-btn app-btn-sm">
            {fr ? "Assistant" : "Assistant"}
          </Link>
        </div>
      </header>

      <div className="local-agent-grid">
        <section className="local-agent-console" aria-label={fr ? "Conversation" : "Conversation"}>
          <header className="local-agent-console-head">
            <div>
              <span className="local-agent-console-kicker">
                <Bot size={14} /> {fr ? "Conversation" : "Conversation"}
              </span>
              <p>
                {state
                  ? fr
                    ? `Dépôt ouvert · ${shortPath(state.root)}`
                    : `Repository open · ${shortPath(state.root)}`
                  : fr
                    ? "Connexion…"
                    : "Connecting…"}
              </p>
            </div>
            {entries.length > 0 ? (
              <button
                type="button"
                className="local-agent-clear"
                onClick={() => {
                  setEntries([]);
                  setNotice("");
                  setConversationKey(`desktop-${Date.now().toString(36)}`);
                }}
                disabled={running}
              >
                {fr ? "Nouvelle conversation" : "New conversation"}
              </button>
            ) : null}
          </header>

          <div className="local-agent-log" ref={logRef} role="log" aria-live="polite">
            {entries.length === 0 ? (
              <div className="local-agent-empty">
                <div className="local-agent-empty-mark">
                  <Bot size={30} strokeWidth={1.4} />
                </div>
                <h2>{fr ? "Par où commence-t-on ?" : "Where do we start?"}</h2>
                <p>
                  {fr
                    ? "L’agent voit le dépôt dans lequel le moteur a été lancé. Il travaille par étapes et montre chaque outil."
                    : "The agent sees the repository the engine was started in. It works in steps and shows every tool."}
                </p>
                <div className="local-agent-prompts">
                  {PROMPTS[fr ? "fr" : "en"].map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => {
                        setDraft(prompt);
                        requestAnimationFrame(() =>
                          document.getElementById("agent-input")?.focus()
                        );
                      }}
                    >
                      {prompt} <ChevronRight size={13} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              entries.map((entry) => {
                if (entry.kind === "user") {
                  return (
                    <article key={entry.id} className="local-agent-message is-user">
                      <span className="local-agent-role">{fr ? "Vous" : "You"}</span>
                      <p>{entry.text}</p>
                    </article>
                  );
                }
                if (entry.kind === "assistant") {
                  return (
                    <article key={entry.id} className="local-agent-message is-assistant">
                      <span className="local-agent-role">
                        <Bot size={12} /> PROOFSTACK
                        {entry.streaming ? <Loader2 size={11} className="app-spin" /> : null}
                      </span>
                      <div className="local-agent-markdown">
                        <ChatMarkdown text={entry.text} />
                      </div>
                    </article>
                  );
                }
                if (entry.kind === "approval") {
                  return (
                    <article key={entry.id} className="local-agent-approval">
                      <header>
                        <span>
                          <ShieldCheck size={15} />{" "}
                          {fr ? "Autorisation demandée" : "Approval requested"}
                        </span>
                        <code>{entry.tool}</code>
                      </header>
                      <p>
                        {fr
                          ? "Cet outil modifie la machine. Vérifiez l’aperçu avant d’autoriser."
                          : "This tool changes the machine. Review the preview before allowing it."}
                      </p>
                      {entry.preview ? <pre>{entry.preview}</pre> : null}
                      {!entry.preview && Object.keys(entry.args).length > 0 ? (
                        <pre>{JSON.stringify(entry.args, null, 2)}</pre>
                      ) : null}
                      {entry.status === "pending" ? (
                        <div className="local-agent-approval-actions">
                          <button
                            type="button"
                            className="app-btn app-btn-mint"
                            onClick={() => void decide(entry, true)}
                          >
                            <Check size={14} /> {fr ? "Autoriser" : "Allow"}
                          </button>
                          <button
                            type="button"
                            className="app-btn"
                            onClick={() => void decide(entry, false)}
                          >
                            <X size={14} /> {fr ? "Refuser" : "Deny"}
                          </button>
                        </div>
                      ) : (
                        <span className={`local-agent-verdict is-${entry.status}`}>
                          {entry.status === "allowed"
                            ? fr
                              ? "Autorisé"
                              : "Allowed"
                            : fr
                              ? "Refusé"
                              : "Denied"}
                        </span>
                      )}
                    </article>
                  );
                }
                const Icon = TOOL_ICONS[entry.name] ?? Wrench;
                return (
                  <details
                    key={entry.id}
                    className={`local-agent-tool is-${entry.status}`}
                    open={entry.status === "running"}
                  >
                    <summary>
                      <Icon size={14} />
                      <span>{entry.name}</span>
                      <span className="local-agent-tool-state">
                        {entry.status === "running" ? (
                          <Loader2 size={12} className="app-spin" />
                        ) : entry.status === "ok" ? (
                          <Check size={12} />
                        ) : (
                          <CircleAlert size={12} />
                        )}
                      </span>
                    </summary>
                    {Object.keys(entry.args).length > 0 ? (
                      <pre>{JSON.stringify(entry.args, null, 2)}</pre>
                    ) : null}
                    {entry.content ? <pre>{entry.content}</pre> : null}
                    {entry.reason ? <p>{entry.reason}</p> : null}
                  </details>
                );
              })
            )}
          </div>

          {notice ? (
            <div className="local-agent-notice" role="alert">
              <CircleAlert size={14} /> {notice}
            </div>
          ) : null}

          <form
            className="local-agent-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              id="agent-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={3}
              placeholder={
                fr
                  ? "Demandez une modification, une recherche ou une vérification…"
                  : "Ask for a change, a search or a verification…"
              }
              aria-label={fr ? "Message à l’agent" : "Message to the agent"}
              disabled={running}
            />
            <div className="local-agent-composer-foot">
              <span>
                {fr
                  ? "Entrée pour envoyer · Maj+Entrée pour une ligne"
                  : "Enter to send · Shift+Enter for a line"}
              </span>
              {running ? (
                <button
                  type="button"
                  className="app-btn app-btn-sm"
                  onClick={() => abortRef.current?.abort()}
                >
                  <Square size={12} /> {fr ? "Arrêter" : "Stop"}
                </button>
              ) : (
                <button
                  type="submit"
                  className="app-btn app-btn-primary app-btn-sm"
                  disabled={!draft.trim()}
                >
                  <Play size={13} /> {fr ? "Envoyer" : "Send"}
                </button>
              )}
            </div>
          </form>
        </section>

        <aside className="local-agent-side">
          <section className="local-agent-card">
            <p className="app-eyebrow">01 / {fr ? "Contexte" : "Context"}</p>
            <h2>{fr ? "Machine" : "Machine"}</h2>
            {state ? (
              <dl className="local-agent-facts">
                <div>
                  <dt>{fr ? "Dépôt" : "Repository"}</dt>
                  <dd title={state.root}>{shortPath(state.root)}</dd>
                </div>
                <div>
                  <dt>{fr ? "Modèle" : "Model"}</dt>
                  <dd>{state.model}</dd>
                  {state.model === "non configuré" ? (
                    <p className="local-agent-card-note">
                      {state.modelReason
                        ? fr
                          ? `Synchronisation du compte impossible : ${state.modelReason}`
                          : `Account sync failed: ${state.modelReason}`
                        : fr
                          ? "Le modèle se configure sur le site ; l’agent le reprend automatiquement."
                          : "Configure the model on the site; the agent picks it up automatically."}
                    </p>
                  ) : null}
                </div>
                <div>
                  <dt>{fr ? "Compte" : "Account"}</dt>
                  <dd>{state.account?.email ?? (fr ? "non connecté" : "signed out")}</dd>
                </div>
                <div>
                  <dt>{fr ? "Écriture" : "Writes"}</dt>
                  <dd className={state.allowWrite ? "is-mint" : ""}>
                    {state.allowWrite
                      ? fr
                        ? "automatique"
                        : "automatic"
                      : fr
                        ? "sur autorisation"
                        : "requires approval"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="local-agent-card-copy">
                {stateError
                  ? fr
                    ? fr
                      ? "Le moteur local ne répond pas."
                      : "The local engine is not responding."
                    : `The local engine did not answer (${stateError}). Start the desktop app or \`proofcore serve\`.`
                  : fr
                    ? "Lecture de l’état du moteur…"
                    : "Reading the engine state…"}
              </p>
            )}
          </section>

          <section className="local-agent-card">
            <p className="app-eyebrow">02 / {fr ? "Outils" : "Tools"}</p>
            <h2>{fr ? "Ce que l’agent peut faire" : "What the agent can do"}</h2>
            <ul className="local-agent-tools">
              {capabilities.map(([Icon, label]) => (
                <li key={label}>
                  <Icon size={13} />
                  {label}
                </li>
              ))}
            </ul>
            <p className="local-agent-card-note">
              {fr
                ? "Les outils qui écrivent passent par une autorisation, sauf si le moteur a été lancé avec --yes."
                : "Writing tools go through an approval unless the engine was started with --yes."}
            </p>
          </section>

          <section className="local-agent-card is-quiet">
            <p className="app-eyebrow">03 / {fr ? "Données" : "Data"}</p>
            <p className="local-agent-card-copy">
              {fr
                ? "La conversation est enregistrée et liée à votre compte."
                : "The conversation is saved and linked to your account."}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-2).join("/")}`;
}
