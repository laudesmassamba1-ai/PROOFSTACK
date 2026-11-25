import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import type { Services } from "../src/http/services.js";

/**
 * Cross-account isolation.
 *
 * Every route that takes a workspace or project identifier must prove membership on the
 * server. Hiding a control in the UI is not authorization. These tests use two real
 * accounts against real SQLite and assert the answer for the other account's identifiers:
 * a 404 (never 403, which would confirm the id exists) and no data.
 *
 * A failure here is a data-leak regression, not a cosmetic one.
 */

const ENV = {
  NODE_ENV: "test",
  WEB_ORIGIN: "http://localhost:5173",
  API_ORIGIN: "http://localhost:8787",
};

interface Harness {
  services: Services;
  request: (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;
  signUp: (email: string) => Promise<{ cookie: string; workspaceId: string; userId: string }>;
}

async function bootstrap(): Promise<Harness> {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env: ENV });
  const request: Harness["request"] = async (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    return built.app.request(path, { ...init, headers });
  };
  const signUp: Harness["signUp"] = async (email) => {
    const response = await request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        email,
        password: "correct horse battery",
        name: "Tenant",
        workspace: "Tenant",
      }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { workspace: { id: string }; user: { id: string } };
    return {
      cookie: (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
      workspaceId: body.workspace.id,
      userId: body.user.id,
    };
  };
  return { services: built.services, request, signUp };
}

