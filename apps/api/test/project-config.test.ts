import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

/**
 * Project module configuration, edited from the web.
 *
 * The API must return a complete config the CLI can load, save a validated subtree,
 * refuse a real charge or an unacknowledged destructive production target, and keep the
 * safety refusal at the same path the CLI would report.
 */

const PASSWORD = "correct horse battery";
const ENV = { NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" };

async function bootstrap() {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env: ENV });
  const config = readConfig(ENV);
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

async function projectFor(workspaceId: string) {
  return harness.store.createProject({
    workspaceId,
    name: "Shop",
    baseUrl: "https://shop.example",
    environment: "staging",
    enabledModules: ["world", "flow", "exit"],
  });
}

const validModules = {
  world: {
    enabled: true,
    profiles: ["fr-FR", "en-US"],
    categories: ["identity", "currency", "datetime"],
    forms: [],
    strictRejectionDetection: true,
    target: {
      kind: "http",
      submitUrl: "https://shop.example/api/records",
      method: "POST",
      headers: {},
      timeoutMs: 10000,
      errorField: "errors",
    },
  },
  flow: {
    enabled: true,
    paymentMode: "simulated",
    scenarios: ["checkout_success", "webhook_duplicate"],
    journeys: [],
    browser: { driver: "playwright", headless: true, viewport: { width: 1440, height: 900 } },
    baseUrl: "https://shop.example",
  },
  exit: {
    enabled: true,
    formats: ["json", "csv"],
    target: "synthetic",
    schema: {},
    relationships: [],
    unique: [],
    roundTrip: { enabled: true },
    maxRecords: 5000,
  },
};

