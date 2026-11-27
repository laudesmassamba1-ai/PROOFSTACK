import {
  controlFor,
  type Finding,
  nextRemediationStep,
  REMEDIATION_STEP_LABELS,
  REMEDIATION_STEPS,
  type RemediationStep,
} from "@proofcore/core";
import { prepareCodePatch } from "./code-patch.js";
import { findingsForAnalysis } from "./findings.js";
import type { Services } from "./http/services.js";

/**
 * A complete remediation plan, assembled from the finding and the control registry.
 *
 * The assistant could read a finding and write plausible advice, but "complete" here
 * means grounded: every step cites the analysis, the measured evidence or the registry's
 * documented fix and verification. Code excerpts come from the project's uploaded files,
 * ranked by the same locator `prepare_code_patch` uses.
 *
 * Nothing is written and no remediation is opened: `open_remediation` is the write, and
 * only a later analysis can call the fix verified. A finding that is not a defect
 * (PASSED, SKIPPED, NOT_APPLICABLE…) is refused rather than turned into busywork.
 */

const ACTIONABLE_STATUSES = new Set(["FAILED", "WARNING"]);
const MAX_CODE_CANDIDATES = 3;

export interface RemediationPlanInput {
  analysisId: string;
  findingKey: string;
  sourceId?: string;
}

interface PlanStep {
  step: RemediationStep;
  label: { fr: string; en: string };
  state: "done" | "next" | "pending";
  action: string;
  evidence: string;
}

export interface RemediationPlan {
  ok: true;
  analysisId: string;
  findingKey: string;
  finding: {
    module: string;
    controlId: string;
    title: string;
    status: string;
    severity: string;
    priority: string;
    cause: string;
    confidence: string;
    url: string | null;
    evidence: { method: string; observed: string; expected: string | null };
  };
  control: {
    id: string;
    module: string;
    risk: string;
    complexity: string;
    method: string;
    result: string;
    consequence: string;
    fix: string;
    verify: string;
    examples: { stack: string; code: string }[];
  } | null;
  plan: {
    title: string;
    severity: string;
    priority: string;
    cause: string;
    confidence: string;
    fix: string;
    verification: string;
    doneWhen: string;
    nextStep: RemediationStep;
    steps: PlanStep[];
    risks: string | null;
    complexity: string | null;
    examples: { stack: string; code: string }[];
  };
  code: {
    candidates: {
      sourceId: string;
      sourceName: string;
      path: string;
      language: string | null;
      line: number | null;
      matches: { line: number; excerpt: string }[];
    }[];
    note: string;
  };
  existingRemediation: {
    id: string;
    status: string;
    nextStep: RemediationStep | null;
  } | null;
  complete: boolean;
  missing: string[];
  writes: false;
  next: string;
}

export type RemediationPlanResult =
  | RemediationPlan
  | {
      ok: false;
      error:
        | "analysis_not_found"
        | "finding_not_found"
        | "finding_not_actionable"
        | "analysisId and findingKey are required";
      message: string;
      status?: string;
    };

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildSteps(input: {
  finding: Finding;
  target: string;
  fix: string;
  verification: string;
  consequence: string;
  examples: { stack: string; code: string }[];
  firstCandidate: { path: string; line: number | null } | null;
}): PlanStep[] {
  const { finding, target, fix, verification, consequence, examples, firstCandidate } = input;
  const method = text(finding.evidence.method) || "not recorded";
  const observed = text(finding.evidence.observed) || "not recorded";
  const expected = text(finding.evidence.expected);
  const observedText = expected
    ? `observed ${observed}; expected ${expected}`
    : `observed ${observed}`;

  const actions: Record<RemediationStep, { action: string; evidence: string }> = {
    read_finding: {
      action: `Read ${finding.title} (${finding.controlId}) in ${finding.analysisId}.`,
      evidence: finding.analysisId,
    },
    verify_evidence: {
      action: `Re-read the evidence: ${method}, ${observedText}.`,
      evidence: `${method} · ${observed}`,
    },
    gather_context: {
      action: `Gather the context at ${finding.url ?? target}.`,
      evidence: finding.url ?? target,
    },
    prepare_fix: {
      action: fix || "No documented fix: establish the cause before changing anything.",
      evidence: fix ? "control registry" : "missing",
    },
    explain: {
      action: `Explain the cause (${finding.cause}) and the consequence: ${consequence}`,
      evidence: finding.cause,
    },
    example: {
      action: examples[0]
        ? `Use the ${examples[0].stack} example from the registry.`
        : "Show a before/after that matches the stack; the registry has no example.",
      evidence: examples[0]?.stack ?? "none",
    },
    preview: {
      action: firstCandidate
        ? `Preview the change to ${firstCandidate.path}${firstCandidate.line ? `:${firstCandidate.line}` : ""}; show the exact diff before applying it.`
        : "Preview the exact change and its scope before applying anything.",
      evidence: firstCandidate?.path ?? "no code candidate",
    },
    authorize: {
      action: "A workspace member with write access approves this specific change.",
      evidence: "approval required",
    },
    apply: {
      action: "Apply the approved change. This tool writes nothing.",
      evidence: "not applied",
    },
    rerun_control: {
      action: verification
        ? `${verification} Then re-analyse ${target}; only a PASSED ${finding.controlId} verifies.`
        : `Re-analyse ${target}; only a PASSED ${finding.controlId} verifies.`,
      evidence: "later analysis of the same target",
    },
  };

  return REMEDIATION_STEPS.map((step, index) => ({
    step,
    label: { ...REMEDIATION_STEP_LABELS[step] },
    state: index < 3 ? "done" : index === 3 ? "next" : "pending",
    ...actions[step],
  }));
}

