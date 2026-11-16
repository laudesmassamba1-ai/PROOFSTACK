import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  proofstackConfigSchema,
  validateConfig,
  type ConfigValidationIssue,
  type ProofstackConfig,
} from "@proofstack/contracts";
import { ProofstackError } from "@proofstack/core";

/**
 * Configuration loading.
 *
 * One file drives the CLI, the SDK and the cloud project record. Three formats are
 * supported, in this order of preference:
 *
 *   1. `proofstack.config.ts`  — typed, can import helpers, evaluated by the runtime
 *   2. `proofstack.config.json` — no code execution, safe in a locked-down CI
 *   3. `proofstack` in `package.json` — for projects that do not want a new file
 *
 * The `.ts` path is deliberately last-resort-*capable* but first-*preferred*: it is
 * what a developer wants, and it is only ever loaded from the project the user is
 * standing in. Nothing here fetches a remote config.
 */

export const CONFIG_FILE_NAMES = [
  "proofstack.config.ts",
  "proofstack.config.mts",
  "proofstack.config.js",
  "proofstack.config.mjs",
  "proofstack.config.json",
] as const;

export interface LoadedConfig {
  config: ProofstackConfig;
  /** Absolute path of the file the config came from. */
  path: string;
  /** Directory the config lives in; relative paths resolve against it. */
  root: string;
  /** Non-fatal problems the operator should know about. */
  warnings: ConfigValidationIssue[];
}

export interface LoadConfigOptions {
  /** Directory to search, or an explicit file path. Defaults to cwd. */
  cwd?: string;
  /** Skip the cross-field validation (used by `proofstack doctor` to show everything). */
  skipValidation?: boolean;
}

/**
 * Find and load the project configuration.
 *
 * Throws a `ProofstackError` with an actionable message when nothing is found or the
 * file is invalid. A CLI that silently invents defaults is a CLI that tests the wrong
 * thing and reports success.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const found = await findConfigFile(cwd);

  if (!found) {
    throw new ProofstackError({
      message: `No PROOFSTACK configuration found in ${cwd}. Run \`proofstack init\` to create one.`,
      category: "CONFIGURATION",
      code: "config_not_found",
      details: { searched: [...CONFIG_FILE_NAMES], cwd },
    });
  }

  const raw = await readConfigFile(found.path);
  const parsed = proofstackConfigSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
    }));
    throw new ProofstackError({
      message: `Invalid configuration in ${found.path}:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n")}`,
      category: "CONFIGURATION",
      code: "config_invalid",
      details: { path: found.path, issues },
    });
  }

  const config = parsed.data;
  const warnings = options.skipValidation ? [] : validateConfig(config);

  return {
    config,
    path: found.path,
    root: dirname(found.path),
    warnings,
  };
}

/**
 * Locate the config file, walking up from `cwd` so a command run in a subdirectory
 * still finds the project root. Stops at the filesystem root or at a directory that
 * contains a `.git`, whichever comes first.
 */
export async function findConfigFile(start: string): Promise<{ path: string } | null> {
  // An explicit file path wins over any search.
  if (isAbsolute(start) && !existsSync(start)) {
    return null;
  }
  if (existsSync(start) && !isDirectory(start)) {
    return { path: start };
  }

  let current = resolve(start);
  for (;;) {
    for (const name of CONFIG_FILE_NAMES) {
      const candidate = join(current, name);
      if (existsSync(candidate)) return { path: candidate };
    }

    const packageJson = join(current, "package.json");
    if (existsSync(packageJson)) {
      const fromPackage = await readPackageJsonConfig(packageJson);
      if (fromPackage) return { path: packageJson };
    }

    const parent = dirname(current);
    if (parent === current) return null;
    // A repository root is a natural stopping point: do not escape the project.
    if (existsSync(join(current, ".git"))) return null;
    current = parent;
  }
}

async function readConfigFile(path: string): Promise<unknown> {
  if (path.endsWith("package.json")) {
    const fromPackage = await readPackageJsonConfig(path);
    if (!fromPackage) {
      throw new ProofstackError({
        message: `${path} has no "proofstack" key`,
        category: "CONFIGURATION",
        code: "config_missing_key",
      });
    }
    return fromPackage;
  }

  if (path.endsWith(".json")) {
    const text = await readFile(path, "utf8");
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new ProofstackError({
        message: `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        category: "CONFIGURATION",
        code: "config_json_invalid",
      });
    }
  }

  // A .ts/.js config is a module. Node 22 can import TypeScript directly only with a
  // loader; the CLI ships one, and the error message says so when it is missing.
  try {
    const module = (await import(pathToFileURL(path).href)) as { default?: unknown };
    if (module.default === undefined) {
      throw new ProofstackError({
        message: `${path} must have a default export`,
        category: "CONFIGURATION",
        code: "config_no_default_export",
      });
    }
    return module.default;
  } catch (error) {
    if (error instanceof ProofstackError) throw error;
    throw new ProofstackError({
      message: `Cannot load ${path}: ${error instanceof Error ? error.message : String(error)}. If this is a TypeScript config, run the CLI through \`proofstack\` (it registers a TS loader) rather than importing the file directly.`,
      category: "CONFIGURATION",
      code: "config_load_failed",
      cause: error,
    });
  }
}

async function readPackageJsonConfig(path: string): Promise<unknown | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { proofstack?: unknown };
    return parsed.proofstack ?? null;
  } catch {
    return null;
  }
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && !existsSync(join(path, ".__not_a_dir__"));
  } catch {
    return false;
  }
}

/**
 * The configuration `proofstack init` writes.
 *
 * Every module is enabled but has no target, so the first run produces SKIPPED cases
 * with a reason rather than a false green. That is the honest starting point: the
 * developer sees exactly what still needs wiring.
 */
export function starterConfig(projectName: string, baseUrl: string): ProofstackConfig {
  return proofstackConfigSchema.parse({
    schemaVersion: 1,
    project: { name: projectName, baseUrl },
    environment: "local",
    modules: {
      world: {
        enabled: true,
        profiles: ["en-US", "fr-FR", "fr-BJ"],
        target: { kind: "none" },
      },
      flow: {
        enabled: true,
        paymentMode: "simulated",
        scenarios: ["checkout_success", "checkout_declined", "webhook_duplicate", "webhook_invalid_signature"],
      },
      exit: {
        enabled: true,
        formats: ["json", "csv"],
        target: "synthetic",
      },
    },
    engine: { parallel: 4, timeoutMs: 120_000 },
    output: { dir: ".proofstack/reports", formats: ["json", "text"] },
    sync: { enabled: false },
    enabledModules: ["world", "flow", "exit"],
  });
}

/** Render a config as the TypeScript file `proofstack init` writes. */
export function renderConfigFile(config: ProofstackConfig): string {
  return `import type { ProofstackConfig } from "@proofstack/contracts";

/**
 * PROOFSTACK project configuration.
 *
 * Nothing here is a secret. Tokens are read from environment variables at run time:
 *   PROOFSTACK_PROJECT_TOKEN   cloud sync
 *   PROOFSTACK_WORLD_TOKEN     WORLD target bearer token
 *   PROOFSTACK_FLOW_TOKEN      FLOW target bearer token
 *   PROOFSTACK_WEBHOOK_SECRET  secret used to sign the webhooks FLOW sends
 */
const config: ProofstackConfig = ${JSON.stringify(config, null, 2)};

export default config;
`;
}