describe("tenant isolation", () => {
  let h: Harness;
  let alice: { cookie: string; workspaceId: string; userId: string };
  let bob: { cookie: string; workspaceId: string; userId: string };
  let aliceProjectId: string;
  let bobProjectId: string;

  beforeEach(async () => {
    h = await bootstrap();
    alice = await h.signUp("alice@example.com");
    bob = await h.signUp("bob@example.com");

    const created = await h.request("/api/v1/projects", {
      method: "POST",
      cookie: alice.cookie,
      body: JSON.stringify({
        workspaceId: alice.workspaceId,
        name: "Alice app",
        baseUrl: "https://alice.example",
      }),
    });
    expect(created.status).toBe(201);
    aliceProjectId = ((await created.json()) as { project: { id: string } }).project.id;

    const bobCreated = await h.request("/api/v1/projects", {
      method: "POST",
      cookie: bob.cookie,
      body: JSON.stringify({
        workspaceId: bob.workspaceId,
        name: "Bob app",
        baseUrl: "https://bob.example",
      }),
    });
    expect(bobCreated.status).toBe(201);
    bobProjectId = ((await bobCreated.json()) as { project: { id: string } }).project.id;
  });

  it("answers 404 to every read scoped to the other account's workspace", async () => {
    const ws = alice.workspaceId;
    const project = aliceProjectId;
    const paths = [
      `/api/v1/projects?workspaceId=${ws}`,
      `/api/v1/projects/${project}?workspaceId=${ws}`,
      `/api/v1/projects/${project}/config?workspaceId=${ws}`,
      `/api/v1/projects/${project}/runs?workspaceId=${ws}`,
      `/api/v1/projects/${project}/findings?workspaceId=${ws}`,
      `/api/v1/projects/${project}/corrections?workspaceId=${ws}`,
      `/api/v1/projects/${project}/sources?workspaceId=${ws}`,
      `/api/v1/projects/${project}/intelligence/metrics?workspaceId=${ws}`,
      `/api/v1/projects/${project}/ai-audits?workspaceId=${ws}`,
      `/api/v1/runs?workspaceId=${ws}`,
      `/api/v1/findings?workspaceId=${ws}`,
      `/api/v1/insights?workspaceId=${ws}`,
      `/api/v1/overview?workspaceId=${ws}`,
      `/api/v1/webhooks?workspaceId=${ws}`,
      `/api/v1/billing?workspaceId=${ws}`,
      `/api/v1/notifications?workspaceId=${ws}`,
      `/api/v1/api-keys?workspaceId=${ws}`,
      `/api/v1/audits?workspaceId=${ws}`,
      `/api/v1/ai/memory?workspaceId=${ws}`,
      `/api/v1/workspaces/${ws}`,
      `/api/v1/workspaces/${ws}/members`,
      `/api/v1/workspaces/${ws}/invitations`,
    ];

    for (const path of paths) {
      const response = await h.request(path, { cookie: bob.cookie });
      expect(response.status, `${path} leaked a status other than 404`).toBe(404);
      const text = await response.text();
      expect(text.includes(alice.userId), `${path} leaked a user id`).toBe(false);
      expect(text.includes("Alice app"), `${path} leaked a project name`).toBe(false);
    }
  });

  it("answers 404 to every write aimed at the other account's workspace", async () => {
    const ws = alice.workspaceId;
    const project = aliceProjectId;
    // A valid configuration, so the request reaches the membership check instead of
    // stopping at body validation. Authorization is what this test is about.
    const configResponse = await h.request(`/api/v1/projects/${project}/config?workspaceId=${ws}`, {
      cookie: alice.cookie,
    });
    const aliceConfig = (await configResponse.json()) as { config: { modules: unknown } };

    const writes: { method: string; path: string; body?: unknown }[] = [
      {
        method: "POST",
        path: "/api/v1/projects",
        body: { workspaceId: ws, name: "Injected", baseUrl: "https://injected.example" },
      },
      {
        method: "PATCH",
        path: `/api/v1/projects/${project}?workspaceId=${ws}`,
        body: { name: "x" },
      },
      {
        method: "PUT",
        path: `/api/v1/projects/${project}/config?workspaceId=${ws}`,
        body: { modules: aliceConfig.config.modules, allowDestructiveProduction: false },
      },
      { method: "DELETE", path: `/api/v1/projects/${project}?workspaceId=${ws}` },
      {
        method: "POST",
        path: "/api/v1/webhooks",
        body: { workspaceId: ws, url: "https://hooks.example/x", events: ["run.completed"] },
      },
      {
        method: "POST",
        path: "/api/v1/checkout/start",
        body: { workspaceId: ws, planKey: "developer", period: "monthly", currency: "USD" },
      },
      {
        method: "POST",
        path: "/api/v1/ai/conversations",
        body: {
          workspaceId: ws,
          title: "Injected",
          messages: [{ role: "user", content: "hello" }],
        },
      },
      {
        method: "POST",
        path: `/api/v1/projects/${project}/sources?workspaceId=${ws}`,
        body: {
          workspaceId: ws,
          name: "src",
          files: [{ path: "a.ts", content: "const a = 1;" }],
        },
      },
    ];

    for (const write of writes) {
      const response = await h.request(write.path, {
        method: write.method,
        cookie: bob.cookie,
        ...(write.body === undefined ? {} : { body: JSON.stringify(write.body) }),
      });
      expect(response.status, `${write.method} ${write.path} was not refused`).toBe(404);
    }
  });

  it("does not reach another account's project through the caller's own workspace", async () => {
    // Bob is a legitimate member of his workspace; the project id belongs to Alice.
    const paths = [
      `/api/v1/projects/${aliceProjectId}?workspaceId=${bob.workspaceId}`,
      `/api/v1/projects/${aliceProjectId}/config?workspaceId=${bob.workspaceId}`,
      `/api/v1/projects/${aliceProjectId}/runs?workspaceId=${bob.workspaceId}`,
      `/api/v1/projects/${aliceProjectId}/findings?workspaceId=${bob.workspaceId}`,
      `/api/v1/projects/${aliceProjectId}/corrections?workspaceId=${bob.workspaceId}`,
    ];
    for (const path of paths) {
      expect((await h.request(path, { cookie: bob.cookie })).status).toBe(404);
    }
    // The caller's own listing stays empty rather than showing the foreign project.
    const runs = await h.request(`/api/v1/runs?workspaceId=${bob.workspaceId}`, {
      cookie: bob.cookie,
    });
    expect(runs.status).toBe(200);
    expect(((await runs.json()) as { items: unknown[] }).items).toHaveLength(0);

    const projects = await h.request(`/api/v1/projects?workspaceId=${bob.workspaceId}`, {
      cookie: bob.cookie,
    });
    const list = (await projects.json()) as { items: { id: string }[] };
    expect(list.items.map((item) => item.id)).toEqual([bobProjectId]);
  });

  it("keeps AI conversations user-scoped even when a foreign workspace is named", async () => {
    const created = await h.request("/api/v1/ai/conversations", {
      method: "POST",
      cookie: alice.cookie,
      body: JSON.stringify({
        workspaceId: alice.workspaceId,
        title: "Alice private conversation",
        messages: [{ role: "user", content: "secret plan" }],
      }),
    });
    // The import endpoint is an upsert and answers 200, not 201.
    expect(created.status).toBe(200);
    const conversationId = ((await created.json()) as { id: string }).id;

    // Bob asking with Alice's workspace id must not receive her rows.
    const listed = await h.request(`/api/v1/ai/conversations?workspaceId=${alice.workspaceId}`, {
      cookie: bob.cookie,
    });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { items: { id: string; title: string }[] };
    expect(body.items).toHaveLength(0);
    expect(JSON.stringify(body).includes("Alice private conversation")).toBe(false);

    // Knowing the id is not enough either: the lookup is keyed by the caller.
    const direct = await h.request(`/api/v1/ai/conversations/${conversationId}`, {
      cookie: bob.cookie,
    });
    expect(direct.status).toBe(404);
    const removed = await h.request(`/api/v1/ai/conversations/${conversationId}`, {
      method: "DELETE",
      cookie: bob.cookie,
    });
    expect(removed.status).toBe(404);

    // Alice still has her conversation intact.
    const own = await h.request(`/api/v1/ai/conversations/${conversationId}`, {
      cookie: alice.cookie,
    });
    expect(own.status).toBe(200);
  });

  it("refuses every route without a session", async () => {
    const paths = [
      `/api/v1/projects?workspaceId=${alice.workspaceId}`,
      `/api/v1/overview?workspaceId=${alice.workspaceId}`,
      `/api/v1/billing?workspaceId=${alice.workspaceId}`,
      "/api/account/sessions",
      "/api/account/invitations",
      `/api/v1/notifications?workspaceId=${alice.workspaceId}`,
    ];
    for (const path of paths) {
      expect((await h.request(path)).status, path).toBe(401);
    }
  });
});
