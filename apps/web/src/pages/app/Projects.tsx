import { ArrowUpRight, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Empty, ErrorState, Field, Loading, StatusBadge } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { environmentLabel } from "../../lib/appLabels.js";
import { relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";

interface Project {
  id: string;
  name: string;
  baseUrl: string;
  stack?: string;
  environment: string;
  enabledModules: string[];
  lastRunAt?: string;
  lastRunStatus?: string;
}

const MODULES = ["world", "flow", "exit"] as const;

export function Projects() {
  const { workspaceId } = useSession();
  const { locale, t } = useI18n();
  const fr = locale === "fr";
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    baseUrl: "http://localhost:3000",
    stack: "",
    environment: "local",
  });
  const [modules, setModules] = useState<string[]>([...MODULES]);
  const [formError, setFormError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    try {
      const body = await apiFetch<{ items: Project[] }>(
        `/api/v1/projects?workspaceId=${workspaceId}`
      );
      setProjects(body.items);
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workspaceId) return;
    setBusy(true);
    setFormError(null);
    try {
      await apiFetch("/api/v1/projects", {
        method: "POST",
        body: {
          workspaceId,
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          ...(form.stack.trim() ? { stack: form.stack.trim() } : {}),
          environment: form.environment,
          enabledModules: modules,
        },
      });
      setCreating(false);
      setForm({ name: "", baseUrl: "http://localhost:3000", stack: "", environment: "local" });
      setModules([...MODULES]);
      await load();
    } catch (caught) {
      setFormError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  if (!workspaceId) {
    return <Empty title={t("ws.noWorkspace.title")} body={t("ws.noWorkspace.body")} />;
  }
  if (error) return <ErrorState error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHeader
        eyebrow={`${t("ws.overview.projects").toUpperCase()} / ${t("ws.overview.eyebrow")}`}
        title={t("ws.projects.title")}
        description={t("ws.projects.description")}
        actions={
          <button
            type="button"
            className="app-btn app-btn-primary"
            onClick={() => setCreating((value) => !value)}
          >
            <Plus size={15} /> {t("ws.projects.new")}
          </button>
        }
      />

      {creating ? (
        <section className="app-sheet mb-5">
          <header className="app-workbench-head">
            <div>
              <p className="app-eyebrow">00 / {t("ws.projects.new")}</p>
              <h2 className="app-workbench-title">{t("ws.projects.new")}</h2>
            </div>
          </header>
          <form className="app-form-sheet" onSubmit={submit}>
            <Field label={t("ws.projects.name")} htmlFor="project-name">
              <input
                id="project-name"
                className="app-input"
                required
                maxLength={120}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field
              label={t("ws.projects.baseUrl")}
              htmlFor="project-base-url"
              hint={t("ws.projects.baseUrl.hint")}
            >
              <input
                id="project-base-url"
                className="app-input"
                type="url"
                required
                value={form.baseUrl}
                onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
              />
            </Field>
            <Field label={t("ws.projects.stack")} htmlFor="project-stack">
              <input
                id="project-stack"
                className="app-input"
                maxLength={60}
                placeholder="nextjs, rails, laravel…"
                value={form.stack}
                onChange={(event) => setForm({ ...form, stack: event.target.value })}
              />
            </Field>
            <Field label={t("ws.projects.environment")} htmlFor="project-environment">
              <select
                id="project-environment"
                className="app-select"
                value={form.environment}
                onChange={(event) => setForm({ ...form, environment: event.target.value })}
              >
                {(["local", "staging", "ci", "production"] as const).map((environment) => (
                  <option key={environment} value={environment}>
                    {environmentLabel(environment, fr)}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset className="sm:col-span-2 md:col-span-2">
              <legend className="app-label">{t("ws.projects.modules")}</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                {MODULES.map((module) => (
                  <label key={module} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={modules.includes(module)}
                      onChange={(event) =>
                        setModules((current) =>
                          event.target.checked
                            ? [...current, module]
                            : current.filter((item) => item !== module)
                        )
                      }
                    />
                    {module.toUpperCase()}
                  </label>
                ))}
              </div>
            </fieldset>
            {formError ? (
              <div className="sm:col-span-2 md:col-span-2">
                <ErrorState error={formError} />
                {"code" in formError && formError.code === "project_limit_reached" ? (
                  <p className="mt-2 text-xs text-muted">
                    {fr ? (
                      <>
                        <Link to="/app/billing" className="app-text-link">
                          Comparer les offres
                        </Link>{" "}
                        pour augmenter cette limite. Aucun projet existant n'est supprimé lorsqu'une
                        limite est atteinte.
                      </>
                    ) : (
                      <>
                        <Link to="/app/billing" className="app-text-link">
                          Compare plans
                        </Link>{" "}
                        to raise this limit. Existing projects are never deleted when a limit is
                        reached.
                      </>
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 sm:col-span-2 md:col-span-2">
              <button
                type="submit"
                className="app-btn app-btn-primary"
                disabled={busy || modules.length === 0}
              >
                {busy ? t("ws.projects.creating") : t("ws.projects.create")}
              </button>
              <button type="button" className="app-btn" onClick={() => setCreating(false)}>
                {t("ws.projects.cancel")}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {!projects ? (
        <Loading label={t("ws.projects.loading")} />
      ) : projects.length === 0 ? (
        <section className="app-sheet">
          <Empty
            title={t("ws.projects.empty.title")}
            body={t("ws.projects.empty.body")}
            action={
              <button
                type="button"
                className="app-btn app-btn-primary"
                onClick={() => setCreating(true)}
              >
                <Plus size={14} /> {t("ws.projects.new")}
              </button>
            }
          />
        </section>
      ) : (
        <>
          <p className="app-eyebrow mb-3">{t("ws.projects.count", { count: projects.length })}</p>
          <div className="app-project-list">
            {projects.map((project, index) => (
              <Link
                key={project.id}
                to={`/app/projects/${project.id}`}
                className="app-project-row"
                aria-label={`${t("ws.projects.open")}: ${project.name}`}
              >
                <span className="app-project-index">{String(index + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <h2 className="app-project-name truncate">{project.name}</h2>
                  <p className="app-project-target">{project.baseUrl}</p>
                </div>
                <div className="app-project-meta">
                  <span>{environmentLabel(project.environment, fr)}</span>
                  {project.enabledModules.map((module) => (
                    <span key={module}>{module.toUpperCase()}</span>
                  ))}
                  <span>
                    {project.lastRunAt
                      ? t("ws.projects.last", { time: relativeTime(project.lastRunAt) })
                      : t("ws.projects.never")}
                  </span>
                </div>
                <div className="app-project-side">
                  {project.lastRunStatus ? (
                    <StatusBadge status={project.lastRunStatus} />
                  ) : (
                    <span className="app-badge">{t("ws.projects.noRuns")}</span>
                  )}
                  <ArrowUpRight size={16} aria-hidden />
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