describe("project module configuration", () => {
  it("allows the browser to preflight the PUT used by the editor", async () => {
    // The editor saves with PUT. A method missing from the CORS allow-list blocks the
    // request in the browser before it reaches a route, which looks like an outage.
    const response = await harness.request("/api/v1/projects/prj_any/config", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "PUT",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("PUT");
  });

  it("returns a complete default config before anything is saved", async () => {
    const owner = await signUp("config-default@example.com");
    const project = await projectFor(owner.workspaceId);
    const response = await harness.request(
      `/api/v1/projects/${project.id}/config?workspaceId=${owner.workspaceId}`,
      { headers: { cookie: owner.cookie } }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      source: string;
      config: { project: { name: string }; modules: { world: { profiles: string[] } } };
      issues: { path: string }[];
    };
    expect(body.source).toBe("defaults");
    expect(body.config.project.name).toBe("Shop");
    expect(body.config.modules.world.profiles.length).toBeGreaterThan(0);
    // WORLD has no target yet: the API says so instead of pretending it is ready.
    expect(body.issues.some((issue) => issue.path.startsWith("modules.world"))).toBe(true);
  });

  it("saves a validated configuration and returns the same one on read", async () => {
    const owner = await signUp("config-save@example.com");
    const project = await projectFor(owner.workspaceId);
    const saved = await harness.request(
      `/api/v1/projects/${project.id}/config?workspaceId=${owner.workspaceId}`,
      {
        method: "PUT",
        headers: { cookie: owner.cookie },
        body: JSON.stringify({ modules: validModules, allowDestructiveProduction: false }),
      }
    );
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as { source: string; savedAt: string };
    expect(savedBody.source).toBe("saved");

    const read = (await (
      await harness.request(
        `/api/v1/projects/${project.id}/config?workspaceId=${owner.workspaceId}`,
        {
          headers: { cookie: owner.cookie },
        }
      )
    ).json()) as {
      source: string;
      savedAt: string;
      config: { modules: { exit: { formats: string[] } } };
    };
    expect(read.source).toBe("saved");
    expect(read.savedAt).toBe(savedBody.savedAt);
    expect(read.config.modules.exit.formats).toEqual(["json", "csv"]);
    const stored = await harness.store.getProject(owner.workspaceId, project.id);
    expect(stored?.moduleConfig).toContain("fr-FR");
  });

  it("refuses a real charge from the web form", async () => {
    const owner = await signUp("config-live@example.com");
    const project = await projectFor(owner.workspaceId);
    const response = await harness.request(
      `/api/v1/projects/${project.id}/config?workspaceId=${owner.workspaceId}`,
      {
        method: "PUT",
        headers: { cookie: owner.cookie },
        body: JSON.stringify({
          modules: { ...validModules, flow: { ...validModules.flow, paymentMode: "live_charge" } },
        }),
      }
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: { code: string; details: { issues: unknown[] } };
    };
    expect(body.error.code).toBe("config_unsafe");
    expect(body.error.details.issues.length).toBeGreaterThan(0);
    const stored = await harness.store.getProject(owner.workspaceId, project.id);
    expect(stored?.moduleConfig).toBeNull();
  });

  it("refuses a malformed URL instead of saving it", async () => {
    const owner = await signUp("config-url@example.com");
    const project = await projectFor(owner.workspaceId);
    const response = await harness.request(
      `/api/v1/projects/${project.id}/config?workspaceId=${owner.workspaceId}`,
      {
        method: "PUT",
        headers: { cookie: owner.cookie },
        body: JSON.stringify({
          modules: {
            ...validModules,
            world: {
              ...validModules.world,
              target: { ...validModules.world.target, submitUrl: "not-a-url" },
            },
          },
        }),
      }
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("preflights the editor's save without writing and reports a blocker as information", async () => {
    const owner = await signUp("config-preflight@example.com");
    const project = await projectFor(owner.workspaceId);
    const validate = (modules: unknown) =>
      harness.request(
        `/api/v1/projects/${project.id}/config/validate?workspaceId=${owner.workspaceId}`,
        {
          method: "POST",
          headers: { cookie: owner.cookie },
          body: JSON.stringify({ modules, allowDestructiveProduction: false }),
        }
      );

    const accepted = await validate(validModules);
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as {
      valid: boolean;
      issues: unknown[];
      blocking: unknown[];
      saved: boolean;
    };
    expect(acceptedBody.valid).toBe(true);
    expect(acceptedBody.blocking).toEqual([]);
    expect(acceptedBody.saved).toBe(false);

    const refused = await validate({
      ...validModules,
      flow: { ...validModules.flow, paymentMode: "live_charge" },
    });
    expect(refused.status).toBe(200);
    const refusedBody = (await refused.json()) as {
      valid: boolean;
      blocking: { path: string; message: string }[];
      saved: boolean;
    };
    expect(refusedBody.valid).toBe(false);
    expect(refusedBody.blocking.length).toBeGreaterThan(0);
    expect(JSON.stringify(refusedBody.blocking)).toContain("live_charge");
    expect(refusedBody.saved).toBe(false);

    // Preflight is a read: neither answer stored a configuration.
    const stored = await harness.store.getProject(owner.workspaceId, project.id);
    expect(stored?.moduleConfig).toBeNull();
  });

  it("rejects a malformed preflight payload with 400, not 500", async () => {
    const owner = await signUp("config-preflight-bad@example.com");
    const project = await projectFor(owner.workspaceId);
    const response = await harness.request(
      `/api/v1/projects/${project.id}/config/validate?workspaceId=${owner.workspaceId}`,
      {
        method: "POST",
        headers: { cookie: owner.cookie },
        body: JSON.stringify({
          modules: {
            ...validModules,
            world: {
              ...validModules.world,
              target: { ...validModules.world.target, submitUrl: "not-a-url" },
            },
          },
        }),
      }
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("answers 404 for a project outside the workspace", async () => {
    const owner = await signUp("config-404@example.com");
    const response = await harness.request(
      `/api/v1/projects/prj_missing/config?workspaceId=${owner.workspaceId}`,
      { headers: { cookie: owner.cookie } }
    );
    expect(response.status).toBe(404);
  });
});
