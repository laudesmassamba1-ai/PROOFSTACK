import { type CurrencyMeta, currencyMeta } from "./currency.js";
import { ProofCoreError } from "./errors.js";

/**
 * Exact money.
 *
 * A Money value is an integer number of *minor units* plus a currency code whose
 * exponent comes from ISO 4217 metadata. There is no `number` anywhere in the
 * arithmetic path: `0.1 + 0.2 !== 0.3` is not a rounding detail, it is a billing
 * defect, and PROOFCORE is not allowed to ship one in its own checkout flow.
 *
 * `toNumber()` and `format()` exist for display only and are documented as such.
 */

export type RoundingMode = "HALF_UP" | "HALF_EVEN" | "DOWN" | "UP" | "CEIL" | "FLOOR";

const DECIMAL_RE = /^([+-]?)(\d+)(?:\.(\d+))?$/;

function divRound(a: bigint, b: bigint, mode: RoundingMode): bigint {
  if (b === 0n) {
    throw new ProofCoreError({
      message: "divRound: zero denominator",
      category: "VALIDATION",
      code: "divide_by_zero",
    });
  }
  let num = a;
  let den = b;
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const negative = num < 0n;
  const mag = negative ? -num : num;
  const q = mag / den;
  const r = mag % den;
  let out = q;
  if (r !== 0n) {
    const twice = r * 2n;
    switch (mode) {
      case "HALF_UP":
        if (twice >= den) out = q + 1n;
        break;
      case "HALF_EVEN":
        if (twice > den || (twice === den && q % 2n !== 0n)) out = q + 1n;
        break;
      case "UP":
        out = q + 1n;
        break;
      case "DOWN":
        break;
      case "CEIL":
        out = negative ? q : q + 1n;
        break;
      case "FLOOR":
        out = negative ? q + 1n : q;
        break;
    }
  }
  return negative ? -out : out;
}

export interface MoneyJson {
  readonly currency: string;
  readonly minor: string;
}

export class Money {
  readonly currency: string;
  readonly minor: bigint;
  readonly meta: CurrencyMeta;

  private constructor(currency: string, minor: bigint) {
    this.meta = currencyMeta(currency);
    this.currency = this.meta.code;
    this.minor = minor;
  }

  static of(code: string, minor: bigint | number): Money {
    return new Money(code, BigInt(minor));
  }

  static zero(code: string): Money {
    return new Money(code, 0n);
  }

  /**
   * Parse a plain decimal string ("2500.00", "-12.5"). Rejects exponent notation,
   * thousands separators and locale separators — those are WORLD-module concerns and
   * are parsed by `parseLocalizedDecimal` instead.
   */
  static fromDecimalString(
    input: string,
    code: string,
    opts: { rounding?: RoundingMode; exact?: boolean } = {}
  ): Money {
    const rounding = opts.rounding ?? "HALF_UP";
    const text = input.trim();
    const match = DECIMAL_RE.exec(text);
    if (!match) {
      throw new ProofCoreError({
        message: `Not a plain decimal money amount: ${JSON.stringify(input)}`,
        category: "VALIDATION",
        code: "bad_money_string",
        details: { input, currency: code },
      });
    }
    const sign = match[1] === "-" ? -1n : 1n;
    const intDigits = match[2] ?? "0";
    const frac = match[3] ?? "";
    const exponent = currencyMeta(code).exponent;

    const keep = frac.slice(0, exponent);
    const rest = frac.slice(exponent);
    const baseDigits = `${intDigits}${keep.padEnd(exponent, "0")}`;
    const base = BigInt(baseDigits);
    if (rest.length === 0) return new Money(code, sign * base);

    const den = 10n ** BigInt(rest.length);
    const total = sign * (base * den + BigInt(rest));
    const minor = divRound(total, den, rounding);
    if (opts.exact && minor * den !== total) {
      throw new ProofCoreError({
        message: `Amount ${input} has more precision than ${code} can represent (${exponent} decimal digit(s))`,
        category: "VALIDATION",
        code: "money_precision_loss",
        details: { input, currency: code, exponent },
      });
    }
    return new Money(code, minor);
  }

