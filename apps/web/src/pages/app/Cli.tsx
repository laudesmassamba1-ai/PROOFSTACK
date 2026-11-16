import { ArrowRight, Check, Copy, ExternalLink, KeyRound, Terminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Card, Empty, ErrorState, Loading, StatusBadge } from "../../components/app/ui.js";
import { CliPreview } from "../../components/marketing/CliPreview.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";

interface Project {
  id: string;
  name: string;
  baseUrl: string;
  environment: string;
  lastRunAt?: string;
  lastRunStatus?: string;
}

const STEPS = [
  {
    title: "Install",
    body: "The package is private in this build. Run it from this repository, or use the published name once it is released.",
    command: "pnpm cli -- init",
  },
  {
    title: "Configure",
    body: "Point the modules at localhost or staging, then validate the targets before the first run.",
    command: "pnpm cli -- doctor\npnpm cli -- validate",
  },
  {
    title: "Prove",
    body: "Run the checks, read the finding, reproduce it. Uploading the result is a separate, explicit step.",
    command: "pnpm cli -- test --module world,flow,exit\npnpm cli -- sync",
  },
];

export function Cli() {
  const { workspaceId } = useSession();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

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

  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  };

  if (error) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!projects) return <Loading label="Checking the workspace connection…" />;

  const latest = [...projects]
    .filter((project) => project.lastRunAt)
    .sort((a, b) => (a.lastRunAt ?? "").localeCompare(b.lastRunAt ?? ""))
    .at(-1);

  return (
    <>
      <PageHeader
        title="Connect the CLI"
        description="Developer onboarding for this workspace. The browser can copy commands and create a project token; it cannot execute a local shell command."
        actions={
          <Link to="/docs" className="app-btn">
            <Terminal size={14} /> CLI documentation
          </Link>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card
          title="Connection status"
          description="Read from the same project records as the dashboard."
        >
          {projects.length === 0 ? (
            <Empty
              title="No project yet"
              body="Create a project first. A project gives the CLI a base URL, an environment and the module set to run."
              action={
                <Link to="/app/projects" className="app-btn app-btn-primary">
                  Create a project <ArrowRight size={14} />
                </Link>
              }
            />
          ) : (
            <div className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {latest ? `Last upload from ${latest.name}` : "No run received yet"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    {latest?.lastRunAt
                      ? `${relativeTime(latest.lastRunAt)} · the status below is the uploaded run status, not a local test result.`
                      : "The projects exist, but the CLI has not uploaded a run. Create a scoped token, run the checks, then sync."}
                  </p>
                </div>
                {latest?.lastRunStatus ? <StatusBadge status={latest.lastRunStatus} /> : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    to={`/app/projects/${project.id}`}
                    className="app-badge hover:text-ink"
                  >
                    {project.name} <ExternalLink size={11} />
                  </Link>
                ))}
              </div>
              <div className="mt-4 rounded-[var(--radius)] border border-line bg-surface-alt px-3 py-3">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <KeyRound size={13} className="text-primary" />
                  Project token
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Open a project and create a token scoped to{" "}
                  <code className="app-mono">runs:write</code> and{" "}
                  <code className="app-mono">reports:read</code>. It is shown once; store it in CI
                  secrets.
                </p>
                <Link
                  to={latest ? `/app/projects/${latest.id}` : "/app/projects"}
                  className="app-btn mt-3"
                >
                  Open project token <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          )}
        </Card>

        <Card title="What the CLI is" description="The execution model, stated plainly.">
          <ul className="space-y-3 px-5 py-4">
            {[
              "Runs on your machine or CI — not in the browser or the API.",
              "One engine, one report schema, three modules.",
              "The cloud stores results you explicitly sync; no silent upload.",
              "Every failed finding includes a reproducible command.",
            ].map((item) => (
              <li key={item} className="flex gap-2.5 text-xs leading-relaxed text-muted">
                <Check size={14} className="mt-0.5 shrink-0 text-success" />
                {item}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {STEPS.map((step, index) => (
          <Card key={step.title} title={`0${index + 1} · ${step.title}`}>
            <div className="px-5 py-4">
              <p className="text-xs leading-relaxed text-muted">{step.body}</p>
              <div className="mt-3 flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius)] bg-surface-alt px-3 py-2 app-mono whitespace-pre-wrap">
                  {step.command}
                </pre>
                <button
                  type="button"
                  className="app-btn px-2"
                  onClick={() => void copy(step.command)}
                  aria-label={`Copy ${step.title} command`}
                >
                  <Copy size={13} />
                </button>
              </div>
              {copied === step.command ? (
                <p className="mt-1 text-[0.7rem] text-success">Copied.</p>
              ) : null}
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-4">
        <CliPreview />
        <p className="mt-2 text-[0.7rem] text-muted">
          The terminal above is a static example generated from a real report shape. It is not a
          live execution from this browser.
        </p>
      </div>

      <Card title="Installation troubleshooting" className="mt-4">
        <div className="grid gap-3 px-5 py-4 text-xs leading-relaxed text-muted sm:grid-cols-2">
          <p>
            <span className="font-medium text-ink">Command not found?</span> Use{" "}
            <code className="app-mono">pnpm cli -- &lt;command&gt;</code> from the repository root;
            the npm package is not published yet.
          </p>
          <p>
            <span className="font-medium text-ink">401 on sync?</span> The token is scoped to one
            project and must be supplied as{" "}
            <code className="app-mono">PROOFSTACK_PROJECT_TOKEN</code>.
          </p>
          <p>
            <span className="font-medium text-ink">API unreachable?</span> Set{" "}
            <code className="app-mono">VITE_API_URL</code> for the dashboard and{" "}
            <code className="app-mono">PROOFSTACK_API_URL</code> for the CLI.
          </p>
          <p>
            <span className="font-medium text-ink">No run appears?</span>{" "}
            <code className="app-mono">test</code> is local; <code className="app-mono">sync</code>{" "}
            is the explicit upload step.
          </p>
        </div>
      </Card>
    </>
  );
}
