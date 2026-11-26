import {
  EXPERIENCE_LEVELS,
  EXPERIENCE_MODES,
  ONBOARDING_GOALS,
  ONBOARDING_STEPS,
  type OnboardingState,
  onboardingProgress,
  PROJECT_TYPES,
  recommendProfile,
} from "@proofcore/core";
import { Hono } from "hono";
import { z } from "zod";
import { HttpError } from "../http/errors.js";
import { readBody, requireWorkspace } from "../http/guards.js";
import type { AppEnv, Services } from "../http/services.js";
import type { OnboardingRecord } from "../store/app-store.js";

/**
 * Workspace onboarding.
 *
 * One endpoint answers where the workspace stands, what it still needs, and which profile
 * its goal maps to. The recommendation comes from the shared registry, so the simple
 * experience and the studio experience run literally the same profile.
 */

const updateSchema = z
  .object({
    experience: z.enum(EXPERIENCE_MODES).optional(),
    projectType: z.enum(PROJECT_TYPES).optional(),
    goal: z.enum(ONBOARDING_GOALS).optional(),
    level: z.enum(EXPERIENCE_LEVELS).optional(),
    target: z.string().trim().min(1).max(2048).optional(),
  })
  .strict();

function stateOf(record: OnboardingRecord | null): OnboardingState {
  if (!record) {
    return {
      experience: "simple",
      projectType: null,
      goal: null,
      level: null,
      target: null,
      completed: false,
      completedAt: null,
    };
  }
  return {
    experience: record.experience,
    projectType: record.projectType as OnboardingState["projectType"],
    goal: record.goal as OnboardingState["goal"],
    level: record.level as OnboardingState["level"],
    target: record.target,
    completed: record.completed,
    completedAt: record.completedAt,
  };
}

function payload(state: OnboardingState) {
  const progress = onboardingProgress(state);
  const recommendation =
    state.projectType && state.goal
      ? recommendProfile({ projectType: state.projectType, goal: state.goal })
      : null;
  return {
    onboarding: state,
    experience: state.experience,
    steps: ONBOARDING_STEPS[state.experience],
    progress,
    recommendation,
  };
}

export function onboardingRoutes(services: Services) {
  const app = new Hono<AppEnv>();

  app.get("/onboarding", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const record = await services.store.getOnboarding(workspace.id);
    return c.json(payload(stateOf(record)));
  });

  app.put("/onboarding", async (c) => {
    const body = await readBody(c, updateSchema);
    const { workspace, role } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    if (role === "viewer") {
      throw new HttpError(403, "insufficient_role", "Viewers cannot change the onboarding.");
    }
    const current = stateOf(await services.store.getOnboarding(workspace.id));
    const merged: OnboardingState = {
      experience: body.experience ?? current.experience,
      projectType: body.projectType ?? current.projectType,
      goal: body.goal ?? current.goal,
      level: body.level ?? current.level,
      target: body.target ?? current.target,
      completed: current.completed,
      completedAt: current.completedAt,
    };
    const progress = onboardingProgress(merged);
    const saved = await services.store.saveOnboarding({
      workspaceId: workspace.id,
      experience: merged.experience,
      projectType: merged.projectType,
      goal: merged.goal,
      level: merged.level,
      target: merged.target,
      completed: progress.complete,
      updatedBy: c.get("user").id,
      now: services.clock(),
    });
    return c.json(payload(stateOf(saved)));
  });

  return app;
}
