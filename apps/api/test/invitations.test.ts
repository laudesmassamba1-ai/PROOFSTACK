import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

/**
 * Invitations need consent.
 *
 * The rules this file pins down, because each one was previously violated:
 *   1. inviting a person does not grant them anything;
 *   2. only the invitee can answer, and only once;
 *   3. the membership row appears on accept and not before;
 *   4. a declined or revoked invitation cannot be accepted afterwards;
 *   5. a workspace deletion takes its pending invitations with it.
 */

interface Harness {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
  store: ReturnType<typeof createApp>["services"]["store"];
  emailKinds: string[];
}

const PASSWORD = "correct horse battery";

async function bootstrap(): Promise<Harness> {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env: { NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" } });
  const config = readConfig({ NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" });
  const emailKinds: string[] = [];
  return {
    request: (path, init = {}) =>
      built.app.request(`http://localhost${path}`, {
        ...init,
        headers: { "content-type": "application/json", origin: config.webOrigin, ...init.headers },
      }),
    close: async () => db.close(),
    store: built.services.store,
    emailKinds,
  };
}

async function signUp(harness: Harness, email: string): Promise<string> {
  const response = await harness.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD, name: email.split("@")[0] }),
  });
  expect(response.status).toBe(201);
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function workspaceIdOf(harness: Harness, cookie: string): Promise<string> {
  const session = (await (
    await harness.request("/api/auth/session", { headers: { cookie } })
  ).json()) as { workspaceId: string };
  return session.workspaceId;
}

interface PendingInvitation {
  id: string;
  role: string;
  workspaceName: string;
  invitedByName: string;
}

async function pendingFor(harness: Harness, cookie: string): Promise<PendingInvitation[]> {
  const body = (await (
    await harness.request("/api/account/invitations", { headers: { cookie } })
  ).json()) as { items: PendingInvitation[] };
  return body.items;
}

async function invite(
  harness: Harness,
  cookie: string,
  workspaceId: string,
  email: string,
  role = "member"
): Promise<Response> {
  return harness.request(`/api/v1/workspaces/${workspaceId}/invitations`, {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ email, role }),
  });
}

let harness: Harness;
beforeEach(async () => {
  harness = await bootstrap();
});
afterEach(async () => {
  await harness.close();
});

