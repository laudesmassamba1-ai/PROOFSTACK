import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth.js";

/**
 * The deployed API runs on Cloudflare Workers, where `crypto.subtle` rejects PBKDF2
 * iteration counts above 100 000. A higher constant passes every Node test and then
 * turns production sign-up into a 500, so the ceiling is asserted here rather than
 * discovered after a deploy.
 */
describe("password hashing", () => {
  it("stays within the Workers PBKDF2 ceiling and verifies a round trip", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const iterations = Number(hash.split("$")[1]);

    expect(hash.startsWith("pbkdf2-sha256$")).toBe(true);
    expect(Number.isInteger(iterations)).toBe(true);
    expect(iterations).toBeLessThanOrEqual(100_000);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });
});
