import {
  exitConfigSchema,
  flowConfigSchema,
  type ModuleId,
  proofcoreConfigSchema,
  worldConfigSchema,
} from "@proofcore/contracts";
import { controlsForModule, Logger } from "@proofcore/core";
import { runEngine } from "@proofcore/engine";
import {
  createFlowProvider,
  defaultFlowTarget,
  SCENARIO_EXPECTATIONS,
} from "@proofcore/module-flow";
import {
  ALL_CATEGORIES,
  createWorldProvider,
  HttpProductUnderTest,
  PROFILES,
} from "@proofcore/module-world";
import type { z } from "zod";
import { HttpError } from "./http/errors.js";
import type { Services } from "./http/services.js";
import {
  blockingIssues,
  buildProjectConfig,
  projectConfigIssues,
  readStoredProjectConfig,
} from "./project-config.js";
import type { ProjectRecord, RunTotals } from "./store/app-store.js";

/**
 * Module copilot.
 *
 * The assistant could read runs and scan one URL, but it could not see the active
 * module configuration, change it with the real schema, or launch a module and keep
 * the result. This file is that missing bridge. It never invents a check: the engine,
 * the control registry and the config schemas are the ones the CLI uses.
 *
 * Runtime limits are stated instead of hidden: the API Worker has no browser, so FLOW
 * journeys are not run here; EXIT may need a file or a command, which a Worker cannot
 * read. Those modules answer `not_runnable` with the exact local command, and the
 * assistant reads the uploaded run afterwards.
 */

export type CopilotModule = "world" | "flow" | "exit" | "fail" | "clean";

export const COPILOT_MODULES: readonly CopilotModule[] = ["world", "flow", "exit", "fail", "clean"];

const LABELS: Record<CopilotModule, string> = {
  world: "WORLD",
  flow: "FLOW",
  exit: "EXIT",
  fail: "FAIL",
  clean: "CLEAN",
};

const PURPOSE: Record<CopilotModule, string> = {
  world: "Global compatibility: locale profiles, addresses, phones, currencies, dates, sorting.",
  flow: "Transaction reliability: checkout, webhooks, ordering, refunds and browser journeys.",
  exit: "Data portability: export shape, types, relationships, truncation and round trip.",
  fail: "Security posture: headers, cookies, TLS, leaks and error-page disclosure over real HTTP.",
  clean:
    "Interface quality: metadata, structure, alt text, labels, weight and caching over real HTTP.",
};

export interface ModuleReadiness {
  module: CopilotModule;
  label: string;
  purpose: string;
  enabled: boolean;
  configured: boolean;
  runnableHere: boolean;
  blockers: { path: string; message: string }[];
  lastRun: {
    id: string;
    status: string;
    startedAt: string;
    totals: unknown;
  } | null;
  runHere: string;
  runLocally: string;
}

function projectOrThrow(services: Services, workspaceId: string, projectId: string) {
  return services.store.getProject(workspaceId, projectId).then((project) => {
    if (!project) throw new HttpError(404, "project_not_found", "Project not found.");
    return project;
  });
}

function moduleConfig(config: ReturnType<typeof buildProjectConfig>, module: CopilotModule) {
  if (module === "world") return config.modules.world;
  if (module === "flow") return config.modules.flow;
  if (module === "exit") return config.modules.exit;
  return null;
}

/** A copy safe to show a model: header values, which may be tokens, are removed. */
function safeModuleConfig(
  config: ReturnType<typeof buildProjectConfig>,
  module: CopilotModule
): unknown {
  const value = moduleConfig(config, module);
  if (!value) return null;
  if (module === "flow") {
    const flow = value as typeof config.modules.flow & {
      target?: { headers?: Record<string, string> };
    };
    return {
      ...flow,
      ...(flow.target
        ? {
            target: {
              ...flow.target,
              headers: Object.fromEntries(
                Object.keys(flow.target.headers ?? {}).map((key) => [key, "<redacted>"])
              ),
            },
          }
        : {}),
    };
  }
  return value;
}

