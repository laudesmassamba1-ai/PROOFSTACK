import {
  dstTransitions,
  FixedClock,
  isIsoInstant,
  parseIsoStrict,
  resolveWallClock,
  wallClockIn,
  zoneObservesDst,
  zoneOffsetMs,
} from "@proofcore/core";
import { describe, expect, it } from "vitest";

describe("time and time zones", () => {
  it("reads real UTC offsets for a winter and a summer instant", () => {
    const winter = Date.UTC(2026, 0, 15, 12); // 2026-01-15T12:00Z
    const summer = Date.UTC(2026, 6, 15, 12); // 2026-07-15T12:00Z
    expect(zoneOffsetMs("Europe/Paris", winter)).toBe(60 * 60_000);
    expect(zoneOffsetMs("Europe/Paris", summer)).toBe(2 * 60 * 60_000);
    // Benin is UTC+1 all year (WAT, no DST) — a common "Africa = GMT" mistake.
    expect(zoneOffsetMs("Africa/Porto-Novo", winter)).toBe(60 * 60_000);
    expect(zoneOffsetMs("Africa/Accra", winter)).toBe(0);
    expect(zoneOffsetMs("Asia/Tokyo", winter)).toBe(9 * 60 * 60_000);
    // Nepal: +05:45 — a 15-minute zone, which naive offset tables get wrong.
    expect(zoneOffsetMs("Asia/Kathmandu", winter)).toBe(5 * 60 * 60_000 + 45 * 60_000);
  });

  it("reports the wall clock a user in that zone would see", () => {
    const instant = Date.UTC(2026, 0, 15, 23, 30); // 23:30Z
    expect(wallClockIn("Europe/Paris", instant)).toEqual({
      year: 2026,
      month: 1,
      day: 16,
      hour: 0,
      minute: 30,
      second: 0,
    });
    expect(wallClockIn("America/Los_Angeles", instant).day).toBe(15);
  });

  it("detects that a spring-forward wall time does not exist", () => {
    // 2026-03-29 in the EU: 02:00 -> 03:00, so 02:30 never happens in Paris.
    const res = resolveWallClock("Europe/Paris", {
      year: 2026,
      month: 3,
      day: 29,
      hour: 2,
      minute: 30,
      second: 0,
    });
    expect(res.kind).toBe("nonexistent");
  });

  it("detects that a fall-back wall time happens twice", () => {
    // 2026-10-25 in the EU: 03:00 -> 02:00, so 02:30 is ambiguous.
    const res = resolveWallClock("Europe/Paris", {
      year: 2026,
      month: 10,
      day: 25,
      hour: 2,
      minute: 30,
      second: 0,
    });
    expect(res.kind).toBe("ambiguous");
    if (res.kind === "ambiguous") {
      expect(res.instants.length).toBe(2);
      expect((res.instants[1] ?? 0) - (res.instants[0] ?? 0)).toBe(60 * 60_000);
    }
  });

  it("resolves an ordinary wall time to exactly one instant", () => {
    const res = resolveWallClock("Europe/Paris", {
      year: 2026,
      month: 6,
      day: 10,
      hour: 14,
      minute: 0,
      second: 0,
    });
    expect(res.kind).toBe("unique");
    if (res.kind === "unique") expect(res.instant).toBe(Date.UTC(2026, 5, 10, 12));
  });

  it("knows which zones observe DST and finds both transitions of a year", () => {
    expect(zoneObservesDst("Europe/Paris", 2026)).toBe(true);
    expect(zoneObservesDst("Asia/Tokyo", 2026)).toBe(false);
    expect(zoneObservesDst("Africa/Porto-Novo", 2026)).toBe(false);
    expect(dstTransitions("Europe/Paris", 2026, 2026).length).toBe(2);
    expect(dstTransitions("Asia/Tokyo", 2026, 2026).length).toBe(0);
  });

  it("rejects impossible ISO instants instead of rolling them over", () => {
    // V8 silently rolls 2026-02-30 over to 2026-03-02; PROOFCORE must not.
    expect(isIsoInstant("2026-02-30T00:00:00Z")).toBe(false);
    expect(() => parseIsoStrict("2026-02-30T00:00:00Z")).toThrowError(/not an ISO-8601 instant/);
    expect(isIsoInstant("2026-02-28T00:00:00Z")).toBe(true);
    expect(isIsoInstant("2028-02-29T00:00:00Z")).toBe(true); // leap year
    expect(isIsoInstant("2026-02-29T00:00:00Z")).toBe(false);
    expect(() => parseIsoStrict("30/01/2026")).toThrowError(/not an ISO-8601 instant/);
    expect(parseIsoStrict("2026-01-15T12:00:00+01:00")).toBe(Date.UTC(2026, 0, 15, 11));
  });

  it("rejects unknown zone identifiers loudly", () => {
    expect(() => zoneOffsetMs("Mars/Olympus_Mons", 0)).toThrowError(/Unknown IANA time zone/);
  });

  it("supports a deterministic clock for reproducible runs", () => {
    const clock = new FixedClock("2026-01-15T12:00:00.000Z");
    expect(clock.iso()).toBe("2026-01-15T12:00:00.000Z");
    clock.advance(5_000);
    expect(clock.now()).toBe(Date.UTC(2026, 0, 15, 12, 0, 5));
  });
});
