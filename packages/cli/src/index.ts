#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  agentSystemPrompt,
  buildAiRuntime,
  CliAgent,
  describeRuntime,
  runAgent,
  summarizeRunForAgent,
} from "@proofstack/adapter-ai";
import { exitCodeFor, renderReport, runTotals } from "@proofstack/adapter-reporting";
import {
  CONFIG_FILE_NAMES,
  type LoadedConfig,
  loadConfig,
  renderConfigFile,
  starterConfig,
} from "@proofstack/config";
import type { ModuleId, ReportFormat, TestRun } from "@proofstack/contracts";
import { iso, Logger, ProofstackError, stableStringify } from "@proofstack/core";
import { ENGINE_VERSION, runEngine } from "@proofstack/engine";
import { createExitProvider, defaultExportSource } from "@proofstack/module-exit";
import { createFlowProvider, defaultFlowTarget } from "@proofstack/module-flow";
import * as worldProfiles from "@proofstack/module-world";
import { createWorldProvider, HttpProductUnderTest } from "@proofstack/module-world";

/**
 * The PROOFSTACK CLI.
 *
 * Design rules, because a test CLI is trusted with a release decision:
 *
 *   - **Exit codes are a contract.** 0 pass, 1 product defect, 2 harness error,
 *     3 cancelled. CI depends on these, so they are never repurposed.
 *   - **No invented defaults.** A module with no target produces SKIPPED cases with a
 *     reason. It never produces a green run it did not earn.
 *   - **Machine output is clean.** `--json` writes one JSON document to stdout and
 *     nothing else; human chatter goes to stderr.
 *   - **Secrets come from the environment.** A token is read at call time and never
 *     written to a report or a config file.
 */

const CLI_VERSION = "0.1.0";

interface GlobalFlags {
  cwd: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  color: boolean;
}

function parseGlobalFlags(argv: string[]): { flags: GlobalFlags; rest: string[] } {
  const flags: GlobalFlags = {
    cwd: process.cwd(),
    json: false,
    quiet: false,
    verbose: false,
    color: stdout.isTTY && !process.env.NO_COLOR,
  };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case "--json":
        flags.json = true;
        break;
      case "--quiet":
      case "-q":
        flags.quiet = true;
        break;
      case "--verbose":
        flags.verbose = true;
        break;
      case "--no-color":
        flags.color = false;
        break;
      case "--cwd":
        flags.cwd = resolve(argv[++i] ?? ".");
        break;
      default:
        rest.push(arg);
    }
  }
  return { flags, rest };
}

function paint(flags: GlobalFlags, code: string, text: string): string {
  return flags.color ? `\u001B[${code}m${text}\u001B[0m` : text;
}

const green = (f: GlobalFlags, t: string) => paint(f, "32", t);
const red = (f: GlobalFlags, t: string) => paint(f, "31", t);
const yellow = (f: GlobalFlags, t: string) => paint(f, "33", t);
const dim = (f: GlobalFlags, t: string) => paint(f, "2", t);
const bold = (f: GlobalFlags, t: string) => paint(f, "1", t);

function out(flags: GlobalFlags, text: string): void {
  if (!flags.quiet) stdout.write(`${text}\n`);
}

function err(flags: GlobalFlags, text: string): void {
  process.stderr.write(`${text}\n`);
}

// ---------------------------------------------------------------------- commands

async function main(argv: string[]): Promise<number> {
  const { flags, rest } = parseGlobalFlags(argv);
  // `pnpm cli -- test` and `npm exec -- proofstack` forward the separator literally.
  const [command, ...args] = rest[0] === "--" ? rest.slice(1) : rest;

  switch (command) {
    case undefined:
    case "--help":
    case "-h":
    case "help":
      printHelp(flags);
      return 0;
    case "--version":
    case "-v":
    case "version":
      stdout.write(`${CLI_VERSION}\n`);
      return 0;
    case "init":
      return commandInit(flags, args);
    case "doctor":
      return commandDoctor(flags);
    case "validate":
      return commandValidate(flags);
    case "test":
      return commandTest(flags, args);
    case "report":
      return commandReport(flags, args);
    case "projects":
      return commandProjects(flags);
    case "login":
    case "logout":
      return commandAuth(flags, command);
    case "sync":
      return commandSync(flags, args);
    case "ai":
      return commandAi(flags, args);
    default:
      err(flags, `Unknown command: ${command}`);
      printHelp(flags);
      return 64;
  }
}

async function commandInit(flags: GlobalFlags, args: string[]): Promise<number> {
  const root = flags.cwd;
  const existing = CONFIG_FILE_NAMES.map((name: string) => join(root, name)).find((path: string) =>
    existsSync(path)
  );
  if (existing) {
    err(flags, red(flags, `A configuration already exists: ${existing}`));
    err(flags, "Refusing to overwrite it. Delete it first if you want a fresh start.");
    return 1;
  }

  const interactive = stdin.isTTY && !args.includes("--yes");
  let projectName = args.find((a) => !a.startsWith("-")) ?? "";
  let baseUrl = "http://localhost:3000";

  if (interactive) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      projectName =
        (await rl.question(`Project name${projectName ? ` (${projectName})` : ""}: `)).trim() ||
        projectName ||
        "My project";
      baseUrl = (await rl.question(`Base URL under test (${baseUrl}): `)).trim() || baseUrl;
    } finally {
      rl.close();
    }
  } else if (!projectName) {
    projectName = "My project";
  }

  const config = starterConfig(projectName, baseUrl);
  const path = join(root, "proofstack.config.ts");
  await writeFile(path, renderConfigFile(config), "utf8");

  out(flags, green(flags, `Created ${path}`));
  out(flags, "");
  out(flags, "Next steps:");
  out(flags, dim(flags, "  1. Point a module at your app:"));
  out(flags, dim(flags, "       modules.world.target  → your form/record endpoint"));
  out(flags, dim(flags, "       modules.flow.target   → your checkout + webhook receiver"));
  out(flags, dim(flags, "       modules.exit.exportSource → your export endpoint"));
  out(flags, dim(flags, "  2. Run `proofstack doctor` to check the wiring."));
  out(flags, dim(flags, "  3. Run `proofstack test`."));
  out(flags, "");
  out(flags, yellow(flags, "Until a module has a target, its cases are SKIPPED — not passed."));
  return 0;
}

