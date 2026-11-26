import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { rolledSessionExpiry, SESSION_ABSOLUTE_TTL_DAYS, SESSION_TTL_DAYS } from "../src/auth.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";

/**
 * Sliding sessions, with a ceiling.
 *
 * The two properties that must hold together: an active session stays signed in without
 * asking for the password again, and no session outlives its absolute cap no matter how
 * often it is used. A stolen cookie must stop being useful on its own.
 */

const DAY = 86_400_000;

interface Harness {
  request: (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;
  store: ReturnType<typeof createApp>["services"]["store"];
  db: NodeSqliteDatabase;
  signUp: (email: string) => Promise<{ cookie: string; userId: string }>;
}

let harness: Harness;

beforeEach(async () => {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env: { NODE_ENV: "test" } });
  const request: Harness["request"] = (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    return built.app.request(path, { ...init, headers });
  };
  harness = {
    request,
    store: built.services.store,
    db,
    signUp: async (email) => {
      const response = await request("/api/auth/sign-up/email", {
        method: "POST",
        body: JSON.stringify({
          email,
          password: "correct horse battery",
          name: "Ada TTL",
          workspace: "TTL",
        }),
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as { user: { id: string } };
      const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      return { cookie, userId: body.user.id };
    },
  };
});

afterEach(() => {
  harness.db.close();
});

describe("rolledSessionExpiry", () => {
  it("gives an active session seven more days", () => {
    const created = new Date("2026-11-01T00:00:00.000Z");
    const now = new Date("2026-11-10T00:00:00.000Z");
    expect(rolledSessionExpiry(created.toISOString(), now)).toBe(
      new Date(now.getTime() + SESSION_TTL_DAYS * DAY).toISOString()
    );
  });

  it("stops at thirty days from creation, however active the session is", () => {
    const created = new Date("2026-11-01T00:00:00.000Z");
    const now = new Date("2026-11-28T00:00:00.000Z");
    expect(rolledSessionExpiry(created.toISOString(), now)).toBe(
      new Date(created.getTime() + SESSION_ABSOLUTE_TTL_DAYS * DAY).toISOString()
    );
  });
});

describe("session renewal on use", () => {
  it("moves the idle deadline instead of letting a used session expire", async () => {
    const { cookie, userId } = await harness.signUp("ttl@example.com");
    const [session] = await harness.store.listSessions(userId);
    expect(session).toBeDefined();
    const before = session?.expiresAt;
    // A session one hour from expiry, never seen since it was created.
    await harness.db
      .prepare("UPDATE sessions SET expires_at = ?, last_seen_at = NULL WHERE id = ?")
      .bind(new Date(Date.now() + 3_600_000).toISOString(), session?.id)
      .run();

    // `/api/auth/session` is a probe that reads the cookie directly; renewal happens on
    // an authenticated route, which is exactly what this asserts.
    const probe = await harness.request("/api/account/sessions", { cookie });
    expect(probe.status).toBe(200);

    const [renewed] = await harness.store.listSessions(userId);
    expect(renewed?.expiresAt).not.toBe(before);
    expect(new Date(renewed?.expiresAt ?? 0).getTime()).toBeGreaterThan(Date.now());
    // Seven days, within the second the request took.
    expect(new Date(renewed?.expiresAt ?? 0).getTime()).toBeGreaterThan(
      Date.now() + (SESSION_TTL_DAYS - 1) * DAY
    );
  });

  it("never renews past the absolute cap, even when the session is used", async () => {
    const { cookie, userId } = await harness.signUp("cap@example.com");
    const [session] = await harness.store.listSessions(userId);
    const createdAt = new Date(Date.now() - 29 * DAY).toISOString();
    await harness.db
      .prepare(
        "UPDATE sessions SET created_at = ?, expires_at = ?, last_seen_at = NULL WHERE id = ?"
      )
      .bind(createdAt, new Date(Date.now() + 3_600_000).toISOString(), session?.id)
      .run();

    const probe = await harness.request("/api/account/sessions", { cookie });
    expect(probe.status).toBe(200);

    const [renewed] = await harness.store.listSessions(userId);
    expect(renewed?.expiresAt).toBe(
      new Date(new Date(createdAt).getTime() + SESSION_ABSOLUTE_TTL_DAYS * DAY).toISOString()
    );
  });
});
