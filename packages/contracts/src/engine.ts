import { z } from "zod";
import {
  environmentKindSchema,
  moduleIdSchema,
  moduleIdStringSchema,
  runStatusSchema,
  severitySchema,
  testStatusSchema,
} from "./statuses.js";

/**
 * Execution-engine entities. The same shapes are produced by the CLI locally,
 * accepted by the API, and rendered by the dashboard — one report architecture.
 */

export const isoInstantSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/,
    "must be an ISO-8601 instant"
  );

export const assertionSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    /** Machine-readable expectation, e.g. "value.length <= 256". */
    expected: z.unknown(),
    actual: z.unknown(),
    status: testStatusSchema,
    /** Field / path the assertion targeted, when the check is about data. */
    target: z.string().optional(),
  })
  .strict();
export type Assertion = z.infer<typeof assertionSchema>;

export const evidenceSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["log", "step", "screenshot", "diff", "checksum", "metadata", "payload"]),
    label: z.string().min(1),
    /**
     * Small inline evidence only. Large artefacts (traces, videos, datasets) stay
     * in CI artifacts or local storage; `ref` points at them. D1 is not a blob store.
     */
    inline: z.string().max(64_000).optional(),
    ref: z
      .object({
        storage: z.enum(["local", "ci-artifact", "object-store"]),
        path: z.string().min(1),
        sha256: z.string().length(64).optional(),
        bytes: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    mediaType: z.string().optional(),
    createdAt: isoInstantSchema,
  })
  .strict();
export type Evidence = z.infer<typeof evidenceSchema>;

export const reproductionSchema = z
  .object({
    summary: z.string().min(1),
    /** Exact CLI invocation that reproduces the finding. */
    command: z.string().min(1),
    configPath: z.string().optional(),
    fixtureIds: z.array(z.string()).default([]),
    environment: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();
export type Reproduction = z.infer<typeof reproductionSchema>;

export const findingSchema = z
  .object({
    id: z.string().min(1),
    testCaseId: z.string().min(1),
    module: moduleIdSchema,
    title: z.string().min(1),
    detail: z.string().min(1),
    severity: severitySchema,
    status: testStatusSchema,
    /** Stable discriminator so the same defect across runs is one issue, not ten. */
    fingerprint: z.string().min(1),
    locale: z.string().optional(),
    country: z.string().length(2).optional(),
    field: z.string().optional(),
    failure: z
      .object({
        message: z.string(),
        category: z.string(),
        code: z.string(),
        expected: z.unknown().optional(),
        actual: z.unknown().optional(),
      })
      .strict()
      .optional(),
    reproduction: reproductionSchema,
    evidenceIds: z.array(z.string()).default([]),
    startedAt: isoInstantSchema,
    endedAt: isoInstantSchema,
    durationMs: z.number().int().nonnegative(),
  })
  .strict();
export type Finding = z.infer<typeof findingSchema>;

export const testCaseResultSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    module: moduleIdSchema,
    description: z.string().min(1),
    status: testStatusSchema,
    severity: severitySchema,
    startedAt: isoInstantSchema,
    endedAt: isoInstantSchema,
    durationMs: z.number().int().nonnegative(),
    environment: environmentKindSchema,
    /** Commit or version under test, when the caller provided one. */
    revision: z.string().optional(),
    profile: z.string().optional(),
    suiteId: z.string(),
    assertions: z.array(assertionSchema).default([]),
    findingIds: z.array(z.string()).default([]),
    evidence: z.array(evidenceSchema).default([]),
    failure: z
      .object({
        message: z.string(),
        category: z.string(),
        code: z.string(),
        stack: z.string().optional(),
        retryable: z.boolean().optional(),
      })
      .strict()
      .optional(),
    reproduction: reproductionSchema.optional(),
    logs: z
      .array(
        z
          .object({
            level: z.enum(["debug", "info", "warn", "error"]),
            message: z.string(),
            time: isoInstantSchema,
          })
          .strict()
      )
      .default([]),
    attempts: z.number().int().positive().default(1),
    skippedReason: z.string().optional(),
  })
  .strict();
export type TestCaseResult = z.infer<typeof testCaseResultSchema>;

export const moduleRunSchema = z
  .object({
    module: moduleIdSchema,
    status: runStatusSchema,
    startedAt: isoInstantSchema,
    endedAt: isoInstantSchema,
    durationMs: z.number().int().nonnegative(),
    totals: z
      .object({
        total: z.number().int().nonnegative(),
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        warnings: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
        errors: z.number().int().nonnegative(),
      })
      .strict(),
    cases: z.array(testCaseResultSchema),
  })
  .strict();
export type ModuleRun = z.infer<typeof moduleRunSchema>;

export const testRunSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    workspaceId: z.string().min(1),
    environment: environmentKindSchema,
    revision: z.string().optional(),
    status: runStatusSchema,
    startedAt: isoInstantSchema,
    endedAt: isoInstantSchema,
    durationMs: z.number().int().nonnegative(),
    /** Which modules were asked for, in order. */
    modules: z.array(moduleIdSchema),
    moduleRuns: z.array(moduleRunSchema),
    findings: z.array(findingSchema),
    /** Client-generated key so a retried upload does not double count usage. */
    idempotencyKey: z.string().optional(),
    cliVersion: z.string().optional(),
    engineVersion: z.string().optional(),
    host: z
      .object({
        platform: z.string(),
        nodeVersion: z.string(),
        ci: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type TestRun = z.infer<typeof testRunSchema>;

export const moduleTotalsSchema = z
  .object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  })
  .strict();
export type ModuleTotals = z.infer<typeof moduleTotalsSchema>;

export const reportSummarySchema = z
  .object({
    runId: z.string(),
    status: runStatusSchema,
    /** Only modules that actually ran appear here. */
    totals: z.record(moduleIdStringSchema, moduleTotalsSchema.optional()).default({}),
    topSeverities: z.array(severitySchema),
    durationMs: z.number(),
  })
  .strict();
export type ReportSummary = z.infer<typeof reportSummarySchema>;

export const REPORT_FORMATS = ["json", "junit", "html", "text"] as const;
export const reportFormatSchema = z.enum(REPORT_FORMATS);
export type ReportFormat = z.infer<typeof reportFormatSchema>;
