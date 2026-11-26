import type { Finding, Priority, Severity } from "./findings.js";

/**
 * Remediation: from a finding to a fix that is proven, not claimed.
 *
 * The chain exists because "fixed" is the easiest thing to say and the hardest to show.
 * Every step is recorded, the fix is previewed before it is applied, applying requires an
 * explicit authorization, and the only way to reach "verified" is a later analysis that
 * re-measured the same control and passed it. Nothing here trusts a checkbox.
 */

export const REMEDIATION_STATUSES = [
  "proposed",
  "approved",
  "applied",
  "verified",
  "failed",
  "dismissed",
] as const;
export type RemediationStatus = (typeof REMEDIATION_STATUSES)[number];

export const TERMINAL_REMEDIATION_STATUSES: readonly RemediationStatus[] = [
  "verified",
  "failed",
  "dismissed",
];

export function isTerminalRemediation(status: RemediationStatus): boolean {
  return TERMINAL_REMEDIATION_STATUSES.includes(status);
}

const TRANSITIONS: Record<RemediationStatus, readonly RemediationStatus[]> = {
  proposed: ["approved", "dismissed"],
  approved: ["applied", "dismissed"],
  applied: ["verified", "failed", "dismissed"],
  verified: [],
  failed: ["proposed"],
  dismissed: ["proposed"],
};

/**
 * True when a remediation may move from one state to another.
 *
 * Terminal states are final. A failed verification may be retried by proposing the fix
 * again, which is a new attempt on the same remediation, not a rewrite of history.
 */
export function canTransitionRemediation(from: RemediationStatus, to: RemediationStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

/**
 * The ten steps of the chain.
 *
 * The order is the contract: evidence is verified before a fix is prepared, a fix is
 * explained and previewed before it is applied, and the control is re-run before anything
 * is called verified.
 */
export const REMEDIATION_STEPS = [
  "read_finding",
  "verify_evidence",
  "gather_context",
  "prepare_fix",
  "explain",
  "example",
  "preview",
  "authorize",
  "apply",
  "rerun_control",
] as const;
export type RemediationStep = (typeof REMEDIATION_STEPS)[number];

export const REMEDIATION_STEP_LABELS: Record<RemediationStep, { fr: string; en: string }> = {
  read_finding: { fr: "Lire le constat", en: "Read the finding" },
  verify_evidence: { fr: "Vérifier la preuve", en: "Verify the evidence" },
  gather_context: { fr: "Rassembler le contexte", en: "Gather context" },
  prepare_fix: { fr: "Préparer la correction", en: "Prepare the fix" },
  explain: { fr: "Expliquer la correction", en: "Explain the fix" },
  example: { fr: "Montrer un exemple", en: "Show an example" },
  preview: { fr: "Prévisualiser l'effet", en: "Preview the effect" },
  authorize: { fr: "Autoriser l'application", en: "Authorize the change" },
  apply: { fr: "Appliquer", en: "Apply" },
  rerun_control: { fr: "Re-mesurer le contrôle", en: "Re-run the control" },
};

export interface RemediationStepRecord {
  step: RemediationStep;
  at: string;
  /** Who did it, when a person authorized or applied. */
  by?: string;
  /** The proof of the step: a diff hash, a preview id, a verifying analysis. */
  evidence?: string;
}

/**
 * Append a step, refusing to skip ahead.
 *
 * Doing the work out of order is how a "preview" gets manufactured after the fact, so the
 * engine only accepts the next step. Re-sending the current step is a no-op, which keeps
 * retries idempotent.
 */
export function advanceRemediation(
  steps: readonly RemediationStepRecord[],
  step: RemediationStep,
  context: { at: string; by?: string; evidence?: string }
): RemediationStepRecord[] {
  const last = steps.at(-1)?.step;
  if (last === step) return [...steps];
  const expected = last
    ? REMEDIATION_STEPS[REMEDIATION_STEPS.indexOf(last) + 1]
    : REMEDIATION_STEPS[0];
  if (step !== expected) {
    throw new Error(
      "Remediation step " +
        step +
        " cannot follow " +
        (last ?? "nothing") +
        "; expected " +
        (expected ?? "none")
    );
  }
  return [
    ...steps,
    {
      step,
      at: context.at,
      ...(context.by ? { by: context.by } : {}),
      ...(context.evidence ? { evidence: context.evidence } : {}),
    },
  ];
}

export function nextRemediationStep(
  steps: readonly RemediationStepRecord[]
): RemediationStep | null {
  const last = steps.at(-1)?.step;
  if (!last) return REMEDIATION_STEPS[0];
  const index = REMEDIATION_STEPS.indexOf(last);
  return REMEDIATION_STEPS[index + 1] ?? null;
}

/** The verdict a verification analysis gives for a remediation. */
export type VerificationOutcome = "verified" | "still_failing" | "inconclusive";

/**
 * Read a later analysis' verdict on the same finding.
 *
 * Only a PASSED status on the same key verifies. A missing finding is inconclusive: the
 * control may not have run, and a check that did not run cannot close a remediation.
 *
 * The caller resolves the finding by key, so this function cannot accidentally verify a
 * different control that happens to share a title.
 */
export function verificationOutcome(after: Finding | undefined): {
  outcome: VerificationOutcome;
  reason: string;
} {
  if (!after) {
    return {
      outcome: "inconclusive",
      reason: "La seconde analyse n'a pas mesuré ce contrôle : impossible de conclure.",
    };
  }
  if (after.status === "PASSED") {
    return { outcome: "verified", reason: "Le contrôle re-mesuré est conforme." };
  }
  if (after.status === "FAILED" || after.status === "WARNING") {
    return {
      outcome: "still_failing",
      reason: "Le contrôle re-mesuré échoue encore : " + after.explanation.fact,
    };
  }
  return {
    outcome: "inconclusive",
    reason: "Le contrôle re-mesuré est " + after.status + ", ce qui ne prouve pas la correction.",
  };
}

export interface RemediationSeed {
  analysisId: string;
  findingKey: string;
  module: string;
  controlId: string;
  title: string;
  severity: Severity;
  priority: Priority;
  cause: string;
  steps: RemediationStepRecord[];
  fix: string;
  verification: string;
  proof: string;
}

/**
 * Seed a remediation from a finding, with the fix and the verification already written.
 *
 * The first three steps are true the moment the remediation exists: the finding was read,
 * its evidence is the stored observation, and the context is the analysis it came from.
 */
export function seedRemediation(finding: Finding, at: string): RemediationSeed {
  const steps: RemediationStepRecord[] = [
    { step: "read_finding", at, evidence: finding.analysisId },
    { step: "verify_evidence", at, evidence: finding.evidence.method },
    { step: "gather_context", at, evidence: finding.url ?? finding.analysisId },
  ];
  return {
    analysisId: finding.analysisId,
    findingKey: finding.key,
    module: finding.module,
    controlId: finding.controlId,
    title: finding.title,
    severity: finding.severity,
    priority: finding.priority,
    cause: finding.cause,
    steps,
    fix: finding.explanation.fix,
    verification: finding.explanation.verification,
    proof: finding.explanation.confidence,
  };
}
