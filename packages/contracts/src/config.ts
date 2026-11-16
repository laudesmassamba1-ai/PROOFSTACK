import { z } from "zod";
import { moduleIdSchema, environmentKindSchema } from "./statuses.js";

/**
 * One configuration file drives the CLI, the SDK and the cloud-side project
 * record: `proofstack.config.ts` (or `.json`, or `proofstack` in package.json).
 *
 * Safety rules are encoded here rather than left to callers, because the
 * dangerous case (pointing a destructive test at production) must fail at parse
 * time with an actionable message.
 */

export const localeProfileSchema = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[A-Za-z]{4})?-(?:[A-Z]{2}|[0-9]{3})(?:-[A-Za-z0-9]{5,8})?$/, "expected BCP-47 locale like fr-BJ or zh-Hans-CN");

export const worldConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Locale profiles to exercise. Must be a subset of the installed profile set. */
    profiles: z.array(localeProfileSchema).min(1).default(["en-US", "fr-FR", "fr-BJ"]),
    /** Extra/override profile definitions loaded from disk. */
    profileFiles: z.array(z.string()).default([]),
    categories: z
      .array(z.enum(["identity", "phone", "address", "currency", "datetime", "forms", "sorting", "collation"]))
      .default(["identity", "phone", "address", "currency", "datetime"]),
    /** Form descriptors the engine fills in and submits. */
    forms: z
      .array(
        z
          .object({
            id: z.string().min(1),
            name: z.string().min(1),
            /** CSS selector of the <form>. Omit when `fields` are addressed by label. */
            selector: z.string().optional(),
            path: z.string().optional(),
            /** Safe by default: submitting a form is a mutation. */
            submit: z.boolean().default(false),
            fields: z
              .array(
                z
                  .object({
                    /** selector or label, one of them is required */
                    selector: z.string().optional(),
                    label: z.string().optional(),
                    kind: z
                      .enum(["text", "email", "tel", "name", "postal", "address", "select", "date", "number", "currency"])
                      .default("text"),
                    required: z.boolean().default(false),
                    maxLength: z.number().int().positive().optional(),
                    /** Values the product must accept; defaults come from the profile. */
                    fixtures: z.array(z.string()).default([]),
                  })
                  .strict()
                  .refine((f) => Boolean(f.selector || f.label), { message: "field needs selector or label" }),
              )
              .min(1),
          })
          .strict(),
      )
      .default([]),
    /** Reject values the product should accept. Failures here are product bugs. */
    strictRejectionDetection: z.boolean().default(true),
  })
  .strict();
export type WorldConfig = z.infer<typeof worldConfigSchema>;

export const paymentModeSchema = z.enum([
  /** Deterministic provider stub inside the engine. No network, no money. */
  "simulated",
  /** Real provider sandbox credentials (SasPay sk_test_...). */
  "sandbox",
  /** Real charge. Refused for automated runs; see `assertSafeForAutomatedRun`. */
  "live_charge",
]);
export type PaymentMode = z.infer<typeof paymentModeSchema>;

export const flowConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    paymentMode: paymentModeSchema.default("simulated"),
    scenarios: z
      .array(z.enum([
        "checkout_success",
        "checkout_declined",
        "checkout_cancelled",
        "checkout_timeout",
        "webhook_duplicate",
        "webhook_delayed",
        "webhook_out_of_order",
        "webhook_invalid_signature",
        "order_missing_confirmation",
        "order_duplicate",
        "refund_flow",
        "inconsistent_state",
      ]))
      .default(["checkout_success", "checkout_declined", "webhook_duplicate", "webhook_invalid_signature"]),
    journeys: z
      .array(
        z
          .object({
            id: z.string().min(1),
            name: z.string().min(1),
            startUrl: z.string().url().optional(),
            steps: z
              .array(
                z
                  .object({
                    id: z.string().min(1),
                    action: z.enum([
                      "navigate",
                      "click",
                      "fill",
                      "select",
                      "submit",
                      "waitFor",
                      "assertText",
                      "assertUrl",
                      "screenshot",
                      "api",
                    ]),
                    target: z.string().optional(),
                    value: z.string().optional(),
                    timeoutMs: z.number().int().positive().max(120_000).default(15_000),
                    optional: z.boolean().default(false),
                  })
                  .strict(),
              )
              .min(1),
            /** Destructive journeys (real orders) require staging or local. */
            destructive: z.boolean().default(false),
          })
          .strict(),
      )
      .default([]),
    /** Webhook endpoint the engine posts forged/duplicated events to. */
    webhookEndpoint: z.string().url().optional(),
    /** Base URL of the app under test (defaults to project.baseUrl). */
    baseUrl: z.string().url().optional(),
    browser: z
      .object({
        driver: z.enum(["playwright", "none"]).default("playwright"),
        headless: z.boolean().default(true),
        channel: z.string().optional(),
        viewport: z
          .object({ width: z.number().int().positive(), height: z.number().int().positive() })
          .strict()
          .default({ width: 1440, height: 900 }),
      })
      .strict()
      .default({ driver: "playwright", headless: true, viewport: { width: 1440, height: 900 } }),
  })
  .strict();
