import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";

/**
 * The sandbox payment provider is selected whenever SasPay credentials are absent, which
 * means a production deployment that forgot two environment variables would otherwise let
 * any workspace owner settle a sandbox intent and grant itself a paid plan for free.
 *
 * These tests pin the gate rather than the UI: production refuses to start a checkout it
 * cannot collect on, production does not expose the settle surface, and the surface comes
 * back only when an operator opts in with ALLOW_SANDBOX_BILLING=true.
 */

const WEB_ORIGIN = "http://localhost:5173";

async function deployment(env: Record<string, string>) {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const { app } = createApp({ db, env });

  const request = (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    headers.set("origin", WEB_ORIGIN);
    if (init.cookie) headers.set("cookie", init.cookie);
    return app.request(`http://localhost${path}`, { ...init, headers });
  };

  const signUp = async () => {
    const response = await request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        email: "owner@example.com",
        password: "correct horse battery",
        name: "Ada Lovelace",
        workspace: "Acme",
      }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { workspace: { id: string } };
    const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    return { cookie, workspaceId: body.workspace.id };
  };

  return { request, signUp, close: async () => db.close() };
}

const START = { planKey: "developer", period: "monthly" } as const;

describe("sandbox billing is closed by default in production", () => {
  let harness: Awaited<ReturnType<typeof deployment>>;
  afterEach(async () => {
    await harness.close();
  });

  it("refuses to start a checkout it cannot collect on", async () => {
    harness = await deployment({ NODE_ENV: "production", WEB_ORIGIN });
    const { cookie, workspaceId } = await harness.signUp();
    const response = await harness.request("/api/v1/checkout/start", {
      method: "POST",
      cookie,
      body: JSON.stringify({ workspaceId, ...START }),
    });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("payment_provider_not_configured");

    // Nothing was recorded, so there is nothing to settle later either.
    const summary = await harness.request(`/api/v1/billing?workspaceId=${workspaceId}`, { cookie });
    expect(summary.status).toBe(200);
    const billing = (await summary.json()) as { payments: unknown[] };
    expect(billing.payments).toHaveLength(0);
  });

  it("does not expose the settle control surface", async () => {
    harness = await deployment({ NODE_ENV: "production", WEB_ORIGIN });
    const { cookie, workspaceId } = await harness.signUp();
    const response = await harness.request(
      `/api/v1/checkout/intent_does_not_matter/sandbox/settle?workspaceId=${workspaceId}`,
      { method: "POST", cookie, body: JSON.stringify({ outcome: "success" }) }
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("not available on this deployment");
  });

  it("keeps the sandbox surface when an operator opts in explicitly", async () => {
    harness = await deployment({
      NODE_ENV: "production",
      WEB_ORIGIN,
      ALLOW_SANDBOX_BILLING: "true",
    });
    const { cookie, workspaceId } = await harness.signUp();
    const start = await harness.request("/api/v1/checkout/start", {
      method: "POST",
      cookie,
      body: JSON.stringify({ workspaceId, ...START }),
    });
    expect(start.status).toBe(201);
    const { intent } = (await start.json()) as { intent: { id: string } };

    const settle = await harness.request(
      `/api/v1/checkout/${intent.id}/sandbox/settle?workspaceId=${workspaceId}`,
      { method: "POST", cookie, body: JSON.stringify({ outcome: "success" }) }
    );
    expect(settle.status).toBe(200);
    const result = (await settle.json()) as { outcome: string };
    expect(result.outcome).toBe("credited");
  });
});
