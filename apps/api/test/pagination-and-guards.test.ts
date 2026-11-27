import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";
import { MAX_PAGE_SIZE, pageBody, readPage } from "../src/http/pagination.js";

/**
 * The list contract, the widened origin guard, and the password budget.
 *
 * Each of these replaced a different kind of silence: a list that truncated without
 * saying so, a guard that covered only one route prefix, and a password prompt with no
 * limit at all.
 */

interface Harness {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
  store: ReturnType<typeof createApp>["services"]["store"];
  db: NodeSqliteDatabase;
}

const PASSWORD = "correct horse battery";

async function bootstrap(): Promise<Harness> {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env: { NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" } });
  const config = readConfig({ NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" });
  return {
    request: (path, init = {}) =>
      built.app.request(`http://localhost${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          origin: config.webOrigin,
          ...(init.method && init.method !== "GET" ? { "sec-fetch-site": "same-origin" } : {}),
          ...init.headers,
        },
      }),
    close: async () => db.close(),
    store: built.services.store,
    db,
  };
}

async function signUp(harness: Harness, email: string): Promise<string> {
  const response = await harness.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ email, password: PASSWORD, name: "Owner" }),
  });
  expect(response.status).toBe(201);
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  const session = (await (
    await harness.request("/api/auth/session", { headers: { cookie } })
  ).json()) as { workspaceId: string };
  return `${cookie}`.length ? cookie : session.workspaceId;
}

let harness: Harness;
beforeEach(async () => {
  harness = await bootstrap();
});
afterEach(async () => {
  await harness.close();
});

describe("pagination contract", () => {
  it("clamps the limit and never lets the offset go negative", () => {
    const context = (query: string) =>
      ({
        req: { query: (name: string) => new URLSearchParams(query).get(name) ?? undefined },
      }) as never;
    expect(readPage(context(""))).toEqual({ limit: 25, offset: 0 });
    expect(readPage(context("limit=500"))).toEqual({ limit: MAX_PAGE_SIZE, offset: 0 });
    expect(readPage(context("limit=0"))).toEqual({ limit: 25, offset: 0 });
    expect(readPage(context("limit=abc"))).toEqual({ limit: 25, offset: 0 });
    expect(readPage(context("offset=-40"))).toEqual({ limit: 25, offset: 0 });
    expect(readPage(context("limit=10&offset=20"))).toEqual({ limit: 10, offset: 20 });
  });

  it("always reports the total, so a page cannot be mistaken for the list", () => {
    expect(pageBody([1, 2], 340, { limit: 2, offset: 0 })).toEqual({
      items: [1, 2],
      total: 340,
      limit: 2,
      offset: 0,
    });
  });

  it("pages runs like findings instead of truncating them", async () => {
    const cookie = await signUp(harness, "pages@example.com");
    const session = (await (
      await harness.request("/api/auth/session", { headers: { cookie } })
    ).json()) as { workspaceId: string };
    const project = await harness.request("/api/v1/projects", {
      method: "POST",
      headers: { cookie, "sec-fetch-site": "same-origin" },
      body: JSON.stringify({
        workspaceId: session.workspaceId,
        name: "Paged",
        baseUrl: "https://example.com",
      }),
    });
    expect(project.status).toBe(201);
    const projectId = ((await project.json()) as { project: { id: string } }).project.id;

    const first = await harness.request(
      `/api/v1/projects/${projectId}/runs?workspaceId=${session.workspaceId}&limit=5&offset=10`,
      { headers: { cookie } }
    );
    expect(first.status).toBe(200);
    const body = (await first.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ total: 0, limit: 5, offset: 10 });
    expect(body.items).toEqual([]);
  });

  it("walks an index instead of scanning the table for every page", async () => {
    // The paginated lists filter by workspace and sort by a timestamp. Without the
    // matching index that is a full scan plus a temporary sort per request — invisible in
    // a test with ten rows, and the dominant cost at a hundred thousand.
    const plan = async (sql: string) =>
      (await harness.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{ detail: string }>())
        .map((row) => row.detail)
        .join(" | ");

    const findingsPlan = await plan(
      "SELECT * FROM findings WHERE workspace_id = 'w' AND (NULL IS NULL OR module = NULL) ORDER BY detected_at DESC LIMIT 25 OFFSET 0"
    );
    expect(findingsPlan).toContain("USING INDEX");
    expect(findingsPlan).not.toContain("SCAN findings");
    expect(findingsPlan).not.toContain("TEMP B-TREE");

    const runsPlan = await plan(
      "SELECT r.* FROM test_runs r WHERE r.workspace_id = 'w' ORDER BY r.started_at DESC LIMIT 25 OFFSET 0"
    );
    expect(runsPlan).toContain("USING INDEX");
    expect(runsPlan).not.toContain("SCAN");
    expect(runsPlan).not.toContain("TEMP B-TREE");
  });

  it("pages conversations, which used to stop at 50 in silence", async () => {
    const cookie = await signUp(harness, "conv@example.com");
    const session = (await (
      await harness.request("/api/auth/session", { headers: { cookie } })
    ).json()) as { workspaceId: string };
    const response = await harness.request(
      `/api/v1/ai/conversations?workspaceId=${session.workspaceId}&limit=7&offset=3`,
      { headers: { cookie } }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ total: 0, limit: 7, offset: 3 });
  });
});

describe("origin guard coverage", () => {
  it("also protects the account routes, not just /api/v1", async () => {
    const cookie = await signUp(harness, "csrf@example.com");
    const response = await harness.request("/api/account/password", {
      method: "POST",
      headers: {
        cookie,
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "another correct horse" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("cross_origin_denied");
    const crossSiteAllowedOrigin = await harness.request("/api/account/password", {
      method: "POST",
      headers: {
        cookie,
        origin: "http://localhost:5173",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "another correct horse" }),
    });
    expect(crossSiteAllowedOrigin.status).toBe(403);
    const crossSiteBody = (await crossSiteAllowedOrigin.json()) as { error: { code: string } };
    expect(crossSiteBody.error.code).toBe("cross_site_write");
    const originOnly = await harness.request("/api/account/password", {
      method: "POST",
      headers: {
        cookie,
        origin: "https://attacker.example",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "another correct horse" }),
    });
    expect(originOnly.status).toBe(403);
    const originOnlyBody = (await originOnly.json()) as { error: { code: string } };
    expect(originOnlyBody.error.code).toBe("cross_origin_denied");
    // The password is untouched: the guard runs before the handler.
    const signIn = await harness.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { origin: "http://localhost:5173", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ email: "csrf@example.com", password: PASSWORD }),
    });
    expect(signIn.status).toBe(200);
  });

  it("still accepts a caller with no Origin (CLI, native client)", async () => {
    const cookie = await signUp(harness, "cli@example.com");
    const response = await harness.request("/api/account/sessions", {
      headers: { cookie, origin: "", "sec-fetch-site": "same-origin" },
    });
    expect(response.status).toBe(200);
  });
});

describe("password budget on account endpoints", () => {
  it("stops a session from grinding the password one attempt at a time", async () => {
    const cookie = await signUp(harness, "grind@example.com");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await harness.request("/api/account/password", {
        method: "POST",
        headers: { cookie, origin: "http://localhost:5173", "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ currentPassword: "wrong", newPassword: "another correct horse" }),
      });
      expect(wrong.status).toBe(403);
    }
    const blocked = await harness.request("/api/account/password", {
      method: "POST",
      headers: { cookie, origin: "http://localhost:5173", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "another correct horse" }),
    });
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: { code: string } };
    expect(body.error.code).toBe("too_many_attempts");
  });

  it("keeps the deletion budget separate from the password-form budget", async () => {
    const cookie = await signUp(harness, "separate@example.com");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await harness.request("/api/account", {
        method: "DELETE",
        headers: { cookie, origin: "http://localhost:5173", "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ password: "wrong", confirm: "DELETE" }),
      });
    }
    const blockedDelete = await harness.request("/api/account", {
      method: "DELETE",
      headers: { cookie, origin: "http://localhost:5173", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ password: PASSWORD, confirm: "DELETE" }),
    });
    expect(blockedDelete.status).toBe(429);

    // The password form still works with the right password: one budget per action.
    const passwordChange = await harness.request("/api/account/password", {
      method: "POST",
      headers: { cookie, origin: "http://localhost:5173", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "another correct horse" }),
    });
    expect(passwordChange.status).toBe(200);
  });

  it("clears the budget after a correct password", async () => {
    const cookie = await signUp(harness, "clear@example.com");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await harness.request("/api/account/password", {
        method: "POST",
        headers: { cookie, origin: "http://localhost:5173", "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ currentPassword: "wrong", newPassword: "another correct horse" }),
      });
    }
    const ok = await harness.request("/api/account/password", {
      method: "POST",
      headers: { cookie, origin: "http://localhost:5173", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "another correct horse" }),
    });
    expect(ok.status).toBe(200);
    // The password change rotates the token: the test continues with the cookie handed
    // back by the response, which is exactly what a browser would do.
    const rotatedCookie = (ok.headers.get("set-cookie") ?? "").split(";")[0];
    const session = (await (
      await harness.request("/api/auth/session", { headers: { cookie: rotatedCookie } })
    ).json()) as { user: { id: string } | null };
    expect(session.user).not.toBeNull();
    const cleared = await harness.store.countAuthAttempts(
      `account:password:${session.user?.id}`,
      new Date(Date.now() - 60 * 60_000)
    );
    expect(cleared).toBe(0);
  });
});
