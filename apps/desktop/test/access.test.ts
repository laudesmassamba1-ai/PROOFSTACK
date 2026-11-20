import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  DAY_MS,
  evaluateAccess,
  formatRemaining,
  parseJwtExpiry,
  sessionToken,
} = require("../src/access.cjs");
const { createStore } = require("../src/store.cjs");

const now = Date.parse("2026-03-01T12:00:00.000Z");
const fresh = {
  email: "a@b.test",
  savedAt: new Date(now - DAY_MS).toISOString(),
  cookie: "ps_session=abc123",
};

describe("sessionToken", () => {
  it("reads the session cookie out of a cookie header", () => {
    expect(sessionToken({ cookie: "ps_session=abc; other=1" })).toBe("abc");
  });
  it("prefers an explicit token", () => {
    expect(sessionToken({ token: "tk", cookie: "ps_session=abc" })).toBe("tk");
  });
  it("is null when there is nothing to read", () => {
    expect(sessionToken(null)).toBeNull();
    expect(sessionToken({ email: "a@b.test" })).toBeNull();
  });
});

describe("parseJwtExpiry", () => {
  it("reads exp from a JWT", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 })).toString("base64url");
    expect(parseJwtExpiry(`h.${payload}.s`)).toBe(1_800_000_000_000);
  });
  it("returns null for an opaque session cookie", () => {
    expect(parseJwtExpiry("abc123")).toBeNull();
  });
});

describe("evaluateAccess", () => {
  it("locks with no session at all", () => {
    const state = evaluateAccess({ session: null, now, online: false });
    expect(state.allowed).toBe(false);
    expect(state.reason).toBe("no-session");
  });

  it("allows a fresh session while offline, inside the grace window", () => {
    const state = evaluateAccess({ session: fresh, now, online: false, graceDays: 7 });
    expect(state.allowed).toBe(true);
    expect(state.status).toBe("offline");
    expect(state.daysLeft).toBeGreaterThan(0);
  });

  it("allows it when the site confirms it", () => {
    expect(evaluateAccess({ session: fresh, now, online: true }).status).toBe("online");
  });

  it("locks once the grace window has passed", () => {
    const old = { ...fresh, savedAt: new Date(now - 8 * DAY_MS).toISOString() };
    const state = evaluateAccess({ session: old, now, online: false, graceDays: 7 });
    expect(state.allowed).toBe(false);
    expect(state.reason).toBe("expired");
  });

  it("locks immediately when the site refuses the account", () => {
    const state = evaluateAccess({ session: fresh, now, online: true, revoked: true });
    expect(state.allowed).toBe(false);
    expect(state.reason).toBe("revoked");
  });

  it("honours a JWT expiry over the local grace window", () => {
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor((now - 1000) / 1000) })).toString(
      "base64url"
    );
    const state = evaluateAccess({
      session: { savedAt: new Date(now).toISOString(), token: `h.${payload}.s` },
      now,
      online: false,
    });
    expect(state.allowed).toBe(false);
    expect(state.reason).toBe("expired");
  });
});

describe("formatRemaining", () => {
  it("says days and hours, then hours and minutes, then expired", () => {
    expect(formatRemaining(3 * DAY_MS + 4 * 3_600_000)).toBe("3 j 4 h");
    expect(formatRemaining(2 * 3_600_000 + 5 * 60_000)).toBe("2 h 5 min");
    expect(formatRemaining(0)).toBe("expiré");
  });
});

