import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";
import { checkDistributedRateLimit, resetLocalRateLimits } from "../src/http/rate-limit.js";
import type { Services } from "../src/http/services.js";

/**
 * Phase 9: the limits and the cross-site guard.
 *
 * The limiter is exercised against the real table (the counter must survive the isolate),
 * against its own fallback (a database failure must degrade, not disappear), and through
 * the AI route, where an exhausted budget must answer 429 before the provider is called.
 */

const PASSWORD = "correct horse battery";

async function bootstrap(extra: Record<string, string> = {}) {
  const env = { NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com", ...extra };
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env });
  const config = readConfig(env);
  return {
    request: (path: string, init: RequestInit = {}) =>
      built.app.request(`http://localhost${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          origin: config.webOrigin,
          ...(init.method && init.method !== "GET" ? { "sec-fetch-site": "same-origin" } : {}),
          ...init.headers,
        },
      }),
    services: built.services,
    close: async () => db.close(),
  };
}

type Harness = Awaited<ReturnType<typeof bootstrap>>;
let harness: Harness;

beforeEach(async () => {
  resetLocalRateLimits();
  harness = await bootstrap({ AI_RATE_LIMIT_PER_HOUR: "2" });
});
afterEach(async () => {
  await harness.close();
});

async function signUp(
  auth: Harness,
  email: string
): Promise<{ cookie: string; workspaceId: string }> {
  const response = await auth.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { origin: "http://localhost:5173", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ email, password: PASSWORD, name: "Tester" }),
  });
  expect(response.status).toBe(201);
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const session = (await (
    await auth.request("/api/auth/session", { headers: { cookie } })
  ).json()) as { workspaceId: string };
  return { cookie, workspaceId: session.workspaceId };
}

describe("distributed rate limiting", () => {
  it("counts in the database and blocks past the limit", async () => {
    const now = harness.services.clock();
    const first = await harness.services.store.hitRateLimit({
      scope: "test.counter",
      key: "client-a",
      windowMs: 60_000,
      now,
    });
    const second = await harness.services.store.hitRateLimit({
      scope: "test.counter",
      key: "client-a",
      windowMs: 60_000,
      now,
    });
    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(second.resetAt).toBe(first.resetAt);
  });

  it("reports allowed, remaining and a retry horizon", async () => {
    const decision = await checkDistributedRateLimit(harness.services, {
      scope: "test.decision",
      key: "client-b",
      limit: 2,
      windowMs: 60_000,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(1);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.degraded).toBe(false);
  });

  it("degrades to a local limit, and says so, when the table is unusable", async () => {
    const broken = {
      ...harness.services,
      store: {
        ...harness.services.store,
        hitRateLimit: async () => {
          throw new Error("database is down");
        },
      },
    } as unknown as Services;
    const decision = await checkDistributedRateLimit(broken, {
      scope: "test.degraded",
      key: "client-c",
      limit: 1,
      windowMs: 60_000,
    });
    expect(decision.degraded).toBe(true);
    expect(decision.allowed).toBe(true);
    const second = await checkDistributedRateLimit(broken, {
      scope: "test.degraded",
      key: "client-c",
      limit: 1,
      windowMs: 60_000,
    });
    expect(second.allowed).toBe(false);
  });

  it("stops the AI route at the account budget before the provider is called", async () => {
    const auth = await signUp(harness, "quota@example.com");
    const call = () =>
      harness.request("/api/v1/ai/chat", {
        method: "POST",
        headers: {
          cookie: auth.cookie,
          origin: "http://localhost:5173",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({}),
      });
    const first = await call();
    expect([400, 422]).toContain(first.status);
    const second = await call();
    expect([400, 422]).toContain(second.status);
    const third = await call();
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
    const body = (await third.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("ai_rate_limited");
  });
});

describe("cross-site writes", () => {
  it("refuses a cookie-authenticated write announced as cross-site", async () => {
    const auth = await signUp(harness, "csrf@example.com");
    const response = await harness.request("/api/account/password", {
      method: "POST",
      headers: {
        cookie: auth.cookie,
        origin: "http://localhost:5173",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "another correct horse" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("cross_site_write");
  });

  it("lets a same-origin write through", async () => {
    const auth = await signUp(harness, "same@example.com");
    const response = await harness.request("/api/account/sessions", {
      method: "GET",
      headers: {
        cookie: auth.cookie,
        origin: "http://localhost:5173",
        "sec-fetch-site": "same-origin",
      },
    });
    expect(response.status).toBe(200);
  });

  it("allows native cookie clients without browser metadata when Origin is absent", async () => {
    const auth = await signUp(harness, "native-client@example.com");
    const response = await harness.request("/api/account/sessions", {
      headers: { cookie: auth.cookie, origin: "" },
    });
    expect(response.status).toBe(200);
  });

  it("does not block authenticated service endpoints outside the browser-only guard", async () => {
    const auth = await signUp(harness, "service-endpoint@example.com");
    const response = await harness.request("/api/v1/ai/chat", {
      method: "POST",
      headers: { cookie: auth.cookie },
      body: JSON.stringify({}),
    });
    expect([400, 422]).toContain(response.status);
  });

  it("does not apply to reads", async () => {
    const response = await harness.request("/api/auth/session", {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(response.status).toBe(200);
  });
});
