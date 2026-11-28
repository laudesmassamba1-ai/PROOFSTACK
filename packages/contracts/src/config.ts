import { z } from "zod";
import { environmentKindSchema, moduleIdSchema } from "./statuses.js";

/**
 * One configuration file drives the CLI, the SDK and the cloud-side project
 * record: `proofcore.config.ts` (or `.json`, or `proofcore` in package.json).
 *
 * Safety rules are encoded here rather than left to callers, because the
 * dangerous case (pointing a destructive test at production) must fail at parse
 * time with an actionable message.
 */

export const localeProfileSchema = z
  .string()
  .regex(
    /^[a-z]{2,3}(?:-[A-Za-z]{4})?-(?:[A-Z]{2}|[0-9]{3})(?:-[A-Za-z0-9]{5,8})?$/,
    "expected BCP-47 locale like fr-BJ or zh-Hans-CN"
  );

export const worldConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Locale profiles to exercise. Must be a subset of the installed profile set. */
    profiles: z.array(localeProfileSchema).min(1).default(["en-US", "fr-FR", "fr-BJ"]),
    /** Extra/override profile definitions loaded from disk. */
    profileFiles: z.array(z.string()).default([]),
    categories: z
      .array(
        z.enum([
          "identity",
          "phone",
          "email",
          "address",
          "currency",
          "datetime",
          "forms",
          "sorting",
          "collation",
        ])
      )
      .default(["identity", "phone", "email", "address", "currency", "datetime"]),
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
                      .enum([
                        "text",
                        "email",
                        "tel",
                        "name",
                        "postal",
                        "address",
                        "select",
                        "date",
                        "number",
                        "currency",
                      ])
                      .default("text"),
                    required: z.boolean().default(false),
                    maxLength: z.number().int().positive().optional(),
                    /** Values the product must accept; defaults come from the profile. */
                    fixtures: z.array(z.string()).default([]),
                  })
                  .strict()
                  .refine((f) => Boolean(f.selector || f.label), {
                    message: "field needs selector or label",
                  })
              )
              .min(1),
          })
          .strict()
      )
      .default([]),
    /** Reject values the product should accept. Failures here are product bugs. */
    strictRejectionDetection: z.boolean().default(true),
    /**
     * How WORLD reaches the product. `none` is the safe default and produces
     * SKIPPED cases with a reason: an unconfigured target must never look like a
     * passing compatibility test.
     */
    target: z
      .object({
        kind: z.enum(["http", "driver", "none"]).default("none"),
        submitUrl: z.string().url().optional(),
        /** Template containing {recordId}; used to detect storage corruption. */
        readbackUrl: z.string().optional(),
        sortUrl: z.string().url().optional(),
        method: z.enum(["POST", "PUT"]).default("POST"),
        headers: z.record(z.string(), z.string()).default({}),
        /** Name of the env var holding a bearer token. Never the token itself. */
        tokenEnvVar: z.string().optional(),
        timeoutMs: z.number().int().positive().max(60_000).default(10_000),
        /** Field name the product uses to report per-field validation errors. */
        errorField: z.string().default("errors"),
      })
      .strict()
      .prefault({ kind: "none" }),
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
      .array(
        z.enum([
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
        ])
      )
      .default([
        "checkout_success",
        "checkout_declined",
        "webhook_duplicate",
        "webhook_invalid_signature",
      ]),
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
                  .strict()
              )
              .min(1),
            /** Destructive journeys (real orders) require staging or local. */
            destructive: z.boolean().default(false),
          })
          .strict()
      )
      .default([]),
    /**
     * The customer's own payment surface. This block was read by FLOW but absent from
     * the strict schema, so any config that declared it was rejected before the module
     * could run. URLs are optional because a missing capability is SKIPPED, not a pass.
     */
    target: z
      .object({
        checkoutUrl: z.string().url().optional(),
        orderUrlTemplate: z.string().url().optional(),
        webhookUrl: z.string().url().optional(),
        refundUrl: z.string().url().optional(),
        /** Name of the env var holding the bearer token. Never the token itself. */
        tokenEnvVar: z.string().optional(),
        headers: z.record(z.string(), z.string()).default({}),
        timeoutMs: z.number().int().positive().max(120_000).default(15_000),
      })
      .strict()
      .optional(),
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
    formats: z
      .array(z.enum(["csv", "json", "zip"]))
      .min(1)
      .default(["json", "csv"]),
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
    schema: z
      .record(
        z.string(),
        z.enum([
          "string",
          "number",
          "integer",
          "boolean",
          "date",
          "datetime",
          "id",
          "money",
          "nullable",
        ])
      )
      .default({}),
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
          .strict()
      )
      .default([]),
    unique: z
      .array(z.object({ table: z.string(), fields: z.array(z.string()).min(1) }).strict())
      .default([]),
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
    tokenEnvVar: z.string().default("PROOFCORE_PROJECT_TOKEN"),
    /** What leaves the machine. Metadata + results only unless evidence is opted in. */
    includeEvidence: z.boolean().default(false),
    maxPayloadBytes: z.number().int().positive().default(1_048_576),
  })
  .strict();
