import { sha256Hex } from "@proofcore/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import type { Services } from "../src/http/services.js";

/**
 * Device authorization (RFC 8628-style) for the CLI.
 *
 * The properties that make the flow trustworthy: the device channel alone can
 * never decide anything, only its SHA-256 is stored, one approval mints exactly
 * one session, denied grants never mint a session, and unknown user codes
 * cannot be approved.
 */

const ENV = {
  NODE_ENV: "test",
  WEB_ORIGIN: "http://localhost:5173",
  API_ORIGIN: "http://localhost:8787",
};

interface Harness {
  services: Services;
  request: (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;
  signUp: (email: string) => Promise<{ cookie: string; email: string }>;
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
      body: JSON.stringify({ email, password: "correct horse battery", name: "Owner" }),
    });
    expect(response.status).toBe(201);
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
    return { cookie, email };
  };
  return { services: built.services, request, signUp };
}

describe("device authorization flow", () => {
  let H: Harness;
  beforeEach(async () => {
    H = await bootstrap();
  });

  it("starts a grant, approves it in the browser session, and mints exactly one session", async () => {
    const h = H;
    const { cookie, email } = await h.signUp("owner@example.com");

    const start = await h.request("/api/auth/device/start", {
      method: "POST",
      body: JSON.stringify({ clientName: "proofcore CLI test" }),
    });
    expect(start.status).toBe(201);
    const grant = (await start.json()) as {
      deviceCode: string;
      userCode: string;
      verificationUrl: string;
      interval: number;
    };
    expect(grant.userCode).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(grant.deviceCode.startsWith("ps_dev_")).toBe(true);
    expect(grant.verificationUrl).toContain("/device");
    expect(grant.interval).toBeGreaterThan(0);

    // Polling before the decision must be pending, not an error the CLI treats as fatal.
    const pending = await h.request("/api/auth/device/token", {
      method: "POST",
      body: JSON.stringify({ deviceCode: grant.deviceCode }),
    });
    expect(pending.status).toBe(400);
    expect(((await pending.json()) as { error: { code: string } }).error.code).toBe(
      "authorization_pending"
    );

    // Approval requires a signed-in browser session.
    const unauthed = await h.request("/api/auth/device/verify", {
      method: "POST",
      body: JSON.stringify({ userCode: grant.userCode }),
    });
    expect(unauthed.status).toBe(401);

    const verify = await h.request("/api/auth/device/verify", {
      method: "POST",
      cookie,
      body: JSON.stringify({ userCode: grant.userCode.toLowerCase() }),
    });
    expect(verify.status).toBe(200);

    const token = await h.request("/api/auth/device/token", {
      method: "POST",
      body: JSON.stringify({ deviceCode: grant.deviceCode }),
    });
    expect(token.status).toBe(200);
    const tokenBody = (await token.json()) as { user: { email: string }; workspaces: unknown[] };
    expect(tokenBody.user.email).toBe(email);
    expect(Array.isArray(tokenBody.workspaces)).toBe(true);
    expect(token.headers.get("set-cookie")).toContain("ps_session=");

    // Consumed: the same code can never mint a second session.
    const again = await h.request("/api/auth/device/token", {
      method: "POST",
      body: JSON.stringify({ deviceCode: grant.deviceCode }),
    });
    expect(again.status).toBe(400);
  });

  it("stores no raw device code and answers unknown codes like expired ones", async () => {
    const h = H;
    const start = await h.request("/api/auth/device/start", { method: "POST", body: "{}" });
    const grant = (await start.json()) as { deviceCode: string };
    const rows = h.services.store;
    // The store lookup by hash is the only way the grant is reachable.
    const found = await rows.findDeviceGrantByDeviceCodeHash(await sha256Hex(grant.deviceCode));
    expect(found).not.toBeNull();
    expect(found?.deviceCodeHash).not.toContain(grant.deviceCode);

    const unknown = await h.request("/api/auth/device/token", {
      method: "POST",
      body: JSON.stringify({ deviceCode: "ps_dev_totally_unknown_code_000000000000" }),
    });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_grant"
    );
  });

  it("a denied grant never mints a session", async () => {
    const h = H;
    const { cookie } = await h.signUp("owner@example.com");
    const start = await h.request("/api/auth/device/start", { method: "POST", body: "{}" });
    const grant = (await start.json()) as { deviceCode: string; userCode: string };

    const deny = await h.request("/api/auth/device/deny", {
      method: "POST",
      cookie,
      body: JSON.stringify({ userCode: grant.userCode }),
    });
    expect(deny.status).toBe(200);

    const token = await h.request("/api/auth/device/token", {
      method: "POST",
      body: JSON.stringify({ deviceCode: grant.deviceCode }),
    });
    expect(token.status).toBe(403);
    expect(((await token.json()) as { error: { code: string } }).error.code).toBe("access_denied");
  });

  it("an unknown user code cannot be approved", async () => {
    const h = H;
    const { cookie } = await h.signUp("owner@example.com");
    const verify = await h.request("/api/auth/device/verify", {
      method: "POST",
      cookie,
      body: JSON.stringify({ userCode: "ZZZZ-ZZZZ" }),
    });
    expect(verify.status).toBe(404);
    expect(((await verify.json()) as { error: { code: string } }).error.code).toBe("unknown_code");
  });
});
