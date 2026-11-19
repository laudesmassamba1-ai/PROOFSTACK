import { ArrowLeft, BookOpen, Check, Copy, Keyboard, ShieldCheck, Terminal } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Card } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";

const COMMANDS = [
  { command: "proofcore", fr: "Ouvre le hub plein écran.", en: "Opens the full-screen hub." },
  {
    command: "proofcore login",
    fr: "Connecte ce poste au compte et reprend le modèle IA du site.",
    en: "Connects this machine to the account and pulls the site AI model.",
  },
  {
    command: "proofcore doctor",
    fr: "Vérifie le poste, les conflits et les permissions.",
    en: "Checks the machine, conflicts and permissions.",
  },
  {
    command: "proofcore test --module world,flow,exit",
    fr: "Exécute les trois modules locaux.",
    en: "Runs the three local modules.",
  },
  {
    command: "proofcore audit fail https://example.com",
    fr: "Audite une URL réelle sans quitter la machine.",
    en: "Audits a real URL without leaving this machine.",
  },
  {
    command: "proofcore sync",
    fr: "Envoie les résultats au compte, jamais le code source.",
    en: "Sends results to the account, never the source code.",
  },
  {
    command: "proofcore update",
    fr: "Vérifie une release et remplace le moteur après validation.",
    en: "Checks a release and replaces the engine after verification.",
  },
];

const SHORTCUTS = [
  { keys: "↑ / ↓", fr: "Historique des commandes", en: "Command history" },
  { keys: "Tab", fr: "Complète une commande", en: "Completes a command" },
  { keys: "PgUp / PgDn", fr: "Fait défiler la sortie", en: "Scrolls the output" },
  { keys: "Ctrl+C", fr: "Interrompt le tour en cours", en: "Interrupts the current turn" },
  { keys: "Ctrl+D", fr: "Quitte le hub", en: "Leaves the hub" },
];

/** The CLI guide lives inside the app shell: opening /docs used to drop the user on the marketing site. */
export function CliDocs() {
  const { locale } = useI18n();
  const fr = locale === "fr";
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      setCopied(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={fr ? "CLI / GUIDE" : "CLI / GUIDE"}
        title={fr ? "LE MOTEUR, DANS LE TERMINAL." : "THE ENGINE, IN THE TERMINAL."}
        description={
          fr
            ? "Les mêmes commandes et les mêmes outils que l’app, depuis un terminal."
            : "The same commands and tools as the app, with no interface to load. Everything runs on this machine; the account is used for session, reports and sync."
        }
        actions={
          <Link to="/app/cli" className="app-btn">
            <ArrowLeft size={14} /> {fr ? "Retour au CLI" : "Back to CLI"}
          </Link>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card
          title={fr ? "Commandes essentielles" : "Essential commands"}
          description={
            fr
              ? "Copiez une commande, collez-la dans un terminal à la racine du projet."
              : "Copy a command and paste it in a terminal at the project root."
          }
          enhanced
        >
          <ul className="divide-y divide-line px-5">
            {COMMANDS.map((entry) => (
              <li key={entry.command} className="flex items-start gap-3 py-3">
                <code className="min-w-0 flex-1 break-words rounded-[var(--radius)] bg-surface-alt px-3 py-2 app-mono text-[0.72rem]">
                  {entry.command}
                </code>
                <button
                  type="button"
                  className="app-btn px-2"
                  onClick={() => void copy(entry.command)}
                  aria-label={fr ? `Copier ${entry.command}` : `Copy ${entry.command}`}
                >
                  {copied === entry.command ? <Check size={13} /> : <Copy size={13} />}
                </button>
                <p className="mt-2 w-[42%] shrink-0 text-xs leading-relaxed text-muted">
                  {fr ? entry.fr : entry.en}
                </p>
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid gap-4">
          <Card
            title={fr ? "Hub plein écran" : "Full-screen hub"}
            description={
              fr
                ? "Lancez `proofcore` sans argument : le hub prend le terminal, affiche l’aide, l’historique et complète les commandes."
                : "Run `proofcore` with no argument: the hub takes the terminal, shows help, history and completes commands."
            }
          >
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 text-xs font-medium">
                <Terminal size={14} className="text-primary" />
                {fr ? "Toujours sur cette machine" : "Always on this machine"}
              </div>
              <ul className="mt-3 space-y-2.5">
                {SHORTCUTS.map((entry) => (
                  <li
                    key={entry.keys}
                    className="flex items-center justify-between gap-3 text-xs text-muted"
                  >
                    <kbd className="rounded border border-line bg-surface-alt px-1.5 py-0.5 app-mono text-[0.65rem] text-ink">
                      {entry.keys}
                    </kbd>
                    <span className="text-right">{fr ? entry.fr : entry.en}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card title={fr ? "Ce qui reste local" : "What stays local"}>
            <div className="grid gap-3 px-5 py-4 text-xs leading-relaxed text-muted">
              <p className="flex gap-2">
                <ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" />
                {fr
                  ? "Lecture, modification, tests, audits, bac à sable et index."
                  : "Reads, edits, tests, audits, sandbox and index run here. Source code is not uploaded by sync."}
              </p>
              <p className="flex gap-2">
                <BookOpen size={15} className="mt-0.5 shrink-0 text-primary" />
                {fr
                  ? "Le modèle du compte est utilisé automatiquement."
                  : "The model key stays encrypted on the site. The engine uses the authenticated relay and re-reads the account model on each turn."}
              </p>
              <p className="flex gap-2">
                <Keyboard size={15} className="mt-0.5 shrink-0 text-primary" />
                {fr
                  ? "Le hub fonctionne aussi dans un terminal distant ou un runner CI : la session est lue depuis ~/.config/proofcore/session.json en mode 0600."
                  : "The hub also works in a remote terminal or CI runner: the session is read from ~/.config/proofcore/session.json with mode 0600."}
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