  get exponent(): number {
    return this.meta.exponent;
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  isPositive(): boolean {
    return this.minor > 0n;
  }

  private same(other: Money): void {
    if (this.currency !== other.currency) {
      throw new ProofCoreError({
        message: `Currency mismatch: ${this.currency} vs ${other.currency}`,
        category: "VALIDATION",
        code: "currency_mismatch",
        details: { a: this.currency, b: other.currency },
      });
    }
  }

  add(other: Money): Money {
    this.same(other);
    return Money.of(this.currency, this.minor + other.minor);
  }

  subtract(other: Money): Money {
    this.same(other);
    return Money.of(this.currency, this.minor - other.minor);
  }

  negate(): Money {
    return Money.of(this.currency, -this.minor);
  }

  abs(): Money {
    return Money.of(this.currency, this.minor < 0n ? -this.minor : this.minor);
  }

  compare(other: Money): -1 | 0 | 1 {
    this.same(other);
    if (this.minor < other.minor) return -1;
    if (this.minor > other.minor) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  /** Exact rational scaling: amount * numerator / denominator. */
  mulRatio(numerator: bigint, denominator: bigint, mode: RoundingMode = "HALF_UP"): Money {
    return Money.of(this.currency, divRound(this.minor * numerator, denominator, mode));
  }

  /** Percentage expressed in basis points (12.5% = 1250). */
  percent(bps: bigint, mode: RoundingMode = "HALF_UP"): Money {
    return this.mulRatio(bps, 10_000n, mode);
  }

  /**
   * Split into weighted parts with no drift: the sum of the parts is always exactly
   * the original amount (largest-remainder distribution).
   */
  allocate(weights: readonly bigint[]): Money[] {
    if (weights.length === 0) {
      throw new ProofCoreError({
        message: "allocate: no weights",
        category: "VALIDATION",
        code: "empty_weights",
      });
    }
    const total = weights.reduce((acc, w) => acc + w, 0n);
    if (total <= 0n) {
      throw new ProofCoreError({
        message: "allocate: weights must sum to a positive number",
        category: "VALIDATION",
        code: "bad_weights",
      });
    }
    // floors is built from the same weights array, so index alignment is a
    // construction invariant; use at() so no assertion is needed.
    const floors = weights.map((w) => (this.minor * w) / total);
    const remainders = weights.map((w, i) => ({
      index: i,
      frac: (((this.minor * w) % total) * 1000n) / total,
      value: floors[i] ?? 0n,
    }));
    let left = this.minor - floors.reduce((acc, v) => acc + v, 0n);
    const ordered = [...remainders].sort((a, b) => Number(b.frac - a.frac) || a.index - b.index);
    const result = new Map<number, bigint>();
    for (const item of ordered) {
      if (left > 0n) {
        result.set(item.index, item.value + 1n);
        left -= 1n;
      } else {
        result.set(item.index, item.value);
      }
    }
    return weights.map((_w, i) => Money.of(this.currency, result.get(i) ?? 0n));
  }

  /** Equal split across `parts`, remainder given to the first parts. */
  splitEvenly(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new ProofCoreError({
        message: `splitEvenly: bad part count ${parts}`,
        category: "VALIDATION",
        code: "bad_parts",
      });
    }
    return this.allocate(Array.from({ length: parts }, () => 1n));
  }

  /**
   * Decimal string using the currency's own exponent ("12.50", "2500").
   * Passing more decimals than the exponent pads with zeros *after* the separator;
   * passing fewer is refused rather than silently rounded.
   */
  toDecimalString(decimals = this.exponent): string {
    const exp = this.exponent;
    if (decimals < exp) {
      throw new ProofCoreError({
        message: `Cannot render ${this.currency} with ${decimals} decimals (exponent ${exp}) without rounding`,
        category: "VALIDATION",
        code: "bad_decimals",
      });
    }
    const neg = this.minor < 0n;
    const mag = neg ? -this.minor : this.minor;
    const digits = mag.toString().padStart(exp + 1, "0");
    const intPart = exp === 0 ? digits : digits.slice(0, -exp);
    const fracPart = exp === 0 ? "" : digits.slice(-exp);
    const frac = `${fracPart}${"0".repeat(decimals - exp)}`;
    const body = decimals === 0 ? intPart : `${intPart}.${frac}`;
    return neg ? `-${body}` : body;
  }

  /**
   * Decimal string for payment providers that take amounts as decimal strings and
   * display two fractional digits even for currencies without a subunit
   * (SasPay: `"2500.00"` for XOF). Never produced by float division.
   */
  toProviderDecimal(displayDecimals = 2): string {
    return this.toDecimalString(Math.max(displayDecimals, this.exponent));
  }

  /** Display only. Do not feed the result back into arithmetic. */
  toNumber(): number {
    return Number(this.minor) / 10 ** this.exponent;
  }

  format(locale = "en-US", options: Intl.NumberFormatOptions = {}): string {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: this.currency,
      minimumFractionDigits: this.exponent,
      maximumFractionDigits: this.exponent,
      ...options,
    }).format(this.toNumber());
  }

  toJSON(): MoneyJson {
    return { currency: this.currency, minor: this.minor.toString() };
  }

  static fromJSON(json: MoneyJson): Money {
    return Money.of(json.currency, BigInt(json.minor));
  }
}