async function commandDoctor(flags: GlobalFlags): Promise<number> {
  const problems: string[] = [];
  const notes: string[] = [];

  out(flags, bold(flags, "PROOFSTACK doctor"));
  out(flags, "");

  // Runtime
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const nodeOk = nodeMajor >= 22;
  out(
    flags,
    `${nodeOk ? green(flags, "ok  ") : red(flags, "FAIL")} node ${process.versions.node}${nodeOk ? "" : " (>= 22 required)"}`
  );
  if (!nodeOk) problems.push("Node 22 or newer is required");

  // Config
  let loaded: LoadedConfig | null = null;
  try {
    loaded = await loadConfig({ cwd: flags.cwd, skipValidation: true });
    out(flags, `${green(flags, "ok  ")} config ${loaded.path}`);
  } catch (error) {
    out(
      flags,
      `${red(flags, "FAIL")} config — ${error instanceof Error ? error.message : String(error)}`
    );
    problems.push("no usable configuration");
  }

  if (loaded) {
    const { config } = loaded;
    out(
      flags,
      `${green(flags, "ok  ")} project "${config.project.name}" → ${config.project.baseUrl}`
    );

    // Module wiring
    for (const moduleId of config.enabledModules) {
      const status = moduleStatus(moduleId, config);
      if (status.ok) {
        out(flags, `${green(flags, "ok  ")} ${moduleId.toUpperCase().padEnd(5)} ${status.detail}`);
      } else {
        out(flags, `${yellow(flags, "warn")} ${moduleId.toUpperCase().padEnd(5)} ${status.detail}`);
        notes.push(`${moduleId}: ${status.detail}`);
      }
    }

    // AI integration: what is configured, and whether its credential is present.
    if (config.ai.enabled) {
      out(
        flags,
        `${green(flags, "ok  ")} AI   autonomy=${config.ai.autonomy} · ${config.ai.providers.length} provider(s), ${config.ai.mcpServers.length} MCP server(s), ${config.ai.agents.length} CLI agent(s)`
      );
      for (const provider of config.ai.providers) {
        if (!provider.apiKeyEnvVar) {
          out(flags, dim(flags, `     ${provider.name}: no key required (${provider.baseUrl})`));
          continue;
        }
        const present = Boolean(process.env[provider.apiKeyEnvVar]);
        out(
          flags,
          `${present ? green(flags, "ok  ") : yellow(flags, "warn")} ${provider.name}: ${provider.apiKeyEnvVar} ${present ? "set" : "not set"}`
        );
        if (!present) notes.push(`AI provider ${provider.name} needs ${provider.apiKeyEnvVar}`);
      }
    } else {
      out(flags, dim(flags, "—    AI   disabled (ai.enabled = false)"));
    }

    // Secrets: presence only, never the value.
    for (const [label, envVar] of [
      ["WORLD token", config.modules.world.target.tokenEnvVar],
      ["FLOW token", readFlowTokenVar(config)],
      ["FLOW webhook secret", readFlowWebhookVar(config)],
      ["cloud sync token", config.sync.tokenEnvVar],
    ] as const) {
      if (!envVar) continue;
      const present = Boolean(process.env[envVar]);
      out(
        flags,
        `${present ? green(flags, "ok  ") : dim(flags, "—   ")} ${label}: ${envVar} ${present ? "set" : "not set"}`
      );
    }

    // Cross-field validation
    const warnings = loaded.warnings;
    if (warnings.length === 0) {
      out(flags, `${green(flags, "ok  ")} configuration is internally consistent`);
    } else {
      for (const warning of warnings) {
        out(flags, `${yellow(flags, "warn")} ${warning.path}: ${warning.message}`);
        if (warning.hint) out(flags, dim(flags, `       ${warning.hint}`));
      }
    }
  }

  out(flags, "");
  if (problems.length === 0) {
    out(flags, green(flags, "No blocking problems."));
    if (notes.length > 0) {
      out(
        flags,
        yellow(
          flags,
          `${notes.length} module(s) are not wired to a target; their cases will be SKIPPED.`
        )
      );
    }
    return 0;
  }
  out(flags, red(flags, `${problems.length} blocking problem(s):`));
  for (const problem of problems) out(flags, `  - ${problem}`);
  return 2;
}

