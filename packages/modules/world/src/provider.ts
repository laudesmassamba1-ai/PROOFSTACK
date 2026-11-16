import type { LocaleProfileData, ModuleId, ProofstackConfig } from "@proofstack/contracts";
import { localeProfileFileSchema } from "@proofstack/contracts";
import { ProofstackError } from "@proofstack/core";
import type { ModuleProvider, SuiteInput, TestSuiteDef } from "@proofstack/engine";
import { buildWorldSuites } from "./checks.js";
import { FIXTURE_CATEGORIES, type FixtureCategory } from "./fixtures.js";
import type { ProductUnderTest } from "./harness.js";
import { PROFILES, PROFILE_VERSION } from "./profiles/base.js";

export const WORLD_VERSION = "0.1.0";

export interface WorldProviderOptions {
  /** Inject the product surface. Without it every case is SKIPPED with a reason. */
  target?: ProductUnderTest;
  /** Override the profile set (used by `--profiles` and by tests). */
  profiles?: LocaleProfileData[];
  categories?: readonly FixtureCategory[];
  maxPerCategory?: number;
  only?: readonly string[];
}

/**
 * The WORLD module provider. Profile resolution happens per run so an operator can
 * add or version profiles without touching code.
 */
export function createWorldProvider(options: WorldProviderOptions = {}): ModuleProvider {
  return {
    id: "world" as ModuleId,
    version: WORLD_VERSION,
    label: "WORLD",
    suites: (input: SuiteInput): TestSuiteDef[] => {
      const profiles = resolveProfiles(input.config, options, input.profiles);
      return buildWorldSuites({
        config: input.config,
        profiles,
        ...(options.target === undefined ? {} : { target: options.target }),
        ...(options.categories === undefined ? {} : { categories: options.categories }),
        ...(options.maxPerCategory === undefined ? {} : { maxPerCategory: options.maxPerCategory }),
        ...(options.only === undefined ? {} : { only: options.only }),
      });
    },
  };
}

export function resolveProfiles(
  config: ProofstackConfig,
  options: WorldProviderOptions,
  requested?: string[],
): LocaleProfileData[] {
  const base = options.profiles ?? PROFILES;
  const wanted = requested && requested.length > 0 ? requested : config.modules.world.profiles;
  const byId = new Map(base.map((p) => [p.id, p]));
  const missing: string[] = [];
  const out: LocaleProfileData[] = [];
  for (const id of wanted) {
    const profile = byId.get(id);
    if (profile) out.push(profile);
    else missing.push(id);
  }
  if (missing.length > 0) {
    throw new ProofstackError({
      message: `unknown locale profile(s): ${missing.join(", ")}`,
      category: "CONFIGURATION",
      code: "unknown_profile",
      details: { missing, available: base.map((p) => p.id), profileVersion: PROFILE_VERSION },
    });
  }
  return out;
}

/**
 * Load extra profiles from a `locale-profiles.json` document. Custom profiles must
 * declare a version and cannot silently replace a shipped one with different facts.
 */
export function parseProfileFile(text: string): LocaleProfileData[] {
  const parsed = localeProfileFileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new ProofstackError({
      message: `invalid locale profile file: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      category: "CONFIGURATION",
      code: "bad_profile_file",
    });
  }
  return parsed.data.profiles;
}

export const ALL_CATEGORIES = FIXTURE_CATEGORIES;
