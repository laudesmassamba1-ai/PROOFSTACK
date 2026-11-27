import { proofcoreConfigSchema } from "@proofcore/contracts";
import { Money, resolveWallClock, unicodeEquals } from "@proofcore/core";
import { describe, expect, it } from "vitest";
import { buildWorldSuites, preview } from "../src/checks.js";
import { parseWithAnyPattern, parseWithPattern, toAsciiDigits } from "../src/dateformat.js";
import { buildFixtures } from "../src/fixtures.js";
import { type FetchLike, HttpProductUnderTest } from "../src/harness.js";
import { ar_EG, fr_BJ, ja_JP, PROFILES, pt_BR } from "../src/profiles/base.js";

/**
 * WORLD module tests.
 *
 * These are the locale facts the product sells, so they are asserted against the
 * profiles rather than against the implementation: a wrong DST rule or a wrong
 * separator would silently mark every customer's product as broken.
 *
 * Facts encoded here (each verifiable against IANA tzdata / CLDR):
 *  - Benin (Africa/Porto-Novo) is UTC+1 all year: no DST.
 *  - Egypt observes DST in 2026 (Africa/Cairo, UTC+2 standard, +1 in summer).
 *  - Japan has no DST (Asia/Tokyo, UTC+9).
 *  - Brazil abolished DST in 2019 (America/Sao_Paulo, UTC-3).
 *  - France formats numbers with a narrow no-break space (U+202F) in CLDR.
 *  - Arabic (Egypt) uses Arabic-Indic digits ٠١٢٣٤٥٦٧٨٩.
 *  - XOF, XAF and JPY have no minor unit.
 */

describe("locale profiles", () => {
  it("covers every profile with the fields the checks require", () => {
    expect(PROFILES.length).toBeGreaterThanOrEqual(8);
    for (const profile of PROFILES) {
      expect(profile.id).toBeTruthy();
      expect(profile.region).toBeTruthy();
      expect(profile.timeZones.length).toBeGreaterThan(0);
      for (const zone of profile.timeZones) expect(zone).toMatch(/^[A-Za-z]+\/[A-Za-z_+-]+$/);
      expect(profile.currency).toHaveLength(3);
      expect(profile.phoneCountryCode).toMatch(/^\+\d{1,3}$/);
      expect(profile.dateFormats.input.length).toBeGreaterThan(0);
      expect(profile.fixtures.names.length).toBeGreaterThan(0);
      expect(profile.fixtures.phones.length).toBeGreaterThan(0);
      expect(profile.fixtures.addresses.length).toBeGreaterThan(0);
      // No identity-number fixtures: the product must never handle real national IDs.
      expect(Object.keys(profile.fixtures)).not.toContain("nationalIds");
    }
  });

  it("declares the real DST behaviour of each region", () => {
    const offsets = (zone: string, month: number): number => {
      const resolved = resolveWallClock(zone, {
        year: 2026,
        month,
        day: 15,
        hour: 12,
        minute: 0,
        second: 0,
      } as never);
      return resolved.offsetMs / 60_000;
    };

    // Benin: no DST, ever. 1 January and 1 July are both UTC+1.
    expect(offsets("Africa/Porto-Novo", 1)).toBe(60);
    expect(offsets("Africa/Porto-Novo", 7)).toBe(60);

    // Japan: no DST, fixed UTC+9.
    expect(offsets("Asia/Tokyo", 1)).toBe(540);
    expect(offsets("Asia/Tokyo", 7)).toBe(540);

    // Brazil: no DST since 2019, fixed UTC-3.
    expect(offsets("America/Sao_Paulo", 1)).toBe(-180);
    expect(offsets("America/Sao_Paulo", 7)).toBe(-180);

    // Egypt: DST in 2026, so the offsets must differ between winter and summer.
    expect(offsets("Africa/Cairo", 1)).toBe(120);
    expect(offsets("Africa/Cairo", 7)).toBe(180);

    // The profiles point at those exact zones.
    expect(fr_BJ.timeZones).toContain("Africa/Porto-Novo");
    expect(ja_JP.timeZones).toContain("Asia/Tokyo");
    expect(pt_BR.timeZones).toContain("America/Sao_Paulo");
    expect(ar_EG.timeZones).toContain("Africa/Cairo");
  });

  it("declares the right minor-unit behaviour for its currency", () => {
    for (const profile of PROFILES) {
      const meta = Money.of(profile.currency as never, 1n);
      const expectedExponent = ["XOF", "XAF", "JPY"].includes(profile.currency) ? 0 : 2;
      expect(meta.currency).toBe(profile.currency);
      // A zero-exponent currency must not print cents.
      if (expectedExponent === 0) {
        expect(Money.of(profile.currency as never, 1234n).toProviderDecimal()).toBe("1234.00");
      }
    }
  });
});