function moduleStatus(
  moduleId: ModuleId,
  config: LoadedConfig["config"]
): { ok: boolean; detail: string } {
  switch (moduleId) {
    case "world": {
      const target = config.modules.world.target;
      if (target.kind === "none") {
        return {
          ok: false,
          detail: "no target configured (target.kind = none) — cases will be SKIPPED",
        };
      }
      if (target.kind === "http" && !target.submitUrl) {
        return { ok: false, detail: "target.kind = http but submitUrl is missing" };
      }
      return { ok: true, detail: `${target.kind} target ${target.submitUrl ?? ""}`.trim() };
    }
    case "flow": {
      const target = readFlowTarget(config);
      if (!target.checkoutUrl) {
        return { ok: false, detail: "no checkoutUrl configured — cases will be SKIPPED" };
      }
      const missing = [
        target.orderUrlTemplate ? null : "orderUrlTemplate",
        target.webhookUrl ? null : "webhookUrl",
      ].filter(Boolean);
      return missing.length === 0
        ? { ok: true, detail: `checkout ${target.checkoutUrl}` }
        : {
            ok: false,
            detail: `checkout set; missing ${missing.join(", ")} — some cases will be SKIPPED`,
          };
    }
    case "exit": {
      const source = config.modules.exit.exportSource;
      if (!source)
        return { ok: false, detail: "no exportSource configured — cases will be SKIPPED" };
      return { ok: true, detail: `${source.kind} export ${source.value}` };
    }
    default:
      return { ok: false, detail: "unknown module" };
  }
}

/**
 * Turn profile ids from `--profiles` into profile objects.
 *
 * The provider validates ids against the installed set and throws a clear error for an
 * unknown one, so an operator who typos `fr-BJ` gets told, rather than silently
 * running fewer profiles than they asked for.
 */
function resolveProfileIds(ids: string[]) {
  const { PROFILES } = worldProfiles;
  const byId = new Map(PROFILES.map((profile) => [profile.id, profile]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new ProofstackError({
      message: `Unknown locale profile(s): ${missing.join(", ")}. Available: ${PROFILES.map((p) => p.id).join(", ")}`,
      category: "CONFIGURATION",
      code: "unknown_profile",
      details: { missing },
    });
  }
  return ids.map((id) => byId.get(id)!);
}

function readFlowTarget(config: LoadedConfig["config"]): {
  checkoutUrl?: string;
  orderUrlTemplate?: string;
  webhookUrl?: string;
  refundUrl?: string;
  tokenEnvVar?: string;
} {
  return (config.modules.flow as unknown as { target?: Record<string, string> }).target ?? {};
}

function readFlowTokenVar(config: LoadedConfig["config"]): string | undefined {
  return readFlowTarget(config).tokenEnvVar;
}

function readFlowWebhookVar(config: LoadedConfig["config"]): string | undefined {
  return (config.modules.flow as unknown as { webhookSecretEnvVar?: string }).webhookSecretEnvVar;
}

async function commandValidate(flags: GlobalFlags): Promise<number> {
  try {
    const loaded = await loadConfig({ cwd: flags.cwd });
    if (flags.json) {
      stdout.write(
        `${stableStringify({ ok: loaded.warnings.length === 0, path: loaded.path, warnings: loaded.warnings }, 2)}\n`
      );
    } else {
      out(flags, green(flags, `Configuration is valid: ${loaded.path}`));
      for (const warning of loaded.warnings) {
        out(flags, yellow(flags, `  warn ${warning.path}: ${warning.message}`));
      }
    }
    return loaded.warnings.length === 0 ? 0 : 1;
  } catch (error) {
    if (flags.json) {
      stdout.write(`${stableStringify({ ok: false, error: describeError(error) }, 2)}\n`);
    } else {
      err(flags, red(flags, describeError(error).message));
    }
    return 2;
  }
}

interface TestArgs {
  modules: ModuleId[];
  only: string[];
  profiles: string[];
  formats: ReportFormat[];
  outputDir?: string;
  noReport: boolean;
  failOnWarning: boolean;
  seed?: number;
}

const TEST_MODULES = ["world", "flow", "exit"] as const;
const REPORT_FORMATS = ["json", "junit", "html", "text"] as const;

function flagError(message: string): ProofstackError {
  return new ProofstackError({ message, category: "CONFIGURATION", code: "bad_flag" });
}

function parseTestArgs(args: string[]): TestArgs {
  const parsed: TestArgs = {
    modules: [],
    only: [],
    profiles: [],
    formats: [],
    noReport: false,
    failOnWarning: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const next = () => {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) {
        throw flagError(`${arg} needs a value.`);
      }
      return value;
    };
    switch (arg) {
      case "--module":
      case "-m": {
        const value = next();
        for (const part of value.split(",")) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          if (!(TEST_MODULES as readonly string[]).includes(trimmed)) {
            throw flagError(
              `Unknown module "${trimmed}". Available: ${TEST_MODULES.join(", ")}.`
            );
          }
          parsed.modules.push(trimmed as ModuleId);
        }
        break;
      }
      case "--only": {
        const value = next().trim();
        if (!value) throw flagError("--only needs a case id, category or name fragment.");
        parsed.only.push(value);
        break;
      }
      case "--profile":
      case "--profiles":
        parsed.profiles.push(
          ...next()
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean)
        );
        break;
      case "--format": {
        for (const part of next().split(",")) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          if (!(REPORT_FORMATS as readonly string[]).includes(trimmed)) {
            throw flagError(
              `Unknown report format "${trimmed}". Available: ${REPORT_FORMATS.join(", ")}.`
            );
          }
          parsed.formats.push(trimmed as ReportFormat);
        }
        break;
      }
      case "--out":
        parsed.outputDir = next();
        break;
      case "--no-report":
        parsed.noReport = true;
        break;
      case "--fail-on-warning":
        parsed.failOnWarning = true;
        break;
      case "--seed": {
        const raw = next();
        const value = Number(raw);
        if (!Number.isInteger(value)) {
          throw flagError(`--seed needs an integer, got "${raw}".`);
        }
        parsed.seed = value;
        break;
      }
      default:
        break;
    }
  }
  return parsed;
}