export type SyncConfig = z.infer<typeof syncConfigSchema>;

/**
 * AI integration.
 *
 * PROOFCORE is not an AI product, but a quality platform is far more useful when an
 * agent can drive it: read a failing run, propose a fix, or run the suite from a chat
 * client. This block configures *how* AI can reach the product, never *which* model
 * must be used, and never stores a key.
 *
 * Three integration shapes, because they solve different problems:
 *
 *   - **MCP servers** — PROOFCORE acts as an MCP *client*. It connects to servers the
 *     user configures (filesystem, GitHub, a database) and their tools become
 *     available to PROOFCORE's own agent. Transport is stdio or HTTP.
 *   - **AI providers** — an OpenAI-compatible chat-completions endpoint. Perch, OpenAI,
 *     self-hosted vLLM or LM Studio: all speak the same shape, so one adapter covers
 *     them and the base URL is the only thing that changes.
 *   - **CLI agents** — an external coding agent invoked as an argv array (never a shell
 *     string), given a prompt on stdin, expected to answer on stdout. This is how you
 *     hand a failing run to whatever agent the team already uses.
 *
 * Every key is read from an environment variable at call time. Nothing here can hold a
 * secret, and nothing here is required for the product to work.
 */
export const mcpTransportSchema = z.enum(["stdio", "http"]);
export type McpTransport = z.infer<typeof mcpTransportSchema>;

export const mcpServerSchema = z
  .object({
    /** Stable name; tools appear as `mcp__<name>__<tool>`. */
    name: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9][a-z0-9_-]*$/i, "use letters, digits, dash or underscore"),
    transport: mcpTransportSchema.default("stdio"),
    /** stdio: argv array. The first element is the executable. Never a shell string. */
    command: z.array(z.string().min(1)).optional(),
    /** http: the server's MCP endpoint. */
    url: z.string().url().optional(),
    /** Environment variables passed to the child process (names only, resolved at spawn). */
    env: z.record(z.string(), z.string()).default({}),
    /** Extra HTTP headers for the http transport; values may reference ${ENV_VAR}. */
    headers: z.record(z.string(), z.string()).default({}),
    cwd: z.string().optional(),
    /** Tools the agent may call. Empty means every tool the server exposes. */
    allowTools: z.array(z.string()).default([]),
    /** Tools that are always refused, even if allowTools is empty. */
    denyTools: z.array(z.string()).default([]),
    /** Start this server when an agent session begins. */
    autoConnect: z.boolean().default(false),
    timeoutMs: z.number().int().positive().max(120_000).default(30_000),
  })
  .strict()
  .refine(
    (server) =>
      server.transport === "stdio" ? Boolean(server.command?.length) : Boolean(server.url),
    {
      message: "stdio servers need a command argv; http servers need a url",
    }
  );
export type McpServerConfig = z.infer<typeof mcpServerSchema>;

