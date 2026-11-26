import {
  canTransitionRemediation,
  isTerminalRemediation,
  REMEDIATION_STEP_LABELS,
  type RemediationStatus,
} from "@proofcore/core";
import { CheckCircle2, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../i18n/index.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { errorText } from "../../lib/errorText.js";

/**
 * The remediation chain, on the finding itself.
 *
 * A finding without a way to close it is an observation, not a product. This panel keeps
 * the four honest facts next to the defect: who owns it, which step is next, what proof
 * each step left, and whether a *later analysis* re-measured the control. "Corrigé" here
 * is never a checkbox: only POST /remediations/:id/verify can produce it, and a missing
 * verdict is shown as inconclusive instead of green.
 */

export interface RemediationStepRecord {
  step: string;
  at: string;
  by?: string;
  evidence?: string;
}

export interface Remediation {
  id: string;
  analysisId: string;
  findingKey: string;
  status: RemediationStatus;
  severity: string;
  priority: string;
  steps: RemediationStepRecord[];
  nextStep: string | null;
  fix: string;
  verification: string;
  proof: string;
  verificationAnalysisId: string | null;
  verificationOutcome: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  workspaceId: string;
  analysisId: string;
  findingKey: string;
  existing: Remediation | null;
  /** Analyses the user can pick as the second measurement. Never the origin analysis. */
  candidates: { id: string; label: string }[];
  onChange: (remediation: Remediation | null) => void;
}

const STATUS_TONE: Record<string, string> = {
  proposed: "text-accent",
  approved: "text-accent",
  applied: "text-warning",
  verified: "text-success",
  failed: "text-danger",
  dismissed: "text-muted",
};

const STATUS_LABEL: Record<string, { fr: string; en: string }> = {
  proposed: { fr: "proposée", en: "proposed" },
  approved: { fr: "approuvée", en: "approved" },
  applied: { fr: "appliquée, à vérifier", en: "applied, to verify" },
  verified: { fr: "vérifiée par une analyse", en: "verified by an analysis" },
  failed: { fr: "échec de vérification", en: "verification failed" },
  dismissed: { fr: "écartée", en: "dismissed" },
};

const OUTCOME_LABEL: Record<string, { fr: string; en: string }> = {
  verified: { fr: "vérifiée par mesure", en: "verified by measurement" },
  still_failing: { fr: "toujours en échec", en: "still failing" },
  inconclusive: { fr: "non concluant", en: "inconclusive" },
};

const NEXT_STATUS: Partial<Record<RemediationStatus, RemediationStatus[]>> = {
  proposed: ["approved", "dismissed"],
  approved: ["applied", "dismissed"],
  // "failed" comes from a measurement, never from a button.
  applied: ["dismissed"],
  failed: ["proposed"],
  dismissed: ["proposed"],
};

function stepLabel(step: string, fr: boolean): string {
  const entry = REMEDIATION_STEP_LABELS[step as keyof typeof REMEDIATION_STEP_LABELS];
  return entry ? entry[fr ? "fr" : "en"] : step;
}

export function FindingRemediation({
  workspaceId,
  analysisId,
  findingKey,
  existing,
  candidates,
  onChange,
}: Props) {
  const { locale } = useI18n();
  const fr = locale === "fr";
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [inconclusive, setInconclusive] = useState<string | null>(null);
  const [verifyWith, setVerifyWith] = useState("");

  async function call(action: string, run: () => Promise<Remediation>) {
    setBusy(action);
    setError(null);
    setInconclusive(null);
    try {
      onChange(await run());
    } catch (caught) {
      const apiError = caught as ApiError;
      if (apiError.code === "verification_inconclusive") {
        setInconclusive(apiError.message);
        // The remediation state did change (the outcome was recorded); reload it so the
        // panel does not keep showing "applied" after a failed or missing measurement.
        const body = await apiFetch<{ remediation: Remediation }>(
          `/api/v1/remediations/${encodeURIComponent(existing?.id ?? "")}?workspaceId=${encodeURIComponent(workspaceId)}`
        );
        onChange(body.remediation);
      } else {
        setError(apiError);
      }
    } finally {
      setBusy(null);
    }
  }

  if (!existing) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="app-btn app-btn-sm"
          disabled={busy !== null}
          onClick={() =>
            void call("create", async () => {
              const body = await apiFetch<{ remediation: Remediation }>("/api/v1/remediations", {
                method: "POST",
                body: { workspaceId, analysisId, findingKey },
              });
              return body.remediation;
            })
          }
        >
          {busy === "create" ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          {fr ? "Ouvrir une remédiation" : "Open a remediation"}
        </button>
        {error ? (
          <span role="alert" className="text-xs text-danger">
            {errorText(error, fr)}
          </span>
        ) : null}
      </div>
    );
  }

  const terminal = isTerminalRemediation(existing.status);
  const moves = (NEXT_STATUS[existing.status] ?? []).filter((status) =>
    canTransitionRemediation(existing.status, status)
  );

  return (
    <div className="mt-2 rounded-[var(--radius)] bg-surface-alt px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`font-medium ${STATUS_TONE[existing.status] ?? "text-muted"}`}>
          {STATUS_LABEL[existing.status]?.[fr ? "fr" : "en"] ?? existing.status}
        </span>
        <span className="text-muted">
          {existing.steps.length}/{Object.keys(REMEDIATION_STEP_LABELS).length}{" "}
          {fr ? "étapes" : "steps"}
        </span>
        {existing.nextStep ? (
          <span className="text-muted">
            · {fr ? "prochaine" : "next"}: {stepLabel(existing.nextStep, fr)}
          </span>
        ) : null}
        {existing.verificationOutcome ? (
          <span className="text-muted">
            ·{" "}
            {OUTCOME_LABEL[existing.verificationOutcome]?.[fr ? "fr" : "en"] ??
              existing.verificationOutcome}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {existing.nextStep && !terminal ? (
          <button
            type="button"
            className="app-btn app-btn-sm"
            disabled={busy !== null}
            onClick={() =>
              void call("step", async () => {
                const body = await apiFetch<{ remediation: Remediation }>(
                  `/api/v1/remediations/${encodeURIComponent(existing.id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
                  {
                    method: "PATCH",
                    body: { advance: { step: existing.nextStep } },
                  }
                );
                return body.remediation;
              })
            }
          >
            {busy === "step" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <CheckCircle2 size={13} />
            )}
            {fr ? "Fait : " : "Done: "}
            {stepLabel(existing.nextStep, fr)}
          </button>
        ) : null}

        {!terminal
          ? moves.map((status) => (
              <button
                key={status}
                type="button"
                className="app-btn app-btn-sm"
                disabled={busy !== null}
                onClick={() =>
                  void call(`status:${status}`, async () => {
                    const body = await apiFetch<{ remediation: Remediation }>(
                      `/api/v1/remediations/${encodeURIComponent(existing.id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
                      { method: "PATCH", body: { status } }
                    );
                    return body.remediation;
                  })
                }
              >
                {STATUS_LABEL[status]?.[fr ? "fr" : "en"] ?? status}
              </button>
            ))
          : null}
      </div>

      {existing.status === "applied" || existing.status === "failed" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`verify-${existing.id}`}>
            {fr ? "Analyse de vérification" : "Verification analysis"}
          </label>
          <select
            id={`verify-${existing.id}`}
            className="app-shell-pill app-shell-select"
            value={verifyWith}
            onChange={(event) => setVerifyWith(event.target.value)}
          >
            <option value="">
              {fr ? "Analyse qui a re-mesuré…" : "Analysis that re-measured…"}
            </option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="app-btn app-btn-sm"
            disabled={busy !== null || !verifyWith}
            onClick={() =>
              void call("verify", async () => {
                const body = await apiFetch<{ remediation: Remediation }>(
                  `/api/v1/remediations/${encodeURIComponent(existing.id)}/verify`,
                  {
                    method: "POST",
                    body: { workspaceId, analysisId: verifyWith },
                  }
                );
                return body.remediation;
              })
            }
          >
            {busy === "verify" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <CheckCircle2 size={13} />
            )}
            {fr ? "Vérifier par mesure" : "Verify by measurement"}
          </button>
        </div>
      ) : null}

      <p className="mt-2 text-[0.68rem] leading-relaxed text-muted">
        {fr ? "Vérification : " : "Verification: "}
        {existing.verification}
      </p>
      {inconclusive ? (
        <p role="status" className="mt-1 text-[0.68rem] text-warning">
          {fr ? "Non concluant : " : "Inconclusive: "}
          {inconclusive}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-[0.68rem] text-danger">
          {errorText(error, fr)}
        </p>
      ) : null}
      <p className="mt-1 text-[0.6rem] text-muted">{existing.id}</p>
    </div>
  );
}