async function commandTest(flags: GlobalFlags, args: string[]): Promise<number> {
  let testArgs: TestArgs;
  try {
    testArgs = parseTestArgs(args);
  } catch (error) {
    err(flags, red(flags, describeError(error).message));
    return 64;
  }
  let loaded: LoadedConfig;
  try {
    loaded = await loadConfig({ cwd: flags.cwd });
  } catch (error) {
    err(flags, red(flags, describeError(error).message));
    return 2;
  }

  // `--seed` must change the run, not be silently dropped. Everything below (providers
  // included) sees the overridden engine config.
  const config =
    testArgs.seed === undefined
      ? loaded.config
      : { ...loaded.config, engine: { ...loaded.config.engine, seed: testArgs.seed } };
  const modules = testArgs.modules.length > 0 ? testArgs.modules : config.enabledModules;

  // Refuse an unsafe configuration before running anything.
  const blocking = loaded.warnings.filter(
    (warning: { message: string }) =>
      warning.message.includes("refused") ||
      warning.message.includes("not allowed") ||
      warning.message.includes("requires")
  );
  if (blocking.length > 0) {
    err(flags, red(flags, "Refusing to run: the configuration is unsafe."));
    for (const warning of blocking) err(flags, `  - ${warning.path}: ${warning.message}`);
    return 2;
  }

  const logger = new Logger({ level: flags.verbose ? "debug" : flags.quiet ? "error" : "warn" });
  const tokenFor = (envVar: string | undefined) => (envVar ? () => process.env[envVar] : undefined);

  const providers = [];
  if (modules.includes("world")) {
    const worldTarget =
      config.modules.world.target.kind === "http"
        ? new HttpProductUnderTest({
            config,
            ...(config.modules.world.target.tokenEnvVar
              ? { tokenProvider: tokenFor(config.modules.world.target.tokenEnvVar) }
              : {}),
          })
        : undefined;
    providers.push(
      createWorldProvider({
        ...(worldTarget === undefined ? {} : { target: worldTarget }),
        ...(testArgs.profiles.length === 0
          ? {}
          : { profiles: resolveProfileIds(testArgs.profiles) }),
      })
    );
  }
  if (modules.includes("flow")) {
    const flowTarget = defaultFlowTarget(config, tokenFor(readFlowTokenVar(config)));
    const webhookSecretVar = readFlowWebhookVar(config);
    providers.push(
      createFlowProvider({
        ...(flowTarget === undefined ? {} : { target: flowTarget }),
        ...(webhookSecretVar && process.env[webhookSecretVar]
          ? { webhookSecret: process.env[webhookSecretVar] }
          : {}),
      })
    );
  }
  if (modules.includes("exit")) {
    const source = defaultExportSource(config, tokenFor(undefined));
    providers.push(createExitProvider({ ...(source === undefined ? {} : { source }) }));
  }

  if (providers.length === 0) {
    err(flags, red(flags, "No modules selected."));
    return 64;
  }

  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof runEngine>>;
  try {
    result = await runEngine({
      config,
      providers,
      only: modules,
      ...(testArgs.only.length === 0 ? {} : { onlyCases: testArgs.only }),
      ...(testArgs.profiles.length === 0 ? {} : { profiles: testArgs.profiles }),
      logger,
      projectId: `local:${config.project.name}`,
      workspaceId: "local",
      cliVersion: CLI_VERSION,
      host: {
        platform: process.platform,
        nodeVersion: process.versions.node,
        ci: Boolean(process.env.CI),
      },
    });
  } catch (error) {
    err(flags, red(flags, `Run failed to start: ${describeError(error).message}`));
    return 2;
  }

  const run = result.run;

  // Reports
  const outputDir = resolve(loaded.root, testArgs.outputDir ?? config.output.dir);
  if (!testArgs.noReport) {
    await mkdir(outputDir, { recursive: true });
    const formats = testArgs.formats.length > 0 ? testArgs.formats : config.output.formats;
    const written: string[] = [];
    for (const format of formats) {
      const fileName =
        format === "json"
          ? config.output.jsonFile
          : format === "junit"
            ? config.output.junitFile
            : format === "html"
              ? config.output.htmlFile
              : `run-${run.id}.txt`;
      const path = join(outputDir, fileName);
      await writeFile(
        path,
        renderReport(run, format, { projectName: config.project.name }),
        "utf8"
      );
      written.push(path);
    }
    if (!flags.json && !flags.quiet) {
      out(flags, "");
      for (const path of written) out(flags, dim(flags, `report → ${path}`));
    }
  }

  // Human summary
  if (flags.json) {
    stdout.write(`${stableStringify(run, 2)}\n`);
  } else {
    const totals = runTotals(run);
    out(flags, "");
    out(
      flags,
      renderReport(run, "text", {
        projectName: config.project.name,
        verbose: flags.verbose,
      }).trimEnd()
    );
    void totals;
  }

  if (process.env.CI && !flags.quiet && !flags.json) {
    out(
      flags,
      dim(
        flags,
        `elapsed ${((Date.now() - startedAt) / 1000).toFixed(1)}s · engine ${ENGINE_VERSION}`
      )
    );
  }

  const code = exitCodeFor(run);

  // A run where nothing was verified is not a crash and not a pass. Say so plainly,
  // because "exit 2" with no explanation reads like the tool broke.
  if (run.status === "NOTHING_VERIFIED" && !flags.json) {
    out(flags, "");
    out(flags, yellow(flags, "Nothing was verified: every case was skipped."));
    out(flags, "Wire at least one module to a target, then run again:");
    out(flags, dim(flags, '  modules.world.target.kind = "http"  (with submitUrl)'));
    out(flags, dim(flags, "  modules.flow.target.checkoutUrl"));
    out(flags, dim(flags, "  modules.exit.exportSource"));
    out(flags, dim(flags, "`proofstack doctor` lists exactly what is missing."));
  }

  if (testArgs.failOnWarning && code === 0 && runTotals(run).warnings > 0) return 1;
  return code;
}

