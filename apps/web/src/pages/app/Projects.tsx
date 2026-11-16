import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Card, Empty, ErrorState, Field, Loading, StatusBadge } from "../../components/app/ui.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
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

  if (!workspaceId)
    return <Empty title="No workspace yet" body="Create a workspace before adding projects." />;
  if (error) return <ErrorState error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHeader
        title="Projects"
        description="A project is one application under test: its base URL, environment and the modules allowed to check it."
        actions={
          <button
            type="button"
            className="app-btn app-btn-primary"
            onClick={() => setCreating((value) => !value)}
          >
            <Plus size={15} /> New project
          </button>
        }
      />

      {creating ? (
        <Card title="New project" className="mb-5">
          <form className="grid gap-4 px-5 py-5 sm:grid-cols-2" onSubmit={submit}>
            <Field label="Name" htmlFor="project-name">
              <input
                id="project-name"
                className="app-input"
                required
                maxLength={120}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>{" "}
            <Field
              label="Base URL"
              htmlFor="project-base-url"
              hint="Local or staging. Production is refused for write-capable module tests."
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
            <Field label="Stack (optional)" htmlFor="project-stack">
              <input
                id="project-stack"
                className="app-input"
                maxLength={60}
                placeholder="nextjs, rails, laravel…"
                value={form.stack}
                onChange={(event) => setForm({ ...form, stack: event.target.value })}
              />
            </Field>
            <Field label="Environment" htmlFor="project-environment">
              <select
                id="project-environment"
                className="app-select"
                value={form.environment}
                onChange={(event) => setForm({ ...form, environment: event.target.value })}
              >
                <option value="local">local</option>
                <option value="staging">staging</option>
                <option value="ci">ci</option>
                <option value="production">production</option>
              </select>
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="app-label">Modules</legend>
              <div className="flex flex-wrap gap-3">
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
              <div className="sm:col-span-2">
                <ErrorState error={formError} />
                {"code" in formError && formError.code === "project_limit_reached" ? (
                  <p className="mt-2 text-xs text-muted">
                    <Link to="/app/billing" className="text-primary hover:underline">
                      Compare plans
                    </Link>{" "}
                    to raise this limit. Existing projects are never deleted when a limit is
                    reached.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="flex gap-2 sm:col-span-2">
              <button
                type="submit"
                className="app-btn app-btn-primary"
                disabled={busy || modules.length === 0}
              >
                {busy ? "Creating…" : "Create project"}
              </button>
              <button type="button" className="app-btn" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {!projects ? (
        <Loading label="Loading projects…" />
      ) : projects.length === 0 ? (
        <Card>
          <Empty
            title="No projects yet"
            body="Create a project to get a configuration and a project token for the CLI."
            action={
              <button
                type="button"
                className="app-btn app-btn-primary"
                onClick={() => setCreating(true)}
              >
                <Plus size={14} /> New project
              </button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/app/projects/${project.id}`}
              className="app-card block p-5 hover:border-primary"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{project.name}</h2>
                  <p className="app-mono mt-1 truncate text-muted">{project.baseUrl}</p>
                </div>
                {project.lastRunStatus ? (
                  <StatusBadge status={project.lastRunStatus} />
                ) : (
                  <span className="app-badge">no runs</span>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="app-badge">{project.environment}</span>
                {project.enabledModules.map((module) => (
                  <span key={module} className="app-badge">
                    {module.toUpperCase()}
                  </span>
                ))}
                <span className="ml-auto">
                  {project.lastRunAt ? `last run ${relativeTime(project.lastRunAt)}` : "never run"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
