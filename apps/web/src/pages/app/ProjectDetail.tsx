import { ArrowLeft, FileJson, KeyRound, Play, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { LoadMore } from "../../components/app/LoadMore.js";
import { Card, Empty, ErrorState, Loading, StatusBadge } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { API_BASE, type ApiError, apiFetch } from "../../lib/api.js";
import { duration, formatDate, relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";
import { usePagedList } from "../../lib/usePagedList.js";

interface Project {
  id: string;
  name: string;
  baseUrl: string;
  environment: string;
  stack?: string;
  enabledModules: string[];
  createdAt: string;
}
interface Run {
  id: string;
  reportId?: string;
  status: string;
  startedAt: string;
  durationMs: number;
  findingCount: number;
}
interface Finding {
  id: string;
  title: string;
  module: string;
  severity: string;
  status: string;
  code: string | null;
  fingerprint: string | null;
  detectedAt: string;
}
interface WebScan {
  id: string;
  url: string;
  worstVerdict: string;
  failed: number;
  warnings: number;
  createdAt: string;
}

export function ProjectDetail() {
  const { projectId } = useParams();
  const { workspaceId } = useSession();
  const { locale } = useI18n();
  const fr = locale === "fr";
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  // Both lists are paged by the same hook, so "load more", the counter and the failure
  // behaviour cannot drift between the runs table and the findings table.
  const runsUrl = useCallback(
    ({ limit, offset }: { limit: number; offset: number }) =>
      `/api/v1/projects/${projectId}/runs?workspaceId=${workspaceId}&limit=${limit}&offset=${offset}`,
    [projectId, workspaceId]
  );
  const findingsUrl = useCallback(
    ({ limit, offset }: { limit: number; offset: number }) =>
      `/api/v1/projects/${projectId}/findings?workspaceId=${workspaceId}&limit=${limit}&offset=${offset}`,
    [projectId, workspaceId]
  );
  const runs = usePagedList<Run>({ url: runsUrl, uniqueBy: (run) => run.id });
  const findings = usePagedList<Finding>({ url: findingsUrl, uniqueBy: (finding) => finding.id });
  const [token, setToken] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<ApiError | Error | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<ApiError | Error | null>(null);
  // Scans started from this page carry the project id, so this list is the project's own
  // history — not the workspace's scans, and not only what CI uploaded.
  const [scans, setScans] = useState<WebScan[] | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId || !projectId) return;
    setError(null);
    try {
      const body = await apiFetch<{ project: Project }>(
        `/api/v1/projects/${projectId}?workspaceId=${workspaceId}`
      );
      setProject(body.project);
    } catch (caught) {
      setError(caught as ApiError);
    }
    await Promise.all([runs.reload(), findings.reload()]);
  }, [projectId, workspaceId, runs.reload, findings.reload]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!workspaceId || !projectId) return;
    let alive = true;
    void apiFetch<{ items: WebScan[] }>(
      `/api/v1/audits?workspaceId=${workspaceId}&projectId=${projectId}&limit=10`
    )
      .then((body) => {
        if (alive) setScans(body.items);
      })
      .catch(() => {
        // The history is a convenience: a failure here must not hide the project.
        if (alive) setScans([]);
      });
    return () => {
      alive = false;
    };
  }, [workspaceId, projectId]);

  const createKey = async () => {
    if (!workspaceId || !projectId) return;
    setKeyError(null);
    setBusy(true);
    try {
      const body = await apiFetch<{ token: string }>("/api/v1/api-keys", {
        method: "POST",
        body: {
          workspaceId,
          projectId,
          label: `${project?.name ?? "Project"} CI`,
          scopes: ["runs:write", "reports:read"],
        },
      });
      setToken(body.token);
    } catch (caught) {
      setKeyError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  /**
   * The five modules, from the browser: the project's own address is scanned server-side
   * and the result opens already interpreted. No CLI, no token, no install step.
   */
  const runModules = async () => {
    if (!workspaceId || !project || running) return;
    setRunning(true);
    setRunError(null);
    try {
      const body = await apiFetch<{ audit: { id: string } }>("/api/v1/audits", {
        method: "POST",
        body: { workspaceId, url: project.baseUrl, projectId: project.id },
      });
      navigate(`/app/scan?audit=${body.audit.id}&explain=1`);
    } catch (caught) {
      setRunError(caught as ApiError);
    } finally {
      setRunning(false);
    }
  };

  const remove = async () => {
    if (!workspaceId || !projectId) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/projects/${projectId}?workspaceId=${workspaceId}`, {
        method: "DELETE",
      });
      navigate("/app/projects");
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!project) return <Loading label={fr ? "Chargement du projet…" : "Loading project…"} />;

  // FAIL and CLEAN are audits, not engine modules: they have no block in the config.
  // Mapping them through a fallback used to emit `exit` three times, which silently
  // overloaded the key in the generated TypeScript.
  const moduleBlocks: Record<string, string> = {
    world: `    world: { enabled: true, profiles: ["en-US", "fr-FR", "fr-BJ"] },`,
    flow: `    flow: { enabled: true, paymentMode: "simulated" },`,
    exit: `    exit: { enabled: true, formats: ["json", "csv"] },`,
  };
  const config = `import type { ProofCoreConfig } from "@proofcore/contracts";

const config: ProofCoreConfig = {
  schemaVersion: 1,
  project: { name: ${JSON.stringify(project.name)}, baseUrl: ${JSON.stringify(project.baseUrl)} },
  environment: ${JSON.stringify(project.environment)},
  modules: {
${project.enabledModules
  .map((module) => moduleBlocks[module])
  .filter((block): block is string => Boolean(block))
  .join("\n")}
  },
  sync: { enabled: true, apiUrl: ${JSON.stringify(API_BASE)} },
};

export default config;`;

  return (
    <>
      <Link
        to="/app/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"
      >
        <ArrowLeft size={13} /> {fr ? "Projets" : "Projects"}
      </Link>
      <PageHeader
        eyebrow={`PROJECT / ${project.environment.toUpperCase()}`}
        title={project.name}
        description={`${project.baseUrl}${project.stack ? ` · ${project.stack}` : ""}`}
        actions={
          <>
            <button
              type="button"
              className="app-btn app-btn-primary"
              onClick={() => void runModules()}
              disabled={running}
            >
              <Play size={14} />{" "}
              {running
                ? fr
                  ? "Modules en cours…"
                  : "Running modules…"
                : fr
                  ? "Lancer les modules"
                  : "Run the modules"}
            </button>
            <button
              type="button"
              className="app-btn app-btn-danger"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
            >
              <Trash2 size={14} /> {fr ? "Supprimer" : "Delete"}
            </button>
          </>
        }
      />

      {runError ? <ErrorState error={runError} onRetry={() => void runModules()} /> : null}

      {confirmingDelete ? (
        <Card className="mb-5 border-danger/40">
          <div className="px-5 py-4">
            <p className="text-sm font-medium">
              {fr ? "Supprimer ce projet ?" : "Delete this project?"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {fr
                ? "Le projet disparaît du workspace. Ses runs restent en base pour l'audit mais ne sont plus accessibles depuis cette page. Cela n'annule aucun paiement."
                : "The project disappears from the dashboard. Its stored runs are kept in the database for audit but are no longer reachable from this page. This does not cancel anything you paid for."}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="app-btn app-btn-danger"
                onClick={() => void remove()}
                disabled={busy}
              >
                {fr ? "Supprimer le projet" : "Delete project"}
              </button>
              <button type="button" className="app-btn" onClick={() => setConfirmingDelete(false)}>
                {fr ? "Le conserver" : "Keep it"}
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card
          title={fr ? "Runs" : "Runs"}
          description={
            fr
              ? "Un run vérifie ce projet. Lancez-en un ici, ou laissez la CI le faire à chaque envoi."
              : "A run verifies this project. Start one here, or let CI upload it on every push."
          }
        >
          {runs.items.length === 0 ? (
            <Empty
              title={fr ? "Aucun run pour l'instant" : "No run yet"}
              body={
                fr
                  ? "Lancez les cinq modules sur l'adresse du projet : le résultat s'ouvre déjà expliqué. Aucun logiciel à installer."
                  : "Run the five modules on the project address: the result opens already explained. Nothing to install."
              }
              action={
                <button
                  type="button"
                  className="app-btn app-btn-primary"
                  onClick={() => void runModules()}
                  disabled={running}
                >
                  <Play size={14} /> {fr ? "Lancer les modules" : "Run the modules"}
                </button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>{fr ? "État" : "Status"}</th>
                    <th>{fr ? "Démarré" : "Started"}</th>
                    <th>{fr ? "Durée" : "Duration"}</th>
                    <th>{fr ? "Constats" : "Findings"}</th>
                    <th>{fr ? "Rapport" : "Report"}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.items.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="text-muted">{formatDate(run.startedAt)}</td>
                      <td className="text-muted">{duration(run.durationMs)}</td>
                      <td>{run.findingCount}</td>
                      <td>
                        <a
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                          href={`${API_BASE}/api/v1/reports/${run.reportId ?? ""}?workspaceId=${workspaceId}&format=html`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <FileJson size={13} /> {fr ? "ouvrir" : "open"}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <LoadMore
            shown={runs.items.length}
            total={runs.total}
            loading={runs.loadingMore}
            onLoad={() => void runs.loadMore()}
            fr={fr}
            noun={fr ? "exécutions" : "runs"}
            label={fr ? "Charger 25 de plus" : "Load 25 more"}
          />
        </Card>

        <div className="space-y-4">
          <Card
            title={fr ? "Automatiser (optionnel)" : "Automate (optional)"}
            description={
              fr
                ? "Pour la CI ou le CLI. Pas nécessaire pour lancer les modules depuis cette page."
                : "For CI or the CLI. Not needed to run the modules from this page."
            }
          >
            <div className="space-y-3 px-5 py-4">
              {token ? (
                <>
                  <pre className="overflow-x-auto rounded-[var(--radius)] bg-surface-alt px-3 py-2 app-mono">
                    {token}
                  </pre>
                  <p className="text-xs text-muted">
                    {fr
                      ? "Copiez-le maintenant. Seul un hash est stocké : il ne pourra plus être affiché. Placez-le dans les secrets CI, jamais dans le dépôt."
                      : "Copy it now. Only a hash is stored, so it cannot be shown again. Put it in CI secrets, never in the repo."}
                  </p>
                </>
              ) : (
                <p className="text-xs leading-relaxed text-muted">
                  {fr
                    ? "Les jetons exigent une offre avec accès API. Le jeton est limité à ce projet et ne peut qu'envoyer des runs et lire les rapports."
                    : "Tokens require a plan with API access. The token is scoped to this project and can only upload runs and read reports."}
                </p>
              )}
              <button
                type="button"
                className="app-btn"
                onClick={() => void createKey()}
                disabled={busy}
              >
                <KeyRound size={14} />{" "}
                {token
                  ? fr
                    ? "Créer un autre jeton"
                    : "Create another token"
                  : fr
                    ? "Créer le jeton du projet"
                    : "Create project token"}
              </button>
              {keyError ? <ErrorState error={keyError} /> : null}
            </div>
          </Card>

          <Card
            title="Configuration"
            description={
              fr
                ? "Modifiez les réglages dans le formulaire, ou copiez le fichier ci-dessous si vous préférez la version experte."
                : "Edit the settings in the form, or copy the file below if you prefer the expert version."
            }
          >
            <div className="px-5 pt-4">
              <Link to={`/app/projects/${projectId}/config`} className="app-btn app-btn-primary">
                {fr ? "Configurer sans code" : "Configure without code"}
              </Link>
            </div>
            <pre className="overflow-x-auto px-5 py-4 app-mono leading-relaxed text-muted">
              {config}
            </pre>
          </Card>
        </div>
      </div>

      <Card
        title={fr ? "Scans de ce site" : "Scans of this site"}
        description={
          fr
            ? "Lancés depuis cette page, sur l'adresse du projet. Le plus récent en haut."
            : "Started from this page against the project address, newest first."
        }
        className="mt-4"
      >
        {scans === null ? (
          <Loading label={fr ? "Chargement des scans…" : "Loading scans…"} />
        ) : scans.length === 0 ? (
          <Empty
            title={fr ? "Aucun scan de ce site" : "No scan of this site yet"}
            body={
              fr
                ? "Le bouton « Lancer les modules » en haut lance un scan et le garde ici, rattaché à ce projet."
                : "The “Run the modules” button above starts a scan and keeps it here, attached to this project."
            }
            tester={false}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th>{fr ? "Verdict" : "Verdict"}</th>
                  <th>{fr ? "Échecs" : "Failures"}</th>
                  <th>{fr ? "Avertissements" : "Warnings"}</th>
                  <th>{fr ? "Quand" : "When"}</th>
                  <th>{fr ? "Résultat" : "Result"}</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <StatusBadge status={item.worstVerdict === "fail" ? "failed" : "passed"} />
                    </td>
                    <td className="tabular-nums">{item.failed}</td>
                    <td className="tabular-nums">{item.warnings}</td>
                    <td className="text-muted">{relativeTime(item.createdAt)}</td>
                    <td>
                      <Link
                        to={`/app/scan?audit=${item.id}&explain=1`}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <Play size={13} /> {fr ? "ouvrir" : "open"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title={fr ? "Constats" : "Findings"}
        description={
          fr
            ? "Vérifications en échec avec l'identifiant du cas reproductible."
            : "Failed checks with the reproducing case id."
        }
        className="mt-4"
      >
        {findings.items.length === 0 ? (
          <Empty
            title={fr ? "Aucun constat" : "No finding"}
            body={
              fr
                ? "Aucune vérification en échec n'a été enregistrée pour ce projet."
                : "No failed check has been recorded for this project."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th>{fr ? "Constat" : "Finding"}</th>
                  <th>Module</th>
                  <th>{fr ? "Gravité" : "Severity"}</th>
                  <th>Code</th>
                  <th>{fr ? "Détecté" : "Detected"}</th>
                </tr>
              </thead>
              <tbody>
                {findings.items.map((finding) => (
                  <tr key={finding.id} className="align-top">
                    <td className="font-medium">
                      <button
                        type="button"
                        className="text-left"
                        onClick={() =>
                          setExpandedFinding((value) => (value === finding.id ? null : finding.id))
                        }
                        aria-expanded={expandedFinding === finding.id}
                      >
                        {finding.title}
                      </button>
                      {expandedFinding === finding.id ? (
                        <dl className="mt-2 space-y-1 rounded-[var(--radius)] bg-surface-alt px-3 py-2 text-xs">
                          <div className="flex gap-2">
                            <dt className="text-muted">{fr ? "Code" : "Code"} :</dt>
                            <dd className="app-mono">{finding.code ?? "—"}</dd>
                          </div>
                          <div className="flex gap-2">
                            <dt className="text-muted">{fr ? "Empreinte" : "Fingerprint"} :</dt>
                            <dd
                              className="app-mono truncate"
                              title={finding.fingerprint ?? undefined}
                            >
                              {finding.fingerprint ? `${finding.fingerprint.slice(0, 18)}…` : "—"}
                            </dd>
                          </div>
                          <div className="flex gap-2">
                            <dt className="text-muted">{fr ? "Détecté le" : "Detected on"} :</dt>
                            <dd>{formatDate(finding.detectedAt)}</dd>
                          </div>
                          <div className="flex gap-2">
                            <dt className="text-muted">
                              {fr ? "Détail complet" : "Full detail"} :
                            </dt>
                            <dd>
                              {fr
                                ? "Dans la charge du rapport : /api/v1/reports — visible dans le run correspondant."
                                : "Inside the report payload: /api/v1/reports — visible from the matching run."}
                            </dd>
                          </div>
                        </dl>
                      ) : null}
                    </td>
                    <td className="uppercase text-muted">{finding.module}</td>
                    <td>
                      <span className="app-badge app-badge-danger">
                        {finding.severity.toLowerCase()}
                      </span>
                    </td>
                    <td className="app-mono text-muted">{finding.code ?? "—"}</td>
                    <td className="text-muted">{relativeTime(finding.detectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore
          shown={findings.items.length}
          total={findings.total}
          loading={findings.loadingMore}
          onLoad={() => void findings.loadMore()}
          fr={fr}
          noun={fr ? "constats" : "findings"}
          label={fr ? "Charger 25 de plus" : "Load 25 more"}
        />
      </Card>

      <Card title={fr ? "CLI (facultatif)" : "CLI (optional)"} className="mt-4">
        <div className="space-y-2 px-5 py-4">
          <p className="text-xs text-muted">
            {fr
              ? "Rien n'est obligatoire ici : les modules se lancent depuis le bouton ci-dessus. Le CLI sert à rejouer la même chose en local ou en CI, depuis la racine du projet :"
              : "Nothing here is mandatory: the modules run from the button above. The CLI replays the same thing locally or in CI, from your project root:"}
          </p>
          <pre className="overflow-x-auto rounded-[var(--radius)] bg-surface-alt px-3 py-2 app-mono">
            {`export PROOFSTACK_PROJECT_TOKEN=<token from above>
pnpm proofcore doctor
pnpm proofcore test --module ${project.enabledModules.join(",") || "world"}
pnpm proofcore sync`}
          </pre>
        </div>
      </Card>
    </>
  );
}
