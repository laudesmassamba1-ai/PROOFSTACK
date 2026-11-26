import { describe, expect, it } from "vitest";
import {
  EMPTY_ONBOARDING,
  EXPERIENCE_MODES,
  ONBOARDING_STEPS,
  onboardingProgress,
  recommendProfile,
} from "../src/index.js";

const full = {
  ...EMPTY_ONBOARDING,
  projectType: "shop" as const,
  goal: "conversion" as const,
  level: "beginner" as const,
  target: "https://shop.example",
};

describe("onboarding", () => {
  it("runs the profile that answers the goal, not a default", () => {
    const conversion = recommendProfile({ projectType: "shop", goal: "conversion" });
    expect(conversion.profile?.id).toBe("conversion");
    expect(conversion.modules.length).toBeGreaterThan(0);
    const indexing = recommendProfile({ projectType: "site", goal: "indexing" });
    expect(indexing.profile?.id).toBe("seo");
    const security = recommendProfile({ projectType: "site", goal: "security" });
    expect(security.profile?.id).toBe("security");
  });

  it("refuses to recommend a page analysis for a project with no page", () => {
    const recommendation = recommendProfile({ projectType: "api", goal: "security" });
    expect(recommendation.profile).toBeNull();
    expect(recommendation.reason.en.length).toBeGreaterThan(10);
  });

  it("says what is still missing instead of calling a half-filled form complete", () => {
    const empty = onboardingProgress(EMPTY_ONBOARDING);
    expect(empty).toMatchObject({ filled: 0, total: 4, next: "projectType", complete: false });
    const half = onboardingProgress({ ...EMPTY_ONBOARDING, projectType: "site" });
    expect(half.next).toBe("goal");
    expect(onboardingProgress(full)).toMatchObject({ filled: 4, next: null, complete: true });
  });

  it("shows more steps in studio, and both end on the same findings", () => {
    expect(EXPERIENCE_MODES).toEqual(["simple", "studio"]);
    expect(ONBOARDING_STEPS.simple).toHaveLength(3);
    expect(ONBOARDING_STEPS.studio.length).toBeGreaterThan(ONBOARDING_STEPS.simple.length);
    expect(ONBOARDING_STEPS.simple.at(-1)).toBe("read_findings");
    expect(ONBOARDING_STEPS.studio.at(-2)).toBe("read_findings");
  });
});