export const aiProviderSchema = z
  .object({
    /** Stable name used by `--provider`. */
    name: z.string().min(1).max(40),
    /**
     * OpenAI-compatible chat completions. One shape covers Perch, OpenAI, vLLM
     * and LM Studio; only the base URL and the model name change.
     */
    kind: z.enum(["openai-compatible"]).default("openai-compatible"),
    baseUrl: z.string().url(),
    model: z.string().min(1),
    /** Name of the env var holding the API key. A local endpoint may need none. */
    apiKeyEnvVar: z.string().optional(),
    /** Extra headers, values may reference ${ENV_VAR}. */
    headers: z.record(z.string(), z.string()).default({}),
    maxTokens: z.number().int().positive().max(200_000).default(4_096),
    temperature: z.number().min(0).max(2).default(0.2),
    timeoutMs: z.number().int().positive().max(600_000).default(120_000),
    /**
     * Whether this model can request tool calls. Local models often cannot; a wrong
     * `true` makes the agent loop send a tools array the server rejects.
     */
    supportsTools: z.boolean().default(true),
    /** Marks the provider used when `--provider` is omitted. */
    default: z.boolean().default(false),
  })
  .strict();
export type AiProviderConfig = z.infer<typeof aiProviderSchema>;

export const cliAgentSchema = z
  .object({
    name: z.string().min(1).max(40),
    /** argv array; `{prompt}` is replaced by the prompt, or the prompt goes to stdin. */
    command: z.array(z.string().min(1)).min(1),
    /** How the prompt reaches the agent. */
    promptDelivery: z.enum(["stdin", "arg"]).default("stdin"),
    /** Extra env for the child, resolved at spawn. */
    env: z.record(z.string(), z.string()).default({}),
    cwd: z.string().optional(),
    timeoutMs: z.number().int().positive().max(1_800_000).default(300_000),
    /** Read-only agents are the default: an agent that can write needs an explicit opt-in. */
    allowFileWrites: z.boolean().default(false),
  })
  .strict();
export type CliAgentConfig = z.infer<typeof cliAgentSchema>;

export const aiConfigSchema = z
  .object({
    /** Off by default. An AI integration is a choice, never a surprise. */
    enabled: z.boolean().default(false),
    providers: z.array(aiProviderSchema).default([]),
    mcpServers: z.array(mcpServerSchema).default([]),
    agents: z.array(cliAgentSchema).default([]),
    /** Hard ceiling on agent turns, so a loop cannot run away with a bill. */
    maxTurns: z.number().int().min(1).max(50).default(8),
    /** Per-session token budget across all model calls. */
    maxTokensPerSession: z.number().int().positive().default(200_000),
    /** What the agent may do without asking. `read` is the safe default. */
    autonomy: z.enum(["read", "propose", "write"]).default("read"),
  })
  .strict();
export type AiConfig = z.infer<typeof aiConfigSchema>;

export const proofcoreConfigSchema = z
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
        dir: z.string().default(".proofcore/reports"),
        formats: z.array(z.enum(["json", "junit", "html", "text"])).default(["json", "text"]),
        junitFile: z.string().default("junit.xml"),
        jsonFile: z.string().default("run.json"),
        htmlFile: z.string().default("run.html"),
      })
      .strict()
      .prefault({ dir: ".proofcore/reports" }),
    sync: syncConfigSchema.prefault({ enabled: false }),
    ai: aiConfigSchema.prefault({ enabled: false }),
    enabledModules: z.array(moduleIdSchema).min(1).default(["world", "flow", "exit"]),
  })
  .strict();

export type ProofCoreConfig = z.infer<typeof proofcoreConfigSchema>;

export interface ConfigValidationIssue {
  path: string;
  message: string;
  hint?: string;
}

/**
 * Cross-field rules zod cannot express, and safety refusals.
 * Returns issues; an empty array means the config is usable.
 */