async function commandReport(flags: GlobalFlags, args: string[]): Promise<number> {
  const requested = args.find((arg) => !arg.startsWith("--") && !arg.endsWith(".json"));
  if (requested !== undefined && !(REPORT_FORMATS as readonly string[]).includes(requested)) {
    err(
      flags,
      red(flags, `Unknown report format "${requested}". Available: ${REPORT_FORMATS.join(", ")}.`)
    );
    return 64;
  }
  const format = (requested ?? "text") as ReportFormat;
  const runPath = args.find((a) => a.endsWith(".json"));

  let loaded: LoadedConfig | null = null;
  try {
    loaded = await loadConfig({ cwd: flags.cwd, skipValidation: true });
  } catch {
    loaded = null;
  }

  const path = runPath
    ? resolve(flags.cwd, runPath)
    : loaded
      ? resolve(loaded.root, loaded.config.output.dir, loaded.config.output.jsonFile)
      : null;

  if (!path || !existsSync(path)) {
    err(
      flags,
      red(flags, `No run report found${path ? ` at ${path}` : ""}. Run \`proofstack test\` first.`)
    );
    return 2;
  }

  let run: TestRun;
  try {
    run = JSON.parse(await readFile(path, "utf8")) as TestRun;
  } catch (error) {
    err(flags, red(flags, `Cannot read ${path}: ${describeError(error).message}`));
    return 2;
  }

  stdout.write(renderReport(run, format, { projectName: loaded?.config.project.name }));
  return 0;
}

async function commandProjects(flags: GlobalFlags): Promise<number> {
  // Local projects only. Cloud projects need a token, and pretending otherwise would
  // be a fake feature; the message says exactly what is missing.
  let loaded: LoadedConfig | null = null;
  try {
    loaded = await loadConfig({ cwd: flags.cwd, skipValidation: true });
  } catch {
    loaded = null;
  }

  if (!loaded) {
    err(flags, red(flags, "No configuration found in this directory."));
    return 2;
  }

  const rows = [
    {
      name: loaded.config.project.name,
      baseUrl: loaded.config.project.baseUrl,
      environment: loaded.config.environment,
      modules: loaded.config.enabledModules.join(","),
      source: "local",
      configPath: loaded.path,
    },
  ];

  if (flags.json) {
    stdout.write(
      `${stableStringify({ projects: rows, cloud: { available: false, reason: "no project token configured" } }, 2)}\n`
    );
    return 0;
  }

  out(flags, bold(flags, "Local projects"));
  for (const row of rows) {
    out(flags, `  ${row.name}  ${dim(flags, row.baseUrl)}  [${row.modules}]`);
  }
  out(flags, "");
  out(
    flags,
    dim(
      flags,
      "Cloud projects require a project token (PROOFSTACK_PROJECT_TOKEN) and a running API."
    )
  );
  return 0;
}

async function commandAuth(flags: GlobalFlags, command: "login" | "logout"): Promise<number> {
  if (command === "logout") {
    out(flags, "No credentials are stored by this CLI build.");
    out(
      flags,
      dim(flags, "Tokens are read from environment variables, so there is nothing to remove.")
    );
    return 0;
  }

  out(flags, bold(flags, "proofstack login"));
  out(flags, "");
  out(flags, "This CLI authenticates with a project token, not a password.");
  out(flags, "");
  out(flags, "  1. Create a project token in the dashboard (Integrations → API keys).");
  out(flags, "  2. Export it in your shell or CI secret store:");
  out(flags, dim(flags, "       export PROOFSTACK_PROJECT_TOKEN=ps_..."));
  out(flags, "  3. Enable sync in proofstack.config.ts:");
  out(flags, dim(flags, '       sync: { enabled: true, apiUrl: "https://your-api.example" }'));
  out(flags, "");
  out(flags, yellow(flags, "No token is written to disk by this command, by design."));
  return 0;
}