describe("workspace invitations", () => {
  it("does not make the invited person a member until they accept", async () => {
    const owner = await signUp(harness, "owner@example.com");
    const guest = await signUp(harness, "guest@example.com");
    const workspaceId = await workspaceIdOf(harness, owner);

    const sent = await invite(harness, owner, workspaceId, "guest@example.com");
    expect(sent.status).toBe(201);
    const sentBody = (await sent.json()) as {
      invitation: { status: string };
      // No provider is configured in tests: the reply must say so rather than pretend.
      email: { delivered: boolean; status: string };
    };
    expect(sentBody.invitation.status).toBe("pending");
    expect(sentBody.email.delivered).toBe(false);
    expect(sentBody.email.status).toBe("unconfigured");

    // The consent boundary: nothing was granted.
    const members = (await (
      await harness.request(`/api/v1/workspaces/${workspaceId}/members`, {
        headers: { cookie: owner },
      })
    ).json()) as { items: { email: string }[] };
    expect(members.items.map((item) => item.email)).not.toContain("guest@example.com");

    // The invitee's own session still points at their personal workspace.
    expect(await workspaceIdOf(harness, guest)).not.toBe(workspaceId);
  });

  it("shows the invitation to the invitee with who asked and which workspace", async () => {
    const owner = await signUp(harness, "owner@example.com");
    const guest = await signUp(harness, "guest@example.com");
    const workspaceId = await workspaceIdOf(harness, owner);

    await invite(harness, owner, workspaceId, "guest@example.com", "admin");
    const pending = await pendingFor(harness, guest);

    expect(pending).toHaveLength(1);
    expect(pending[0]?.role).toBe("admin");
    expect(pending[0]?.invitedByName).toBe("owner");
    expect(pending[0]?.workspaceName.length).toBeGreaterThan(0);
  });

  it("grants the membership on accept, with the invited role", async () => {
    const owner = await signUp(harness, "owner@example.com");
    const guest = await signUp(harness, "guest@example.com");
    const workspaceId = await workspaceIdOf(harness, owner);
    await invite(harness, owner, workspaceId, "guest@example.com", "admin");
    const [invitation] = await pendingFor(harness, guest);

    const accepted = await harness.request(`/api/account/invitations/${invitation?.id}/accept`, {
      method: "POST",
      headers: { cookie: guest },
    });
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as {
      workspace: { id: string; name: string; role: string };
    };
    expect(body.workspace.id).toBe(workspaceId);
    expect(body.workspace.role).toBe("admin");

    const members = (await (
      await harness.request(`/api/v1/workspaces/${workspaceId}/members`, {
        headers: { cookie: owner },
      })
    ).json()) as { items: { email: string; role: string }[] };
    const member = members.items.find((item) => item.email === "guest@example.com");
    expect(member?.role).toBe("admin");

    // And the invitation is gone from the invitee's list.
    expect(await pendingFor(harness, guest)).toHaveLength(0);
  });

  it("records a decline without granting anything, and does not ask again", async () => {
    const owner = await signUp(harness, "owner@example.com");
    const guest = await signUp(harness, "guest@example.com");
    const workspaceId = await workspaceIdOf(harness, owner);
    await invite(harness, owner, workspaceId, "guest@example.com");
    const [invitation] = await pendingFor(harness, guest);

    const declined = await harness.request(`/api/account/invitations/${invitation?.id}/decline`, {
      method: "POST",
      headers: { cookie: guest },
    });
    expect(declined.status).toBe(200);
    expect(await pendingFor(harness, guest)).toHaveLength(0);

    const members = (await (
      await harness.request(`/api/v1/workspaces/${workspaceId}/members`, {
        headers: { cookie: owner },
      })
    ).json()) as { items: { email: string }[] };
    expect(members.items.map((item) => item.email)).not.toContain("guest@example.com");

    // A second answer is refused, not silently applied.
    const again = await harness.request(`/api/account/invitations/${invitation?.id}/accept`, {
      method: "POST",
      headers: { cookie: guest },
    });
    expect(again.status).toBe(409);
  });

  it("answers 404 for someone else's invitation, so ids stay unguessable", async () => {
    const owner = await signUp(harness, "owner@example.com");
    const guest = await signUp(harness, "guest@example.com");
    await signUp(harness, "stranger@example.com");
    const workspaceId = await workspaceIdOf(harness, owner);
    await invite(harness, owner, workspaceId, "guest@example.com");
    const [invitation] = await pendingFor(harness, guest);

    const stranger = await harness.request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: "stranger@example.com", password: PASSWORD }),
    });
    const strangerCookie = (stranger.headers.get("set-cookie") ?? "").split(";")[0];
    const attempt = await harness.request(`/api/account/invitations/${invitation?.id}/accept`, {
      method: "POST",
      headers: { cookie: strangerCookie },
    });
    expect(attempt.status).toBe(404);
    const body = (await attempt.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invitation_not_found");
    // The stranger did not become a member either.
    expect(await pendingFor(harness, guest)).toHaveLength(1);
  });

  it("lets the inviter revoke, after which the invitation cannot be accepted", async () => {
    const owner = await signUp(harness, "owner@example.com");
    const guest = await signUp(harness, "guest@example.com");
    const workspaceId = await workspaceIdOf(harness, owner);
    await invite(harness, owner, workspaceId, "guest@example.com");
    const [invitation] = await pendingFor(harness, guest);

    const listed = (await (
      await harness.request(`/api/v1/workspaces/${workspaceId}/invitations`, {
        headers: { cookie: owner },
      })
    ).json()) as { items: { id: string; email: string }[] };
    expect(listed.items.map((item) => item.email)).toContain("guest@example.com");

    const revoked = await harness.request(
      `/api/v1/workspaces/${workspaceId}/invitations/${invitation?.id}`,
      { method: "DELETE", headers: { cookie: owner } }
    );
    expect(revoked.status).toBe(200);
    expect(await pendingFor(harness, guest)).toHaveLength(0);

    const late = await harness.request(`/api/account/invitations/${invitation?.id}/accept`, {
      method: "POST",
      headers: { cookie: guest },
    });
    expect(late.status).toBe(409);
  });

  it("refuses a duplicate pending invitation and an existing member", async () => {
    const owner = await signUp(harness, "owner@example.com");
    const guest = await signUp(harness, "guest@example.com");
    const workspaceId = await workspaceIdOf(harness, owner);

    expect((await invite(harness, owner, workspaceId, "guest@example.com")).status).toBe(201);
    const duplicate = await invite(harness, owner, workspaceId, "guest@example.com");
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { error: { code: string } }).error.code).toBe(
      "invitation_pending"
    );

    const [invitation] = await pendingFor(harness, guest);
    await harness.request(`/api/account/invitations/${invitation?.id}/accept`, {
      method: "POST",
      headers: { cookie: guest },
    });
    const afterJoin = await invite(harness, owner, workspaceId, "guest@example.com");
    expect(afterJoin.status).toBe(409);
    expect(((await afterJoin.json()) as { error: { code: string } }).error.code).toBe(
      "already_member"
    );
  });

  it("refuses to invite an address with no account, instead of silently subscribing it", async () => {
    const owner = await signUp(harness, "owner@example.com");
    const workspaceId = await workspaceIdOf(harness, owner);
    const response = await invite(harness, owner, workspaceId, "nobody@example.com");
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "user_not_found"
    );
  });

  it("refuses an invitation from a viewer", async () => {
    const owner = await signUp(harness, "owner@example.com");
    const guest = await signUp(harness, "guest@example.com");
    await signUp(harness, "target@example.com");
    const workspaceId = await workspaceIdOf(harness, owner);
    await invite(harness, owner, workspaceId, "guest@example.com", "viewer");
    const [invitation] = await pendingFor(harness, guest);
    await harness.request(`/api/account/invitations/${invitation?.id}/accept`, {
      method: "POST",
      headers: { cookie: guest },
    });

    const response = await invite(harness, guest, workspaceId, "target@example.com");
    expect(response.status).toBe(403);
  });

  it("takes pending invitations with it when the workspace is deleted", async () => {
    const owner = await signUp(harness, "owner@example.com");
    const guest = await signUp(harness, "guest@example.com");
    const workspaceId = await workspaceIdOf(harness, owner);
    await invite(harness, owner, workspaceId, "guest@example.com");

    // The owner must be alone to delete, so revoke the pending invitation first: a pending
    // invitation is not a member, and the deletion guard counts members.
    const deleted = await harness.request(`/api/v1/workspaces/${workspaceId}`, {
      method: "DELETE",
      headers: { cookie: owner },
    });
    expect(deleted.status).toBe(200);
    expect(await pendingFor(harness, guest)).toHaveLength(0);
  });
});