describe("createStore", () => {
  const fakeVault = {
    available: true,
    encryptString: (text: string) => Buffer.from(`sealed:${Buffer.from(text).toString("base64")}`),
    decryptString: (buffer: Buffer) =>
      Buffer.from(buffer.toString().slice(7), "base64").toString("utf8"),
    isEncryptionAvailable() {
      return this.available;
    },
  };

  it("writes through the vault when there is one", () => {
    const dir = mkdtempSync(join(tmpdir(), "pc-store-"));
    const store = createStore({ dir, safeStorage: fakeVault });
    const result = store.save({ cookie: "ps_session=abc", email: "a@b.test" });
    expect(result.mode).toBe("keyring");
    expect(readFileSync(store.file).toString("latin1")).not.toContain("ps_session");
    expect(store.load()).toMatchObject({ email: "a@b.test" });
    expect(statSync(store.file).mode & 0o777).toBe(0o600);
  });

  it("falls back to a 0600 file when the vault is unavailable, and says so", () => {
    const dir = mkdtempSync(join(tmpdir(), "pc-store-"));
    const store = createStore({ dir, safeStorage: { ...fakeVault, available: false } });
    expect(store.save({ cookie: "ps_session=abc" }).mode).toBe("file");
    expect(store.mode).toBe("file");
    expect(statSync(store.file).mode & 0o777).toBe(0o600);
  });

  it("reports a locked vault instead of pretending there is no session", () => {
    const dir = mkdtempSync(join(tmpdir(), "pc-store-"));
    createStore({ dir, safeStorage: fakeVault }).save({ cookie: "ps_session=abc" });
    const locked = createStore({ dir, safeStorage: { ...fakeVault, available: false } }).load();
    expect(locked).toEqual({ error: "vault-locked" });
  });

  it("survives a corrupted file without throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "pc-store-"));
    const store = createStore({ dir, safeStorage: fakeVault });
    writeFileSync(store.file, Buffer.from([0x00, 0x7b, 0x7b]));
    expect(store.load()).toHaveProperty("error");
  });
});

describe("signInWithCredentials", () => {
  const { signInWithCredentials, readSetCookie } = require("../src/sign-in.cjs");
  const url = "https://site.test";

  const post = (status, headers, body) => async () => ({ status, headers, body });

  it("reads the session out of Set-Cookie, never out of the body", async () => {
    const result = await signInWithCredentials({
      apiUrl: url,
      email: "a@b.test",
      password: "correct-password-123",
      post: post(
        200,
        { "set-cookie": `${"ps_session"}=tok123; HttpOnly; Path=/"` },
        JSON.stringify({
          user: { email: "a@b.test" },
          session: { expiresAt: "2026-03-08T12:00:00.000Z" },
        })
      ),
    });
    expect(result.ok).toBe(true);
    expect(result.session.cookie).toBe("ps_session=tok123");
    expect(result.session.expiresAt).toBe("2026-03-08T12:00:00.000Z");
    // The gate honours the server's expiry, not a local guess.
    const state = evaluateAccess({ session: result.session, now, online: true });
    expect(state.expiresAt).toBe(Date.parse("2026-03-08T12:00:00.000Z"));
  });

  it("answers the API's one message for a wrong password, without inventing detail", async () => {
    const result = await signInWithCredentials({
      apiUrl: url,
      email: "a@b.test",
      password: "wrong-password-123",
      post: post(
        401,
        {},
        JSON.stringify({
          error: { code: "invalid_credentials", message: "Email or password is incorrect." },
        })
      ),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("credentials");
    expect(result.detail).toBe("Email or password is incorrect.");
  });

  it("keeps a network failure in its own words, so the person can act on it", async () => {
    const result = await signInWithCredentials({
      apiUrl: url,
      email: "a@b.test",
      password: "whatever-password-1",
      post: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("network");
    expect(result.detail).toContain("ENOTFOUND");
  });

  it("names rate limiting instead of echoing a generic error", async () => {
    const result = await signInWithCredentials({
      apiUrl: url,
      email: "a@b.test",
      password: "whatever-password-1",
      post: post(429, {}, "{}"),
    });
    expect(result.code).toBe("rate-limited");
    expect(result.detail).toContain("Trop de tentatives");
  });

  it("refuses a 200 without a cookie rather than storing half a session", async () => {
    const result = await signInWithCredentials({
      apiUrl: url,
      email: "a@b.test",
      password: "whatever-password-1",
      post: post(200, {}, JSON.stringify({ user: { email: "a@b.test" } })),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("server");
  });

  it("finds one cookie among several Set-Cookie lines", () => {
    const value = readSetCookie(
      { "set-cookie": ["a=1; Path=/", "ps_session=tok; HttpOnly"] },
      "ps_session"
    );
    expect(value).toBe("tok");
  });
});