function vocabulary(config: ReturnType<typeof buildProjectConfig>, module: CopilotModule): unknown {
  if (module === "world") {
    return {
      profiles: PROFILES.map((profile) => ({ id: profile.id, region: profile.region })),
      categories: ALL_CATEGORIES,
      forms: "world.forms: id, name, optional selector/path, submit (default false), fields[]",
      targetKinds: ["none", "http"],
    };
  }
  if (module === "flow") {
    return {
      scenarios: Object.values(SCENARIO_EXPECTATIONS).map((expectation) => ({
        id: expectation.scenario,
        description: expectation.description,
        acceptableOrderStatuses: expectation.acceptableOrderStatuses,
        exactlyOneOrder: expectation.exactlyOneOrder,
        expectsPaid: expectation.expectsPaid,
      })),
      journeyActions: [
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
      ],
      journeyShape:
        "id, name, optional startUrl, steps[] (id, action, target?, value?, timeoutMs?, optional?)",
      paymentModes: ["simulated", "sandbox", "live_charge"],
      target: "checkoutUrl, orderUrlTemplate, webhookUrl, refundUrl, headers, timeoutMs",
      baseUrl: config.modules.flow.baseUrl ?? config.project.baseUrl,
    };
  }
  if (module === "exit") {
    return {
      formats: ["csv", "json", "zip"],
      targets: ["synthetic", "staging", "production"],
      exportSource: "http | file | command (value, headers, method)",
      schemaTypes: [
        "string",
        "number",
        "integer",
        "boolean",
        "date",
        "datetime",
        "id",
        "money",
        "nullable",
      ],
      maxRecords: 5000,
    };
  }
  return {
    controls: controlsForModule(module).map((control) => ({
      id: control.id,
      title: control.en.title,
      objective: control.en.objective,
      consequence: control.en.consequence,
      fix: control.en.fix,
      verify: control.en.verify,
    })),
  };
}

function issuesFor(config: ReturnType<typeof buildProjectConfig>, module: CopilotModule) {
  return projectConfigIssues(config).filter(
    (issue) => issue.path === module || issue.path.startsWith(`${module}.`)
  );
}

export async function moduleStatus(
  services: Services,
  workspaceId: string,
  projectId?: string
): Promise<{
  project: { id: string; name: string; baseUrl: string; environment: string } | null;
  modules: ModuleReadiness[];
}> {
  const projects = await services.store.listProjects(workspaceId);
  const project = projectId
    ? projects.find((item) => item.id === projectId)
    : (projects[0] ?? null);
  if (projectId && !project) throw new HttpError(404, "project_not_found", "Project not found.");
  if (!project) return { project: null, modules: [] };

  const config = buildProjectConfig(project, readStoredProjectConfig(project.moduleConfig));
  const runs = await services.store.recentRuns(workspaceId, 20);
  const projectRuns = runs.filter((run) => run.projectId === project.id);

  const modules = COPILOT_MODULES.map((module): ModuleReadiness => {
    const issues = issuesFor(config, module);
    const blockers = blockingIssues(issues).map((issue) => ({
      path: issue.path,
      message: issue.message,
    }));
    const enabled = project.enabledModules.includes(module as ModuleId);
    const lastRun = projectRuns.find((run) => {
      const totals = run.totals as Record<string, unknown> | null;
      return totals !== null && typeof totals === "object" && module in totals;
    });
    return {
      module,
      label: LABELS[module],
      purpose: PURPOSE[module],
      enabled,
      configured: configuredFor(config, module),
      runnableHere:
        module === "fail" || module === "clean" || module === "world" || module === "flow",
      blockers,
      lastRun: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            startedAt: lastRun.startedAt,
            totals: lastRun.totals,
          }
        : null,
      runHere: runHint(module, project, config, true),
      runLocally: runHint(module, project, config, false),
    };
  });

  return {
    project: {
      id: project.id,
      name: project.name,
      baseUrl: project.baseUrl,
      environment: project.environment,
    },
    modules,
  };
}

function configuredFor(
  config: ReturnType<typeof buildProjectConfig>,
  module: CopilotModule
): boolean {
  if (module === "fail" || module === "clean") return true;
  if (module === "world") return config.modules.world.target.kind === "http";
  if (module === "flow") {
    return Boolean(
      config.modules.flow.target?.checkoutUrl ||
        config.modules.flow.journeys.length > 0 ||
        config.modules.flow.webhookEndpoint
    );
  }
  return Boolean(config.modules.exit.exportSource);
}