export type FlowConfig = z.infer<typeof flowConfigSchema>;

export const exitConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    formats: z.array(z.enum(["csv", "json", "zip"])).min(1).default(["json", "csv"]),
    /** Where the export is produced from. Production needs an explicit opt-in. */
    target: z.enum(["synthetic", "staging", "production"]).default("synthetic"),
    /** Endpoint or command that produces the export. */
    exportSource: z
      .object({
        kind: z.enum(["http", "file", "command"]),
        /** http: URL to call; file: path to a local export; command: argv array. */
        value: z.string().min(1),
        headers: z.record(z.string(), z.string()).default({}),
        method: z.enum(["GET", "POST"]).default("GET"),
      })
      .strict()
      .optional(),
    /** Expected schema the export must satisfy (field name -> type). */
    schema: z.record(z.string(), z.enum(["string", "number", "integer", "boolean", "date", "datetime", "id", "money", "nullable"])).default({}),
    relationships: z
      .array(
        z
          .object({
            child: z.string(),
            childField: z.string(),
            parent: z.string(),
            parentField: z.string(),
            required: z.boolean().default(true),
          })
          .strict(),
      )
      .default([]),
    unique: z.array(z.object({ table: z.string(), fields: z.array(z.string()).min(1) }).strict()).default([]),
    /** Round-trip: re-import the export and compare. */
    roundTrip: z
      .object({
        enabled: z.boolean().default(true),
        /** Endpoint/command that imports the export back into a scratch dataset. */
        value: z.string().min(1).optional(),
      })
      .strict()
      .default({ enabled: true }),
    maxRecords: z.number().int().positive().max(1_000_000).default(5_000),
  })
  .strict();
export type ExitConfig = z.infer<typeof exitConfigSchema>;

export const engineConfigSchema = z
  .object({
    parallel: z.number().int().min(1).max(16).default(4),
    timeoutMs: z.number().int().positive().max(1_800_000).default(120_000),
    /** Retries only ever apply to ERROR (harness) outcomes, never to FAILED. */
    retries: z.number().int().min(0).max(5).default(0),
    retryOn: z.array(z.enum(["ERROR", "TIMEOUT"])).default(["ERROR"]),
    seed: z.number().int().default(20260116),
    stopOnCritical: z.boolean().default(false),
  })
  .strict();
export type EngineConfig = z.infer<typeof engineConfigSchema>;

export const syncConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    apiUrl: z.string().url().optional(),
    /** Name of the environment variable holding the project token. Never the token itself. */
    tokenEnvVar: z.string().default("PROOFSTACK_PROJECT_TOKEN"),
    /** What leaves the machine. Metadata + results only unless evidence is opted in. */
    includeEvidence: z.boolean().default(false),
    maxPayloadBytes: z.number().int().positive().default(1_048_576),
  })
  .strict();
export type SyncConfig = z.infer<typeof syncConfigSchema>;

