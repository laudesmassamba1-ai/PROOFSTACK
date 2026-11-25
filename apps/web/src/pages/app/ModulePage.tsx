import {
  ArrowRight,
  BadgeCheck,
  Brain,
  Globe2,
  PackageOpen,
  Route as RouteIcon,
  ScanLine,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Empty, ErrorState, Loading, StatusBadge } from "../../components/app/ui.js";
import { ModuleGlyph } from "../../components/brand/GlyphArt.js";
import { useI18n } from "../../i18n/index.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { duration, relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";
import { useTheme } from "../../lib/theme.js";

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
    icon: BadgeCheck,
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

interface PageAuditSummary {
  id: string;
  url: string;
  finalUrl: string;
  status: number;
  durationMs: number;
  worstVerdict: string;
  failed: number;
  warnings: number;
  ownership: string;
  redacted: boolean;
  projectId: string | null;
  createdAt: string;
}

interface PageAuditFinding {
  id: string;
  module: string;
  status: string;
  observed: string;
  why: string;
}

interface PageAuditModuleSummary {
  module: string;
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
  score: number;
  verdict: string;
}

interface PageAuditDetail {
  result: {
    findings?: PageAuditFinding[];
    modules?: PageAuditModuleSummary[];
  };
}

function auditBadgeStatus(verdict: string): string {
  if (verdict === "fail") return "FAILED";
  if (verdict === "warnings") return "PARTIAL";
  if (verdict === "pass") return "COMPLETED";
  return "NOT_MEASURED";
}

const ZERO = { passed: 0, failed: 0, warnings: 0, errors: 0, skipped: 0, total: 0 };

