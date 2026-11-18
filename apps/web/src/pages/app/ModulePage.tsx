import {
  ArrowRight,
  Globe2,
  PackageOpen,
  Route as RouteIcon,
  ShieldAlert,
  Sparkles,
  Terminal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ModuleObject } from "../../components/app/ModuleObjects.js";
import { Empty, ErrorState, Loading, StatusBadge } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { duration, relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";

/**
 * A module workbench.
 *
 * The object is bound to the latest run that contains this module. No locale profile,
 * transaction stage or export format is invented: the API does not supply those here.
 */
const MODULES = {
  world: {
    name: "WORLD",
    icon: Globe2,
    summary: "ws.module.world.summary",
    body: "ws.module.world.body",
    command: "proofcore test --module world",
  },
  flow: {
    name: "FLOW",
    icon: RouteIcon,
    summary: "ws.module.flow.summary",
    body: "ws.module.flow.body",
    command: "proofcore test --module flow",
  },
  exit: {
    name: "EXIT",
    icon: PackageOpen,
    summary: "ws.module.exit.summary",
    body: "ws.module.exit.body",
    command: "proofcore test --module exit",
  },
  fail: {
    name: "FAIL",
    icon: ShieldAlert,
    summary: "ws.module.fail.summary",
    body: "ws.module.fail.body",
    command: "proofcore audit fail <url>",
  },
  clean: {
    name: "CLEAN",
    icon: Sparkles,
    summary: "ws.module.clean.summary",
    body: "ws.module.clean.body",
    command: "proofcore audit clean <url>",
  },
} as const;

type ModuleId = keyof typeof MODULES;

interface ModuleRun {
  id: string;
  projectId: string;
  projectName: string;
  status: string;
  startedAt: string;
  durationMs: number;
  totals: Record<
    string,
    {
      passed: number;
      failed: number;
      warnings: number;
      errors: number;
      skipped: number;
      total: number;
    }
  >;
}

interface Finding {
  id: string;
  title: string;
  projectId: string;
  severity: string;
  code: string | null;
  detectedAt: string;
}

const ZERO = { passed: 0, failed: 0, warnings: 0, errors: 0, skipped: 0, total: 0 };

export function ModulePage() {
  const { module: raw } = useParams();
  const module = (
    raw === "world" || raw === "flow" || raw === "exit" || raw === "fail" || raw === "clean"
      ? raw
      : null
  ) as ModuleId | null;
  const { workspaceId } = useSession();
  const { locale, t } = useI18n();
  const fr = locale === "fr";
  const [runs, setRuns] = useState<ModuleRun[] | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId || !module) return;
    setError(null);
    try {
      const [runBody, findingBody] = await Promise.all([
        apiFetch<{ items: ModuleRun[] }>(`/api/v1/runs?workspaceId=${workspaceId}&limit=50`),
        apiFetch<{ items: Finding[] }>(
          `/api/v1/findings?workspaceId=${workspaceId}&module=${module}`
        ),
      ]);
      setRuns(runBody.items.filter((run) => run.totals[module] !== undefined));
      setFindings(findingBody.items);
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [module, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!module) {
    return (
      <Empty
        title={fr ? "Module inconnu" : "Unknown module"}
        body={
          fr
            ? "PROOFCORE a cinq modules : WORLD, FLOW, EXIT, FAIL et CLEAN."
            : "PROOFCORE has five modules: WORLD, FLOW, EXIT, FAIL and CLEAN."
        }
        tester="lost"
      />
    );
  }

  const meta = MODULES[module];
  const Icon = meta.icon;

  if (error) return <ErrorState error={error} onRetry={() => void load()} />;
  // No workspace selected means the fetch never started. Saying "loading" forever is a
  // lie the user cannot act on; name the real state instead.
  if (!workspaceId) {
    return (
      <Empty title={t("ws.noWorkspace.title")} body={t("ws.noWorkspace.body")} tester="empty" />
    );
  }
  if (!runs)
    return (
      <Loading
        label={fr ? `Chargement de l'activité ${meta.name}…` : `Loading ${meta.name} activity…`}
      />
    );

  const latest = runs[0];
  const latestTotals = latest?.totals[module] ?? ZERO;
  const hasRun = Boolean(latest);

  return (
    <div className={`app-page app-module-page module-${module}`}>
      <section className="app-module-hero">
        <div className="app-module-hero-copy">
          <p className="app-eyebrow">
            {t("ws.module.eyebrow")} / 0{Object.keys(MODULES).indexOf(module) + 1}
          </p>
          <h1 className="app-display app-module-title">{meta.name}</h1>
          <p className="app-support">{t(meta.summary)}</p>
          <p className="app-module-state">
            {hasRun && latest
              ? t("ws.module.state.latest", {
                  module: meta.name,
                  status: latest.status.toLowerCase(),
                  time: relativeTime(latest.startedAt),
                })
              : t("ws.module.state.empty", { module: meta.name })}
          </p>
        </div>
        <div className="app-module-object-stage">
          <ModuleObject
            module={module}
            passed={latestTotals.passed}
            failed={latestTotals.failed}
            total={latestTotals.total}
          />
        </div>
        <div className="app-module-figures">
          <div>
            <span className="app-module-figure">{latestTotals.passed}</span>
            <span className="app-eyebrow">{t("ws.module.passed")}</span>
          </div>
          <div>
            <span className={`app-module-figure ${latestTotals.failed > 0 ? "is-danger" : ""}`}>
              {latestTotals.failed}
            </span>
            <span className="app-eyebrow">{t("ws.module.failed")}</span>
          </div>
          <div>
            <span className="app-module-figure">{latestTotals.skipped}</span>
            <span className="app-eyebrow">{t("ws.module.skipped")}</span>
          </div>
          <div>
            <span className="app-module-figure app-module-figure-small">
              {latestTotals.warnings}
            </span>
            <span className="app-eyebrow">{t("ws.module.warnings")}</span>
          </div>
        </div>
      </section>

      <section className="app-module-intro">
        <div>
          <p className="app-eyebrow">{t("ws.module.what")}</p>
          <p className="app-module-body">{t(meta.body)}</p>
        </div>
        <div className="app-module-run-state">
          <Icon size={16} aria-hidden />
          <span>
            {hasRun && latest
              ? t("ws.module.latestSummary", {
                  passed: latestTotals.passed,
                  failed: latestTotals.failed,
                  skipped: latestTotals.skipped,
                  warnings: latestTotals.warnings,
                })
              : t("ws.module.latestNone")}
          </span>
          {latest ? <StatusBadge status={latest.status} /> : null}
        </div>
      </section>

      <div className="app-module-body-grid">
        <section className="app-workbench" aria-labelledby="module-runs-title">
          <header className="app-workbench-head">
            <div>
              <p className="app-eyebrow">02 / {t("ws.module.runs")}</p>
              <h2 id="module-runs-title" className="app-workbench-title">
                {t("ws.module.runs")}
              </h2>
              <p>{t("ws.module.runs.body")}</p>
            </div>
            <span className="app-count-mark">{runs.length}</span>
          </header>
          {runs.length === 0 ? (
            <Empty
              title={`${meta.name} has not run yet`}
              body={t(meta.body)}
              tester="working"
              action={
                <Link to="/app/projects" className="app-btn">
                  {t("ws.module.configure")} <ArrowRight size={13} />
                </Link>
              }
            />
          ) : (
            <div className="app-table-wrap">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>{t("ws.module.project")}</th>
                    <th>{t("ws.module.status")}</th>
                    <th>{t("ws.module.started")}</th>
                    <th>{t("ws.module.duration")}</th>
                    <th>{t("ws.module.passFail")}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const totals = run.totals[module] ?? ZERO;
                    return (
                      <tr key={run.id}>
                        <td className="font-medium">{run.projectName}</td>
                        <td>
                          <StatusBadge status={run.status} />
                        </td>
                        <td className="text-muted">{relativeTime(run.startedAt)}</td>
                        <td className="text-muted">{duration(run.durationMs)}</td>
                        <td className="tabular-nums">
                          {totals.passed} / {totals.failed}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="app-module-side">
          <section className="app-command-sheet">
            <p className="app-eyebrow">03 / {t("ws.module.command")}</p>
            <h2>{t("ws.module.command")}</h2>
            <pre>
              <code>{meta.command}</code>
            </pre>
            <p>{t("ws.module.command.body")}</p>
            <Link to="/app/projects" className="app-btn">
              <Terminal size={14} /> {t("ws.module.projects")}
            </Link>
          </section>

          <section
            className="app-workbench app-findings-workbench"
            aria-labelledby="module-findings-title"
          >
            <header className="app-workbench-head">
              <div>
                <p className="app-eyebrow">04 / {t("ws.module.findings")}</p>
                <h2 id="module-findings-title" className="app-workbench-title">
                  {t("ws.module.findings")}
                </h2>
              </div>
              <span className="app-count-mark">{findings.length}</span>
            </header>
            {findings.length === 0 ? (
              <Empty
                title={t("ws.module.findings")}
                body={t("ws.module.findings.empty")}
                tester={false}
              />
            ) : (
              <ul className="app-failure-list">
                {findings.slice(0, 8).map((finding) => (
                  <li key={finding.id}>
                    <div className="app-finding-static">
                      <span className="app-failure-glyph" aria-hidden>
                        ×
                      </span>
                      <span className="min-w-0">
                        <span className="app-failure-title">{finding.title}</span>
                        <span className="app-failure-meta">
                          <span className="app-mono">{finding.code ?? "—"}</span> ·{" "}
                          {relativeTime(finding.detectedAt)}
                        </span>
                      </span>
                      <span className="app-badge app-badge-danger">
                        {finding.severity.toLowerCase()}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
