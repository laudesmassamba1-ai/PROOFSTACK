import { Activity, Download, GitCompare, MessageSquare, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { FindingRemediation, type Remediation } from "../../components/app/FindingRemediation.js";
import { Empty, ErrorState, Loading } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { errorText } from "../../lib/errorText.js";
import { formatDate, relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";

/**
 * The Analysis Center.
 *
 * Every row is a stored analysis, whichever surface produced it (Web, CLI, AI, Desktop,
 * API). The page reads the canonical resource and nothing else, so a scan started from a
 * chat and a scan started from the toolbar appear in the same list with the same ids.
 *
 * Two details are deliberately visible rather than hidden behind a score:
 * the coverage (modules measured, modules skipped, pages read) and the findings the
 * later analysis never re-read when two runs are compared.
 */

interface Skip {
  module: string;
  reason: string;
}

interface Coverage {
  requestedModules: string[];
  applicableModules: string[];
  measuredModules: string[];
  skipped: Skip[];
  pages?: { discovered: number; scanned: number };
  ratio: number;
  label: "none" | "partial" | "complete";
}

interface Analysis {
  id: string;
  reportId?: string | null;
  source: string;
  targetType: string;
  target: string;
  scope: string;
  status: string;
  engine: string;
  engineVersion: string;
  environment: string;
  coverage: Coverage;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  createdAt: string;
}

interface Finding {
  key: string;
  analysisId: string;
  module: string;
  controlId: string;
  title: string;
  status: string;
  severity: string;
  priority: string;
  cause: string;
  confidence: string;
  url: string | null;
  explanation: {
    fact: string;
    meaning: string;
    impact: string;
    scope: string;
    verification: string;
    fix: string;
  };
  evidence: { method: string; observed: string; expected: string | null };
}

interface PageBody<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

const STATUS_TONE: Record<string, string> = {
  queued: "text-muted",
  running: "text-accent",
  completed: "text-success",
  partial: "text-warning",
  failed: "text-danger",
  cancelled: "text-muted",
};

const FINDING_TONE: Record<string, string> = {
  PASSED: "text-success",
  FAILED: "text-danger",
  WARNING: "text-warning",
  SKIPPED: "text-muted",
  BLOCKED: "text-warning",
  ERROR: "text-danger",
  NOT_APPLICABLE: "text-muted",
  NOT_CONFIGURED: "text-muted",
};

interface Comparison {
  comparable: boolean;
  reasons: string[];
  counts: Record<string, number>;
  appeared: Finding[];
  resolved: Finding[];
  persisting: Finding[];
  worsened: Finding[];
  improved: Finding[];
  unmeasured: Finding[];
  measured: { before: string[]; after: string[] };
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`text-[0.68rem] uppercase tracking-wide ${STATUS_TONE[status] ?? "text-muted"}`}
    >
      {status}
    </span>
  );
}

function CoverageLine({ coverage, fr }: { coverage: Coverage; fr: boolean }) {
  const pages = coverage.pages;
  return (
    <p className="mt-1 text-[0.7rem] text-muted">
      {fr ? "couverture" : "coverage"} {Math.round(coverage.ratio * 100)}% ·{" "}
      {coverage.measuredModules.length}/{coverage.applicableModules.length}{" "}
      {fr ? "modules mesurés" : "modules measured"}
      {pages ? ` · ${pages.scanned}/${pages.discovered} ${fr ? "pages relues" : "pages read"}` : ""}
      {coverage.skipped.length > 0
        ? ` · ${coverage.skipped.length} ${fr ? "ignoré(s)" : "skipped"}`
        : ""}
    </p>
  );
}