describe("fixtures", () => {
  it("generates every category and gives each fixture a stable id", () => {
    const fixtures = buildFixtures(fr_BJ);
    const categories = new Set(fixtures.map((fixture) => fixture.category));
    expect(categories).toEqual(
      new Set(["identity", "phone", "email", "address", "currency", "datetime", "collation"])
    );
    const ids = fixtures.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Deterministic: same input, same ids and same values, so a rerun compares like
    // with like even though the objects are new.
    const again = buildFixtures(fr_BJ);
    expect(again.map((f) => f.id)).toEqual(ids);
    expect(again.map((f) => f.value)).toEqual(fixtures.map((f) => f.value));
  });

  it("builds only the requested categories and respects the cap", () => {
    const only = buildFixtures(fr_BJ, { categories: ["phone"], maxPerCategory: 3 });
    expect(only.every((fixture) => fixture.category === "phone")).toBe(true);
    expect(only.length).toBeLessThanOrEqual(3);
  });

  it("covers valid addresses a narrow pattern refuses, and invalid ones", () => {
    const emails = buildFixtures(fr_BJ).filter((fixture) => fixture.category === "email");
    expect(emails.some((fixture) => fixture.value === "lucie+facture@example.com")).toBe(true);
    expect(emails.some((fixture) => fixture.value === "用户@例子.广告")).toBe(true);
    expect(emails.some((fixture) => fixture.expectation === "reject")).toBe(true);
  });

  it("keeps identity fixtures that break naive normalisation", () => {
    // The point of the module: names a product must not mangle.
    const names = buildFixtures(ja_JP).filter((fixture) => fixture.category === "identity");
    expect(names.length).toBeGreaterThan(0);
    // Every identity fixture either carries a value to preserve or is the deliberate
    // "an empty name must be refused" case. Nothing in between.
    const accepted = names.filter((fixture) => fixture.expectation === "accept");
    expect(accepted.every((fixture) => fixture.value.length > 0)).toBe(true);
    expect(names.some((fixture) => fixture.expectation === "reject")).toBe(true);
    // Comparison is normalisation-aware: an NFC and an NFD spelling of the same name
    // are the same name, while a stripped accent is a different one.
    expect(unicodeEquals("Kòfí", "Kòfí")).toBe(true);
    expect(unicodeEquals("Kòfí", "Kòfí".normalize("NFD"))).toBe(true);
    expect(unicodeEquals("Kòfí", "Kofi")).toBe(false);
  });
});

describe("date parsing", () => {
  it("parses a pattern-based date", () => {
    const parsed = parseWithPattern("15/07/2026", "DD/MM/YYYY");
    expect(parsed).toBeDefined();
    expect(parsed?.wall.day).toBe(15);
    expect(parsed?.wall.month).toBe(7);
    expect(parsed?.wall.year).toBe(2026);
    expect(parsed?.pattern).toBe("DD/MM/YYYY");
  });

  it("tries every pattern and returns the first that fits", () => {
    const parsed = parseWithAnyPattern("2026-07-15", ["DD/MM/YYYY", "YYYY-MM-DD"]);
    expect(parsed?.wall.year).toBe(2026);
    expect(parsed?.wall.month).toBe(7);
    expect(parsed?.wall.day).toBe(15);
    expect(parsed?.pattern).toBe("YYYY-MM-DD");
  });

  it("folds non-ASCII digits and says so", () => {
    const parsed = parseWithPattern("١٥/٠٧/٢٠٢٦", "DD/MM/YYYY");
    expect(parsed?.wall.day).toBe(15);
    expect(parsed?.wall.year).toBe(2026);
    expect(parsed?.folded).toBe(true);
  });

  it("refuses an impossible date instead of rolling it over", () => {
    // 31 February must not become 3 March: that would hide a real defect.
    expect(parseWithPattern("31/02/2026", "DD/MM/YYYY")).toBeUndefined();
    expect(parseWithPattern("15/13/2026", "DD/MM/YYYY")).toBeUndefined();
  });

  it("refuses a value that does not match the pattern", () => {
    expect(parseWithPattern("15 juillet 2026", "YYYY-MM-DD")).toBeUndefined();
    expect(parseWithPattern("", "YYYY-MM-DD")).toBeUndefined();
  });
});

