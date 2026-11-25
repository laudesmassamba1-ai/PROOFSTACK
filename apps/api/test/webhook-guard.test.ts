import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import type { Services } from "../src/http/services.js";
import { deliverWorkspaceEvent, isValidWebhookUrl } from "../src/outbound.js";

/**
 * Outbound webhook authority.
 *
 * A workspace owner controls the URL. If the server accepts an internal address, that
 * owner can make PROOFCORE POST run data to `169.254.169.254` (cloud metadata),
 * `127.0.0.1` (the deployment itself), a cluster service, or a database port — the API
 * becomes an SSRF proxy. These tests pin the address policy and the redirect refusal so
 * the guard cannot quietly regress.
 */

const PROD = "production";
const TEST = "test";

describe("isValidWebhookUrl — production", () => {
  it.each([
    ["https://hooks.example.com/proofcore", true],
    ["https://hooks.example.com:8443/proofcore", true],
    ["https://hooks.example.com:8080/proofcore", true],
    ["http://hooks.example.com/proofcore", false],
    ["https://169.254.169.254/latest/meta-data", false],
    ["https://metadata.google.internal/computeMetadata/v1", false],
    ["https://metadata.goog/", false],
    ["https://100.64.0.1/", false],
    ["https://10.0.0.5/", false],
    ["https://172.16.4.2/", false],
    ["https://192.168.1.4/", false],
    ["https://127.0.0.1/", false],
    ["https://[::1]/", false],
    ["https://[fd00::1]/", false],
    ["https://[fe80::1]/", false],
    ["https://[::ffff:127.0.0.1]/", false],
    ["https://2130706433/", false],
    ["https://0x7f000001/", false],
    ["https://hooks.example.svc/", false],
    ["https://relay.cluster.local/", false],
    ["https://printer.local/", false],
    ["https://user:password@hooks.example.com/", false],
    ["https://hooks.example.com:6379/", false],
    ["https://hooks.example.com:22/", false],
    ["ftp://hooks.example.com/", false],
    ["not a url", false],
  ])("%s → %s", (url, expected) => {
    expect(isValidWebhookUrl(url, PROD)).toBe(expected);
  });
});

describe("isValidWebhookUrl — local development", () => {
  it("keeps local receivers usable outside production", () => {
    expect(isValidWebhookUrl("http://127.0.0.1:5678/webhook/proofcore", TEST)).toBe(true);
    expect(isValidWebhookUrl("http://localhost:3000/hook", TEST)).toBe(true);
    expect(isValidWebhookUrl("http://192.168.1.20:5678/hook", TEST)).toBe(true);
  });

  it("still refuses metadata and link-local addresses", () => {
    expect(isValidWebhookUrl("http://169.254.169.254/latest/meta-data", TEST)).toBe(false);
    expect(isValidWebhookUrl("http://metadata.google.internal/", TEST)).toBe(false);
    expect(isValidWebhookUrl("http://[fd00::1]/", TEST)).toBe(false);
    expect(isValidWebhookUrl("http://[::ffff:169.254.169.254]/", TEST)).toBe(false);
  });
});

async function bootstrap(env: Record<string, string>) {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env });
  const request = async (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    return built.app.request(path, { ...init, headers });
  };
  return { services: built.services as Services, request };
}

describe("webhook registration", () => {
  it("refuses a metadata endpoint in production and records no row", async () => {
    const h = await bootstrap({
      NODE_ENV: "production",
      WEB_ORIGIN: "https://app.proofcore.test",
      API_ORIGIN: "https://api.proofcore.test",
    });
    const signUp = await h.request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        email: "owner@example.com",
        password: "correct horse battery",
        name: "Owner",
      }),
    });
    expect(signUp.status).toBe(201);
    const cookie = (signUp.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const workspaceId = ((await signUp.json()) as { workspace: { id: string } }).workspace.id;

    const response = await h.request("/api/v1/webhooks", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        url: "https://169.254.169.254/latest/meta-data/iam/security-credentials/",
        events: ["run.completed"],
      }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "webhook_url_invalid"
    );
    expect(await h.services.store.listWorkspaceWebhooks(workspaceId)).toHaveLength(0);
  });
});

describe("webhook delivery", () => {
  let close: (() => void) | undefined;
  afterEach(() => {
    close?.();
    close = undefined;
  });

  it("does not follow a redirect into the internal network", async () => {
    const server = createServer((_req, res) => {
      // The classic bypass: the public receiver answers 302 to the metadata service.
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    close = () => server.close();

    const h = await bootstrap({
      NODE_ENV: "test",
      WEB_ORIGIN: "http://localhost:5173",
      API_ORIGIN: "http://localhost:8787",
    });
    const workspace = await h.services.store.createWorkspace({
      userId: (
        await h.services.store.createUser({
          email: "owner@example.com",
          emailNormalized: "owner@example.com",
          name: "Owner",
          passwordHash: "unused",
        })
      ).id,
      name: "Acme",
    });
    const webhook = await h.services.store.createWorkspaceWebhook({
      workspaceId: workspace.id,
      url: `http://127.0.0.1:${port}/hook`,
      secret: "wsk_test_secret",
      secretPrefix: "wsk_test_sec",
      events: ["run.completed"],
    });

    await deliverWorkspaceEvent(h.services, {
      event: "run.completed",
      workspaceId: workspace.id,
      occurredAt: new Date().toISOString(),
      data: { runId: "run_1" },
    });

    const stored = (await h.services.store.listWorkspaceWebhooks(workspace.id))[0];
    expect(stored?.id).toBe(webhook.id);
    expect(stored?.lastStatus).toBe(302);
    expect(stored?.lastError).toContain("redirect");
  });

  it("refuses a stored target that the current policy rejects", async () => {
    const h = await bootstrap({
      NODE_ENV: "production",
      WEB_ORIGIN: "https://app.proofcore.test",
      API_ORIGIN: "https://api.proofcore.test",
    });
    const user = await h.services.store.createUser({
      email: "owner@example.com",
      emailNormalized: "owner@example.com",
      name: "Owner",
      passwordHash: "unused",
    });
    const workspace = await h.services.store.createWorkspace({
      userId: user.id,
      name: "Acme",
    });
    await h.services.store.createWorkspaceWebhook({
      workspaceId: workspace.id,
      url: "https://169.254.169.254/hook",
      secret: "wsk_test_secret",
      secretPrefix: "wsk_test_sec",
      events: ["run.completed"],
    });

    await deliverWorkspaceEvent(h.services, {
      event: "run.completed",
      workspaceId: workspace.id,
      occurredAt: new Date().toISOString(),
      data: { runId: "run_1" },
    });

    const stored = (await h.services.store.listWorkspaceWebhooks(workspace.id))[0];
    expect(stored?.lastStatus).toBeNull();
    expect(stored?.lastError).toContain("blocked");
  });
});
