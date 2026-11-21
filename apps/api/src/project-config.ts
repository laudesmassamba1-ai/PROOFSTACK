import {
  type ConfigValidationIssue,
  exitConfigSchema,
  flowConfigSchema,
  type ProofCoreConfig,
  proofcoreConfigSchema,
  validateConfig,
  worldConfigSchema,
} from "@proofcore/contracts";
import { z } from "zod";
import type { ProjectRecord } from "./store/app-store.js";

/**
 * The module configuration is the one in `proofcore.config.ts`, edited from the web.
 *
 * The schema is not duplicated here: the request body is validated with the same
 * `worldConfigSchema`/`flowConfigSchema`/`exitConfigSchema` the CLI parses, then the
 * whole project config is rebuilt and passed through `validateConfig`. A setting that
 * would be refused locally is refused here, with the same path and explanation.
 *
 * Only the module subtree and the one explicit safety acknowledgement are stored. The
 * project name, base URL, environment and enabled modules stay in their own columns, so
 * renaming a project never leaves a second, stale copy of its identity in this blob.
 */

export const projectConfigInputSchema = z
  .object({
    modules: z
      .object({
        world: worldConfigSchema,
        flow: flowConfigSchema,
        exit: exitConfigSchema,
      })
      .strict(),
    allowDestructiveProduction: z.boolean().default(false),
  })
  .strict();

export type ProjectConfigInput = z.infer<typeof projectConfigInputSchema>;

const storedSchema = projectConfigInputSchema.extend({ savedAt: z.string() });

export interface StoredProjectConfig extends ProjectConfigInput {
  savedAt: string;
}

export function readStoredProjectConfig(raw: string | null): StoredProjectConfig | null {
  if (!raw) return null;
  try {
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // A row written by an older, incompatible shape is treated as "not configured yet"
    // instead of crashing every project read.
    return null;
  }
}

export function buildProjectConfig(
  project: ProjectRecord,
  stored: StoredProjectConfig | null
): ProofCoreConfig {
  return proofcoreConfigSchema.parse({
    schemaVersion: 1,
    project: {
      name: project.name,
      baseUrl: project.baseUrl,
      ...(project.stack ? { stack: project.stack } : {}),
    },
    environment: project.environment,
    enabledModules:
      project.enabledModules.length > 0 ? project.enabledModules : ["world", "flow", "exit"],
    allowDestructiveProduction: stored?.allowDestructiveProduction ?? false,
    ...(stored ? { modules: stored.modules } : {}),
  });
}

/**
 * Issues that must block a save, as opposed to advice.
 *
 * A missing WORLD target is a warning: it produces SKIPPED cases with a reason, and the
 * person may be configuring progressively. A real charge, or an unacknowledged
 * destructive production target, is never saved from a web form.
 */
export function blockingIssues(issues: ConfigValidationIssue[]): ConfigValidationIssue[] {
  return issues.filter((issue) =>
    /live_charge|refused|not allowed|requires allowDestructiveProduction/i.test(
      `${issue.path} ${issue.message}`
    )
  );
}

export function projectConfigIssues(config: ProofCoreConfig): ConfigValidationIssue[] {
  return validateConfig(config);
}
