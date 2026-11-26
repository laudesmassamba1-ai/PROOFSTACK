import {
  ANALYSIS_PROFILES,
  ANALYSIS_TARGET_TYPES,
  type AnalysisTargetType,
  CAPABILITIES,
  CAPABILITY_VERSION,
  capabilitiesForModule,
  modulesForTargetType,
  planAnalysis,
  profileById,
} from "@proofcore/core";
import { Hono } from "hono";
import { HttpError } from "../http/errors.js";
import { requireUser } from "../http/guards.js";
import type { AppEnv, Services } from "../http/services.js";

/**
 * The capability registry over HTTP.
 *
 * The UI builds its forms from this list, the AI reads it before promising a check, and
 * the docs are generated from it. Serving it rather than duplicating it in the client is
 * what keeps "what the product can do" a single answer.
 */

export function capabilityRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/capabilities", async (c) => {
    await requireUser(c, services);
    const module = c.req.query("module");
    const targetType = c.req.query("targetType");
    const surface = c.req.query("surface");
    let items = CAPABILITIES.map((entry) => ({ ...entry }));
    if (module) {
      const known = CAPABILITIES.some((entry) => entry.module === module);
      if (!known) throw new HttpError(400, "unknown_module", `Unknown module: ${module}`);
      items = capabilitiesForModule(module as never);
    }
    if (targetType) {
      items = items.filter((entry) =>
        entry.compatibility.targetTypes.includes(targetType as never)
      );
    }
    if (surface) {
      items = items.filter((entry) => entry.compatibility.surfaces.includes(surface as never));
    }
    return c.json({
      version: CAPABILITY_VERSION,
      items,
      profiles: ANALYSIS_PROFILES,
      // What each target type can offer, computed here so no client hardcodes the matrix.
      modulesByTargetType: {
        PAGE: modulesForTargetType("PAGE"),
        SITE: modulesForTargetType("SITE"),
        API: modulesForTargetType("API"),
        PROJECT: modulesForTargetType("PROJECT"),
        WORKFLOW: modulesForTargetType("WORKFLOW"),
        LOCAL_ENVIRONMENT: modulesForTargetType("LOCAL_ENVIRONMENT"),
      },
    });
  });

  /**
   * What a named profile would actually run, before anything runs.
   *
   * This is the answer the UI shows before a person presses "start": the applicable
   * modules, the capabilities behind them, and the modules that cannot run here with the
   * reason. Registered before `/capabilities/:capabilityId` so "plan" is not read as an id.
   */
  app.get("/capabilities/plan", async (c) => {
    await requireUser(c, services);
    const profileId = c.req.query("profile") ?? "";
    const targetType = (c.req.query("targetType") ?? "PAGE") as AnalysisTargetType;
    if (!(ANALYSIS_TARGET_TYPES as readonly string[]).includes(targetType)) {
      throw new HttpError(400, "unknown_target_type", `Unknown target type: ${targetType}`);
    }
    const profile = profileById(profileId);
    if (!profile) {
      throw new HttpError(400, "unknown_profile", `Unknown profile: ${profileId}`, {
        available: ANALYSIS_PROFILES.map((item) => item.id),
      });
    }
    const plan = planAnalysis({ targetType, requestedModules: profile.modules });
    return c.json({
      profile: { id: profile.id, name: profile.en.name, targetType: profile.targetType },
      requestedTargetType: targetType,
      plan,
      // A profile built for a PAGE is not silently widened to a SITE: the caller sees
      // that the plan covers fewer modules than the profile names.
      complete: plan.unavailable.length === 0,
    });
  });

  app.get("/capabilities/:capabilityId", async (c) => {
    await requireUser(c, services);
    const id = c.req.param("capabilityId");
    const found = CAPABILITIES.find((entry) => entry.id === id);
    if (!found) throw new HttpError(404, "capability_not_found", `No capability: ${id}`);
    return c.json({ capability: found });
  });

  return app;
}
