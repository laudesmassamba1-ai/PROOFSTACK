import type { WallClock } from "@proofstack/core";
import { ProofstackError } from "@proofstack/core";

/**
 * Reference date-pattern parser.
 *
 * WORLD needs to know what a correctly internationalised product *should* do with a
 * typed date before it can call a real behaviour a defect. This is that reference:
 * it understands the tokens the profiles declare, it accepts Arabic-Indic and
 * full-width digits because ICU renders those for the locale, and it refuses
 * calendar-impossible dates instead of rolling them over.
 */

const ARABIC_INDIC = /[\u0660-\u0669\u06f0-\u06f9]/g;
const FULLWIDTH = /[\uff10-\uff19]/g;

export function toAsciiDigits(value: string): string {
  return value
    .replace(ARABIC_INDIC, (d) => String(d.codePointAt(0)! - (d < "\u066a" ? 0x0660 : 0x06f0)))
    .replace(FULLWIDTH, (d) => String(d.codePointAt(0)! - 0xff10));
}

export interface ParsedDate {
  wall: WallClock;
  /** Which declared pattern matched. */
  pattern: string;
  /** True when the input needed digit folding to parse. */
  folded: boolean;
}

const TOKENS = ["YYYY", "MM", "M", "DD", "D", "HH", "mm", "ss"] as const;

export function parseWithPattern(value: string, pattern: string): ParsedDate | undefined {
  const folded = value !== toAsciiDigits(value);
  const digits = toAsciiDigits(value).trim();
  const parts: Array<{ token?: (typeof TOKENS)[number]; literal?: string }> = [];
  let rest = pattern;
  while (rest.length > 0) {
    const token = TOKENS.find((t) => rest.startsWith(t));
    if (token) {
      parts.push({ token });
      rest = rest.slice(token.length);
      continue;
    }
    // Accumulate literal characters until the next token.
    let literal = rest[0] ?? "";
    rest = rest.slice(1);
    while (rest.length > 0 && !TOKENS.some((t) => rest.startsWith(t))) {
      literal += rest[0];
      rest = rest.slice(1);
    }
    const previous = parts[parts.length - 1];
    if (previous && previous.literal !== undefined) previous.literal += literal;
    else parts.push({ literal });
  }

  let cursor = 0;
  const numbers: Record<string, number> = {};
  for (const part of parts) {
    if (part.literal !== undefined) {
      const expected = part.literal;
      if (digits.slice(cursor, cursor + expected.length) !== expected) return undefined;
      cursor += expected.length;
      continue;
    }
    const token = part.token!;
    if (token === "YYYY") {
      const chunk = digits.slice(cursor, cursor + 4);
      if (!/^\d{4}$/.test(chunk)) return undefined;
      numbers.year = Number(chunk);
      cursor += 4;
    } else {
      const greedy = token === "M" || token === "D";
      const two = digits.slice(cursor, cursor + 2);
      const one = digits.slice(cursor, cursor + 1);
      const useTwo = /^\d{2}$/.test(two) && (!greedy || !/^\d{3,}/.test(digits.slice(cursor)));
      const chunk = useTwo ? two : one;
      if (!/^\d{1,2}$/.test(chunk)) return undefined;
      const key = token.startsWith("M") ? "month" : token.startsWith("D") ? "day" : token.startsWith("H") ? "hour" : token.startsWith("m") ? "minute" : "second";
      numbers[key] = Number(chunk);
      cursor += chunk.length;
    }
  }
  if (cursor !== digits.length) return undefined;

  const year = numbers.year;
  const month = numbers.month ?? 1;
  const day = numbers.day ?? 1;
  if (year === undefined) return undefined;
  const wall: WallClock = {
    year,
    month,
    day,
    hour: numbers.hour ?? 0,
    minute: numbers.minute ?? 0,
    second: numbers.second ?? 0,
  };
  if (!calendarExists(wall)) return undefined;
  return { wall, pattern, folded };
}

/** Rejects 2026-02-30 the way a validator must, not the way Date.parse does. */
export function calendarExists(wall: WallClock): boolean {
  if (wall.month < 1 || wall.month > 12) return false;
  if (wall.day < 1) return false;
  if (wall.hour > 23 || wall.minute > 59 || wall.second > 59) return false;
  const days = daysInMonth(wall.year, wall.month);
  return wall.day <= days;
}

export function daysInMonth(year: number, month: number): number {
  // Never Date.UTC rollover arithmetic: compute from the calendar directly.
  const long = new Set([1, 3, 5, 7, 8, 10, 12]);
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return long.has(month) ? 31 : 30;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Parse against every pattern the profile declares, best match wins. */
export function parseWithAnyPattern(value: string, patterns: readonly string[]): ParsedDate | undefined {
  for (const pattern of patterns) {
    const parsed = parseWithPattern(value, pattern);
    if (parsed) return parsed;
  }
  return undefined;
}

const JAPANESE_DATE = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/;

/** Era-form dates (令和8年…) are not ISO: reported as unparseable, on purpose. */
export function isJapaneseEraDate(value: string): boolean {
  return /^(令和|平成|昭和|大正|明治)\d{1,2}年/.test(toAsciiDigits(value));
}

export function parseJapaneseDate(value: string): ParsedDate | undefined {
  const match = JAPANESE_DATE.exec(toAsciiDigits(value.trim()));
  if (!match) return undefined;
  const wall: WallClock = {
    year: Number(match[1]),
    month: Number(match[2] ?? 1),
    day: Number(match[3] ?? 1),
    hour: 0,
    minute: 0,
    second: 0,
  };
  if (!calendarExists(wall)) return undefined;
  return { wall, pattern: "YYYY年M月D日", folded: value !== toAsciiDigits(value) };
}

export function assertCalendarDate(wall: WallClock, label = "date"): void {
  if (!calendarExists(wall)) {
    throw new ProofstackError({
      message: `${label} does not exist on the calendar: ${wall.year}-${wall.month}-${wall.day}`,
      category: "VALIDATION",
      code: "impossible_date",
    });
  }
}
