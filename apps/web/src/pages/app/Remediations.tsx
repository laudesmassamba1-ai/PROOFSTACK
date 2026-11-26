import { ArrowUpRight, ClipboardList, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Empty, ErrorState, Loading } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { formatDate, relativeTime } from "../../lib/format.js";
import {
  REMEDIATION_OUTCOME_LABEL,
  REMEDIATION_STATUS_LABEL,
  REMEDIATION_STATUS_ORDER,
} from "../../lib/remediationText.js";
import { useSession } from "../../lib/session.js";

/**
 * The remediation queue.
 *
 * A workspace fixes defects in batches, not one finding at a time: this screen answers
 * "what is open, who owns it, what is the next concrete step, and what did the last
 * measurement say". It reads the same records the finding panel writes — no third
 * source of truth — and a remediation only reaches "vérifiée" through a later analysis.
 */

interface Step {
  step: string;
  at: string;
  by?: string;
  evidence?: string;
}

interface Remediation {
  id: string;
  analysisId: string;
  findingKey: string;
  module: string;
  controlId: string;
  title: string;
  status: string;
  severity: string;
  priority: string;
  cause: string;
  owner: string | null;
  dueAt: string | null;
  steps: Step[];
  nextStep: string | null;
  verificationOutcome: string | null;
  verificationAnalysisId: string | null;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
  verifiedAt: string | null;
}

interface PageBody<T> {
  items: T[];
  total: number;
}

const TONE: Record<string, string> = {
  proposed: "text-accent",
  approved: "text-accent",
  applied: "text-warning",
  verified: "text-success",
  failed: "text-danger",
  dismissed: "text-muted",
};

const STEP_LABEL: Record<string, { fr: string; en: string }> = {
  read_finding: { fr: "lire le constat", en: "read the finding" },
  verify_evidence: { fr: "vérifier la preuve", en: "verify the evidence" },
  gather_context: { fr: "rassembler le contexte", en: "gather context" },
  prepare_fix: { fr: "préparer la correction", en: "prepare the fix" },
  explain: { fr: "expliquer la correction", en: "explain the fix" },
  example: { fr: "montrer un exemple", en: "show an example" },
  preview: { fr: "prévisualiser l'effet", en: "preview the effect" },
  authorize: { fr: "autoriser l'application", en: "authorize the change" },
  apply: { fr: "appliquer", en: "apply" },
  rerun_control: { fr: "re-mesurer le contrôle", en: "re-run the control" },
};

function label(map: Record<string, { fr: string; en: string }>, key: string | null, fr: boolean) {
  if (!key) return null;
  return map[key]?.[fr ? "fr" : "en"] ?? key;
}