export function validateConfig(config: ProofCoreConfig): ConfigValidationIssue[] {
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

  if (
    config.modules.exit.enabled &&
    config.modules.exit.target === "production" &&
    !config.allowDestructiveProduction
  ) {
    issues.push({
      path: "modules.exit.target",
      message: 'exit.target="production" requires allowDestructiveProduction=true',
      hint: 'prefer target="staging"; exports of production datasets are never uploaded by default',
    });
  }

  if (
    config.modules.world.enabled &&
    config.modules.world.target.kind === "none" &&
    config.modules.world.forms.length === 0
  ) {
    issues.push({
      path: "modules.world.target.kind",
      message: "WORLD is enabled but has no product target and no forms to drive",
      hint: 'set modules.world.target.kind="http" with a submitUrl, or configure forms for the browser driver',
    });
  }

  if (
    config.modules.world.enabled &&
    config.modules.world.target.kind === "http" &&
    !config.modules.world.target.submitUrl
  ) {
    issues.push({
      path: "modules.world.target.submitUrl",
      message: 'target.kind="http" requires submitUrl',
      hint: "point submitUrl at an endpoint that accepts the record payload",
    });
  }

  if (config.modules.world.enabled && config.modules.world.profiles.length === 0) {
    issues.push({
      path: "modules.world.profiles",
      message: "at least one locale profile is required",
    });
  }

  if (config.environment === "production") {
    const destructive = [
      ...config.modules.flow.journeys
        .filter((j) => j.destructive)
        .map((j) => `flow.journeys.${j.id}`),
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

  // ---- AI integration
  if (config.ai.enabled) {
    if (
      config.ai.providers.length === 0 &&
      config.ai.mcpServers.length === 0 &&
      config.ai.agents.length === 0
    ) {
      issues.push({
        path: "ai.enabled",
        message: "ai is enabled but nothing is configured",
        hint: "add an entry to ai.providers, ai.mcpServers or ai.agents",
      });
    }

    const providerNames = config.ai.providers.map((p) => p.name);
    const duplicates = providerNames.filter((name, index) => providerNames.indexOf(name) !== index);
    if (duplicates.length > 0) {
      issues.push({
        path: "ai.providers",
        message: `duplicate provider name(s): ${[...new Set(duplicates)].join(", ")}`,
        hint: "each provider needs a unique name so --provider is unambiguous",
      });
    }

    const defaults = config.ai.providers.filter((p) => p.default);
    if (defaults.length > 1) {
      issues.push({
        path: "ai.providers",
        message: `${defaults.length} providers are marked default; exactly one may be`,
        hint: `marked: ${defaults.map((p) => p.name).join(", ")}`,
      });
    }

    const serverNames = config.ai.mcpServers.map((s) => s.name);
    const duplicateServers = serverNames.filter(
      (name, index) => serverNames.indexOf(name) !== index
    );
    if (duplicateServers.length > 0) {
      issues.push({
        path: "ai.mcpServers",
        message: `duplicate MCP server name(s): ${[...new Set(duplicateServers)].join(", ")}`,
        hint: "tool names are namespaced by server, so names must be unique",
      });
    }

    // A write-capable agent in an automated run is the same hazard as a live charge.
    if (config.ai.autonomy === "write" && config.environment === "production") {
      issues.push({
        path: "ai.autonomy",
        message: 'autonomy="write" is refused while environment="production"',
        hint: 'use "read" or "propose", or run the agent against staging',
      });
    }

    for (const agent of config.ai.agents) {
      if (agent.allowFileWrites && config.ai.autonomy === "read") {
        issues.push({
          path: `ai.agents.${agent.name}.allowFileWrites`,
          message: 'agent may write files but ai.autonomy is "read"',
          hint: 'raise ai.autonomy to "propose" or "write", or set allowFileWrites=false',
        });
      }
    }

    // A key must never be inline. This catches the mistake that leaks a secret.
    for (const provider of config.ai.providers) {
      if (provider.apiKeyEnvVar && /^(sk-|sk_|Bearer )/.test(provider.apiKeyEnvVar)) {
        issues.push({
          path: `ai.providers.${provider.name}.apiKeyEnvVar`,
          message: "apiKeyEnvVar looks like a key value, not a variable name",
          hint: "put the name of the env var here (e.g. OPENAI_API_KEY), never the key itself",
        });
      }
    }
  }

  return issues;
}

export function assertSafeForAutomatedRun(config: ProofCoreConfig): void {
  const issues = validateConfig(config).filter(
    (i) =>
      i.path.includes("live_charge") ||
      i.message.includes("refused") ||
      i.message.includes("not allowed")
  );
  if (issues.length > 0) {
    throw new Error(
      `Unsafe configuration for an automated run:\n${issues.map((i) => ` - ${i.path}: ${i.message}${i.hint ? ` (${i.hint})` : ""}`).join("\n")}`
    );
  }
}
