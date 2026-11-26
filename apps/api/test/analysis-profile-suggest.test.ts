import { ANALYSIS_PROFILES } from "@proofcore/core";
import { describe, expect, it } from "vitest";
import { suggestAnalysisProfile } from "../src/analysis-profile-suggest.js";

/**
 * Profile suggestion is a registry lookup, not a model opinion.
 *
 * These tests pin the only promise the tool makes: a goal maps to one of the six
 * documented profiles, the words that justified the match are returned, and a goal the
 * registry does not cover gets no recommendation instead of a made-up profile.
 */

const registryIds = new Set(ANALYSIS_PROFILES.map((profile) => profile.id));

describe("analysis profile suggestion", () => {
  it("maps a payment goal to the conversion profile and shows the matched words", () => {
    const result = suggestAnalysisProfile("Un client peut-il payer sur le site ?");
    expect(result.recommendation?.id).toBe("conversion");
    expect(result.recommendation?.matchedTerms).toContain("payer");
    expect(result.recommendation?.modules).toContain("flow");
    expect(result.saved).toBe(false);
  });

  it("maps an indexing goal to the SEO profile", () => {
    const result = suggestAnalysisProfile("Le site est-il bien indexé par Google ?");
    expect(result.recommendation?.id).toBe("seo");
    expect(result.recommendation?.targetType).toBe("SITE");
  });

  it("maps an HTTP protection question to the security profile", () => {
    const result = suggestAnalysisProfile("Les en-têtes de sécurité HTTP manquent-ils ?");
    expect(result.recommendation?.id).toBe("security");
    // "sécurité" is not the profile's wording (it says protections); the tool reports
    // the words that actually matched instead of pretending it understood the rest.
    expect(result.recommendation?.matchedTerms).toEqual(
      expect.arrayContaining(["http", "manquent"])
    );
  });

  it("maps a repository-versus-site question to the project profile", () => {
    const result = suggestAnalysisProfile("Le dépôt correspond-il au site ?");
    expect(result.recommendation?.id).toBe("project");
  });

  it("returns no recommendation when the registry's wording does not cover the goal", () => {
    const result = suggestAnalysisProfile("xyzzy plugh");
    expect(result.recommendation).toBeNull();
    expect(result.alternatives).toEqual([]);
    expect(result.hint).toContain("do not invent a profile");
    // The caller can still show what exists without a second call.
    expect(result.available).toHaveLength(ANALYSIS_PROFILES.length);
  });

  it("only ever recommends a registered profile", () => {
    for (const goal of [
      "Un client peut-il payer ?",
      "Indexation et robots.txt",
      "Accessibilité et lecteurs d'écran",
      "Cohérence entre le dépôt et le site",
      "Le site est-il rapide ?",
    ]) {
      const { recommendation } = suggestAnalysisProfile(goal);
      if (recommendation) expect(registryIds.has(recommendation.id)).toBe(true);
    }
  });

  it("respects the target type instead of recommending a profile that cannot run there", () => {
    const page = suggestAnalysisProfile("paiement", "PAGE");
    expect(page.recommendation?.id).toBe("conversion");
    expect(page.recommendation?.targetType).toBe("PAGE");

    const site = suggestAnalysisProfile("paiement", "SITE");
    expect(site.recommendation?.id).not.toBe("conversion");
    expect(site.recommendation?.targetType).toBe("SITE");

    const empty = suggestAnalysisProfile("paiement", "API");
    expect(empty.recommendation).toBeNull();
    expect(empty.hint).toContain("No registered profile");
  });

  it("never returns zero-score alternatives, and never more than two", () => {
    const result = suggestAnalysisProfile("sécurité HTTP pour un paiement");
    expect(result.alternatives.length).toBeLessThanOrEqual(2);
    for (const alternative of result.alternatives) expect(alternative.score).toBeGreaterThan(0);
  });
});
