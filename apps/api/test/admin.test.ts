import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import type { Services } from "../src/http/services.js";

/**
 * The operations console is a production read surface with access to every tenant's
 * data. These tests assert the properties that make that acceptable: a valid session
 * alone is not enough, an empty allowlist fails closed, and the response never carries
 * password or credential hashes.
 */

const ENV = {
  NODE_ENV: "test",
  WEB_ORIGIN: "http://localhost:5173",
  API_ORIGIN: "http://localhost:8787",
  ADMIN_EMAILS: "owner@example.com",
};

interface Harness {
  services: Services;
  request: (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;
  signUp: (email: string, workspace?: string) => Promise<{ cookie: string; workspaceId: string }>;
}

function harness(env: Record<string, string | undefined> = ENV): Harness {
  const db = NodeSqliteDatabase.open(":memory:");
  const built = createApp({ db, env });
  const request: Harness["request"] = async (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    return built.app.request(path, { ...init, headers });
  };
  const signUp: Harness["signUp"] = async (email, workspace = "Acme") => {
    const response = await request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        email,
        password: "correct horse battery",
        name: "Ada Lovelace",
        workspace,
      }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { workspace: { id: string } };
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    return { cookie: cookie ?? "", workspaceId: body.workspace.id };
  };
  return { services: built.services, request, signUp };
}

async function bootstrap(env: Record<string, string | undefined> = ENV): Promise<Harness> {
  const h = harness(env);
  await migrate(h.services.db, migrationFiles());
  return h;
}

describe("operations console", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await bootstrap();
  });

  it("requires a session and an allowlisted account", async () => {
    const owner = await h.signUp("owner@example.com");
    const other = await h.signUp("other@example.com");

    const anonymous = await h.request("/api/v1/admin/overview");
    expect(anonymous.status).toBe(401);

    const forbidden = await h.request("/api/v1/admin/overview", { cookie: other.cookie });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({
      error: { code: "admin_required" },
    });

    const allowed = await h.request("/api/v1/admin/overview", { cookie: owner.cookie });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("cache-control")).toBe("no-store");
    const body = (await allowed.json()) as {
      admin: { email: string };
      totals: { users: number; workspaces: number };
      provider: { slug: string; live: boolean };
    };
    expect(body.admin.email).toBe("owner@example.com");
    expect(body.totals.users).toBe(2);
    expect(body.totals.workspaces).toBe(2);
    expect(body.provider).toMatchObject({ slug: "sandbox", live: false });
  });

  it("reports the allowlist decision in the session payload without trusting the browser", async () => {
    const owner = await h.signUp("owner@example.com");
    const other = await h.signUp("other@example.com");

    const ownerSession = (await (
      await h.request("/api/auth/session", { cookie: owner.cookie })
    ).json()) as { isAdmin?: boolean };
    const otherSession = (await (
      await h.request("/api/auth/session", { cookie: other.cookie })
    ).json()) as { isAdmin?: boolean };
    expect(ownerSession.isAdmin).toBe(true);
    expect(otherSession.isAdmin).toBe(false);
  });

  it("fails closed when ADMIN_EMAILS is empty", async () => {
    const closed = await bootstrap({ ...ENV, ADMIN_EMAILS: "" });
    const owner = await closed.signUp("owner@example.com");
    const response = await closed.request("/api/v1/admin/overview", { cookie: owner.cookie });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "admin_not_configured" },
    });
  });

  it("shows credited payments and never selects credential hashes", async () => {
    const owner = await h.signUp("owner@example.com");
    const project = await h.request(`/api/v1/projects?workspaceId=${owner.workspaceId}`, {
      method: "POST",
      cookie: owner.cookie,
      body: JSON.stringify({
        workspaceId: owner.workspaceId,
        name: "Shop",
        baseUrl: "http://localhost:3000",
      }),
    });
    expect(project.status).toBe(201);

    const start = await h.request("/api/v1/checkout/start", {
      method: "POST",
      cookie: owner.cookie,
      body: JSON.stringify({
        workspaceId: owner.workspaceId,
        planKey: "developer",
        period: "monthly",
        currency: "USD",
      }),
    });
    expect(start.status).toBe(201);
    const intent = (await start.json()) as { intent: { id: string } };

    const settle = await h.request(
      `/api/v1/checkout/${intent.intent.id}/sandbox/settle?workspaceId=${owner.workspaceId}`,
      {
        method: "POST",
        cookie: owner.cookie,
        body: JSON.stringify({ outcome: "success" }),
      }
    );
    expect(settle.status).toBe(200);

    const response = await h.request("/api/v1/admin/overview", { cookie: owner.cookie });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("pbkdf2");
    expect(text).not.toContain("token_hash");

    const body = JSON.parse(text) as {
      payments: { state: string; credited: boolean; amountMinor: string; currency: string }[];
      revenue: { currency: string; minor: string; payments: number }[];
      totals: { activeSubscriptions: number };
    };
    expect(body.payments[0]).toMatchObject({
      state: "SUCCEEDED",
      credited: true,
      currency: "USD",
    });
    expect(Number(body.payments[0]?.amountMinor ?? 0)).toBeGreaterThan(0);
    expect(body.revenue).toEqual([expect.objectContaining({ currency: "USD", payments: 1 })]);
    expect(Number(body.revenue[0]?.minor ?? 0)).toBeGreaterThan(0);
    expect(body.totals.activeSubscriptions).toBe(1);
  });
});