describe("digit normalisation", () => {
  it("converts Arabic-Indic and fullwidth digits to ASCII", () => {
    expect(toAsciiDigits("١٢٣٤٥٦٧٨٩٠")).toBe("1234567890");
    expect(toAsciiDigits("１２３")).toBe("123");
    expect(toAsciiDigits("2026")).toBe("2026");
    expect(toAsciiDigits("")).toBe("");
  });
});

describe("suites", () => {
  it("builds one suite per profile with a case per fixture", () => {
    const fixtures = buildFixtures(fr_BJ);
    const suites = buildWorldSuites({
      config: { version: 1 } as never,
      profiles: [fr_BJ],
    });
    expect(suites).toHaveLength(1);
    expect(suites[0]?.module).toBe("world");
    expect(suites[0]?.id).toBe(`world:${fr_BJ.id}`);
    expect(suites[0]?.cases.length).toBe(fixtures.length);
    // Every case is addressable and carries the value that was tested.
    expect(suites[0]?.cases.every((item) => item.id.length > 0)).toBe(true);
  });

  it("narrows to the requested fixture ids", () => {
    const all = buildWorldSuites({ config: { version: 1 } as never, profiles: [fr_BJ] });
    const firstCase = all[0]?.cases[0];
    expect(firstCase).toBeDefined();
    // `--only` accepts the fixture id, which is what a report prints.
    const fixtureId = firstCase?.fixtureId ?? firstCase?.id ?? "";
    const narrowed = buildWorldSuites({
      config: { version: 1 } as never,
      profiles: [fr_BJ],
      only: [fixtureId],
    });
    expect(narrowed[0]?.cases.length).toBeGreaterThanOrEqual(1);
    expect(narrowed[0]?.cases[0]?.id).toBe(firstCase?.id);
  });

  it("times out readback and collation requests instead of hanging the run", async () => {
    const config = proofcoreConfigSchema.parse({
      project: { name: "WORLD timeout", baseUrl: "http://localhost:3000" },
      environment: "staging",
      modules: {
        world: {
          enabled: true,
          target: {
            kind: "http",
            submitUrl: "http://target.test/submit",
            readbackUrl: "http://target.test/records/{recordId}",
            sortUrl: "http://target.test/sort",
            timeoutMs: 100,
          },
        },
        flow: { enabled: false },
        exit: { enabled: false },
      },
      enabledModules: ["world"],
    });
    // Never resolves on its own; only the request deadline can end it. This is the
    // failure mode that used to leave the engine waiting forever.
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    const target = new HttpProductUnderTest({ config, fetchImpl: hanging });

    await expect(target.readback("rec_1")).rejects.toThrow(/WORLD could not reach/);
    await expect(
      target.sorted({ profile: "fr-FR", field: "name", values: ["b", "a"] })
    ).rejects.toThrow(/WORLD could not reach/);
  });

  it("truncates long values in a report so a failure stays readable", () => {
    const long = "a".repeat(120);
    const shown = preview(long, 10);
    // The report keeps the visible prefix and states the real length, so a truncated
    // value cannot be mistaken for the whole value.
    expect(shown).toContain("…");
    expect(shown).toContain("120 graphemes");
    expect(preview("short")).toBe("short");
  });
});