function runHint(
  module: CopilotModule,
  project: ProjectRecord,
  config: ReturnType<typeof buildProjectConfig>,
  here: boolean
): string {
  if (here) {
    if (module === "fail" || module === "clean") {
      return `module_run({ projectId: "${project.id}", module: "${module}", confirm: true })`;
    }
    if (module === "world" || module === "flow") {
      return `module_run({ projectId: "${project.id}", module: "${module}", confirm: true })`;
    }
  }
  if (module === "exit" && config.modules.exit.exportSource?.kind !== "http") {
    return `Local only: proofcore test --module exit (the export source is ${
      config.modules.exit.exportSource?.kind ?? "unset"
    }, which the API cannot read).`;
  }
  return `proofcore test --module ${module}`;
}

export async function moduleConfigView(
  services: Services,
  workspaceId: string,
  projectId: string,
  module: CopilotModule
) {
  const project = await projectOrThrow(services, workspaceId, projectId);
  const config = buildProjectConfig(project, readStoredProjectConfig(project.moduleConfig));
  const issues = issuesFor(config, module);
  return {
    project: { id: project.id, name: project.name, baseUrl: project.baseUrl },
    module,
    label: LABELS[module],
    purpose: PURPOSE[module],
    enabled: project.enabledModules.includes(module as ModuleId),
    config: safeModuleConfig(config, module),
    vocabulary: vocabulary(config, module),
    issues,
    blocking: blockingIssues(issues),
    runnableHere:
      module === "fail" || module === "clean" || module === "world" || module === "flow",
    runHere: runHint(module, project, config, true),
    runLocally: runHint(module, project, config, false),
  };
}

const PATCH_SCHEMAS: Partial<Record<CopilotModule, z.ZodType>> = {
  world: worldConfigSchema.partial().strict(),
  flow: flowConfigSchema.partial().strict(),
  exit: exitConfigSchema.partial().strict(),
};

export async function configureModule(
  services: Services,
  workspaceId: string,
  projectId: string,
  module: CopilotModule,
  settings: unknown
): Promise<
  | { ok: true; config: unknown; issues: unknown; savedAt: string; runHere: string }
  | { ok: false; error: string; issues?: unknown }
