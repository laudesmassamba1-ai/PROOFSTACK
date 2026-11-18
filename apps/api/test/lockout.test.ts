import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

/**
 * Durable brute-force protection.
 *
 * The in-process limiter is useless as a security boundary on Workers: the isolate that
 * counted the first nine failures is gone before the tenth request arrives. These tests
 * therefore assert the property that matters — a *fresh app instance over the same
 * database* is still locked out. A test that reuses one instance would pass even with a
 * purely in-memory implementation, so it would prove nothing.
 */

interface Harness {
  request: typeof fetch;
  close: () => Promise<void>;
  db: NodeSqliteDatabase;
}

const PASSWORD = "correct horse battery";

async function bootstrap(db: NodeSqliteDatabase): Promise<Harness> {
  const built = createApp({
    db,
    env: { NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" },
  });
  const config = readConfig({ NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" });
  return {
    request: ((path: string, init: RequestInit = {}) =>
      built.app.request(`http://localhost${path}`, {
        ...init,
        headers: { "content-type": "application/json", origin: config.webOrigin, ...init.headers },
      })) as unknown as typeof fetch,
    close: async () => db.close(),
    db,
  };
}

/** A new app on the same database: this is what an isolate recycling looks like. */
function restartIdentity(db: NodeSqliteDatabase): Promise<Harness> {
  return bootstrap(db);
}

async function signUp(harness: Harness, email: string): Promise<void> {
  const response = await harness.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD, name: "Owner" }),
  });
  expect(response.status).toBe(201);
}

function signIn(harness: Harness, email: string, password: string): Promise<Response> {
  return harness.request("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

let db: NodeSqliteDatabase;
let harness: Harness;

beforeEach(async () => {
  db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  harness = await bootstrap(db);
});

afterEach(async () => {
  await harness.close();
});

describe("durable sign-in lockout", () => {
  it("locks the account after the failure budget and survives an isolate restart", async () => {
    await signUp(harness, "target@example.com");

    // The route's own limit is 8 failures per account inside the window.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const wrong = await signIn(harness, "target@example.com", "not the password");
      expect(wrong.status).toBe(401);
    }

    // Simulate Workers recycling the isolate: brand-new app, same database.
    harness = await restartIdentity(db);

    const blocked = await signIn(harness, "target@example.com", PASSWORD);
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: { code: string; retryAfterSeconds?: number } };
    expect(body.error.code).toBe("account_locked");
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    // The correct password must not be an escape hatch: that is the whole point.
  });

  it("clears the counter on a successful sign-in", async () => {
    await signUp(harness, "ok@example.com");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await signIn(harness, "ok@example.com", "wrong")).status).toBe(401);
    }

    const good = await signIn(harness, "ok@example.com", PASSWORD);
    expect(good.status).toBe(200);

    const cleared = await db
      .prepare("SELECT COUNT(*) AS count FROM auth_attempts WHERE scope = ?")
      .bind("signin:email:ok@example.com")
      .first<{ count: number }>();
    expect(cleared?.count ?? 0).toBe(0);

    // And the budget starts over rather than resuming at five. A fresh instance means a
    // fresh in-memory limiter too, so what is measured here is the durable counter alone.
    harness = await restartIdentity(db);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await signIn(harness, "ok@example.com", "wrong")).status).toBe(401);
    }
  });

  it("keeps the per-address budget loose enough for a shared egress", async () => {
    // 40 failures from one address is the ceiling; reaching it across accounts is what
    // stops spraying, while a normal office never comes close.
    await signUp(harness, "a@example.com");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await signIn(harness, "a@example.com", "wrong");
    }
    // A different account from the same address is still allowed to try.
    await signUp(harness, "b@example.com");
    const other = await signIn(harness, "b@example.com", PASSWORD);
    expect(other.status).toBe(200);
  });

  it("prunes attempts older than the window instead of growing forever", async () => {
    const stale = new Date(Date.now() - 10 * 60 * 60_000).toISOString();
    await db
      .prepare("INSERT INTO auth_attempts (id, scope, at) VALUES (?, ?, ?)")
      .bind("stale", "signin:email:old@example.com", stale)
      .run();

    const since = new Date(Date.now() - 15 * 60_000);
    const count = await harness.request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: "old@example.com", password: "wrong" }),
    });
    expect(count.status).toBe(401);

    const remaining = await db
      .prepare("SELECT COUNT(*) AS count FROM auth_attempts WHERE scope = ?")
      .bind("signin:email:old@example.com")
      .first<{ count: number }>();
    // The stale row was pruned by the read; only the fresh failure remains.
    expect(remaining?.count ?? 0).toBe(1);
    expect(since.getTime()).toBeLessThan(Date.now());
  });
});

describe("forgot-password budget", () => {
  it("stops a mail bomb aimed at one inbox, and it survives a restart", async () => {
    await signUp(harness, "bomb@example.com");

    // Four requests per hour per address/account is the configured ceiling.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await harness.request("/api/account/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: "bomb@example.com" }),
      });
      expect(response.status).toBe(200);
    }

    harness = await restartIdentity(db);

    const blocked = await harness.request("/api/account/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "bomb@example.com" }),
    });
    expect(blocked.status).toBe(429);
  });
});
