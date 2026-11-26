import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

/**
 * Account self-service: what the privacy page promises must exist.
 *
 * The assertions that matter are the destructive ones — a password change revokes the
 * other sessions, and deleting an account refuses while a workspace would take other
 * people's work with it.
 */

interface Harness {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
  store: ReturnType<typeof createApp>["services"]["store"];
}

const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "another correct horse";

async function bootstrap(): Promise<Harness> {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env: { NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" } });
  const config = readConfig({ NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" });
  return {
    request: (path, init = {}) =>
      built.app.request(`http://localhost${path}`, {
        ...init,
        headers: { "content-type": "application/json", origin: config.webOrigin, ...init.headers },
      }),
    close: async () => db.close(),
    store: built.services.store,
  };
}

async function signUp(harness: Harness, email: string): Promise<string> {
  const response = await harness.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD, name: "Owner" }),
  });
  expect(response.status).toBe(201);
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

function signIn(harness: Harness, email: string, password: string): Promise<Response> {
  return harness.request("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

let harness: Harness;
beforeEach(async () => {
  harness = await bootstrap();
});
afterEach(async () => {
  await harness.close();
});

describe("sessions", () => {
  it("lists sessions without ever leaking a token hash", async () => {
    const cookie = await signUp(harness, "sessions@example.com");
    const response = await harness.request("/api/account/sessions", { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Record<string, unknown>[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.current).toBe(true);
    expect(body.items[0]).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(body)).not.toContain("ps_sess_");
  });

  it("issues a distinct token for every sign-in", async () => {
    const firstCookie = await signUp(harness, "rotate@example.com");
    const second = await signIn(harness, "rotate@example.com", PASSWORD);
    expect(second.status).toBe(200);
    const secondCookie = (second.headers.get("set-cookie") ?? "").split(";")[0];
    expect(secondCookie).toContain("ps_sess_");
    expect(secondCookie).not.toBe(firstCookie);

    // Both sessions stay independent: signing in again does not evict the first device.
    for (const candidate of [firstCookie, secondCookie]) {
      const session = await harness.request("/api/auth/session", {
        headers: { cookie: candidate },
      });
      expect(((await session.json()) as { user: unknown }).user).not.toBeNull();
    }
  });

  it("revokes another session but answers 404 for someone else's", async () => {
    const ownerCookie = await signUp(harness, "revoke@example.com");
    const second = await signIn(harness, "revoke@example.com", PASSWORD);
    expect(second.status).toBe(200);

    const listed = (await (
      await harness.request("/api/account/sessions", { headers: { cookie: ownerCookie } })
    ).json()) as { items: { id: string; current: boolean }[] };
    expect(listed.items).toHaveLength(2);
    const other = listed.items.find((item) => !item.current);
    expect(other).toBeDefined();

    const revoked = await harness.request(`/api/account/sessions/${other?.id}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    });
    expect(revoked.status).toBe(200);

    // A stranger asking about the same id learns nothing.
    const strangerCookie = await signUp(harness, "stranger@example.com");
    const notMine = await harness.request(`/api/account/sessions/${other?.id}`, {
      method: "DELETE",
      headers: { cookie: strangerCookie },
    });
    expect(notMine.status).toBe(404);
  });
});

describe("password change", () => {
  it("requires the current password, then revokes every other session", async () => {
    const cookie = await signUp(harness, "change@example.com");
    const second = await signIn(harness, "change@example.com", PASSWORD);
    const secondCookie = (second.headers.get("set-cookie") ?? "").split(";")[0];

    const wrong = await harness.request("/api/account/password", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ currentPassword: "nope", newPassword: NEW_PASSWORD }),
    });
    expect(wrong.status).toBe(403);

    const ok = await harness.request("/api/account/password", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
    });
    expect(ok.status).toBe(200);
    const changed = (await ok.json()) as { revokedSessions: number; rotatedSession: boolean };
    expect(changed.revokedSessions).toBe(1);
    expect(changed.rotatedSession).toBe(true);

    // The token that asked for the change is rotated: the old cookie is dead, and the
    // browser is handed a new one that still carries the session it just used.
    const rotatedCookie = (ok.headers.get("set-cookie") ?? "").split(";")[0];
    expect(rotatedCookie).toContain("ps_sess_");
    expect(rotatedCookie).not.toBe(cookie);
    const retired = await harness.request("/api/auth/session", { headers: { cookie } });
    expect(((await retired.json()) as { user: unknown }).user).toBeNull();
    const renewed = await harness.request("/api/auth/session", {
      headers: { cookie: rotatedCookie },
    });
    expect(((await renewed.json()) as { user: unknown }).user).not.toBeNull();

    // The old password is dead, the new one works, and the revoked cookie is dead too.
    expect((await signIn(harness, "change@example.com", PASSWORD)).status).toBe(401);
    expect((await signIn(harness, "change@example.com", NEW_PASSWORD)).status).toBe(200);
    const stale = await harness.request("/api/auth/session", { headers: { cookie: secondCookie } });
    expect(((await stale.json()) as { user: unknown }).user).toBeNull();
  });

  it("refuses a new password identical to the current one", async () => {
    const cookie = await signUp(harness, "same@example.com");
    const response = await harness.request("/api/account/password", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: PASSWORD }),
    });
    expect(response.status).toBe(400);
  });
});

describe("account deletion", () => {
  it("refuses without the typed confirmation, then deletes the account and its data", async () => {
    const cookie = await signUp(harness, "bye@example.com");
    const session = (await (
      await harness.request("/api/auth/session", { headers: { cookie } })
    ).json()) as { workspaceId: string };

    const unconfirmed = await harness.request("/api/account", {
      method: "DELETE",
      headers: { cookie },
      body: JSON.stringify({ password: PASSWORD, confirm: "delete" }),
    });
    expect(unconfirmed.status).toBe(400);

    const deleted = await harness.request("/api/account", {
      method: "DELETE",
      headers: { cookie },
      body: JSON.stringify({ password: PASSWORD, confirm: "DELETE" }),
    });
    expect(deleted.status).toBe(200);

    // The workspace they solely owned is gone, not orphaned.
    expect(await harness.store.getWorkspace(session.workspaceId)).toBeNull();
    expect((await harness.request("/api/auth/session", { headers: { cookie } })).status).toBe(200);
    const after = (await (
      await harness.request("/api/auth/session", { headers: { cookie } })
    ).json()) as { user: unknown };
    expect(after.user).toBeNull();
    // And the address can be used again: nothing was left behind.
    expect((await signIn(harness, "bye@example.com", PASSWORD)).status).toBe(401);
  });

  it("refuses while the person owns a workspace with other members", async () => {
    const cookie = await signUp(harness, "owner@example.com");
    const colleagueCookie = await signUp(harness, "colleague@example.com");
    const session = (await (
      await harness.request("/api/auth/session", { headers: { cookie } })
    ).json()) as { workspaceId: string };

    // An invitation is not a membership: it only becomes one after the invitee accepts.
    const invited = await harness.request(`/api/v1/workspaces/${session.workspaceId}/invitations`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ email: "colleague@example.com", role: "member" }),
    });
    expect(invited.status).toBe(201);
    const invitation = (await invited.json()) as { invitation: { id: string } };
    const accepted = await harness.request(
      `/api/account/invitations/${invitation.invitation.id}/accept`,
      { method: "POST", headers: { cookie: colleagueCookie } }
    );
    expect(accepted.status).toBe(200);

    const blocked = await harness.request("/api/account", {
      method: "DELETE",
      headers: { cookie },
      body: JSON.stringify({ password: PASSWORD, confirm: "DELETE" }),
    });
    expect(blocked.status).toBe(409);
    const body = (await blocked.json()) as { error: { code: string } };
    expect(body.error.code).toBe("workspace_not_empty");
  });
});
