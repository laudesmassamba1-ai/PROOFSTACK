import { ArrowRight, ScanLine, Terminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Empty, ErrorState, Loading, StatusBadge } from "../../components/app/ui.js";
import { ModuleGlyph } from "../../components/brand/GlyphArt.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { useSession } from "../../lib/session.js";
import { useTheme } from "../../lib/theme.js";

interface Overview {
  workspace: { id: string; name: string };
  modules: {
    module: string;
    status: string;
    passed: number;
    failed: number;
    warnings: number;
    errors: number;
    lastRunAt?: string;
  }[];
  recentRuns: unknown[];
}

const MODULES = [
  {
    id: "world",
    label: "WORLD",
    command: "proofcore world",
    fr: "Compatibilité mondiale : formulaires, encodage, profils.",
    en: "Global compatibility: forms, encoding, locale profiles.",
  },
  {
    id: "flow",
    label: "FLOW",
    command: "proofcore flow",
    fr: "Fiabilité des parcours : commande, webhook, remboursement.",
    en: "Journey reliability: checkout, webhook, refund.",
  },
  {
    id: "exit",
    label: "EXIT",
    command: "proofcore exit",
    fr: "Portabilité des données : export, schéma, réimport.",
    en: "Data portability: export, schema, re-import.",
  },
  {
    id: "fail",
    label: "FAIL",
    command: "proofcore fail <url>",
    fr: "Audit de sécurité passif sur une URL.",
    en: "Passive security audit against a URL.",
  },
  {
    id: "clean",
    label: "CLEAN",
    command: "proofcore clean <url>",
    fr: "Qualité d’interface : structure, contraste, accessibilité.",
    en: "Interface quality: structure, contrast, accessibility.",
  },
] as const;

export function ModulesIndexPage() {
  const session = useSession();
  const { locale } = useI18n();
  const fr = locale === "fr";
  const { theme } = useTheme();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const load = useCallback(async () => {
    if (!session.workspaceId) return;
    setError(null);
    try {
      setData(await apiFetch<Overview>(`/api/v1/overview?workspaceId=${session.workspaceId}`));
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [session.workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session.workspaceId) {
    return (
      <div className="app-page">
        <Empty
          title={fr ? "Aucun espace de travail" : "No workspace yet"}
          body={fr ? "Créez un espace de travail pour commencer." : "Create a workspace to begin."}
          tester={false}
        />
      </div>
    );
  }
  if (error) {
    return (
      <div className="app-page">
        <ErrorState error={error} onRetry={() => void load()} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="app-page">
        <Loading label={fr ? "Chargement des modules…" : "Loading modules…"} />
      </div>
    );
  }

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="PROOFCORE / MODULES"
        title={fr ? "LES CINQ MODULES." : "THE FIVE MODULES."}
        description={
          fr
            ? "Chaque module vérifie une question précise. Les mêmes commandes tournent dans le CLI, sans ouvrir de navigateur."
            : "Each module answers one precise question. The same commands run in the CLI, without opening a browser."
        }
        actions={
          <div className="modules-index-actions">
            <Link to="/app/scan" className="app-btn app-btn-primary app-btn-sm">
              <ScanLine size={14} /> {fr ? "Scanner une adresse" : "Scan an address"}
            </Link>
            <Link to="/app/cli" className="app-btn app-btn-sm">
              <Terminal size={14} /> {fr ? "Configurer le CLI" : "Set up the CLI"}
            </Link>
          </div>
        }
      />

      <div className="app-object-grid">
        {MODULES.map((module, index) => {
          const record = data.modules.find((item) => item.module === module.id);
          const covered = Boolean(record?.lastRunAt);
          return (
            <Link
              key={module.id}
              to={`/app/modules/${module.id}`}
              className={`app-object-card pk-enter module-${module.id} app-object-card-${index + 1}`}
            >
              <div className="app-object-card-head">
                <span className="app-object-index">0{index + 1}</span>
                {covered ? (
                  <StatusBadge status={record?.status ?? ""} />
                ) : (
                  <span className="app-badge">{fr ? "non testé" : "not tested"}</span>
                )}
              </div>
              <div className="app-object-stage">
                <ModuleGlyph
                  kind={module.id as "world" | "flow" | "exit" | "fail" | "clean"}
                  tone={theme === "dark" ? "dark" : "ink"}
                />
              </div>
              <div className="app-object-card-foot">
                <h2 className="app-object-name">{module.label}</h2>
                <p className="app-object-state">{fr ? module.fr : module.en}</p>
                <code className="modules-index-command">{module.command}</code>
                <span className="app-object-open">
                  {fr ? "Voir le module" : "Open module"} <ArrowRight size={13} />
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      <section className="app-workbench modules-index-cli">
        <header className="app-workbench-head">
          <div>
            <p className="app-eyebrow">CLI / LOCAL</p>
            <h2 className="app-workbench-title">
              {fr ? "Les modules tournent chez vous." : "Modules run on your machine."}
            </h2>
            <p>
              {fr
                ? "Les commandes ci-dessus exécutent les vérifications localement. Sans cible configurée, les cas sont SKIPPED, jamais verts."
                : "The commands above run checks locally. Without a configured target, cases are SKIPPED, never green."}
            </p>
          </div>
          <Link to="/app/cli" className="app-text-link">
            {fr ? "Voir la configuration" : "See the configuration"} <ArrowRight size={13} />
          </Link>
        </header>
        <div className="modules-index-commands">
          {MODULES.map((module) => (
            <div key={module.id} className="modules-index-command-row">
              <span>{module.label}</span>
              <code>{module.command}</code>
            </div>
          ))}
          <div className="modules-index-command-row">
            <span>SCAN</span>
            <code>proofcore scan &lt;url&gt; --explain</code>
          </div>
          <div className="modules-index-command-row">
            <span>HUB</span>
            <code>/modules · /world · /flow · /module exit</code>
          </div>
          <p className="modules-index-note">
            {fr
              ? '`check` enchaîne FAIL et CLEAN sur n\'importe quelle adresse, localhost compris. Une page derrière un login se teste avec --header "Authorization: Bearer …" ou --cookie "nom=valeur".'
              : '`check` runs FAIL and CLEAN on any address, localhost included. A page behind a login is tested with --header "Authorization: Bearer …" or --cookie "name=value".'}
          </p>
        </div>
      </section>
    </div>
  );
}
