import type { LoadedConfig } from "@proofcore/config";
import type { ModuleId } from "@proofcore/contracts";
import { ProofCoreError } from "@proofcore/core";
import type { ModuleProvider } from "@proofcore/engine";
import { createExitProvider, defaultExportSource } from "@proofcore/module-exit";
import { createFlowProvider, defaultFlowTarget } from "@proofcore/module-flow";
import * as worldProfiles from "@proofcore/module-world";
import { createWorldProvider, HttpProductUnderTest } from "@proofcore/module-world";

/**
 * Shared module provider assembly for every entry surface that runs the engine:
 * `proofcore test`, the MCP server's `run_tests` tool, and any future one.
 *
 * One place, one behaviour: the same target resolution, the same environment
 * token lookups, and the same refusal to invent providers for modules the
 * configuration does not enable. If a module is requested but the configuration
 * has no usable target, the provider is skipped — the engine then reports what
 * actually ran instead of a surface pretending.
 */

export function resolveProfileIds(ids: string[]) {
  const { PROFILES } = worldProfiles;
  const byId = new Map(PROFILES.map((profile) => [profile.id, profile]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new ProofCoreError({
      message: `Unknown locale profile(s): ${missing.join(", ")}. Available: ${PROFILES.map((p) => p.id).join(", ")}`,
      category: "CONFIGURATION",
      code: "unknown_profile",
      details: { missing },
    });
  }
  return ids.map((id) => byId.get(id)).filter((def) => def !== undefined);
}

/** Warnings that mean "do not run anything": the configuration is unsafe. */
export function blockingSafetyWarnings(warnings: readonly { message: string }[]): string[] {
  return warnings
    .map((warning) => warning.message)
    .filter(
      (message) =>
        message.includes("refused") ||
        message.includes("not allowed") ||
        message.includes("requires")
    );
}

export async function assembleProviders(
  loaded: LoadedConfig,
  modules: readonly ModuleId[],
  options: { profiles?: string[] } = {}
): Promise<ModuleProvider[]> {
  const config = loaded.config;
  const tokenFor = (envVar: string | undefined) => (envVar ? () => process.env[envVar] : undefined);
  const providers: ModuleProvider[] = [];

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
        ...(options.profiles === undefined || options.profiles.length === 0
          ? {}
          : { profiles: resolveProfileIds(options.profiles) }),
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

  return providers;
}

function readFlowTokenVar(config: LoadedConfig["config"]): string | undefined {
  return readFlowTarget(config).tokenEnvVar;
}

function readFlowWebhookVar(config: LoadedConfig["config"]): string | undefined {
  return (config.modules.flow as unknown as { webhookSecretEnvVar?: string }).webhookSecretEnvVar;
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
