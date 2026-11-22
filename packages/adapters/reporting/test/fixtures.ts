import type { TestRun } from "@proofcore/contracts";

/**
 * A minimal, contract-valid run: one module, one case, nothing failing.
 *
 * Report tests mutate this rather than hand-writing a run each time, so a schema change
 * breaks one place instead of five.
 */
export function makeRun(): TestRun {
  const at = "2026-01-01T00:00:00.000Z";
  return {
    id: "run_fixture",
    projectId: "prj_fixture",
    workspaceId: "ws_fixture",
    environment: "local",
    status: "COMPLETED",
    startedAt: at,
    endedAt: at,
    durationMs: 10,
    modules: ["world"],
    moduleRuns: [
      {
        module: "world",
        status: "COMPLETED",
        startedAt: at,
        endedAt: at,
        durationMs: 10,
        totals: {
          total: 1,
          passed: 1,
          failed: 0,
          warnings: 0,
          skipped: 0,
          errors: 0,
          blocked: 0,
          notApplicable: 0,
          notConfigured: 0,
        },
        cases: [
          {
            id: "world.identity.accept",
            name: "accepts a name with diacritics",
            module: "world",
            description: "A name that must be accepted.",
            status: "PASSED",
            severity: "HIGH",
            startedAt: at,
            endedAt: at,
            durationMs: 10,
            environment: "local",
            suiteId: "world.suite",
            assertions: [],
            findingIds: [],
            evidence: [],
          },
        ],
      },
    ],
    findings: [],
  };
}
