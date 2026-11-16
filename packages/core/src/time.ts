import { ProofstackError } from "./errors.js";

/**
 * Time primitives.
 *
 * Everything in PROOFSTACK stores instants as UTC epoch milliseconds and renders
 * them through an explicit IANA time zone. Wall-clock arithmetic is never done on
 * a local machine's implicit zone: that is exactly the class of bug the WORLD
 * module is meant to find in other people's software.
 */

export interface Clock {
  now(): number;
  iso(): string;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
};

/** Deterministic clock for tests and reproducible runs. */
export class FixedClock implements Clock {
  private ms: number;
  constructor(start: number | string = Date.UTC(2026, 0, 1)) {
    this.ms = typeof start === "string" ? Date.parse(start) : start;
    if (!Number.isFinite(this.ms))
      throw new ProofstackError({
        message: `FixedClock: unparseable start ${start}`,
        category: "VALIDATION",
        code: "bad_instant",
      });
  }
  now(): number {
    return this.ms;
  }
  iso(): string {
    return new Date(this.ms).toISOString();
  }
  advance(ms: number): number {
    this.ms += ms;
    return this.ms;
  }
  set(instant: number | string): void {
    this.ms = typeof instant === "string" ? Date.parse(instant) : instant;
  }
}

export function iso(instant: number | Date = Date.now()): string {
  return (instant instanceof Date ? instant : new Date(instant)).toISOString();
}

export function durationMs(start: number, end: number): number {
  return Math.max(0, end - start);
}

export function isIsoInstant(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return false;
  // V8 rolls impossible dates over ("2026-02-30" becomes 2026-03-02). Accepting that
  // silently is exactly the defect WORLD is supposed to surface, so we compare the
  // calendar fields back.
  const d = new Date(instant);
  const offset = match[8] ?? "Z";
  let y = d.getUTCFullYear();
  let mo = d.getUTCMonth() + 1;
  let day = d.getUTCDate();
  if (offset !== "Z") {
    const sign = offset.startsWith("-") ? -1 : 1;
    const shift =
      sign * (Number(offset.slice(1, 3)) * HOURS_UTC + Number(offset.slice(4, 6)) * 60_000);
    const local = new Date(instant + shift);
    y = local.getUTCFullYear();
    mo = local.getUTCMonth() + 1;
    day = local.getUTCDate();
  }
  return (
    y === Number(match[1]) &&
    mo === Number(match[2]) &&
    day === Number(match[3]) &&
    d.getUTCHours() < 25
  );
}

/** Strict parse: rejects strings that are not full ISO-8601 instants. */
export function parseIsoStrict(value: string, label = "instant"): number {
  if (!isIsoInstant(value)) {
    throw new ProofstackError({
      message: `${label} is not an ISO-8601 instant: ${JSON.stringify(value)}`,
      category: "VALIDATION",
      code: "bad_instant",
      details: { label, value },
    });
  }
  return Date.parse(value);
}

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

const HOURS_UTC = 3_600_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(zone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(zone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(zone, created);
  return created;
}

/**
 * Offset (in ms) applied to UTC to obtain wall-clock time in `zone` at `instant`.
 * Uses Intl, which is available in Node (full-icu since v13) and in Workers.
 */
export function zoneOffsetMs(zone: string, instant: number): number {
  assertZone(zone);
  const parts = zoneFormatter(zone).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) {
      throw new ProofstackError({
        message: `Intl did not return ${type} for zone ${zone}`,
        category: "INTERNAL",
        code: "intl_part_missing",
      });
    }
    return Number(found.value);
  };
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

export function assertZone(zone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw new ProofstackError({
      message: `Unknown IANA time zone: ${JSON.stringify(zone)}`,
      category: "VALIDATION",
      code: "bad_time_zone",
      details: { zone },
    });
  }
}

export function wallClockIn(zone: string, instant: number): WallClock {
  assertZone(zone);
  const offset = zoneOffsetMs(zone, instant);
  const d = new Date(instant + offset);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

export type WallClockResolution =
  | { kind: "unique"; instant: number; offsetMs: number }
  | { kind: "ambiguous"; instants: number[]; offsetsMs: number[] }
  | { kind: "nonexistent"; nearestBefore: number; nearestAfter: number };

/**
 * Resolve a wall-clock reading in a zone into real instants.
 *
 * A spring-forward gap has no instant (nonexistent); a fall-back overlap has two
 * (ambiguous). Software that silently picks one of these without telling the user
 * is a real internationalisation defect, so the engine reports it as one.
 */
export function resolveWallClock(zone: string, wall: WallClock): WallClockResolution {
  assertZone(zone);
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const matches: number[] = [];
  // Sweep every offset used anywhere on Earth, in 15-minute steps.
  for (let off = -12 * HOURS_UTC; off <= 14 * HOURS_UTC; off += 15 * 60_000) {
    const instant = naive - off;
    if (zoneOffsetMs(zone, instant) === off) matches.push(off);
  }
  if (matches.length === 1) {
    return { kind: "unique", instant: naive - matches[0]!, offsetMs: matches[0]! };
  }
  if (matches.length > 1) {
    // Ascending instants: the first is the earlier (summer-time) reading.
    const instants = matches.map((off) => naive - off).sort((a, b) => a - b);
    return { kind: "ambiguous", offsetsMs: matches, instants };
  }
  // Gap: find the transition neighbours.
  let before = naive - 24 * HOURS_UTC;
  let after = naive + 24 * HOURS_UTC;
  while (after - before > 1000) {
    const mid = Math.floor((before + after) / 2);
    if (zoneOffsetMs(zone, mid) <= zoneOffsetMs(zone, mid - 1)) before = mid;
    else after = mid;
  }
  return { kind: "nonexistent", nearestBefore: before, nearestAfter: after };
}

/** True when the zone observes any DST shift during `year`. */
export function zoneObservesDst(zone: string, year: number): boolean {
  const jan = Date.UTC(year, 0, 1);
  const jul = Date.UTC(year, 6, 1);
  return zoneOffsetMs(zone, jan) !== zoneOffsetMs(zone, jul);
}

/**
 * Instant list of the DST transitions of a zone inside [fromYear, toYear].
 *
 * Sampled daily, then bisected to the second: a naive 30-minute sweep over a year
 * costs ~17k Intl calls, which is far too slow for a CLI run.
 */
export function dstTransitions(zone: string, fromYear: number, toYear: number): number[] {
  const DAY = 24 * HOURS_UTC;
  const out: number[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    let cursor = Date.UTC(y - 1, 10, 1);
    const end = Date.UTC(y, 10, 1);
    let prev = zoneOffsetMs(zone, cursor);
    while (cursor < end) {
      const next = Math.min(cursor + DAY, end);
      const nextOffset = zoneOffsetMs(zone, next);
      if (nextOffset !== prev) {
        // Bisect inside [cursor, next].
        let lo = cursor;
        let hi = next;
        while (hi - lo > 1000) {
          const mid = Math.floor((lo + hi) / 2);
          if (zoneOffsetMs(zone, mid) === prev) lo = mid;
          else hi = mid;
        }
        out.push(hi);
        prev = nextOffset;
      }
      cursor = next;
    }
  }
  return out;
}

export function formatInZone(
  zone: string,
  instant: number,
  dateStyle: Intl.DateTimeFormatOptions["dateStyle"] = "short"
): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, dateStyle }).format(new Date(instant));
}
