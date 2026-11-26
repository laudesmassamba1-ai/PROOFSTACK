import {
  ANALYSIS_PROFILES,
  CAPABILITIES,
  CAPABILITY_VERSION,
  capabilitiesForModule,
  modulesForTargetType,
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

  app.get("/capabilities/:capabilityId", async (c) => {
    await requireUser(c, services);
    const id = c.req.param("capabilityId");
    const found = CAPABILITIES.find((entry) => entry.id === id);
    if (!found) throw new HttpError(404, "capability_not_found", `No capability: ${id}`);
    return c.json({ capability: found });
  });

  return app;
}