export function money(code: string, minor: bigint | number): Money {
  return Money.of(code, minor);
}

export function sumMoney(items: readonly Money[], code: string): Money {
  let acc = Money.zero(code);
  for (const item of items) acc = acc.add(item);
  return acc;
}

export interface LocalizedDecimalSpec {
  decimalSeparator: string;
  groupingSeparator: string;
}

const SPACE_LIKE = /[\u0020\u00a0\u2007\u202f\u2009\u200a]/;

/**
 * Read the real separators ICU uses for a locale instead of hardcoding them.
 * fr-FR groups with a narrow no-break space, de-DE groups with a dot, en-US uses
 * commas: a product that assumes "1,234.56" everywhere breaks in exactly the
 * places this function describes.
 */
export function numberSeparators(locale: string): LocalizedDecimalSpec {
  const parts = new Intl.NumberFormat(locale, {
    useGrouping: true,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(1234.56);
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";
  const grouping = parts.find((p) => p.type === "group")?.value ?? "";
  return { decimalSeparator: decimal, groupingSeparator: grouping };
}

/**
 * Parse a number written with locale separators (fr-FR "1 234,56", de-DE
 * "1.234,56", en-US "1,234.56").
 *
 * Returns the value it actually meant, or a reason it could not be read. A
 * separator swap ("1.234,56" handed to an en-US parser) fails loudly rather than
 * silently becoming 1.234 — which is how a €1 234,56 charge becomes €1.
 */
export function parseLocalizedDecimal(
  raw: string,
  spec: LocalizedDecimalSpec,
  code: string,
  opts: { exact?: boolean } = {}
): { ok: true; money: Money } | { ok: false; reason: string } {
  let text = raw.trim();
  if (text.length === 0) return { ok: false, reason: "empty" };
  if (spec.decimalSeparator.length !== 1 || SPACE_LIKE.test(spec.decimalSeparator)) {
    return { ok: false, reason: "bad_spec" };
  }
  const spaceLikeGrouping =
    spec.groupingSeparator === "" || SPACE_LIKE.test(spec.groupingSeparator);
  // Normalise every space variant to a plain space so grouping can be stripped.
  text = text.replace(new RegExp(SPACE_LIKE.source, "g"), " ");

  const dec = spec.decimalSeparator;
  const firstDec = text.indexOf(dec);
  if (firstDec !== -1 && text.lastIndexOf(dec) !== firstDec) {
    return { ok: false, reason: "multiple_decimal_separators" };
  }
  let intPart = text;
  let fracPart = "";
  if (firstDec !== -1) {
    intPart = text.slice(0, firstDec);
    fracPart = text.slice(firstDec + dec.length);
    if (!/^\d+$/.test(fracPart)) return { ok: false, reason: "non_digit_fraction" };
  }

  // The pattern always matches (it is a full catch-all); assert once, typed.
  const signMatch = /^([+-]?)(.*)$/.exec(intPart);
  if (!signMatch) return { ok: false, reason: "empty_integer" };
  const sign = signMatch[1] ?? "";
  let digits = signMatch[2] ?? "";
  if (digits.length === 0) return { ok: false, reason: "empty_integer" };

  if (!spaceLikeGrouping) {
    const grp = spec.groupingSeparator;
    const groups = digits.split(grp);
    if (groups.length > 1) {
      if (groups[0] === undefined || !/^\d{1,3}$/.test(groups[0]))
        return { ok: false, reason: "bad_first_group" };
      for (let i = 1; i < groups.length; i++) {
        if (!/^\d{3}$/.test(groups[i] ?? "")) return { ok: false, reason: "bad_group_length" };
      }
    }
    digits = groups.join("");
  } else {
    digits = digits.replace(/ /g, "");
  }
  if (!/^\d+$/.test(digits)) return { ok: false, reason: "non_digit" };

  const plain = `${sign}${digits}${fracPart.length > 0 ? `.${fracPart}` : ""}`;
  try {
    return { ok: true, money: Money.fromDecimalString(plain, code, opts) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Format money the way a locale would print it, for round-trip tests: parse the
 * rendered string back and compare. A product that cannot read its own output has
 * a portability defect even if the numbers look right on screen.
 */
export function renderLocalized(m: Money, locale: string): string {
  return m.format(locale);
}

/** Strip currency symbols/spaces from a rendered amount using locale separators. */
export function stripCurrencyDecorations(value: string, spec: LocalizedDecimalSpec): string {
  return value
    .replace(/[^\d+\-.,\u00a0\u202f\u2007 ]/g, "")
    .trim()
    .replace(/\s+/g, spec.groupingSeparator === "" ? " " : spec.groupingSeparator);
}