export const proofstackConfigSchema = z
  .object({
    /** Config format version, so old files keep working when the shape changes. */
    schemaVersion: z.literal(1).default(1),
    project: z
      .object({
        name: z.string().min(1).max(120),
        baseUrl: z.string().url(),
        /** Free-form stack tag, used for report grouping. */
        stack: z.string().optional(),
        revision: z.string().optional(),
      })
      .strict(),
    environment: environmentKindSchema.default("local"),
    /** Explicit acknowledgement required before anything destructive targets prod. */
    allowDestructiveProduction: z.boolean().default(false),
    modules: z
      .object({
        world: worldConfigSchema.prefault({ enabled: true, profiles: ["en-US", "fr-FR", "fr-BJ"] }),
        flow: flowConfigSchema.prefault({ enabled: true, paymentMode: "simulated" }),
        exit: exitConfigSchema.prefault({ enabled: true, formats: ["json", "csv"] }),
      })
      .strict()
      // Absent `modules` must still produce fully defaulted module configs.
      .prefault({}),
    engine: engineConfigSchema.prefault({ parallel: 4, timeoutMs: 120_000 }),
    output: z
      .object({
        dir: z.string().default(".proofstack/reports"),
        formats: z.array(z.enum(["json", "junit", "html", "text"])).default(["json", "text"]),
        junitFile: z.string().default("junit.xml"),
        jsonFile: z.string().default("run.json"),
        htmlFile: z.string().default("run.html"),
      })
      .strict()
      .prefault({ dir: ".proofstack/reports" }),
    sync: syncConfigSchema.prefault({ enabled: false }),
    enabledModules: z.array(moduleIdSchema).min(1).default(["world", "flow", "exit"]),
  })
  .strict();

export type ProofstackConfig = z.infer<typeof proofstackConfigSchema>;

export interface ConfigValidationIssue {
  path: string;
  message: string;
  hint?: string;
}

/**
 * Cross-field rules zod cannot express, and safety refusals.
 * Returns issues; an empty array means the config is usable.
 */
export function validateConfig(config: ProofstackConfig): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];
  const enabled = new Set(config.enabledModules);

  for (const key of ["world", "flow", "exit"] as const) {
    if (config.modules[key].enabled && !enabled.has(key)) {
      issues.push({
        path: `modules.${key}.enabled`,
        message: `module ${key} is enabled but not listed in enabledModules`,
        hint: `add "${key}" to enabledModules or set modules.${key}.enabled=false`,
      });
    }
  }

  if (config.modules.flow.enabled && config.modules.flow.paymentMode === "live_charge") {
    issues.push({
      path: "modules.flow.paymentMode",
      message: "live_charge is refused for automated runs",
      hint: 'use "sandbox" or "simulated"; real charges must be a human-initiated action',
    });
  }

  if (config.modules.exit.enabled && config.modules.exit.target === "production" && !config.allowDestructiveProduction) {
    issues.push({
      path: "modules.exit.target",
      message: 'exit.target="production" requires allowDestructiveProduction=true',
      hint: "prefer target=\"staging\"; exports of production datasets are never uploaded by default",
    });
  }

  if (config.modules.world.enabled && config.modules.world.profiles.length === 0) {
    issues.push({ path: "modules.world.profiles", message: "at least one locale profile is required" });
  }

  if (config.environment === "production") {
    const destructive = [
      ...config.modules.flow.journeys.filter((j) => j.destructive).map((j) => `flow.journeys.${j.id}`),
      ...(config.modules.exit.target === "production" ? ["modules.exit.target"] : []),
    ];
    for (const path of destructive) {
      issues.push({
        path,
        message: `destructive step is not allowed while environment="production"`,
        hint: "run against staging, or set environment accordingly and gate it in CI",
      });
    }
  }

  if (config.sync.enabled && !config.sync.apiUrl) {
    issues.push({ path: "sync.apiUrl", message: "sync is enabled but no apiUrl is configured" });
  }

  return issues;
}

export function assertSafeForAutomatedRun(config: ProofstackConfig): void {
  const issues = validateConfig(config).filter(
    (i) => i.path.includes("live_charge") || i.message.includes("refused") || i.message.includes("not allowed"),
  );
  if (issues.length > 0) {
    throw new Error(
      `Unsafe configuration for an automated run:\n${issues.map((i) => ` - ${i.path}: ${i.message}${i.hint ? ` (${i.hint})` : ""}`).join("\n")}`,
    );
  }
}
