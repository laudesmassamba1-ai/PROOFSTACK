import { ArrowRight, Check, Copy, ExternalLink, KeyRound, Terminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Card, Empty, ErrorState, Loading, StatusBadge } from "../../components/app/ui.js";\nimport { EnhancedCard } from "../../components/common/EnhancedCard.js";
import { CliPreview } from "../../components/marketing/CliPreview.js";
import { useI18n } from "../../i18n/index.js";
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
    titleKey: "ws.cli.install",
    bodyKey: "ws.cli.step.install.body",
    command: "pnpm cli -- init",
  },
  {
    titleKey: "ws.cli.configure",
    bodyKey: "ws.cli.step.configure.body",
    command: "pnpm cli -- doctor\npnpm cli -- validate",
  },
  {
    titleKey: "ws.cli.prove",
    bodyKey: "ws.cli.step.prove.body",
    command: "pnpm cli -- test --module world,flow,exit\npnpm cli -- sync",
  },
] as const;

const CLI_FACTS = ["ws.cli.what.1", "ws.cli.what.2", "ws.cli.what.3", "ws.cli.what.4"] as const;

export function Cli() {
  const { workspaceId } = useSession();
  const { t } = useI18n();
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
  if (!projects) return <Loading label={t("ws.cli.checking")} />;

  const latest = [...projects]
    .filter((project) => project.lastRunAt)
    .sort((a, b) => (a.lastRunAt ?? "").localeCompare(b.lastRunAt ?? ""))
    .at(-1);

  return (
    <>
      <PageHeader
        eyebrow={t("ws.cli.eyebrow")}
        title={t("ws.cli.title")}
        description={t("ws.cli.description")}
        actions={
          <Link to="/docs" className="app-btn">
            <Terminal size={14} /> {t("ws.cli.docs")}
          </Link>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card title={t("ws.cli.connection")} description={t("ws.cli.connection.body")}>
          {projects.length === 0 ? (
            <Empty
              title={t("ws.cli.noProject")}
              body={t("ws.cli.noProject.body")}
              action={
                <Link to="/app/projects" className="app-btn app-btn-primary">
                  {t("ws.cli.create")} <ArrowRight size={14} />
                </Link>
              }
            />
          ) : (
            <div className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {latest ? t("ws.cli.lastUpload", { project: latest.name }) : t("ws.cli.noRun")}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    {latest?.lastRunAt
                      ? t("ws.cli.lastUpload.body", { time: relativeTime(latest.lastRunAt) })
                      : t("ws.cli.noRun.body")}
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
                  <KeyRound size={13} className="text-primary" /> {t("ws.cli.token")}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t("ws.cli.token.body")}</p>
                <Link
                  to={latest ? `/app/projects/${latest.id}` : "/app/projects"}
                  className="app-btn mt-3"
                >
                  {t("ws.cli.token.open")} <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          )}
        </Card>

        <Card title={t("ws.cli.what")} description={t("ws.cli.what.body")}>
          <ul className="space-y-3 px-5 py-4">
            {CLI_FACTS.map((key) => (
              <li key={key} className="flex gap-2.5 text-xs leading-relaxed text-muted">
                <Check size={14} className="mt-0.5 shrink-0 text-success" />
                {t(key)}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {STEPS.map((step, index) => (
          <Card key={step.titleKey} title={`0${index + 1} · ${t(step.titleKey)}`}>
            <div className="px-5 py-4">
              <p className="text-xs leading-relaxed text-muted">{t(step.bodyKey)}</p>
              <div className="mt-3 flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius)] bg-surface-alt px-3 py-2 app-mono whitespace-pre-wrap">
                  {step.command}
                </pre>
                <button
                  type="button"
                  className="app-btn px-2"
                  onClick={() => void copy(step.command)}
                  aria-label={t("ws.cli.copy", { title: t(step.titleKey) })}
                >
                  <Copy size={13} />
                </button>
              </div>
              {copied === step.command ? (
                <p className="mt-1 text-[0.7rem] text-success">{t("ws.cli.copied")}</p>
              ) : null}
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-4">
        <CliPreview />
        <p className="mt-2 text-[0.7rem] text-muted">{t("ws.cli.static")}</p>
      </div>

      <Card title={t("ws.cli.trouble.title")} className="mt-4">
        <div className="grid gap-3 px-5 py-4 text-xs leading-relaxed text-muted sm:grid-cols-2">
          <p>
            <span className="font-medium text-ink">{t("ws.cli.trouble.command.title")}</span>{" "}
            {t("ws.cli.trouble.command.body")}{" "}
            <code className="app-mono">pnpm cli -- &lt;command&gt;</code>
          </p>
          <p>
            <span className="font-medium text-ink">{t("ws.cli.trouble.sync.title")}</span>{" "}
            {t("ws.cli.trouble.sync.body")}{" "}
            <code className="app-mono">PROOFSTACK_PROJECT_TOKEN</code>.
          </p>
          <p>
            <span className="font-medium text-ink">{t("ws.cli.trouble.api.title")}</span>{" "}
            {t("ws.cli.trouble.api.body")} <code className="app-mono">VITE_API_URL</code>{" "}
            {t("ws.cli.trouble.api.body2")} <code className="app-mono">PROOFSTACK_API_URL</code>{" "}
            {t("ws.cli.trouble.api.body3")}
          </p>
          <p>
            <span className="font-medium text-ink">{t("ws.cli.trouble.upload.title")}</span>{" "}
            <code className="app-mono">test</code> {t("ws.cli.trouble.upload.body")}{" "}
            <code className="app-mono">sync</code> {t("ws.cli.trouble.upload.body2")}
          </p>
        </div>
      </Card>
    </>
  );
}