export function ModulePage() {
  const { module: raw } = useParams();
  const requested = (raw ?? "").toLowerCase();
  const module = (
    requested === "world" ||
    requested === "flow" ||
    requested === "exit" ||
    requested === "fail" ||
    requested === "clean"
      ? requested
      : null
  ) as ModuleId | null;
  const { workspaceId } = useSession();
  const { locale, t } = useI18n();
  const fr = locale === "fr";
  const { theme } = useTheme();
  const [runs, setRuns] = useState<ModuleRun[] | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [pageAudits, setPageAudits] = useState<PageAuditSummary[]>([]);
  const [pageAuditDetail, setPageAuditDetail] = useState<PageAuditDetail | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId || !module) return;
    setError(null);
    try {
      const isPageAuditModule = module === "fail" || module === "clean";
      const [runBody, findingBody, auditBody] = await Promise.all([
        apiFetch<{ items: ModuleRun[] }>(`/api/v1/runs?workspaceId=${workspaceId}&limit=50`),
        apiFetch<{ items: Finding[] }>(
          `/api/v1/findings?workspaceId=${workspaceId}&module=${module}`
        ),
        isPageAuditModule
          ? apiFetch<{ items: PageAuditSummary[] }>(
              `/api/v1/audits?workspaceId=${workspaceId}&limit=50`
            )
          : Promise.resolve({ items: [] as PageAuditSummary[] }),
      ]);
      setRuns(runBody.items.filter((run) => run.totals[module] !== undefined));
      setFindings(findingBody.items);
      setPageAudits(auditBody.items);

      const latestAudit = auditBody.items[0];
      if (isPageAuditModule && latestAudit) {
        try {
          const detail = await apiFetch<PageAuditDetail>(
            `/api/v1/audits/${latestAudit.id}?workspaceId=${workspaceId}`
          );
          setPageAuditDetail(detail);
        } catch {
          // The summary remains useful even when the detail payload is unavailable.
          setPageAuditDetail(null);
        }
      } else {
        setPageAuditDetail(null);
      }
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
  const isPageAuditModule = module === "fail" || module === "clean";
  const latestPageAudit = isPageAuditModule ? (pageAudits[0] ?? null) : null;
  const pageModuleSummary =
    pageAuditDetail?.result.modules?.find((item) => item.module === module) ?? null;
  const pageModuleFindings =
    pageAuditDetail?.result.findings?.filter((item) => item.module === module) ?? [];
  const visiblePageFindings = pageModuleFindings.filter((item) => item.status !== "PASS");
  const hasRun = Boolean(latest);
  const hasPageAudit = Boolean(latestPageAudit);
  const projectForCodeAudit = latest?.projectId ?? latestPageAudit?.projectId ?? null;

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
              : hasPageAudit && latestPageAudit
                ? fr
                  ? `Dernier scan de page · ${relativeTime(latestPageAudit.createdAt)}`
                  : `Latest page scan · ${relativeTime(latestPageAudit.createdAt)}`
                : t("ws.module.state.empty", { module: meta.name })}
          </p>
        </div>
        <div className="app-module-object-stage">
          <ModuleGlyph
            kind={module as "world" | "flow" | "exit" | "fail" | "clean"}
            tone={theme === "dark" ? "dark" : "ink"}
          />
        </div>
        <div className="app-module-figures">
          {isPageAuditModule ? (
            <>
              <div>
                <span className="app-module-figure">{pageModuleSummary?.score ?? "—"}</span>
                <span className="app-eyebrow">{fr ? "Score / 100" : "Score / 100"}</span>
              </div>
              <div>
                <span
                  className={`app-module-figure ${(pageModuleSummary?.failed ?? 0) > 0 ? "is-danger" : ""}`}
                >
                  {pageModuleSummary?.failed ?? "—"}
                </span>
                <span className="app-eyebrow">{t("ws.module.failed")}</span>
              </div>
              <div>
                <span className="app-module-figure">{pageModuleSummary?.skipped ?? "—"}</span>
                <span className="app-eyebrow">{t("ws.module.skipped")}</span>
              </div>
              <div>
                <span className="app-module-figure app-module-figure-small">
                  {pageModuleSummary?.warnings ?? "—"}
                </span>
                <span className="app-eyebrow">{t("ws.module.warnings")}</span>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
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
              : hasPageAudit && pageModuleSummary
                ? fr
                  ? `${pageModuleSummary.passed} réussi(s) · ${pageModuleSummary.failed} échec(s) · ${pageModuleSummary.warnings} avertissement(s)`
                  : `${pageModuleSummary.passed} passed · ${pageModuleSummary.failed} failed · ${pageModuleSummary.warnings} warnings`
                : hasPageAudit
                  ? fr
                    ? "Scan enregistré · détails partiels"
                    : "Scan saved · partial details"
                  : t("ws.module.latestNone")}
          </span>
          {latest ? (
            <StatusBadge status={latest.status} />
          ) : hasPageAudit ? (
            <StatusBadge
              status={auditBadgeStatus(
                pageModuleSummary?.verdict ?? latestPageAudit?.worstVerdict ?? ""
              )}
            />
          ) : null}
        </div>
      </section>

      {/* The module says what was measured. The AI reads the code and says where and how
          to change it. That link is the difference between a dashboard and a fix. */}
      <section className="mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-black/10 px-4 py-3">
        <Brain size={18} className="shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1 break-words">
          <p className="text-sm font-medium break-words">
            {fr ? "Passer du verdict à la correction" : "From verdict to correction"}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted break-words">
            {fr
              ? `L'IA lit les fichiers du projet, cite la ligne et propose le changement. Le résultat ${meta.name} reste la mesure de référence.`
              : `AI reads the project files, names the line and proposes the change. The ${meta.name} result stays the measurement of record.`}
          </p>
        </div>
        <Link
          to={projectForCodeAudit ? `/app/projects/${projectForCodeAudit}?tab=ai` : "/app/projects"}
          className="app-btn app-btn-primary app-btn-sm"
        >
          <Brain size={13} />
          {fr ? "Auditer le code avec l'IA" : "Audit the code with AI"}
          <ArrowRight size={13} />
        </Link>
      </section>

      <div className="app-module-body-grid">
        {isPageAuditModule ? (
          <section className="app-workbench" aria-labelledby="module-page-audits-title">
            <header className="app-workbench-head">
              <div>
                <p className="app-eyebrow">
                  02 / {fr ? "HISTORIQUE DES SCANS" : "PAGE SCAN HISTORY"}
                </p>
                <h2 id="module-page-audits-title" className="app-workbench-title">
                  {fr ? "Audits de pages" : "Page audits"}
                </h2>
                <p>
                  {fr
                    ? "Les audits FAIL/CLEAN sont conservés dans l'historique des scans de pages, séparément des exécutions du moteur."
                    : "FAIL/CLEAN audits are stored in page-scan history, separately from engine runs."}
                </p>
              </div>
              <span className="app-count-mark">{pageAudits.length}</span>
            </header>
            {pageAudits.length === 0 ? (
              <Empty
                title={fr ? "Aucun scan de page pour le moment" : "No page scan yet"}
                body={t(meta.body)}
                tester="working"
                action={
                  <Link to="/app/scan" className="app-btn app-btn-primary">
                    <ScanLine size={13} /> {fr ? "Scanner une adresse" : "Scan an address"}
                  </Link>
                }
              />
            ) : (
              <div className="app-table-wrap">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th>{fr ? "Adresse" : "Address"}</th>
                      <th>{fr ? "Verdict du scan" : "Scan verdict"}</th>
                      <th>{fr ? "Date" : "Date"}</th>
                      <th>HTTP</th>
                      <th>{fr ? "Constats globaux" : "All-check findings"}</th>
                      <th>{fr ? "Rapport" : "Report"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageAudits.map((audit) => (
                      <tr key={audit.id}>
                        <td className="max-w-[240px] truncate font-medium">{audit.url}</td>
                        <td>
                          <StatusBadge status={auditBadgeStatus(audit.worstVerdict)} />
                        </td>
                        <td className="text-muted">{relativeTime(audit.createdAt)}</td>
                        <td className="tabular-nums">{audit.status}</td>
                        <td className="tabular-nums">
                          {audit.failed} / {audit.warnings}
                        </td>
                        <td>
                          <Link
                            to={`/app/scan?audit=${encodeURIComponent(audit.id)}`}
                            className="app-text-link"
                            >
                            {fr ? "Ouvrir" : "Open"} <ArrowRight size={12} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted">
                  {fr
                    ? "Les nombres de constats affichés ici couvrent l'ensemble du scan (FAIL + CLEAN). Les chiffres du module ci-dessus sont filtrés sur ce module."
                    : "Finding counts here cover the whole scan (FAIL + CLEAN). The figures above are filtered to this module."}
                </p>
              </div>
            )}
          </section>
        ) : (
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
                  // Two ways in, and the one that needs no install comes first: a module that
                  // cannot be started from the browser reads as documentation, not as a tool.
                  <div className="flex flex-wrap gap-2">
                    <Link to="/app/scan" className="app-btn app-btn-primary">
                      <ScanLine size={13} /> {t("ws.module.runNow")}
                    </Link>
                    <Link to="/app/projects" className="app-btn">
                      {t("ws.module.configure")} <ArrowRight size={13} />
                    </Link>
                  </div>
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
        )}

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
              <span className="app-count-mark">
                {isPageAuditModule ? visiblePageFindings.length : findings.length}
              </span>
            </header>
            {isPageAuditModule ? (
              visiblePageFindings.length === 0 ? (
                <Empty
                  title={fr ? "Aucun constat pour ce module" : "No finding for this module"}
                  body={
                    hasPageAudit
                      ? fr
                        ? "Le dernier scan n'a pas relevé d'échec ou d'avertissement dans ce module."
                        : "The latest scan found no failure or warning in this module."
                      : t("ws.module.findings.empty")
                  }
                  tester={false}
                />
              ) : (
                <ul className="app-failure-list">
                  {visiblePageFindings.slice(0, 8).map((finding) => (
                    <li key={finding.id}>
                      <div className="app-finding-static">
                        <span className="app-failure-glyph" aria-hidden>
                          {finding.status === "FAIL" ? "×" : "!"}
                        </span>
                        <span className="min-w-0">
                          <span className="app-failure-title">{finding.why}</span>
                          <span className="app-failure-meta">
                            <span className="app-mono">{finding.id}</span> · {finding.observed}
                          </span>
                        </span>
                        <span
                          className={`app-badge ${finding.status === "FAIL" ? "app-badge-danger" : "app-badge-warning"}`}
                        >
                          {finding.status}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : findings.length === 0 ? (
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
