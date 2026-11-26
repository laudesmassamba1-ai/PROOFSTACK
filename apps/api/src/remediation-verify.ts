import { verificationOutcome } from "@proofcore/core";
import { findingsForAnalysis } from "./findings.js";
import { HttpError } from "./http/errors.js";
import type { Services } from "./http/services.js";
import type { RemediationRecord } from "./store/app-store.js";

/**
 * Confirming a fix with a second measurement.
 *
 * This lives outside the HTTP route because the assistant needs the exact same rule: a
 * remediation is verified by a later analysis that re-measured the same control, never by
 * a status a caller sets. Extracting it means the tool cannot drift from the endpoint.
 *
 * `inconclusive` is a refusal, not a success: the remediation is left in its current
 * status and the caller is told why. The record is written first so the attempt stays
 * visible in the history.
 */

export interface RemediationVerification {
  remediation: RemediationRecord;
  outcome: "verified" | "still_failing" | "inconclusive";
  reason: string;
}

export async function verifyRemediationWithAnalysis(input: {
  services: Services;
  workspaceId: string;
  remediationId: string;
  analysisId: string;
}): Promise<RemediationVerification> {
  const { services, workspaceId, remediationId, analysisId } = input;
  const current = await services.store.getRemediation(workspaceId, remediationId);
  if (!current) throw new HttpError(404, "remediation_not_found", "Remediation not found.");
  if (current.analysisId === analysisId) {
    throw new HttpError(
      400,
      "verification_requires_new_analysis",
      "The analysis that produced the finding cannot verify it."
    );
  }
  const analysis = await services.store.getAnalysis(workspaceId, analysisId);
  if (!analysis) {
    throw new HttpError(404, "analysis_not_found", "Verification analysis not found.");
  }
  const loaded = await findingsForAnalysis(services, analysis);
  const finding = loaded.findings.find((item) => item.key === current.findingKey);
  const verdict = verificationOutcome(finding);
  const now = services.clock().toISOString();
  const nextStatus =
    verdict.outcome === "verified"
      ? "verified"
      : verdict.outcome === "still_failing"
        ? "failed"
        : current.status;
  const updated = await services.store.updateRemediation({
    workspaceId,
    id: current.id,
    patch: {
      status: nextStatus,
      verificationAnalysisId: analysisId,
      verificationOutcome: verdict.outcome,
      ...(verdict.outcome === "verified" ? { verifiedAt: now } : {}),
    },
    expected: [current.status],
  });
  if (!updated) {
    throw new HttpError(
      409,
      "remediation_status_conflict",
      "The remediation changed while verifying."
    );
  }
  if (verdict.outcome === "inconclusive") {
    throw new HttpError(409, "verification_inconclusive", verdict.reason, {
      remediationId: updated.id,
      verificationOutcome: verdict.outcome,
    });
  }
  return { remediation: updated, outcome: verdict.outcome, reason: verdict.reason };
}