export function AnalysesPage() {
  const session = useSession();
  const [search] = useSearchParams();
  const requested = search.get("analysis");
  const { locale } = useI18n();
  const fr = locale === "fr";
  const [list, setList] = useState<Analysis[] | null>(null);
  const [listError, setListError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [findings, setFindings] = useState<{ items: Finding[]; total: number } | null>(null);
  const [findingsError, setFindingsError] = useState<ApiError | null>(null);
  const [against, setAgainst] = useState<string>("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [compareError, setCompareError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [remediations, setRemediations] = useState<Record<string, Remediation>>({});

  const loadList = useCallback(async () => {
    if (!session.workspaceId) return;
    setListError(null);
    try {
      const body = await apiFetch<PageBody<Analysis>>(
        `/api/v1/analyses?workspaceId=${encodeURIComponent(session.workspaceId)}&limit=50`
      );
      setList(body.items);
      // A link from the remediation queue names the analysis to open; without it the
      // page keeps whatever was already selected, then falls back to the newest.
      if (requested && body.items.some((item) => item.id === requested)) {
        setSelected(requested);
      } else {
        setSelected((current) => current ?? body.items[0]?.id ?? null);
      }
    } catch (caught) {
      setListError(caught as ApiError);
    }
  }, [requested, session.workspaceId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!session.workspaceId) return;
    let cancelled = false;
    apiFetch<{ remediations: PageBody<Remediation> }>(
      `/api/v1/remediations?workspaceId=${encodeURIComponent(session.workspaceId)}&limit=100`
    )
      .then((body) => {
        if (cancelled) return;
        const next: Record<string, Remediation> = {};
        for (const item of body.remediations.items) {
          next[`${item.analysisId}:${item.findingKey}`] = item;
        }
        setRemediations(next);
      })
      .catch(() => {
        // A remediation read failure must not hide the findings themselves.
      });
    return () => {
      cancelled = true;
    };
  }, [session.workspaceId]);

  useEffect(() => {
    if (!session.workspaceId || !selected) return;
    let cancelled = false;
    setFindings(null);
    setFindingsError(null);
    apiFetch<{ findings: PageBody<Finding> }>(
      `/api/v1/analyses/${encodeURIComponent(selected)}/findings?workspaceId=${encodeURIComponent(session.workspaceId)}&limit=100`
    )
      .then((body) => {
        if (!cancelled) setFindings({ items: body.findings.items, total: body.findings.total });
      })
      .catch((caught: ApiError) => {
        if (!cancelled) setFindingsError(caught);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, session.workspaceId]);

  const compare = useCallback(async () => {
    if (!session.workspaceId || !selected || !against) return;
    setBusy(true);
    setCompareError(null);
    try {
      const body = await apiFetch<{ comparison: Comparison }>(
        `/api/v1/analyses/compare?workspaceId=${encodeURIComponent(session.workspaceId)}&base=${encodeURIComponent(selected)}&target=${encodeURIComponent(against)}`
      );
      setComparison(body.comparison);
    } catch (caught) {
      setCompareError(caught as ApiError);
      setComparison(null);
    } finally {
      setBusy(false);
    }
  }, [against, selected, session.workspaceId]);

  const current = useMemo(
    () => list?.find((item) => item.id === selected) ?? null,
    [list, selected]
  );
  const downloadReport = useCallback(
    async (format: "html" | "json") => {
      if (!session.workspaceId || !selected) return;
      setBusy(true);
      setCompareError(null);
      try {
        const response = await fetch(
          `/api/v1/analyses/${encodeURIComponent(selected)}/report?workspaceId=${encodeURIComponent(session.workspaceId)}&format=${format}`,
          { credentials: "include" }
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(body?.error?.message ?? `Export failed (${response.status})`);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `proofcore-analysis-${selected}.${format}`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      } catch (caught) {
        setCompareError({
          code: "report_export_failed",
          message: caught instanceof Error ? caught.message : String(caught),
        } as ApiError);
      } finally {
        setBusy(false);
      }
    },
    [selected, session.workspaceId]
  );
  const others = useMemo(
    () => (list ?? []).filter((item) => item.id !== selected),
    [list, selected]
  );

  if (!session.workspaceId) {
    return (
      <Empty
        title={fr ? "Aucun espace de travail sélectionné" : "No workspace selected"}
        body={
          fr
            ? "Choisissez un espace de travail dans l'en-tête pour voir ses analyses."
            : "Pick a workspace in the header to see its analyses."
        }
      />
    );
  }

  const workspaceId = session.workspaceId;

  return (
    <>
      <PageHeader
        title={fr ? "Centre d'analyse" : "Analysis Center"}
        description={
          fr
            ? "Toutes les analyses de cet espace, quelle que soit leur origine : Web, CLI, assistant, Desktop ou API."
            : "Every analysis in this workspace, whatever started it: Web, CLI, assistant, Desktop or API."
        }
        actions={
          <button type="button" className="app-btn" onClick={() => void loadList()}>
            <RefreshCw size={14} />
            {fr ? "Rafraîchir" : "Refresh"}
          </button>
        }
      />

      {listError ? (
        <ErrorState error={listError} onRetry={() => void loadList()} />
      ) : !list ? (
        <Loading label={fr ? "Chargement des analyses…" : "Loading analyses…"} />
      ) : list.length === 0 ? (
        <Empty
          title={fr ? "Aucune analyse" : "No analysis"}
          body={
            fr
              ? "Lancez un scan depuis Analyser, ou exécutez proofcore analyse. Les résultats apparaîtront ici."
              : "Start a scan from Scan, or run proofcore analyse. Results will appear here."
          }
          action={<Activity size={22} className="text-muted" />}
        />
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <section aria-label={fr ? "Analyses" : "Analyses"} className="app-card overflow-hidden">
            <ul className="divide-y divide-line">
              {list.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(item.id);
                      setComparison(null);
                      setAgainst("");
                    }}
                    aria-current={item.id === selected}
                    className={`w-full px-4 py-3 text-left transition-colors hover:bg-surface-alt ${
                      item.id === selected ? "bg-surface-alt" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <StatusPill status={item.status} />
                      <span className="text-[0.68rem] text-muted">
                        {relativeTime(item.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium" title={item.target}>
                      {item.target}
                    </p>
                    <p className="text-[0.7rem] text-muted">
                      {item.source} · {item.targetType} · {item.scope}
                    </p>
                    <CoverageLine coverage={item.coverage} fr={fr} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-live="polite" className="min-w-0">
            {!current ? (
              <Loading label={fr ? "Chargement…" : "Loading…"} />
            ) : (
              <>
                <div className="app-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="eyebrow">{fr ? "analyse" : "analysis"}</p>
                      <h2 className="mt-1 break-all text-lg font-medium">{current.target}</h2>
                      <p className="mt-1 text-xs text-muted">
                        {current.engine} {current.engineVersion} · {current.environment} ·{" "}
                        {formatDate(current.startedAt)}
                        {current.durationMs !== null
                          ? ` · ${Math.round(current.durationMs / 1000)} s`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <StatusPill status={current.status} />
                      <Link
                        className="app-btn"
                        to={`/app/ai?context=analysis&analysis=${encodeURIComponent(current.id)}&label=${encodeURIComponent(current.target)}`}
                      >
                        <MessageSquare size={14} />
                        {fr ? "Demander à l’assistant" : "Ask the assistant"}
                      </Link>
                      <button
                        type="button"
                        className="app-btn"
                        onClick={() => void downloadReport("html")}
                        disabled={busy}
                        aria-label={
                          fr
                            ? "Télécharger le rapport HTML imprimable"
                            : "Download the printable HTML report"
                        }
                      >
                        <Download size={14} /> {fr ? "Rapport HTML" : "HTML report"}
                      </button>
                      <button
                        type="button"
                        className="app-btn"
                        onClick={() => void downloadReport("json")}
                        disabled={busy}
                      >
                        JSON
                      </button>
                      <p className="w-full text-right text-[0.68rem] text-muted">{current.id}</p>
                    </div>
                  </div>
                  <CoverageLine coverage={current.coverage} fr={fr} />
                  {current.coverage.skipped.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-xs text-muted">
                      {current.coverage.skipped.map((skip) => (
                        <li key={skip.module}>
                          <span className="font-medium">{skip.module}</span>: {skip.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="app-card mt-4 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">
                      {fr ? "Comparer à une autre analyse" : "Compare with another analysis"}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor="compare-against">
                        {fr ? "Analyse à comparer" : "Analysis to compare against"}
                      </label>
                      <select
                        id="compare-against"
                        className="app-shell-pill app-shell-select"
                        value={against}
                        onChange={(event) => setAgainst(event.target.value)}
                      >
                        <option value="">{fr ? "Choisir…" : "Choose…"}</option>
                        {others.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.target} · {item.source} · {formatDate(item.createdAt)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="app-btn app-btn-primary"
                        disabled={busy || !against}
                        onClick={() => void compare()}
                      >
                        <GitCompare size={14} />
                        {fr ? "Comparer" : "Compare"}
                      </button>
                    </div>
                  </div>

                  {compareError ? (
                    <p className="mt-3 text-xs text-danger" role="alert">
                      {errorText(compareError, fr)}
                    </p>
                  ) : comparison ? (
                    <div className="mt-3">
                      {!comparison.comparable ? (
                        <p className="text-xs text-warning" role="status">
                          {fr ? "Non comparable" : "Not comparable"}
                          {comparison.reasons.length > 0
                            ? ` : ${comparison.reasons.join(" ")}`
                            : ""}
                        </p>
                      ) : (
                        <>
                          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                            {(
                              [
                                ["appeared", fr ? "nouveaux" : "new", "text-danger"],
                                ["resolved", fr ? "corrigés" : "resolved", "text-success"],
                                ["persisting", fr ? "toujours là" : "still there", "text-warning"],
                                ["worsened", fr ? "aggravés" : "worse", "text-danger"],
                                ["improved", fr ? "atténués" : "improved", "text-success"],
                                ["unmeasured", fr ? "non relus" : "not re-read", "text-muted"],
                              ] as const
                            ).map(([key, label, tone]) => (
                              <div
                                key={key}
                                className="rounded-[var(--radius)] bg-surface-alt px-3 py-2"
                              >
                                <dt className="text-[0.68rem] uppercase tracking-wide text-muted">
                                  {label}
                                </dt>
                                <dd className={`text-base font-medium ${tone}`}>
                                  {comparison.counts[key] ?? 0}
                                </dd>
                              </div>
                            ))}
                          </dl>
                          {comparison.reasons.length > 0 ? (
                            <p className="mt-2 text-xs text-muted">
                              {comparison.reasons.join(" ")}
                            </p>
                          ) : null}
                          {(
                            [
                              { key: "appeared", items: comparison.appeared },
                              { key: "resolved", items: comparison.resolved },
                              { key: "persisting", items: comparison.persisting },
                              { key: "unmeasured", items: comparison.unmeasured },
                            ] as const
                          ).map(({ key, items }) =>
                            items.length === 0 ? null : (
                              <p key={key} className="mt-2 text-xs text-muted">
                                <span className="font-medium">{key}:</span>{" "}
                                {items.map((item) => item.controlId).join(" · ")}
                              </p>
                            )
                          )}
                        </>
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="app-card mt-4 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-line px-5 py-3">
                    <h3 className="text-sm font-medium">{fr ? "Constats" : "Findings"}</h3>
                    {findings ? (
                      <span className="text-xs text-muted">
                        {findings.total} {fr ? "au total" : "total"}
                      </span>
                    ) : null}
                  </div>
                  {findingsError ? (
                    <div className="p-5">
                      <ErrorState error={findingsError} />
                    </div>
                  ) : !findings ? (
                    <Loading label={fr ? "Chargement des constats…" : "Loading findings…"} />
                  ) : findings.items.length === 0 ? (
                    <div className="p-5">
                      <Empty
                        title={fr ? "Aucun constat" : "No findings"}
                        body={
                          fr
                            ? "Cette analyse n'a pas encore de constat exploitable. Un résultat partiel ne vaut pas un feu vert."
                            : "This analysis has no usable finding yet. A partial result is not a green light."
                        }
                      />
                    </div>
                  ) : (
                    <ul className="divide-y divide-line">
                      {findings.items.map((finding) => (
                        <li key={finding.key} className="px-5 py-4">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span
                              className={`text-[0.68rem] font-medium uppercase tracking-wide ${
                                FINDING_TONE[finding.status] ?? "text-muted"
                              }`}
                            >
                              {finding.status}
                            </span>
                            <span className="text-[0.68rem] uppercase tracking-wide text-muted">
                              {finding.severity} · {finding.priority} · {finding.module}
                            </span>
                          </div>
                          <p className="mt-1 text-sm font-medium">{finding.title}</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted">
                            {finding.explanation.fact}
                          </p>
                          <details className="mt-2 text-xs">
                            <summary className="cursor-pointer text-muted">
                              {fr ? "Comprendre et corriger" : "Understand and fix"}
                            </summary>
                            <dl className="mt-2 space-y-1.5 text-muted">
                              <div>
                                <dt className="inline font-medium text-ink">
                                  {fr ? "Ce que ça veut dire : " : "What it means: "}
                                </dt>
                                <dd className="inline">{finding.explanation.meaning}</dd>
                              </div>
                              <div>
                                <dt className="inline font-medium text-ink">
                                  {fr ? "Conséquence : " : "Impact: "}
                                </dt>
                                <dd className="inline">{finding.explanation.impact}</dd>
                              </div>
                              <div>
                                <dt className="inline font-medium text-ink">
                                  {fr ? "Preuve : " : "Evidence: "}
                                </dt>
                                <dd className="inline">
                                  {finding.evidence.method} — {finding.evidence.observed}
                                  {finding.evidence.expected
                                    ? ` (${fr ? "attendu" : "expected"}: ${finding.evidence.expected})`
                                    : ""}
                                </dd>
                              </div>
                              <div>
                                <dt className="inline font-medium text-ink">
                                  {fr ? "Correction : " : "Fix: "}
                                </dt>
                                <dd className="inline">{finding.explanation.fix}</dd>
                              </div>
                              <div>
                                <dt className="inline font-medium text-ink">
                                  {fr ? "Vérification : " : "Verification: "}
                                </dt>
                                <dd className="inline">{finding.explanation.verification}</dd>
                              </div>
                            </dl>
                          </details>
                          <Link
                            className="app-btn mt-2"
                            to={`/app/ai?context=finding&analysis=${encodeURIComponent(finding.analysisId)}&finding=${encodeURIComponent(finding.key)}&label=${encodeURIComponent(finding.title)}`}
                          >
                            <MessageSquare size={13} />
                            {fr ? "Expliquer avec l’assistant" : "Explain with the assistant"}
                          </Link>
                          <FindingRemediation
                            workspaceId={workspaceId}
                            analysisId={finding.analysisId}
                            findingKey={finding.key}
                            existing={remediations[`${finding.analysisId}:${finding.key}`] ?? null}
                            candidates={others.map((item) => ({
                              id: item.id,
                              label: `${item.target} · ${item.source} · ${formatDate(item.createdAt)}`,
                            }))}
                            onChange={(next) => {
                              const key = `${finding.analysisId}:${finding.key}`;
                              setRemediations((current) => {
                                const copy = { ...current };
                                if (next) copy[key] = next;
                                else delete copy[key];
                                return copy;
                              });
                            }}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
