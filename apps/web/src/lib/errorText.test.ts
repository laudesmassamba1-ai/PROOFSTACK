import { describe, expect, it } from "vitest";
import { errorText } from "./errorText.js";

/**
 * The assistant's two "no AI" situations must not be told as one.
 *
 * A deployment that never configured a provider is a product fact the user cannot fix
 * from the page; a missing personal key is something they can. Same HTTP code, opposite
 * advice — so the distinction is pinned here, in the language layer.
 */

describe("errorText: assistant availability", () => {
  it("says the deployment has no managed assistant, and what still works", () => {
    const text = errorText(
      { code: "ai_not_configured", details: { managed: false, personal: false } },
      true
    );
    expect(text).toContain("pas activé sur ce déploiement");
    expect(text).toContain("sans IA");
  });

  it("asks for a personal key when that is the only missing piece", () => {
    const text = errorText({ code: "ai_not_configured" }, true);
    expect(text).toContain("fournisseur d'IA");
    expect(text).not.toContain("déploiement");
  });

  it("states the managed quota, its size and its horizon", () => {
    const text = errorText(
      { code: "managed_ai_quota", details: { callsPerMonth: 300, retryAfterSeconds: 720 } },
      true
    );
    expect(text).toContain("(300 demandes)");
    expect(text).toContain("12 min");
    expect(text).toContain("ta propre clé");
  });

  it("falls back to the API message in English", () => {
    const text = errorText(
      { code: "managed_ai_quota", message: "Managed quota reached.", details: {} },
      false
    );
    expect(text).toBe("Managed quota reached.");
  });
});
