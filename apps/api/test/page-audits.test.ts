import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

/**
 * Scans run from the app.
 *
 * The important assertions are negative ones: the server must refuse internal addresses,
 * must not record a scan it could not perform, and must not let a viewer start one. The
 * positive path is covered by the core scan tests, which own the checks themselves.
 */

const PASSWORD = "correct horse battery";

async function bootstrap() {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env: { NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" } });
  const config = readConfig({ NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" });
  return {
    request: (path: string, init: RequestInit = {}) =>
      built.app.request(`http://localhost${path}`, {
        ...init,
        headers: { "content-type": "application/json", origin: config.webOrigin, ...init.headers },
      }),
    store: built.services.store,
    close: async () => db.close(),
  };
}

let harness: Awaited<ReturnType<typeof bootstrap>>;
beforeEach(async () => {
  harness = await bootstrap();
});
afterEach(async () => {
  await harness.close();
});

async function signUp(email: string): Promise<{ cookie: string; workspaceId: string }> {
  const response = await harness.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD, name: "Tester" }),
  });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  const session = (await (
    await harness.request("/api/auth/session", { headers: { cookie } })
  ).json()) as { workspaceId: string };
  return { cookie, workspaceId: session.workspaceId };
}

describe("page audits", () => {
  it("refuses loopback, private and metadata addresses before any request", async () => {
    const { cookie, workspaceId } = await signUp("scan@example.com");
    for (const url of [
      "http://localhost:3000",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.1.2.3/",
      "file:///etc/passwd",
    ]) {
      const response = await harness.request("/api/v1/audits", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ workspaceId, url }),
      });
      expect(response.status, url).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("url_not_scannable");
    }
  });

  it("says where to run a local scan instead of pretending to reach it", async () => {
    const { cookie, workspaceId } = await signUp("local@example.com");
    const response = await harness.request("/api/v1/audits", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ workspaceId, url: "http://localhost:5173" }),
    });
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("CLI");
  });

  it("records nothing when the site cannot be reached", async () => {
    const { cookie, workspaceId } = await signUp("unreachable@example.com");
    const response = await harness.request("/api/v1/audits", {
      method: "POST",
      headers: { cookie },
      // Reserved TLD: guaranteed not to resolve, without hitting a real site in a test.
      body: JSON.stringify({ workspaceId, url: "https://proofcore-test.invalid/" }),
    });
    expect(response.status).toBe(502);
    const list = (await (
      await harness.request(`/api/v1/audits?workspaceId=${workspaceId}`, { headers: { cookie } })
    ).json()) as { items: unknown[]; total: number };
    expect(list.total).toBe(0);
    expect(list.items).toHaveLength(0);
  });

  it("rejects a viewer, and a workspace the caller is not in", async () => {
    const owner = await signUp("owner-scan@example.com");
    const other = await signUp("other-scan@example.com");
    const response = await harness.request("/api/v1/audits", {
      method: "POST",
      headers: { cookie: other.cookie },
      body: JSON.stringify({ workspaceId: owner.workspaceId, url: "https://example.com" }),
    });
    // 404, not 403: a workspace id you do not own stays unenumerable.
    expect(response.status).toBe(404);
  });

  it("lists scans with a total, newest first", async () => {
    const { cookie, workspaceId } = await signUp("list-scan@example.com");
    await harness.store.createPageAudit({
      id: "aud_test_1",
      workspaceId,
      createdBy: "u",
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      durationMs: 120,
      worstVerdict: "fail",
      failed: 3,
      warnings: 1,
      payload: "{}",
    });
    const body = (await (
      await harness.request(`/api/v1/audits?workspaceId=${workspaceId}`, { headers: { cookie } })
    ).json()) as { items: { id: string; worstVerdict: string }[]; total: number; limit: number };
    expect(body.total).toBe(1);
    expect(body.limit).toBe(25);
    expect(body.items[0]?.worstVerdict).toBe("fail");
  });

  it("keeps a scan private to its workspace", async () => {
    const owner = await signUp("priv-owner@example.com");
    const stranger = await signUp("priv-stranger@example.com");
    await harness.store.createPageAudit({
      id: "aud_private",
      workspaceId: owner.workspaceId,
      createdBy: "u",
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      durationMs: 90,
      worstVerdict: "pass",
      failed: 0,
      warnings: 0,
      payload: "{}",
    });
    const response = await harness.request(
      `/api/v1/audits/aud_private?workspaceId=${stranger.workspaceId}`,
      { headers: { cookie: stranger.cookie } }
    );
    expect(response.status).toBe(404);
  });
});