export async function generateRemediationPlan(input: {
  services: Services;
  workspaceId: string;
  args: RemediationPlanInput;
}): Promise<RemediationPlanResult> {
  const { services, workspaceId, args } = input;
  if (!args.analysisId || !args.findingKey) {
    return {
      ok: false,
      error: "analysisId and findingKey are required",
      message: "Pass the analysis id and the finding key from analysis_findings.",
    };
  }

  const analysis = await services.store.getAnalysis(workspaceId, args.analysisId);
  if (!analysis) {
    return {
      ok: false,
      error: "analysis_not_found",
      message: "Call list_analyses to get a real id.",
    };
  }
  const loaded = await findingsForAnalysis(services, analysis);
  const finding = loaded.findings.find((item) => item.key === args.findingKey);
  if (!finding) {
    return {
      ok: false,
      error: "finding_not_found",
      message: "Call analysis_findings with this analysisId to get a real key.",
    };
  }
  if (!ACTIONABLE_STATUSES.has(finding.status)) {
    return {
      ok: false,
      error: "finding_not_actionable",
      message: `This finding is ${finding.status}; a remediation applies to a FAILED or WARNING finding.`,
      status: finding.status,
    };
  }

  const control = controlFor(finding.module as never, finding.controlId);
  const fix = text(control?.en.fix) || text(finding.explanation.fix);
  const verification = text(control?.en.verify) || text(finding.explanation.verification);
  const consequence =
    text(control?.en.consequence) || text(finding.explanation.impact) || "not recorded";
  const examples = (control?.fixes ?? []).slice(0, 3).map((example) => ({
    stack: example.stack,
    code: example.code,
  }));

  // Code candidates are useful, not required: a header or a DNS record may live outside
  // the uploaded files. A missing source store is reported, never treated as "no issue".
  let candidates: RemediationPlan["code"]["candidates"] = [];
  let codeNote =
    "No uploaded file contains the finding's terms; ask which file implements this control.";
  if (!services.projectKnowledge) {
    codeNote =
      "No project source store is configured (NEON_DATABASE_URL); no code excerpt is available.";
  } else {
    const located = await prepareCodePatch({
      services,
      workspaceId,
      args: {
        analysisId: args.analysisId,
        findingKey: args.findingKey,
        ...(args.sourceId ? { sourceId: args.sourceId } : {}),
      },
    });
    if (!located.ok) {
      codeNote = located.hint ?? located.message ?? located.error;
    } else if (located.mode === "locate") {
      candidates = located.candidates.slice(0, MAX_CODE_CANDIDATES).map((candidate) => ({
        sourceId: candidate.sourceId,
        sourceName: candidate.sourceName,
        path: candidate.path,
        language: candidate.language,
        line: candidate.matches[0]?.line ?? null,
        matches: candidate.matches.map((match) => ({
          line: match.line,
          excerpt: match.excerpt,
        })),
      }));
      codeNote =
        candidates.length > 0
          ? "Read the excerpt, then call prepare_code_patch with path, before and after to get a verified diff."
          : (located.hint ?? codeNote);
    }
  }

  const record = await services.store.findRemediationByFinding(
    workspaceId,
    args.analysisId,
    args.findingKey
  );
  const steps = buildSteps({
    finding,
    target: analysis.target,
    fix,
    verification,
    consequence,
    examples,
    firstCandidate: candidates[0] ? { path: candidates[0].path, line: candidates[0].line } : null,
  });

  const missing: string[] = [];
  if (!control) missing.push("control_registry_entry");
  if (!fix) missing.push("fix");
  if (!verification) missing.push("verification");
  if (!text(finding.evidence.method)) missing.push("evidence_method");
  if (!text(finding.evidence.observed)) missing.push("observed_value");

  return {
    ok: true,
    analysisId: args.analysisId,
    findingKey: finding.key,
    finding: {
      module: finding.module,
      controlId: finding.controlId,
      title: finding.title,
      status: finding.status,
      severity: finding.severity,
      priority: finding.priority,
      cause: finding.cause,
      confidence: finding.confidence,
      url: finding.url,
      evidence: {
        method: finding.evidence.method,
        observed: finding.evidence.observed,
        expected: finding.evidence.expected,
      },
    },
    control: control
      ? {
          id: control.id,
          module: control.module,
          risk: control.risk,
          complexity: control.complexity,
          method: control.method,
          result: control.result,
          consequence: control.en.consequence,
          fix: control.en.fix,
          verify: control.en.verify,
          examples: examples.map((example) => ({ ...example })),
        }
      : null,
    plan: {
      title: finding.title,
      severity: finding.severity,
      priority: finding.priority,
      cause: finding.cause,
      confidence: finding.confidence,
      fix,
      verification,
      doneWhen: `A later analysis of ${analysis.target} reports ${finding.controlId} as PASSED${
        text(finding.evidence.expected) ? ` (expected ${text(finding.evidence.expected)})` : ""
      }.`,
      nextStep: "prepare_fix",
      steps,
      risks: control ? control.en.consequence : consequence,
      complexity: control ? control.complexity : null,
      examples: examples.map((example) => ({ ...example })),
    },
    code: { candidates, note: codeNote },
    existingRemediation: record
      ? {
          id: record.id,
          status: record.status,
          nextStep: nextRemediationStep(record.steps),
        }
      : null,
    complete: missing.length === 0,
    missing,
    writes: false,
    next: "Present this plan with the evidence and the exact change. Opening a remediation is a separate write the user must ask for; only a later analysis verifies the fix.",
  };
}
