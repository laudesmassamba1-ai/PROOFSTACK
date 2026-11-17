import {
  caseFold,
  codePointLength,
  composeStrict,
  containsBidiControls,
  containsControlChars,
  detectScripts,
  graphemeLength,
  isFormulaLikeCell,
  isRtl,
  localeCompare,
  normalize,
  sanitizeControlChars,
  stripDiacritics,
  suspiciousHomoglyphs,
  textDirection,
  truncateGraphemes,
  unicodeEquals,
} from "@proofcore/core";
import { describe, expect, it } from "vitest";

describe("international text primitives", () => {
  it("counts what a reader sees, not what a UTF-16 buffer holds", () => {
    const composed = "\u00e9"; // precomposed
    const decomposed = "e\u0301"; // e + combining acute
    expect(composed.length).toBe(1);
    expect(decomposed.length).toBe(2);
    expect(graphemeLength(composed)).toBe(1);
    expect(graphemeLength(decomposed)).toBe(1);
    expect(codePointLength(decomposed)).toBe(2);
    expect(graphemeLength("\u{1F1E7}\u{1F1EF}")).toBe(1); // flag BJ
    expect(codePointLength("\u{1F1E7}\u{1F1EF}")).toBe(2);
    expect(graphemeLength("\u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}")).toBe(1);
  });

  it("normalizes so that visually identical strings compare equal", () => {
    expect(unicodeEquals("\u00e9", "e\u0301")).toBe(true);
    expect("\u00e9" === "e\u0301").toBe(false);
    expect(composeStrict("e\u0301")).toBe("\u00e9");
    // NFKC folds compatibility forms: a real input-normalization hazard.
    expect(normalize("\uFB01", "NFKC")).toBe("fi");
    expect(normalize("\uFB01", "NFC")).toBe("\uFB01");
  });

  it("truncates on cluster boundaries", () => {
    expect(truncateGraphemes("e\u0301abc", 1)).toBe("e\u0301");
    expect(truncateGraphemes("\u{1F469}\u200D\u{1F469}\u200D\u{1F467}", 1)).toBe(
      "\u{1F469}\u200D\u{1F469}\u200D\u{1F467}"
    );
    expect(truncateGraphemes("hello", 0)).toBe("");
  });

  it("detects scripts and base direction", () => {
    expect(detectScripts("Kòfí Sòssou")).toContain("latin");
    expect(detectScripts("محمود")).toContain("arabic");
    expect(detectScripts("田中太郎")).toContain("han");
    expect(detectScripts("Привет")).toContain("cyrillic");
    expect(textDirection("محمود")).toBe("rtl");
    expect(textDirection("Hello")).toBe("ltr");
    // A leading digit does not establish direction; the first strong character does.
    expect(textDirection("12345")).toBe("neutral");
    expect(textDirection("12345 مرحبا")).toBe("rtl");
    expect(isRtl("+229 97 50 50 50")).toBe(false);
  });

  it("flags bidi control characters used in display-name spoofing", () => {
    expect(containsBidiControls("Awa\u202E Sossou")).toBe(true);
    expect(containsBidiControls("Awa Sossou")).toBe(false);
  });

  it("flags cross-script homoglyphs that look like ASCII", () => {
    const spoof = "аdmin"; // Cyrillic а
    expect(spoof.charCodeAt(0)).toBe(0x0430);
    expect(suspiciousHomoglyphs(spoof)).toContain("а");
    expect(suspiciousHomoglyphs("admin")).toEqual([]);
  });

  it("strips control characters but keeps legitimate punctuation", () => {
    const dirty = "Awa\u0000\tSossou\u001f";
    expect(containsControlChars(dirty)).toBe(true);
    expect(sanitizeControlChars(dirty)).toBe("Awa\tSossou");
    expect(containsControlChars("Ann-Marie O'Neill")).toBe(false);
  });

  it("knows which exported cells a spreadsheet would execute", () => {
    for (const cell of ['=HYPERLINK("http://evil")', "+1", "-1", "@SUM(A1)"]) {
      expect(isFormulaLikeCell(cell)).toBe(true);
    }
    expect(isFormulaLikeCell("Awa")).toBe(false);
    expect(isFormulaLikeCell("2500")).toBe(false);
  });

  it("sorts with locale collation, not by code unit", () => {
    const names = ["Élodie", "Eric", "Aaron"];
    expect([...names].sort((a, b) => localeCompare(a, b, "fr-FR"))).toEqual([
      "Aaron",
      "Élodie",
      "Eric",
    ]);
    // Default JS sort puts accented letters after z: the bug collation fixes.
    expect([...names].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }))[0]).toBe(
      "Aaron"
    );
    expect(localeCompare("ä", "a", "de")).toBe(1);
    expect(localeCompare("a", "a", "de")).toBe(0);
  });

  it("case folds without locale surprises", () => {
    expect(caseFold("ÉLODIE")).toBe("élodie");
    expect(caseFold("e\u0301")).toBe(caseFold("\u00e9"));
  });

  it("strips diacritics only for slugs, never for equality", () => {
    expect(stripDiacritics("Kòfí Sòssou")).toBe("Kofi Sossou");
    expect(unicodeEquals(stripDiacritics("Élodie"), "Elodie")).toBe(true);
  });
});