async function commandSync(flags: GlobalFlags, args: string[]): Promise<number> {
  let loaded: LoadedConfig;
  try {
    loaded = await loadConfig({ cwd: flags.cwd });
  } catch (error) {
    err(flags, red(flags, describeError(error).message));
    return 2;
  }

  const { config } = loaded;
  if (!config.sync.enabled || !config.sync.apiUrl) {
    err(
      flags,
      red(flags, "Sync is not configured. Set sync.enabled = true and sync.apiUrl in your config.")
    );
    return 2;
  }

  const token = process.env[config.sync.tokenEnvVar];
  if (!token) {
    err(
      flags,
      red(
        flags,
        `${config.sync.tokenEnvVar} is not set. Run \`proofstack login\` for instructions.`
      )
    );
    return 2;
  }

  const runPath =
    args.find((a) => a.endsWith(".json")) ?? join(config.output.dir, config.output.jsonFile);
  const path = resolve(loaded.root, runPath);
  if (!existsSync(path)) {
    err(flags, red(flags, `No run report at ${path}. Run \`proofstack test\` first.`));
    return 2;
  }

  let run: TestRun;
  try {
    run = JSON.parse(await readFile(path, "utf8")) as TestRun;
  } catch (error) {
    err(flags, red(flags, `Cannot read ${path}: ${describeError(error).message}`));
    return 2;
  }

  // Send real totals: the API recomputes them from moduleRuns, but a payload that
  // claims zero cases for a 400-case run is wrong on its face for any other consumer.
  const payload = stableStringify({ run, summary: runTotals(run) });
  if (Buffer.byteLength(payload) > config.sync.maxPayloadBytes) {
    err(
      flags,
      red(
        flags,
        `Payload is ${Buffer.byteLength(payload)} bytes, over the ${config.sync.maxPayloadBytes} byte limit. ` +
          "Run with fewer cases or raise sync.maxPayloadBytes."
      )
    );
    return 2;
  }

  try {
    const response = await fetch(`${config.sync.apiUrl.replace(/\/+$/, "")}/v1/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: payload,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      err(flags, red(flags, `Sync failed: HTTP ${response.status} ${text.slice(0, 400)}`));
      return 2;
    }
    const body = (await response.json().catch(() => ({}))) as {
      runId?: string;
      recorded?: boolean;
    };
    if (flags.json) {
      stdout.write(`${stableStringify({ ok: true, ...body }, 2)}\n`);
    } else {
      out(
        flags,
        green(flags, `Synced run ${run.id}${body.recorded === false ? " (already recorded)" : ""}`)
      );
    }
    return 0;
  } catch (error) {
    err(flags, red(flags, `Sync failed: ${describeError(error).message}`));
    return 2;
  }
}

// ------------------------------------------------------------------------ ai commands

/**
 * `proofstack ai …`
 *
 * Four subcommands, each of which does exactly one thing and says when it cannot:
 *
 *   status  — what is configured and what actually connected
 *   tools   — every MCP tool the agent would be allowed to call
 *   ask     — one question to a provider, with the last run as context
 *   agent   — the bounded loop: provider + MCP tools + a real task
 *
 * Every command refuses politely when `ai.enabled` is false. None of them invent a
 * provider, and none of them store a key.
 */
async function commandAi(flags: GlobalFlags, args: string[]): Promise<number> {
  const [sub, ...rest] = args;

  let loaded: LoadedConfig;
  try {
    loaded = await loadConfig({ cwd: flags.cwd, skipValidation: true });
  } catch (error) {
    err(flags, red(flags, describeError(error).message));
    return 2;
  }

  const { ai } = loaded.config;

  if (!ai.enabled) {
    if (sub === "status" || sub === undefined) {
      out(flags, bold(flags, "AI integration"));
      out(flags, "");
      out(flags, dim(flags, "ai.enabled is false."));
      out(flags, "");
      out(flags, "To turn it on, add an ai block to your config:");
      out(flags, dim(flags, "  ai: { enabled: true, providers: [...], mcpServers: [...] }"));
      out(flags, dim(flags, "See docs/guides/AI_INTEGRATION.md."));
      return 0;
    }
    err(flags, red(flags, "AI integration is disabled. Set ai.enabled = true in your config."));
    return 2;
  }

  switch (sub) {
    case undefined:
    case "status": {
      const connect = connectServers(rest);
      const runtime = await buildAiRuntime({
        config: ai,
        ...(connect === undefined
          ? {}
          : {
              connectServers: connect.length > 0 ? connect : ai.mcpServers.map((s) => s.name),
            }),
        onStderr: (server, chunk) => {
          if (flags.verbose) err(flags, dim(flags, `[${server}] ${chunk.trimEnd()}`));
        },
      });
      try {
        if (flags.json) {
          stdout.write(
            `${stableStringify(
              {
                enabled: ai.enabled,
                autonomy: ai.autonomy,
                providers: runtime.providers.map((p) => ({
                  name: p.name,
                  model: p.model,
                  supportsTools: p.supportsTools,
                  default: runtime.defaultProvider?.name === p.name,
                })),
                mcpServers: runtime.mcpClients.map((c) => ({
                  name: c.name,
                  server: c.serverInfo,
                })),
                mcpTools: runtime.mcpTools.map((t) => ({
                  name: t.definition.name,
                  effect: t.effect ?? "write",
                })),
                agents: ai.agents.map((a) => ({
                  name: a.name,
                  allowFileWrites: a.allowFileWrites,
                })),
                warnings: runtime.warnings,
              },
              2
            )}\n`
          );
          return 0;
        }

        out(flags, bold(flags, "AI integration"));
        out(
          flags,
          dim(
            flags,
            `autonomy: ${ai.autonomy} · max turns: ${ai.maxTurns} · token budget: ${ai.maxTokensPerSession}`
          )
        );
        out(flags, "");
        for (const line of describeRuntime(runtime)) out(flags, line);

        if (ai.agents.length > 0) {
          out(flags, "");
          out(flags, `external agents: ${ai.agents.length}`);
          for (const agent of ai.agents) {
            out(
              flags,
              `  ${agent.name} — ${agent.command.join(" ")}${agent.allowFileWrites ? " (may write files)" : ""}`
            );
          }
        }

        const connected = runtime.mcpClients.length;
        const configured = ai.mcpServers.length;
        if (configured > connected) {
          out(flags, "");
          out(
            flags,
            dim(
              flags,
              `${configured - connected} server(s) not connected (autoConnect is false; use --connect).`
            )
          );
        }
        return 0;
      } finally {
        await runtime.close();
      }
    }

    case "tools": {
      const runtime = await buildAiRuntime({
        config: ai,
        connectServers: ai.mcpServers.map((s) => s.name),
        onStderr: (server, chunk) => {
          if (flags.verbose) err(flags, dim(flags, `[${server}] ${chunk.trimEnd()}`));
        },
      });
      try {
        if (flags.json) {
          stdout.write(
            `${stableStringify(
              runtime.mcpTools.map((t) => ({
                name: t.definition.name,
                effect: t.effect ?? "write",
                description: t.definition.description,
                parameters: t.definition.parameters,
              })),
              2
            )}\n`
          );
          return 0;
        }
        if (runtime.mcpTools.length === 0) {
          out(flags, yellow(flags, "No MCP tools available."));
          for (const warning of runtime.warnings) out(flags, dim(flags, `  ${warning}`));
          return 0;
        }
        out(flags, bold(flags, `${runtime.mcpTools.length} MCP tool(s)`));
        for (const tool of runtime.mcpTools) {
          const effect = tool.effect ?? "write";
          const tag = effect === "read" ? green(flags, "read ") : yellow(flags, "write");
          out(flags, `  ${tag} ${tool.definition.name}`);
          if (tool.definition.description)
            out(flags, dim(flags, `        ${tool.definition.description}`));
        }
        return 0;
      } finally {
        await runtime.close();
      }
    }

    case "ask": {
      const question = aiPositionals(rest).join(" ").trim();
      if (!question) {
        err(flags, red(flags, 'Usage: proofstack ai ask "your question"'));
        return 64;
      }
      const providerName = flagValue(rest, "--provider");
      const runtime = await buildAiRuntime({ config: ai });
      try {
        const provider = providerName
          ? runtime.providers.find((p) => p.name === providerName)
          : runtime.defaultProvider;
        if (!provider) {
          err(
            flags,
            red(
              flags,
              providerName ? `No provider named "${providerName}".` : "No AI provider configured."
            )
          );
          for (const warning of runtime.warnings) err(flags, dim(flags, `  ${warning}`));
          return 2;
        }

        const context = await lastRunSummary(loaded);
        const response = await provider.chat({
          messages: [
            { role: "system", content: agentSystemPrompt(loaded.config.project.name) },
            {
              role: "user",
              content: context ? `${context}\n\n---\n\n${question}` : question,
            },
          ],
        });

        if (flags.json) {
          stdout.write(
            `${stableStringify({ provider: provider.name, model: response.model, answer: response.message.content, usage: response.usage }, 2)}\n`
          );
        } else {
          out(flags, response.message.content.trim());
          if (response.usage)
            out(
              flags,
              dim(
                flags,
                `\n${response.usage.totalTokens} tokens · ${provider.name}/${response.model}`
              )
            );
        }
        return 0;
      } finally {
        await runtime.close();
      }
    }

    case "agent": {
      const task = aiPositionals(rest).join(" ").trim();
      if (!task) {
        err(flags, red(flags, 'Usage: proofstack ai agent "what to investigate"'));
        return 64;
      }
      const providerName = flagValue(rest, "--provider");
      const agentName = flagValue(rest, "--cli-agent");

      // An external agent takes precedence: if the operator named one, they want it.
      if (agentName) {
        const config = ai.agents.find((a) => a.name === agentName);
        if (!config) {
          err(
            flags,
            red(
              flags,
              `No CLI agent named "${agentName}". Configured: ${ai.agents.map((a) => a.name).join(", ") || "none"}`
            )
          );
          return 2;
        }
        const context = await lastRunSummary(loaded);
        const prompt = [
          agentSystemPrompt(loaded.config.project.name),
          "",
          context ?? "(no run report found)",
          "",
          "---",
          "",
          task,
        ].join("\n");
        const agent = new CliAgent(config);
        const result = await agent.run(prompt);
        if (flags.json) {
          stdout.write(`${stableStringify(result, 2)}\n`);
        } else {
          if (result.answer) out(flags, result.answer);
          if (result.stderr) err(flags, dim(flags, result.stderr));
          out(
            flags,
            dim(
              flags,
              `\n${result.agent} exited ${result.exitCode} in ${(result.durationMs / 1000).toFixed(1)}s${result.timedOut ? " (timed out)" : ""}`
            )
          );
        }
        return result.exitCode === 0 ? 0 : 1;
      }

      const runtime = await buildAiRuntime({
        config: ai,
        connectServers: ai.mcpServers.map((s) => s.name),
        onStderr: (server, chunk) => {
          if (flags.verbose) err(flags, dim(flags, `[${server}] ${chunk.trimEnd()}`));
        },
      });
      try {
        const provider = providerName
          ? runtime.providers.find((p) => p.name === providerName)
          : runtime.defaultProvider;
        if (!provider) {
          err(flags, red(flags, "No AI provider configured, so the agent loop cannot run."));
          for (const warning of runtime.warnings) err(flags, dim(flags, `  ${warning}`));
          return 2;
        }

        const context = await lastRunSummary(loaded);
        const result = await runAgent({
          chat: async (request) => provider.chat(request),
          tools: runtime.mcpTools,
          systemPrompt: agentSystemPrompt(loaded.config.project.name),
          userPrompt: [context ?? "(no run report found)", "", "---", "", task].join("\n"),
          autonomy: ai.autonomy,
          maxTurns: ai.maxTurns,
          maxTokensPerSession: ai.maxTokensPerSession,
          // Anything above `read` needs a human. In a non-interactive run there is no
          // human, so the answer is no — the agent reports it instead of acting.
          ...(ai.autonomy === "read"
            ? {}
            : {
                approve: async (request: { tool: string; args: Record<string, unknown> }) => {
                  if (!stdin.isTTY) {
                    err(
                      flags,
                      yellow(
                        flags,
                        `refused ${request.tool}: no interactive terminal to approve it`
                      )
                    );
                    return false;
                  }
                  const rl = createInterface({ input: stdin, output: stdout });
                  try {
                    const answer = await rl.question(
                      `Allow ${request.tool}(${JSON.stringify(request.args).slice(0, 120)})? [y/N] `
                    );
                    return answer.trim().toLowerCase().startsWith("y");
                  } finally {
                    rl.close();
                  }
                },
              }),
          onEvent: flags.verbose
            ? (event) => {
                if (event.type === "tool_call") err(flags, dim(flags, `→ ${event.tool}`));
                if (event.type === "tool_refused")
                  err(flags, yellow(flags, `refused ${event.tool}: ${event.reason}`));
              }
            : undefined,
        });

        if (flags.json) {
          stdout.write(`${stableStringify(result, 2)}\n`);
        } else {
          if (result.answer) out(flags, result.answer);
          if (result.error) err(flags, red(flags, result.error));
          out(flags, "");
          out(
            flags,
            dim(
              flags,
              `${result.turns} turn(s), ${result.steps.length} tool call(s), ${result.tokensUsed} tokens · stopped: ${result.stopReason}`
            )
          );
          for (const step of result.steps.filter((s) => s.refused)) {
            out(flags, yellow(flags, `  refused ${step.tool}: ${step.refused}`));
          }
        }
        return result.stopReason === "provider_error" ? 2 : 0;
      } finally {
        await runtime.close();
      }
    }

    default:
      err(flags, red(flags, `Unknown ai subcommand: ${sub}`));
      out(flags, '  proofstack ai status | tools | ask "..." | agent "..."');
      return 64;
  }
}

/** Read `--flag value` from an argv slice. */
function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

/**
 * Parse `--connect [a,b]` for the AI commands.
 *
 *   omitted          → only autoConnect servers
 *   `--connect`      → every configured server
 *   `--connect a,b`  → exactly those servers
 */
function connectServers(args: string[]): string[] | undefined {
  const index = args.indexOf("--connect");
  if (index < 0) return undefined;
  const next = args[index + 1];
  if (next === undefined || next.startsWith("--")) return [];
  return next
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Positional words of an `ai ask` / `ai agent` command.
 *
 * Flags and their values must never leak into the prompt: `ai ask "why?" --provider
 * local` used to send "why? local" to the model.
 */
function aiPositionals(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--provider" || arg === "--cli-agent") {
      i += 1;
      continue;
    }
    if (arg === "--connect") {
      if (args[i + 1] !== undefined && !args[i + 1]!.startsWith("--")) i += 1;
      continue;
    }
    if (arg.startsWith("--")) continue;
    out.push(arg);
  }
  return out;
}

/** Load the last run and render it as compact context, or null when there is none. */
async function lastRunSummary(loaded: LoadedConfig): Promise<string | null> {
  const path = resolve(loaded.root, loaded.config.output.dir, loaded.config.output.jsonFile);
  if (!existsSync(path)) return null;
  try {
    const run = JSON.parse(await readFile(path, "utf8")) as TestRun;
    return summarizeRunForAgent(run);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------ helpers

function describeError(error: unknown): { message: string; code?: string; category?: string } {
  if (error instanceof ProofstackError) {
    return { message: error.message, code: error.code, category: error.category };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

function printHelp(flags: GlobalFlags): void {
  const w = (text: string): void => {
    stdout.write(`${text}\n`);
  };
  w(bold(flags, "PROOFSTACK — make software work everywhere"));
  w("");
  w("Usage: proofstack <command> [options]");
  w("");
  w(bold(flags, "Commands"));
  w("  init                     Create proofstack.config.ts in this directory");
  w("  doctor                   Check the runtime, config and module wiring");
  w("  validate                 Validate the configuration and exit");
  w("  test                     Run the enabled modules");
  w("  report [json|junit|html|text]   Render the last run");
  w("  projects                 List projects");
  w("  login | logout           How to authenticate (token-based)");
  w("  sync                     Upload the last run to the API");
  w("  ai <status|ask|agent>    MCP servers, AI providers and external agents");
  w("");
  w(bold(flags, "test options"));
  w("  --module, -m <ids>       world,flow,exit (repeatable or comma-separated)");
  w("  --only <pattern>         Run only cases matching a fixture id or category");
  w("  --profiles <ids>         Locale profiles, e.g. en-US,fr-FR,fr-BJ");
  w("  --format <formats>       json,junit,html,text");
  w("  --out <dir>              Report directory (default: .proofstack/reports)");
  w("  --no-report              Do not write report files");
  w("  --fail-on-warning        Exit 1 when a case produced a warning");
  w("");
  w(bold(flags, "global options"));
  w("  --json                   Machine-readable output on stdout");
  w("  --quiet, -q              Suppress human output");
  w("  --verbose                Show every case, including passes");
  w("  --no-color               Disable colour");
  w("  --cwd <dir>              Run against another directory");
  w("");
  w(bold(flags, "exit codes"));
  w("  0  all cases passed (skips allowed)");
  w("  1  at least one product defect");
  w("  2  harness error or invalid configuration");
  w("  3  run cancelled");
  w("");
  w(dim(flags, `cli ${CLI_VERSION} · engine ${ENGINE_VERSION} · ${iso()}`));
}

// --------------------------------------------------------------------------- entry

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `proofstack: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
    process.exitCode = 2;
  });