> {
  const patchSchema = PATCH_SCHEMAS[module];
  if (!patchSchema) {
    return {
      ok: false,
      error: `${LABELS[module]} has no persisted module settings. It is configured by the URL you give module_run.`,
    };
  }
  const parsed = patchSchema.safeParse(settings);
  if (!parsed.success) {
    return {
      ok: false,
      error: "The settings do not match the PROOFCORE module schema.",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const project = await projectOrThrow(services, workspaceId, projectId);
  const stored = readStoredProjectConfig(project.moduleConfig);
  const before = buildProjectConfig(project, stored);
  const patch = parsed.data as Record<string, unknown>;
  const merged = (() => {
    if (module === "world") {
      return worldConfigSchema.parse({ ...before.modules.world, ...patch });
    }
    if (module === "flow") {
      return flowConfigSchema.parse({ ...before.modules.flow, ...patch });
    }
    return exitConfigSchema.parse({ ...before.modules.exit, ...patch });
  })();

  const modules = {
    ...before.modules,
    [module]: merged,
  };
  let candidate: ReturnType<typeof buildProjectConfig>;
  try {
    candidate = proofcoreConfigSchema.parse({
      ...before,
      modules,
      enabledModules: project.enabledModules.includes(module as ModuleId)
        ? project.enabledModules
        : [...project.enabledModules, module as ModuleId],
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The merged configuration is invalid.",
    };
  }

  const issues = projectConfigIssues(candidate);
  const blocking = blockingIssues(issues);
  if (blocking.length > 0) {
    return {
      ok: false,
      error: "This configuration cannot be run automatically. Nothing was saved.",
      issues: blocking,
    };
  }

  const savedAt = new Date(services.clock()).toISOString();
  const written = {
    modules: candidate.modules,
    allowDestructiveProduction: candidate.allowDestructiveProduction ?? false,
    savedAt,
  };
  const saved = await services.store.setProjectModuleConfig(
    workspaceId,
    project.id,
    JSON.stringify(written)
  );
  if (!saved) throw new HttpError(404, "project_not_found", "Project not found.");
  await services.store.appendAudit({
    workspaceId,
    actor: "assistant",
    action: "project.config_updated",
    detail: { projectId: project.id, module, source: "assistant" },
  });

  return {
    ok: true,
    config: safeModuleConfig(candidate, module),
    issues,
    savedAt,
    runHere: runHint(module, project, candidate, true),
  };
}

function totalsOf(run: Awaited<ReturnType<typeof runEngine>>["run"]): Record<string, RunTotals> {
  const totals: Record<string, RunTotals> = {};
  for (const moduleRun of run.moduleRuns) {
    totals[moduleRun.module] = {
      total: moduleRun.totals.total,
      passed: moduleRun.totals.passed,
      failed: moduleRun.totals.failed,
      warnings: moduleRun.totals.warnings,
      errors: moduleRun.totals.errors,
      skipped: moduleRun.totals.skipped,
    };
  }
  return totals;
}

function retentionBoundary(endedAt: string, days: number): string {
  const end = new Date(endedAt).getTime();
  return new Date(end + days * 24 * 60 * 60 * 1000).toISOString();
}

const REMEDIATIONS: Record<string, { fix: string; verify: string }> = {
  checkout_rejected: {
    fix: "Make the checkout endpoint accept the sandbox request and return order_id and payment_id; return a field-level refusal for a declined scenario, not a 5xx.",
    verify: "Replay the same request and confirm a 2xx with both ids.",
  },
  idempotent_retry_rejected: {
    fix: "Treat a repeated checkout with the same order_reference or Idempotency-Key as the same intent and return the existing result.",
    verify: "Send the same checkout twice and assert both calls succeed with the same order id.",
  },
  duplicate_order_created: {
    fix: "Make checkout idempotent on order_reference/Idempotency-Key; a retry must return the existing order, not insert a second one.",
    verify: "Send the same checkout twice and assert order_count is exactly 1.",
  },
  duplicate_order_from_webhook: {
    fix: "Deduplicate webhook deliveries by event id before mutating an order; a replay must be acknowledged without a second order.",
    verify: "Deliver the same signed event twice and assert one order and a 2xx.",
  },
  forged_webhook_accepted: {
    fix: "Verify X-Webhook-Signature over the raw body with the shared secret and reject an invalid signature with 401.",
    verify: "Post an unsigned or wrongly signed event and assert the order did not change.",
  },
  forged_webhook_changed_state: {
    fix: "Verify the signature before parsing or applying the event; a forged body must change nothing.",
    verify: "Post a forged SUCCESS event and read the order back: it must remain unpaid.",
  },
  missing_order_confirmation: {
    fix: "On a verified SUCCESS event, transition the order to paid in the same transaction that records the payment.",
    verify: "Send a valid SUCCESS event and assert the order reads paid.",
  },
  inconsistent_payment_state: {
    fix: "Derive the order status from the verified payment state, or reconcile the two instead of reporting a status the order does not have.",
    verify: "Compare the checkout response state with the order readback in the same run.",
  },
  order_not_paid: {
    fix: "A successful checkout must leave the order paid; inspect the transition that runs after the provider acknowledges the payment.",
    verify: "Run checkout_success and read the order back.",
  },
  order_not_paid_after_webhook: {
    fix: "Ignore a stale PENDING event after a terminal success; never move a paid order backwards.",
    verify: "Deliver SUCCESS then PENDING and assert the order stays paid.",
  },
  unpaid_order_marked_paid: {
    fix: "Only a verified SUCCESS may mark an order paid; a declined, cancelled or pending payment must not.",
    verify: "Run checkout_declined and assert the order is not paid.",
  },
  refund_deleted_order: {
    fix: "Mark the order refunded; never delete the customer's order record.",
    verify: "Refund a paid order and read it back with order_count 1.",
  },
  refund_rejected: {
    fix: "Accept a refund for a paid payment and return the resulting state.",
    verify: "Refund a paid order and assert a 2xx with state refunded.",
  },
  refund_state_wrong: {
    fix: "Persist the refunded state on the order after a successful refund.",
    verify: "Refund and read the order back: the status must be refunded.",
  },
  webhook_delivery_failed: {
    fix: "Return a 2xx for a valid event and surface processing errors as a retryable non-2xx, not a crash.",
    verify: "Post one valid signed event and assert status < 500.",
  },
  webhook_duplicate_errored: {
    fix: "Acknowledge a duplicate event with 2xx after deduplication; do not error on the replay.",
    verify: "Post the same signed event twice and assert both responses are < 500.",
  },
  webhook_out_of_order_errored: {
    fix: "Make event handling order-independent: a late event must not fail or regress a terminal state.",
    verify: "Deliver SUCCESS then a stale PENDING and assert the order stays paid.",
  },
  order_count_wrong: {
    fix: "Return the number of orders that actually exist for the reference; do not report 1 when duplicates exist.",
    verify: "Retry a checkout and read order_count back.",
  },
  order_identity_mismatch: {
    fix: "Return the same order id for the same intent; a new id means a second order was created.",
    verify: "Compare the order ids of two identical checkouts.",
  },
  amount_corrupted: {
    fix: "Store the charged amount as a decimal string, unchanged by formatting or floating point.",
    verify: "Charge 2500.00 and compare the stored amount exactly.",
  },
  world_target_unconfigured: {
    fix: "Set modules.world.target to an HTTP submit URL, or configure browser forms; a profile with no target cannot be exercised.",
    verify: "Call module_run world and confirm the target cases are no longer NOT_CONFIGURED.",
  },
  world_target_unreachable: {
    fix: "Fix the submit URL, its authentication, or the server availability; the engine could not reach the product.",
    verify: "Open the submit URL from the same network and confirm it answers.",
  },
  accepts_invalid_value: {
    fix: "Reject the invalid locale fixture at the boundary; accepting it stores data the product cannot use.",
    verify: "Submit the invalid value and assert a 4xx with a field error.",
  },
  wrong_collation: {
    fix: "Sort with the locale's collation rules instead of byte order or the server default.",
    verify: "Sort the documented pair and compare the order with the profile expectation.",
  },
  impossible_date: {
    fix: "Normalise dates through the locale profile before storing them; reject impossible day/month combinations.",
    verify: "Submit the profile's date samples and read them back unchanged.",
  },
  export_empty: {
    fix: "Produce a non-empty export for the configured target; an empty file is not a portable dataset.",
    verify: "Download the export and assert it contains the expected records.",
  },
  export_missing_field: {
    fix: "Include every field declared in the EXIT schema; a missing field breaks the import contract.",
    verify: "Validate the export against the declared schema.",
  },
  export_type_mismatch: {
    fix: "Serialise each field with its declared type; keep money as a decimal string and ids as strings.",
    verify: "Re-import the export and compare each typed field.",
  },
  export_orphan_records: {
    fix: "Respect the declared relationships; every child must reference an exported parent.",
    verify: "Check each child foreign key against the exported parent set.",
  },
  export_duplicate_records: {
    fix: "Export each record once; deduplicate on the declared unique key.",
    verify: "Count records by unique key and assert no duplicates.",
  },
  silent_truncation: {
    fix: "Export the whole dataset up to maxRecords, or fail explicitly when the cap is reached; never truncate silently.",
    verify: "Compare the exported count with the source count.",
  },
  round_trip_missing_records: {
    fix: "Make the round trip lossless: every exported record must survive import.",
    verify: "Import the export and compare record counts and ids.",
  },
  round_trip_field_changed: {
    fix: "Preserve field values through export and import; normalising on the way out changes the customer's data.",
    verify: "Compare each field before export and after import.",
  },
  journey_no_start_url: {
    fix: "Give the journey a startUrl or set modules.flow.baseUrl so the first navigation has a destination.",
    verify: "Run the journey and confirm the first step navigates.",
  },
  journey_text_missing: {
    fix: "Fix the page state or the expected text: the assertion did not find the value after the preceding steps.",
    verify: "Replay the journey with a screenshot before the assertion.",
  },
  journey_url_mismatch: {
    fix: "Align the expected URL fragment with the route the product actually opens.",
    verify: "Replay the journey and read the final URL.",
  },
  journey_step_incomplete: {
    fix: "Complete the step: click/fill/select need a target selector, waitFor needs a selector, text or URL.",
    verify: "Validate the config again; the schema rejects the incomplete step.",
  },
};

export interface ModuleRunSummary {
  module: CopilotModule;
  runId: string | null;
  reportId: string | null;
  status: string;
  totals: unknown;
  cases: { id: string; status: string; failure?: { code: string; message: string } }[];
  skipped: { id: string; reason: string }[];
  note?: string;
}

/**
 * Launch one module on the real engine.
 *
 * FAIL/CLEAN stay HTTP scans of the project's own host. WORLD and FLOW run the engine
 * with the configured target. A run is metered and stored exactly like a CLI upload,
 * so it appears in history and the assistant can read it again in a later turn.
 */
export async function runModule(
  services: Services,
  workspaceId: string,
  projectId: string,
  module: CopilotModule,
  options: { url?: string; onlyCases?: string[] } = {}
): Promise<ModuleRunSummary> {
  const project = await projectOrThrow(services, workspaceId, projectId);
  const config = buildProjectConfig(project, readStoredProjectConfig(project.moduleConfig));

  if (module === "fail" || module === "clean") {
    const url = options.url ?? project.baseUrl;
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new HttpError(400, "bad_url", "An absolute http(s) URL is required.");
    }
    const own = new URL(project.baseUrl);
    if (target.hostname !== own.hostname) {
      throw new HttpError(403, "url_outside_project", "Scan only this project's host.");
    }
    const scan = await services.scan(url, {
      allowPrivate: false,
      timeoutMs: 15_000,
      ownershipHint: "remote",
    });
    const summary = scan.modules.find((item) => item.module === module);
    const findings = scan.findings.filter((item) => item.module === module);
    return {
      module,
      runId: null,
      reportId: null,
      status: summary?.score === undefined ? "NOT_MEASURED" : "COMPLETED",
      totals: summary
        ? {
            total: summary.passed + summary.failed + summary.warnings + summary.skipped,
            score: summary.score,
            passed: summary.passed,
            warnings: summary.warnings,
            failed: summary.failed,
            skipped: summary.skipped,
          }
        : null,
      cases: findings.map((finding) => ({
        id: finding.id,
        status: finding.status,
        ...(finding.status === "FAIL"
          ? { failure: { code: finding.id, message: finding.why } }
          : {}),
      })),
      skipped: findings
        .filter((finding) => finding.status === "SKIPPED")
        .map((finding) => ({ id: finding.id, reason: finding.observed })),
      note: "A page scan is returned live; it is not stored as a test run. Use FAIL/CLEAN history for trends.",
    };
  }

  if (module === "exit" && config.modules.exit.exportSource?.kind !== "http") {
    return {
      module,
      runId: null,
      reportId: null,
      status: "NOT_RUNNABLE_HERE",
      totals: null,
      cases: [],
      skipped: [],
      note: `EXIT needs a ${config.modules.exit.exportSource?.kind ?? "unset"} export source, which a Worker cannot read. Run it locally: proofcore test --module exit, then upload the run.`,
    };
  }

  const providers = [];
  if (module === "world") {
    const target =
      config.modules.world.target.kind === "http"
        ? new HttpProductUnderTest({ config })
        : undefined;
    providers.push(createWorldProvider(target ? { target } : {}));
  } else if (module === "flow") {
    const target = defaultFlowTarget(config);
    providers.push(createFlowProvider(target ? { target } : {}));
  }
  // EXIT with an HTTP source is the one export source this runtime can fetch.
  if (module === "exit") {
    return {
      module,
      runId: null,
      reportId: null,
      status: "NOT_RUNNABLE_HERE",
      totals: null,
      cases: [],
      skipped: [],
      note: "EXIT runs in the CLI, where the export source and the filesystem are available. Upload the run to see it here.",
    };
  }

  const gate = await services.meter.authorize({
    workspaceId,
    check: { key: "monthly_test_runs", requested: 1 },
    subjectId: `module_run:${project.id}:${module}`,
  });
  if (!gate.allowed) {
    throw new HttpError(
      403,
      "quota_exhausted",
      "The monthly test-run quota is exhausted; nothing was launched.",
      { remaining: gate.decision.remaining }
    );
  }

  const result = await runEngine({
    config,
    providers,
    only: [module as ModuleId],
    projectId: project.id,
    workspaceId,
    ...(options.onlyCases && options.onlyCases.length > 0 ? { onlyCases: options.onlyCases } : {}),
    clock: {
      now: () => services.clock().getTime(),
      iso: () => services.clock().toISOString(),
    },
    logger: new Logger({ level: "error" }),
  });
  const run = result.run;
  const totals = totalsOf(run);
  const countable = run.status !== "CANCELLED" && run.status !== "ERROR";
  await services.meter.meter({
    workspaceId,
    kind: "test_run",
    subjectId: run.id,
    quantity: 1,
    countable,
    projectId: project.id,
  });
  const saved = await services.store.saveRun({
    run,
    workspaceId,
    projectId: project.id,
    totals,
    retainedUntil: retentionBoundary(run.endedAt, 14),
  });
  await services.store.markProjectRun(project.id, run.startedAt, run.status);
  await services.store.appendAudit({
    workspaceId,
    actor: "assistant",
    action: "run.uploaded",
    detail: {
      runId: saved.runId,
      projectId: project.id,
      status: run.status,
      modules: run.modules,
      source: "assistant_module_run",
    },
  });

  const moduleRun = run.moduleRuns[0];
  return {
    module,
    runId: saved.runId,
    reportId: saved.reportId,
    status: run.status,
    totals,
    cases:
      moduleRun?.cases.map((testCase) => ({
        id: testCase.id,
        status: testCase.status,
        ...(testCase.failure
          ? { failure: { code: testCase.failure.code, message: testCase.failure.message } }
          : {}),
      })) ?? [],
    skipped:
      moduleRun?.cases
        .filter((testCase) => testCase.status === "SKIPPED")
        .map((testCase) => ({
          id: testCase.id,
          reason: testCase.skippedReason ?? "no reason recorded",
        })) ?? [],
  };
}

/** Compact diagnosis of a stored run: failures, non-measured cases, and the fix the
 *  control registry already documents. The model writes the recommendation; this
 *  function only supplies facts and known remediations. */
export async function analyzeRun(services: Services, workspaceId: string, runId: string) {
  const report = await services.store.getReportByRunId(workspaceId, runId);
  if (!report) return null;

  const controls = new Map(
    COPILOT_MODULES.flatMap((module) =>
      controlsForModule(module).map((control) => [control.id, control] as const)
    )
  );
  const failures: {
    caseId: string;
    module: string;
    status: string;
    code: string | null;
    message: string | null;
    expected: unknown;
    actual: unknown;
    observed: string | null;
    why: string | null;
    fix: string | null;
    verify: string | null;
    reproduce: string | null;
  }[] = [];
  const skipped: { caseId: string; module: string; reason: string }[] = [];
  const passed: { caseId: string; module: string }[] = [];

  for (const moduleRun of report.moduleRuns) {
    for (const testCase of moduleRun.cases) {
      if (testCase.status === "PASSED") {
        passed.push({ caseId: testCase.id, module: moduleRun.module });
      }
      if (testCase.status === "SKIPPED") {
        skipped.push({
          caseId: testCase.id,
          module: moduleRun.module,
          reason: testCase.skippedReason ?? "no reason recorded",
        });
      }
      if (testCase.status !== "FAILED" && testCase.status !== "ERROR") continue;
      const finding = report.findings.find((item) => item.testCaseId === testCase.id);
      const control = controls.get(testCase.id.replace(/^[a-z]+\//, ""));
      failures.push({
        caseId: testCase.id,
        module: moduleRun.module,
        status: testCase.status,
        code: testCase.failure?.code ?? null,
        message: testCase.failure?.message ?? null,
        expected: finding?.failure?.expected ?? null,
        actual: finding?.failure?.actual ?? null,
        observed: finding?.detail ?? null,
        why: finding?.title ?? null,
        fix: control?.en.fix ?? REMEDIATIONS[testCase.failure?.code ?? ""]?.fix ?? null,
        verify: control?.en.verify ?? REMEDIATIONS[testCase.failure?.code ?? ""]?.verify ?? null,
        reproduce: testCase.reproduction?.summary ?? finding?.reproduction.summary ?? null,
      });
    }
  }

  return {
    run: {
      id: report.id,
      projectId: report.projectId,
      status: report.status,
      environment: report.environment,
      startedAt: report.startedAt,
      endedAt: report.endedAt,
      modules: report.modules,
    },
    totals: report.moduleRuns.map((moduleRun) => ({
      module: moduleRun.module,
      status: moduleRun.status,
      totals: moduleRun.totals,
    })),
    failures,
    skipped,
    passedCount: passed.length,
    note:
      failures.length > 0
        ? "Each failure names the case, the observed value and, when the control registry documents it, the fix and its verification."
        : "No failed case in this run. Do not turn skipped cases into passes; list them with their reasons.",
  };
}
