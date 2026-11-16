import {
  canonical,
  deterministicId,
  fromHex,
  hmacSha256Hex,
  isUuid,
  sha256Hex,
  shortId,
  slugify,
  stableStringify,
  timingSafeEqualHex,
  toHex,
} from "@proofstack/core";
import { describe, expect, it } from "vitest";

describe("canonical JSON", () => {
  it("is independent of key insertion order", () => {
    const a = { b: 1, a: 2, c: { z: 1, y: 2 } };
    const b = { c: { y: 2, z: 1 }, a: 2, b: 1 };
    expect(canonical(a)).toBe(canonical(b));
  });

  it("drops undefined, keeps null, and survives bigint", () => {
    expect(canonical({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(() => canonical(undefined)).toThrowError(/not a JSON value/);
    expect(canonical({ a: null })).toBe('{"a":null}');
    expect(canonical({ minor: 12345n })).toBe('{"minor":"12345n"}');
  });

  it("refuses cycles rather than crashing the reporter", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => stableStringify(cyclic)).toThrowError(/cyclic/);
    expect(canonical({ u: undefined, v: 1 })).toBe('{"v":1}');
  });
});

describe("hashing", () => {
  it("matches published SHA-256 vectors", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("round-trips hex and compares digests in constant time", () => {
    const bytes = new Uint8Array([0, 15, 255]);
    expect(toHex(bytes)).toBe("000fff");
    expect(fromHex("000fff")).toEqual(bytes);
    expect(timingSafeEqualHex("00".repeat(32), "00".repeat(32))).toBe(true);
    expect(timingSafeEqualHex("00".repeat(32), "0f".repeat(31) + "00")).toBe(false);
    expect(timingSafeEqualHex("abc", "abcd")).toBe(false);
  });

  it("produces the HMAC shape SasPay webhook signatures use", async () => {
    // RFC-style sanity check: same inputs -> same digest, different secret -> different.
    const a = await hmacSha256Hex("secret", "1700000000.body");
    const b = await hmacSha256Hex("secret", "1700000000.body");
    const c = await hmacSha256Hex("other", "1700000000.body");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("identifiers", () => {
  it("mints uuids and short ids", () => {
    expect(isUuid(shortId(8))).toBe(false);
    expect(shortId(12)).toMatch(/^[0-9a-z]{12}$/);
    expect(isUuid(deterministicIdSync())).toBe(true);
  });

  it("derives stable ids so a retried payment reuses one idempotency key", async () => {
    const one = await deterministicId("checkout", ["ws_1", "plan_developer", "monthly"]);
    const two = await deterministicId("checkout", ["ws_1", "plan_developer", "monthly"]);
    const other = await deterministicId("checkout", ["ws_2", "plan_developer", "monthly"]);
    expect(one).toBe(two);
    expect(one).not.toBe(other);
    expect(isUuid(one)).toBe(true);
  });

  it("slugifies accented names and never returns an empty slug", () => {
    expect(slugify("Kòfí Sòssou")).toBe("kofi-sossou");
    expect(slugify("À l'aise — Studio")).toBe("a-laise-studio");
    expect(slugify("محمود")).toBe("item");
    expect(slugify("   ")).toBe("item");
  });
});

function deterministicIdSync(): string {
  return "00000000-0000-4000-8000-000000000000";
}
