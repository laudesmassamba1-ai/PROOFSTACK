import { type Finding, type FindingStatus, findingKey, type Severity } from "./findings.js";

/**
 * Comparing two analyses.
 *
 * The only honest comparison is per control and per page: two overall scores computed
 * from different modules, on a different number of pages, are not a trend. So this
 * function reports what happened to each finding, and refuses to pair findings whose
 * identity is ambiguous (several findings collapsed on the same page, because the run
 * grouped pages). `incomparable` exists for exactly that case: silence would read as
 * "fixed".
 */

const PROBLEM_STATUSES: readonly FindingStatus[] = ["FAILED", "WARNING"];
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export interface FindingSeverityChange {
  before: Finding;
  after: Finding;
}

export interface FindingDiff {
  /** Problems that the later analysis reports and the earlier one did not. */
  added: Finding[];
  /** Problems reported before, measured again and no longer reported. */
  resolved: Finding[];
  /** Problems reported before on a page the later analysis did not measure. */
  unmeasured: Finding[];
  /** Problems on pages the earlier analysis never measured: new coverage, not a regression. */
  uncovered: Finding[];
  /** Problems reported by both, unchanged in severity. */
  persisting: Finding[];
  /** Same problem, higher severity. */
  worsened: FindingSeverityChange[];
  /** Same problem, lower severity. */
  improved: FindingSeverityChange[];
  /** Identities that could not be paired safely, with the reason. */
  incomparable: { identity: string; reason: string }[];
}

function isProblem(finding: Finding): boolean {
  return PROBLEM_STATUSES.includes(finding.status);
}

function indexByIdentity(
  findings: readonly Finding[],
  side: "before" | "after"
): { map: Map<string, Finding>; duplicated: { identity: string; reason: string }[] } {
  const map = new Map<string, Finding>();
  const duplicated: { identity: string; reason: string }[] = [];
  for (const finding of findings) {
    const identity = findingKey(finding.module, finding.controlId, finding.url);
    if (map.has(identity)) {
      duplicated.push({
        identity,
        reason:
          "Plus d'un constat partage cette identité dans l'analyse " +
          side +
          " ; les apparier reviendrait à en inventer un.",
      });
      continue;
    }
    map.set(identity, finding);
  }
  return { map, duplicated };
}

export function diffFindings(before: readonly Finding[], after: readonly Finding[]): FindingDiff {
  const previous = indexByIdentity(before, "before");
  const next = indexByIdentity(after, "after");
  const ambiguous = new Set(
    [...previous.duplicated, ...next.duplicated].map((item) => item.identity)
  );

  const diff: FindingDiff = {
    added: [],
    resolved: [],
    unmeasured: [],
    uncovered: [],
    persisting: [],
    worsened: [],
    improved: [],
    incomparable: [...previous.duplicated, ...next.duplicated].filter(
      (item, index, all) => all.findIndex((other) => other.identity === item.identity) === index
    ),
  };

  const measuredUrls = new Set(
    before.map((finding) => finding.url).filter((url): url is string => url !== null)
  );

  for (const [identity, afterFinding] of next.map) {
    if (ambiguous.has(identity)) continue;
    const beforeFinding = previous.map.get(identity);
    if (!beforeFinding) {
      if (!isProblem(afterFinding)) continue;
      // A page that was never read is new coverage, not a regression: calling it
      // "appeared since last time" would blame a change nobody made.
      if (afterFinding.url !== null && !measuredUrls.has(afterFinding.url)) {
        diff.uncovered.push(afterFinding);
      } else {
        diff.added.push(afterFinding);
      }
      continue;
    }
    const was = isProblem(beforeFinding);
    const is = isProblem(afterFinding);
    if (!was && is) {
      diff.added.push(afterFinding);
      continue;
    }
    if (was && !is) {
      diff.resolved.push(beforeFinding);
      continue;
    }
    if (!was && !is) continue;
    const delta = SEVERITY_RANK[afterFinding.severity] - SEVERITY_RANK[beforeFinding.severity];
    if (delta > 0) diff.worsened.push({ before: beforeFinding, after: afterFinding });
    else if (delta < 0) diff.improved.push({ before: beforeFinding, after: afterFinding });
    else diff.persisting.push(afterFinding);
  }

  for (const [identity, beforeFinding] of previous.map) {
    if (ambiguous.has(identity)) continue;
    if (next.map.has(identity)) continue;
    if (isProblem(beforeFinding)) diff.unmeasured.push(beforeFinding);
  }

  return diff;
}

/**
 * Are two analyses comparable at all?
 *
 * Different control sets make a score comparison meaningless, even when both analyses
 * succeeded. Saying so is the difference between a trend and a coincidence.
 */
export function comparableAnalyses(
  before: { modules: readonly string[] },
  after: { modules: readonly string[] }
): { comparable: boolean; reason?: string } {
  const a = [...new Set(before.modules)].sort().join(",");
  const b = [...new Set(after.modules)].sort().join(",");
  if (a === b) return { comparable: true };
  return {
    comparable: false,
    reason:
      "Les deux analyses ne couvrent pas les mêmes modules (" +
      (a || "aucun") +
      " vs " +
      (b || "aucun") +
      ") ; une différence de score ne mesure pas une amélioration.",
  };
}
