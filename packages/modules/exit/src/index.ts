import type { ModuleId, ProofstackConfig } from "@proofstack/contracts";
import type { ModuleProvider, SuiteInput, TestSuiteDef } from "@proofstack/engine";
import { buildExitSuites, type ExitCheckOptions } from "./checks.js";
import type { ExportFormat, ExportSource, RoundTripTarget } from "./data.js";
import { CommandExportSource, FileExportSource, HttpExportSource } from "./sources.js";

export const EXIT_VERSION = "0.1.0";

export interface ExitProviderOptions {
  source?: ExportSource;
  roundTrip?: RoundTripTarget;
  formats?: readonly ExportFormat[];
}

/**
 * The EXIT module provider.
 *
 * Like WORLD and FLOW, it resolves its target once and hands the engine a suite. The
 * judgement lives in `checks.ts` so the same assertions run from the CLI, from CI and
 * from a test.
 */
export function createExitProvider(options: ExitProviderOptions = {}): ModuleProvider {
  return {
    id: "exit" as ModuleId,
    version: EXIT_VERSION,
    label: "EXIT",
    suites: (input: SuiteInput): TestSuiteDef[] => {
      const checkOptions: ExitCheckOptions = {
        config: input.config,
        ...(options.source === undefined ? {} : { source: options.source }),
        ...(options.roundTrip === undefined ? {} : { roundTrip: options.roundTrip }),
        ...(options.formats === undefined ? {} : { formats: options.formats }),
      };
      return buildExitSuites(checkOptions);
    },
  };
}

/**
 * Build the export source declared in the project config.
 *
 * Returns `undefined` when EXIT has no source: the module then produces SKIPPED cases
 * with a reason, which is honest about not having tested anything.
 */
export function defaultExportSource(
  config: ProofstackConfig,
  tokenProvider?: () => string | undefined
): ExportSource | undefined {
  const source = config.modules.exit.exportSource;
  if (!source) return undefined;

  switch (source.kind) {
    case "http":
      return new HttpExportSource({
        url: source.value,
        method: source.method,
        headers: source.headers,
        ...(tokenProvider === undefined ? {} : { tokenProvider }),
      });
    case "file":
      return new FileExportSource({ path: source.value });
    case "command":
      // The config stores the command as a single string; split on whitespace only
      // when it has no quoting, and refuse anything that looks like shell syntax.
      return new CommandExportSource({ argv: splitCommand(source.value) });
    default:
      return undefined;
  }
}

/**
 * Split a configured command into argv without invoking a shell.
 *
 * A configured export command is trusted input (it comes from the project's own
 * config file), but it still must not be handed to `sh -c`: the same config is read
 * in CI, and a shell metacharacter in a path would become an injection.
 */
export function splitCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

export * from "./checks.js";
export * from "./data.js";
export * from "./sources.js";