export function RemediationsPage() {
  const session = useSession();
  const { locale } = useI18n();
  const fr = locale === "fr";
  const [items, setItems] = useState<Remediation[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    if (!session.workspaceId) return;
    setError(null);
    try {
      const body = await apiFetch<{ remediations: PageBody<Remediation> }>(
        `/api/v1/remediations?workspaceId=${encodeURIComponent(session.workspaceId)}&limit=100`
      );
      setItems(body.remediations.items);
      setTotal(body.remediations.total);
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [session.workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of items ?? []) map[item.status] = (map[item.status] ?? 0) + 1;
    return map;
  }, [items]);

  const visible = useMemo(
    () => (items ?? []).filter((item) => filter === "all" || item.status === filter),
    [filter, items]
  );

  if (!session.workspaceId) {
    return (
      <Empty
        title={fr ? "Aucun espace de travail sélectionné" : "No workspace selected"}
        body={
          fr
            ? "Choisis un espace de travail dans l'en-tête pour voir ses corrections."
            : "Pick a workspace in the header to see its remediations."
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title={fr ? "Remédiations" : "Remediations"}
        description={
          fr
            ? "Ce qui reste à corriger, qui s'en occupe, et la dernière mesure qui l'a confirmé — ou pas."
            : "What is left to fix, who owns it, and the last measurement that confirmed it — or did not."
        }
        actions={
          <button type="button" className="app-btn" onClick={() => void load()}>
            <RefreshCw size={14} />
            {fr ? "Rafraîchir" : "Refresh"}
          </button>
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={() => void load()} />
      ) : !items ? (
        <Loading label={fr ? "Chargement des corrections…" : "Loading remediations…"} />
      ) : items.length === 0 ? (
        <Empty
          title={fr ? "Aucune remédiation ouverte" : "No remediation open"}
          body={
            fr
              ? "Ouvre une remédiation depuis un constat : le correctif et la méthode de vérification viennent du contrôle lui-même."
              : "Open a remediation from a finding: the fix and the verification method come from the control itself."
          }
          action={<ClipboardList size={22} className="text-muted" />}
        />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`app-btn app-btn-sm ${filter === "all" ? "app-btn-primary" : ""}`}
              onClick={() => setFilter("all")}
              aria-pressed={filter === "all"}
            >
              {fr ? "Toutes" : "All"} · {total}
            </button>
            {REMEDIATION_STATUS_ORDER.map((status) => {
              const count = counts[status] ?? 0;
              if (count === 0) return null;
              return (
                <button
                  key={status}
                  type="button"
                  className={`app-btn app-btn-sm ${filter === status ? "app-btn-primary" : ""}`}
                  onClick={() => setFilter(status)}
                  aria-pressed={filter === status}
                >
                  {label(REMEDIATION_STATUS_LABEL, status, fr)} · {count}
                </button>
              );
            })}
          </div>

          <div className="mt-4 app-card overflow-hidden">
            <ul className="divide-y divide-line">
              {visible.map((item) => {
                const verified = item.verificationOutcome
                  ? label(REMEDIATION_OUTCOME_LABEL, item.verificationOutcome, fr)
                  : null;
                return (
                  <li key={item.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span
                          className={`text-[0.68rem] font-medium uppercase tracking-wide ${
                            TONE[item.status] ?? "text-muted"
                          }`}
                        >
                          {label(REMEDIATION_STATUS_LABEL, item.status, fr) ?? item.status}
                        </span>
                        <span className="text-[0.68rem] uppercase tracking-wide text-muted">
                          {item.severity} · {item.priority} · {item.module}
                        </span>
                      </div>
                      <span className="text-[0.68rem] text-muted">
                        {fr ? "mise à jour" : "updated"} {relativeTime(item.updatedAt)}
                      </span>
                    </div>

                    <Link
                      to={`/app/analyses?analysis=${encodeURIComponent(item.analysisId)}`}
                      className="mt-1 inline-flex items-center gap-1 text-sm font-medium hover:underline"
                    >
                      {item.title}
                      <ArrowUpRight size={13} className="text-muted" />
                    </Link>

                    <p className="mt-1 text-xs text-muted">
                      {item.controlId}
                      {item.owner ? ` · ${fr ? "responsable" : "owner"} ${item.owner}` : ""}
                      {item.dueAt ? ` · ${fr ? "échéance" : "due"} ${formatDate(item.dueAt)}` : ""}
                    </p>

                    <p className="mt-1 text-xs text-muted">
                      {item.steps.length}/10 {fr ? "étapes" : "steps"}
                      {item.nextStep
                        ? ` · ${fr ? "prochaine" : "next"}: ${label(STEP_LABEL, item.nextStep, fr)}`
                        : ""}
                      {verified ? ` · ${verified}` : ""}
                    </p>

                    {item.status === "verified" && item.verificationAnalysisId ? (
                      <Link
                        to={`/app/analyses?analysis=${encodeURIComponent(item.verificationAnalysisId)}`}
                        className="mt-1 inline-block text-[0.68rem] text-success hover:underline"
                      >
                        {fr ? "voir l'analyse qui a vérifié" : "see the analysis that verified it"}
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
