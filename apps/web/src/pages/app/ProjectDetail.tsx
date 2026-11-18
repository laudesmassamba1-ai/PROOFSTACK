import { ArrowLeft, ChevronDown, FileJson, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Card, Empty, ErrorState, Loading, StatusBadge } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { API_BASE, type ApiError, apiFetch } from "../../lib/api.js";
import { duration, formatDate, relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";

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

export function ProjectDetail() {
  const { projectId } = useParams();
  const { workspaceId } = useSession();
  const { locale } = useI18n();
  const fr = locale === "fr";
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [findingsTotal, setFindingsTotal] = useState(0);
  const [findingsLoadingMore, setFindingsLoadingMore] = useState(false);
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<ApiError | Error | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId || !projectId) return;
    setError(null);
    try {
      const [projectBody, runBody, findingBody] = await Promise.all([
        apiFetch<{ project: Project }>(`/api/v1/projects/${projectId}?workspaceId=${workspaceId}`),
        apiFetch<{ items: Run[] }>(`/api/v1/projects/${projectId}/runs?workspaceId=${workspaceId}`),
        apiFetch<{ items: Finding[]; total: number }>(
          `/api/v1/projects/${projectId}/findings?workspaceId=${workspaceId}&limit=25`
        ),
      ]);
      setProject(projectBody.project);
      setRuns(runBody.items);
      setFindings(findingBody.items);
      setFindingsTotal(findingBody.total);
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [projectId, workspaceId]);

  const loadMoreFindings = useCallback(async () => {
    if (!workspaceId || !projectId || findingsLoadingMore) return;
    setFindingsLoadingMore(true);
    setError(null);
    try {
      const body = await apiFetch<{ items: Finding[]; total: number }>(
        `/api/v1/projects/${projectId}/findings?workspaceId=${workspaceId}&limit=25&offset=${findings.length}`
      );
      setFindings((items) => [...items, ...body.items]);
      setFindingsTotal(body.total);
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setFindingsLoadingMore(false);
    }
  }, [workspaceId, projectId, findings.length, findingsLoadingMore]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const config = `import type { ProofCoreConfig } from "@proofcore/contracts";

const config: ProofCoreConfig = {
  schemaVersion: 1,
  project: { name: ${JSON.stringify(project.name)}, baseUrl: ${JSON.stringify(project.baseUrl)} },
  environment: ${JSON.stringify(project.environment)},
  modules: {
${project.enabledModules
  .map((module) =>
    module === "world"
      ? `    world: { enabled: true, profiles: ["en-US", "fr-FR", "fr-BJ"] },`
      : module === "flow"
        ? `    flow: { enabled: true, paymentMode: "simulated" },`
        : `    exit: { enabled: true, formats: ["json", "csv"] },`
  )
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
          <button
            type="button"
            className="app-btn app-btn-danger"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
          >
            <Trash2 size={14} /> {fr ? "Supprimer" : "Delete"}
          </button>
        }
      />

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
              ? "Enregistrés depuis les envois CLI/CI, un par identifiant de run."
              : "Stored from CLI/CI uploads, one per run id."
          }
        >
          {runs.length === 0 ? (
            <Empty
              title={fr ? "Aucun run" : "No run yet"}
              body={
                fr
                  ? "Connectez le CLI avec le jeton ci-dessous, puis lancez `proofcore test`."
                  : "Connect the CLI with the token below, then run `proofcore test`."
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
                  {runs.map((run) => (
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
        </Card>

        <div className="space-y-4">
          <Card
            title={fr ? "Jeton du projet" : "Project token"}
            description={
              fr
                ? "Jeton Bearer pour le CLI et la CI. Affiché une seule fois."
                : "Bearer token for the CLI and CI. Shown once."
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
                ? "À copier dans proofcore.config.ts à la racine du projet."
                : "Copy into proofcore.config.ts at your project root."
            }
          >
            <pre className="overflow-x-auto px-5 py-4 app-mono leading-relaxed text-muted">
              {config}
            </pre>
          </Card>
        </div>
      </div>

      <Card
        title={fr ? "Constats" : "Findings"}
        description={
          fr
            ? "Vérifications en échec avec l'identifiant du cas reproductible."
            : "Failed checks with the reproducing case id."
        }
        className="mt-4"
      >
        {findings.length === 0 ? (
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
                {findings.map((finding) => (
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
        {findings.length < findingsTotal ? (
          <div className="flex items-center gap-3 border-t border-line px-5 py-3">
            <p className="text-xs text-muted">
              {fr
                ? `${findings.length} affichés sur ${findingsTotal} constats.`
                : `${findings.length} of ${findingsTotal} findings shown.`}
            </p>
            <button
              type="button"
              className="app-btn"
              onClick={() => void loadMoreFindings()}
              disabled={findingsLoadingMore}
            >
              {findingsLoadingMore ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : (
                <ChevronDown size={13} aria-hidden />
              )}
              {fr ? "Charger 25 de plus" : "Load 25 more"}
            </button>
          </div>
        ) : null}
      </Card>

      <Card title="CLI" className="mt-4">
        <div className="space-y-2 px-5 py-4">
          <p className="text-xs text-muted">
            {fr ? "Depuis la racine de votre projet :" : "From your project root:"}
          </p>
          <pre className="overflow-x-auto rounded-[var(--radius)] bg-surface-alt px-3 py-2 app-mono">
            {`export PROOFCORE_PROJECT_TOKEN=<token from above>
pnpm proofcore doctor
pnpm proofcore test --module ${project.enabledModules.join(",") || "world"}
pnpm proofcore sync`}
          </pre>
        </div>
      </Card>
    </>
  );
}
