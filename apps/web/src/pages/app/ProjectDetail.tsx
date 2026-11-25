import {
  ArrowLeft,
  ArrowRight,
  Brain,
  FileJson,
  KeyRound,
  Play,
  Settings2,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ProjectAiPanel, ProjectMetricsPanel } from "../../components/app/ProjectIntelligence.js";
import { Empty, ErrorState, Loading, StatusBadge } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { API_BASE, type ApiError, apiFetch } from "../../lib/api.js";
import { environmentLabel } from "../../lib/appLabels.js";
import { duration, formatDate, relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";

interface Project {
  id: string;
  name: string;
  baseUrl: string;
  environment: string;
  stack?: string;
  enabledModules: string[];
}

interface Run {
  id: string;
  reportId?: string;
  status: string;
  startedAt: string;
  durationMs: number;
  findingCount: number;
}

interface WebScan {
  id: string;
  url: string;
  worstVerdict: string;
  failed: number;
  warnings: number;
  createdAt: string;
}

type Tab = "ai" | "metrics" | "runs";

export function ProjectDetail() {
  const { projectId } = useParams();
  const { workspaceId } = useSession();
  const { locale } = useI18n();
  const fr = locale === "fr";
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const initialTab = params.get("tab");
  const [tab, setTab] = useState<Tab>(
    initialTab === "metrics" || initialTab === "runs" ? initialTab : "ai"
  );
  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [scans, setScans] = useState<WebScan[] | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<ApiError | Error | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<ApiError | Error | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId || !projectId) return;
    setError(null);
    try {
      const [projectBody, runBody, scanBody] = await Promise.all([
        apiFetch<{ project: Project }>(`/api/v1/projects/${projectId}?workspaceId=${workspaceId}`),
        apiFetch<{ items: Run[] }>(
          `/api/v1/projects/${projectId}/runs?workspaceId=${workspaceId}&limit=20`
        ),
        apiFetch<{ items: WebScan[] }>(
          `/api/v1/audits?workspaceId=${workspaceId}&projectId=${projectId}&limit=10`
        ),
      ]);
      setProject(projectBody.project);
      setRuns(runBody.items);
      setScans(scanBody.items);
      void apiFetch<{ precheck: string }>(
        `/api/v1/projects/${projectId}/config?workspaceId=${workspaceId}`
      )
        .then((config) => setNotConfigured(config.precheck === "NOT_CONFIGURED"))
        .catch(() => setNotConfigured(false));
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [projectId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const chooseTab = (next: Tab) => {
    setTab(next);
    setParams(next === "ai" ? {} : { tab: next }, { replace: true });
  };

  const runModules = async () => {
    if (!workspaceId || !project || running) return;
    setRunning(true);
    setRunError(null);
    try {
      const body = await apiFetch<{ audit: { id: string } }>("/api/v1/audits", {
        method: "POST",
        body: { workspaceId, url: project.baseUrl, projectId: project.id },
      });
      navigate(`/app/scan?audit=${body.audit.id}&project=${project.id}&explain=1`);
    } catch (caught) {
      setRunError(caught as ApiError);
    } finally {
      setRunning(false);
    }
  };

  const createKey = async () => {
    if (!workspaceId || !projectId) return;
    setTokenError(null);
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
      setTokenError(caught as ApiError);
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

  return (
    <>
      <Link
        to="/app/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"
      >
        <ArrowLeft size={13} /> {fr ? "Projets" : "Projects"}
      </Link>
      <PageHeader
        eyebrow={`${fr ? "PROJET" : "PROJECT"} / ${environmentLabel(
          project.environment,
          fr
        ).toUpperCase()}`}
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
                  ? "Scan en cours…"
                  : "Scanning…"
                : fr
                  ? "Scanner le site"
                  : "Scan the site"}
            </button>
            <Link to={`/app/projects/${project.id}/config`} className="app-btn">
              <Settings2 size={14} /> {fr ? "Configurer" : "Configure"}
            </Link>
            <button
              type="button"
              className="app-btn app-btn-danger"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
            >
              <Trash2 size={14} />
            </button>
          </>
        }
      />

      {notConfigured ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-warning/40 bg-warning/5 px-4 py-3 text-xs">
          <span className="min-w-0 flex-1">
            {fr
              ? "Les modules WORLD, FLOW et EXIT n'ont pas encore de cible enregistrée. L'audit IA fonctionne déjà sur les fichiers importés."
              : "WORLD, FLOW and EXIT have no saved target yet. AI audit already works on imported files."}
          </span>
          <Link to={`/app/projects/${project.id}/config`} className="app-text-link">
            {fr ? "Configurer" : "Configure"} <ArrowRight size={12} />
          </Link>
        </div>
      ) : null}

      {runError ? <ErrorState error={runError} onRetry={() => void runModules()} /> : null}

      {confirmingDelete ? (
        <div className="mb-4 rounded-[var(--radius)] border border-danger/40 px-4 py-3">
          <p className="text-sm font-medium">
            {fr ? "Supprimer ce projet ?" : "Delete this project?"}
          </p>
          <p className="mt-1 text-xs text-muted">
            {fr
              ? "Le projet et son accès depuis cette page disparaissent. Les runs restent en base pour l'audit."
              : "The project and its access from this page disappear. Runs stay stored for audit."}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="app-btn app-btn-danger"
              onClick={() => void remove()}
              disabled={busy}
            >
              {fr ? "Supprimer" : "Delete"}
            </button>
            <button type="button" className="app-btn" onClick={() => setConfirmingDelete(false)}>
              {fr ? "Conserver" : "Keep"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Three doors, not a wall. The AI view is the default because it is the one that
          turns a verdict into a file, a line and a correction. */}
      <div
        className="project-tabs mb-4 flex flex-wrap gap-2"
        role="tablist"
        aria-label={fr ? "Vues du projet" : "Project views"}
      >
        {(
          [
            ["ai", <Brain key="ai" size={14} />, fr ? "Audit IA" : "AI audit"],
            ["metrics", <FileJson key="metrics" size={14} />, fr ? "Métriques" : "Metrics"],
            ["runs", <Play key="runs" size={14} />, fr ? "Exécutions" : "Runs"],
          ] as const
        ).map(([id, icon, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`app-btn ${tab === id ? "app-btn-primary" : ""}`}
            onClick={() => chooseTab(id)}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === "ai" ? <ProjectAiPanel projectId={project.id} /> : null}
      {tab === "metrics" ? <ProjectMetricsPanel projectId={project.id} /> : null}

      {tab === "runs" ? (
        <div className="space-y-4">
          <section className="app-workbench">
            <header className="app-workbench-head">
              <div>
                <p className="app-eyebrow">01 / {fr ? "EXÉCUTIONS" : "RUNS"}</p>
                <h2 className="app-workbench-title">
                  {fr ? "Vérifications déterministes" : "Deterministic checks"}
                </h2>
              </div>
              <button
                type="button"
                className="app-btn app-btn-sm"
                onClick={() => void runModules()}
                disabled={running}
              >
                <Play size={13} /> {fr ? "Relancer" : "Run again"}
              </button>
            </header>
            {runs === null ? (
              <Loading label={fr ? "Chargement…" : "Loading…"} />
            ) : runs.length === 0 ? (
              <Empty
                title={fr ? "Aucun run" : "No run"}
                body={
                  fr
                    ? "Lance un scan depuis cette page. L'IA ne remplace pas ce résultat : elle lit ensuite le code pour expliquer comment corriger."
                    : "Run a scan from this page. AI does not replace this result: it reads the code to explain how to fix it."
                }
                tester={false}
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
                        <td className="tabular-nums">{run.findingCount}</td>
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
          </section>

          <section className="app-workbench">
            <header className="app-workbench-head">
              <div>
                <p className="app-eyebrow">02 / SCANS</p>
                <h2 className="app-workbench-title">{fr ? "Scans du site" : "Site scans"}</h2>
              </div>
            </header>
            {scans === null ? (
              <Loading label={fr ? "Chargement…" : "Loading…"} />
            ) : scans.length === 0 ? (
              <p className="px-5 py-4 text-xs text-muted">
                {fr ? "Aucun scan de ce site pour l'instant." : "No scan of this site yet."}
              </p>
            ) : (
              <div className="divide-y divide-black/5">
                {scans.map((scan) => (
                  <Link
                    key={scan.id}
                    to={`/app/scan?audit=${scan.id}&explain=1`}
                    className="flex items-center gap-3 px-5 py-3 text-xs hover:bg-surface-alt"
                  >
                    <StatusBadge status={scan.worstVerdict === "fail" ? "failed" : "passed"} />
                    <span className="min-w-0 flex-1 truncate app-mono">{scan.url}</span>
                    <span className="text-muted">
                      {scan.failed} {fr ? "échec(s)" : "fail"} · {scan.warnings}{" "}
                      {fr ? "avertissement(s)" : "warn"}
                    </span>
                    <span className="shrink-0 text-muted">{relativeTime(scan.createdAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <details className="app-sheet">
            <summary className="cursor-pointer px-5 py-3 text-xs font-medium">
              {fr
                ? "Avancé : jeton CI et configuration experte"
                : "Advanced: CI token and expert config"}
            </summary>
            <div className="space-y-3 border-t border-black/10 px-5 py-4">
              <p className="text-xs leading-relaxed text-muted">
                {fr
                  ? "Utile seulement pour la CI. Le scan depuis cette page ne demande aucun jeton."
                  : "Useful only for CI. Scanning from this page needs no token."}
              </p>
              {token ? (
                <pre className="overflow-x-auto rounded-[var(--radius)] bg-surface-alt px-3 py-2 app-mono">
                  {token}
                </pre>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="app-btn app-btn-sm"
                  onClick={() => void createKey()}
                  disabled={busy}
                >
                  <KeyRound size={13} />{" "}
                  {token
                    ? fr
                      ? "Créer un autre jeton"
                      : "Create another token"
                    : fr
                      ? "Créer un jeton CI"
                      : "Create CI token"}
                </button>
                <Link to={`/app/projects/${project.id}/config`} className="app-btn app-btn-sm">
                  <Settings2 size={13} /> {fr ? "Configuration complète" : "Full configuration"}
                </Link>
              </div>
              {tokenError ? <ErrorState error={tokenError} /> : null}
            </div>
          </details>
        </div>
      ) : null}
    </>
  );
}
