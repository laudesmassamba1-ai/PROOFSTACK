import { describe, expect, it } from "vitest";
import { Money, currencyMeta, knownCurrencies, numberSeparators, parseLocalizedDecimal } from "@proofstack/core";

describe("Money — exact minor-unit arithmetic", () => {
  it("never uses floating point for the classic 0.1 + 0.2 case", () => {
    const a = Money.fromDecimalString("0.10", "USD");
    const b = Money.fromDecimalString("0.20", "USD");
    expect(a.add(b).equals(Money.fromDecimalString("0.30", "USD"))).toBe(true);
    expect(a.add(b).minor).toBe(30n);
    // The float trap we are explicitly avoiding.
    expect(0.1 + 0.2 === 0.3).toBe(false);
  });

  it("honours ISO 4217 exponents instead of assuming two decimals", () => {
    expect(currencyMeta("XOF").exponent).toBe(0);
    expect(currencyMeta("JOD").exponent).toBe(3);
    expect(currencyMeta("USD").exponent).toBe(2);
    expect(Money.fromDecimalString("2500.00", "XOF").minor).toBe(2500n);
    expect(Money.fromDecimalString("5.123", "JOD").minor).toBe(5123n);
    expect(Money.fromDecimalString("12.5", "USD").minor).toBe(1250n);
  });

  it("renders provider decimal strings without float division", () => {
    // SasPay takes amounts as decimal strings, e.g. "2500.00" for XOF.
    expect(Money.of("XOF", 2500n).toProviderDecimal()).toBe("2500.00");
    expect(Money.of("USD", 1250n).toProviderDecimal()).toBe("12.50");
    expect(Money.of("JOD", 5123n).toProviderDecimal()).toBe("5.123");
    expect(Money.of("XOF", 2500n).toDecimalString()).toBe("2500");
  });

  it("rounds sub-minor-unit input with an explicit, documented mode", () => {
    expect(Money.fromDecimalString("1.005", "USD", { rounding: "HALF_UP" }).minor).toBe(101n);
    expect(Money.fromDecimalString("1.005", "USD", { rounding: "HALF_EVEN" }).minor).toBe(100n);
    expect(Money.fromDecimalString("1.015", "USD", { rounding: "HALF_EVEN" }).minor).toBe(102n);
    expect(Money.fromDecimalString("1.999", "USD", { rounding: "DOWN" }).minor).toBe(199n);
    expect(Money.fromDecimalString("-1.999", "USD", { rounding: "DOWN" }).minor).toBe(-199n);
    expect(Money.fromDecimalString("-1.999", "USD", { rounding: "FLOOR" }).minor).toBe(-200n);
    expect(Money.fromDecimalString("-1.999", "USD", { rounding: "CEIL" }).minor).toBe(-199n);
  });

  it("refuses to silently drop precision when asked to be exact", () => {
    expect(() => Money.fromDecimalString("1000.50", "XOF", { exact: true })).toThrowError(
      /more precision than XOF/,
    );
    expect(() => Money.fromDecimalString("1,000.50", "USD")).toThrowError(/plain decimal/);
    expect(() => Money.fromDecimalString("1e3", "USD")).toThrowError(/plain decimal/);
  });

  it("refuses unknown currencies rather than guessing an exponent", () => {
    expect(() => Money.of("ZZZ", 100n)).toThrowError(/Unknown currency code/);
    expect(() => Money.of("xof", 100n)).not.toThrow();
  });

  it("blocks cross-currency arithmetic", () => {
    expect(() => Money.of("USD", 1n).add(Money.of("EUR", 1n))).toThrowError(/Currency mismatch/);
  });

  it("allocates with largest remainder so splits never drift", () => {
    const total = Money.of("USD", 100n); // $1.00
    const thirds = total.allocate([1n, 1n, 1n]);
    expect(thirds.map((m) => m.minor)).toEqual([34n, 33n, 33n]);
    expect(thirds.reduce((acc, m) => acc.add(m), Money.of("USD", 0n)).minor).toBe(100n);

    const even = total.splitEvenly(4);
    expect(even.map((m) => m.minor)).toEqual([25n, 25n, 25n, 25n]);

    // Weighted proration: 3 of 7 days of a $29.00 monthly plan.
    const plan = Money.of("USD", 2900n);
    expect(plan.mulRatio(3n, 7n).minor).toBe(1243n);
    expect(plan.mulRatio(4n, 7n).minor).toBe(1657n);
    expect(plan.mulRatio(3n, 7n).add(plan.mulRatio(4n, 7n)).minor).toBeGreaterThan(0n);
  });

  it("computes percentage fees exactly (SasPay ADD_ON style)", () => {
    const base = Money.of("XOF", 2500n);
    // 1.5% of 2500 = 37.5 -> 38 minor units with HALF_UP
    expect(base.percent(150n).minor).toBe(38n);
    expect(base.add(base.percent(150n)).minor).toBe(2538n);
  });

  it("formats per locale and compares exactly", () => {
    const m = Money.of("EUR", 123456n);
    expect(m.format("en-US")).toBe("€1,234.56");
    // fr-FR groups with a space variant and puts the symbol after the amount.
    expect(m.format("fr-FR").replace(/\s/g, "")).toBe("1234,56€");
    expect(m.compare(Money.of("EUR", 123455n))).toBe(1);
    expect(m.toJSON()).toEqual({ currency: "EUR", minor: "123456" });
    expect(Money.fromJSON({ currency: "EUR", minor: "123456" }).equals(m)).toBe(true);
  });

  it("round-trips localized input using ICU separators, not guesses", () => {
    const fr = numberSeparators("fr-FR");
    const de = numberSeparators("de-DE");
    const en = numberSeparators("en-US");
    expect(parseLocalizedDecimal("1 234,56", fr, "EUR").ok).toBe(true);
    expect(parseLocalizedDecimal("1.234,56", de, "EUR")).toEqual({
      ok: true,
      money: Money.of("EUR", 123456n),
    });
    expect(parseLocalizedDecimal("1,234.56", en, "USD")).toEqual({
      ok: true,
      money: Money.of("USD", 123456n),
    });
    // The dangerous case: German text read with an en-US parser.
    const swapped = parseLocalizedDecimal("1.234,56", en, "USD");
    expect(swapped.ok).toBe(false);
    // ...and it must not quietly become $1.234
    if (swapped.ok) expect(swapped.money.minor).not.toBe(1234n);
  });

  it("rejects malformed localized numbers with a reason", () => {
    const en = numberSeparators("en-US");
    expect(parseLocalizedDecimal("1,23,4.56", en, "USD")).toEqual({ ok: false, reason: "bad_group_length" });
    expect(parseLocalizedDecimal("1.2.3", en, "USD")).toEqual({ ok: false, reason: "multiple_decimal_separators" });
    expect(parseLocalizedDecimal("", en, "USD")).toEqual({ ok: false, reason: "empty" });
    expect(parseLocalizedDecimal("abc", en, "USD").ok).toBe(false);
  });

  it("knows the currencies used by the shipped locale profiles", () => {
    const codes = knownCurrencies().map((c) => c.code);
    for (const code of ["XOF", "USD", "EUR", "GBP", "JPY", "BRL", "EGP", "NGN"]) {
      expect(codes).toContain(code);
    }
  });
});
