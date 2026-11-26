import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

/**
 * Saved FLOW scenarios: the definition survives a reload, the server re-validates what the
 * editor validated, and a deployment without a browser refuses to pretend it ran.
 */

const ENV = { NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" };
const PASSWORD = "correct horse battery";

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
    close: async () => db.close(),
  };
}

type Harness = Awaited<ReturnType<typeof bootstrap>>;
let harness: Harness;
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
  expect(response.status).toBe(201);
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const session = (await (
    await harness.request("/api/auth/session", { headers: { cookie } })
  ).json()) as { workspaceId: string };
  return { cookie, workspaceId: session.workspaceId };
}

const steps = [
  { id: "open", kind: "navigate", label: "Ouvrir la page", value: "https://example.com/" },
  { id: "buy", kind: "click", label: "Cliquer sur Acheter", target: "Acheter" },
  {
    id: "cart",
    kind: "assert",
    label: "Le panier s'ouvre",
    expect: { urlContains: "/cart" },
  },
];

async function create(cookie: string, workspaceId: string, body: Record<string, unknown> = {}) {
  return harness.request("/api/v1/flow/scenarios", {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({
      workspaceId,
      name: "Parcours d'achat",
      target: "https://example.com/",
      steps,
      ...body,
    }),
  });
}

interface ScenarioBody {
  scenario: {
    id: string;
    name: string;
    target: string;
    steps: { id: string; kind: string; value?: string }[];
    lastRunAt: string | null;
    lastReport: unknown;
  };
}

describe("FLOW scenarios", () => {
  it("saves a scenario the runner can execute and lists it after a reload", async () => {
    const { cookie, workspaceId } = await signUp("flow@example.com");
    const created = await create(cookie, workspaceId);
    expect(created.status).toBe(201);
    const body = (await created.json()) as ScenarioBody;
    expect(body.scenario.id).toMatch(/^flw_/);
    expect(body.scenario.steps.map((step) => step.id)).toEqual(["open", "buy", "cart"]);
    expect(body.scenario.steps[0]?.value).toBe("https://example.com/");
    expect(body.scenario.lastRunAt).toBeNull();

    const list = await harness.request(
      `/api/v1/flow/scenarios?workspaceId=${workspaceId}`,
      { headers: { cookie } }
    );
    expect(list.status).toBe(200);
    const body2 = (await list.json()) as { scenarios: ScenarioBody["scenario"][] };
    expect(body2.scenarios).toHaveLength(1);
    expect(body2.scenarios[0]?.id).toBe(body.scenario.id);
  });

  it("refuses a click without a control and names the step at fault", async () => {
    const { cookie, workspaceId } = await signUp("flow@example.com");
    const response = await create(cookie, workspaceId, {
      steps: [
        { id: "open", kind: "navigate", label: "Ouvrir", value: "https://example.com/" },
        { id: "ghost", kind: "click", label: "Cliquer quelque part" },
      ],
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; details?: { issues: { step?: number; code: string }[] } };
    };
    expect(body.error.code).toBe("invalid_scenario");
    expect(body.error.details?.issues).toEqual([
      expect.objectContaining({ step: 1, code: "missing_target" }),
    ]);
  });

  it("updates the steps and keeps the identity of the scenario", async () => {
    const { cookie, workspaceId } = await signUp("flow@example.com");
    const created = (await (await create(cookie, workspaceId)).json()) as ScenarioBody;
    const updated = await harness.request(`/api/v1/flow/scenarios/${created.scenario.id}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({
        workspaceId,
        name: "Parcours remanié",
        target: "https://example.com/",
        steps: [
          { id: "open", kind: "navigate", label: "Ouvrir", value: "https://example.com/" },
          { id: "cart", kind: "assert", label: "Le panier", expect: { textContains: "Panier" } },
        ],
      }),
    });
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as ScenarioBody;
    expect(body.scenario.id).toBe(created.scenario.id);
    expect(body.scenario.name).toBe("Parcours remanié");
    expect(body.scenario.steps).toHaveLength(2);
  });

  it("deletes the scenario and returns 404 afterwards", async () => {
    const { cookie, workspaceId } = await signUp("flow@example.com");
    const created = (await (await create(cookie, workspaceId)).json()) as ScenarioBody;
    const removed = await harness.request(
      `/api/v1/flow/scenarios/${created.scenario.id}?workspaceId=${workspaceId}`,
      { method: "DELETE", headers: { cookie } }
    );
    expect(removed.status).toBe(200);
    const list = (await (
      await harness.request(`/api/v1/flow/scenarios?workspaceId=${workspaceId}`, {
        headers: { cookie },
      })
    ).json()) as { scenarios: unknown[] };
    expect(list.scenarios).toHaveLength(0);
    const missing = await harness.request(
      `/api/v1/flow/scenarios/${created.scenario.id}?workspaceId=${workspaceId}`,
      { method: "DELETE", headers: { cookie } }
    );
    expect(missing.status).toBe(404);
  });

  it("keeps scenarios inside their workspace", async () => {
    const owner = await signUp("owner@example.com");
    const other = await signUp("other@example.com");
    const created = (await (await create(owner.cookie, owner.workspaceId)).json()) as ScenarioBody;
    const list = (await (
      await harness.request(`/api/v1/flow/scenarios?workspaceId=${other.workspaceId}`, {
        headers: { cookie: other.cookie },
      })
    ).json()) as { scenarios: unknown[] };
    expect(list.scenarios).toHaveLength(0);
    const patch = await harness.request(`/api/v1/flow/scenarios/${created.scenario.id}`, {
      method: "PATCH",
      headers: { cookie: other.cookie },
      body: JSON.stringify({
        workspaceId: other.workspaceId,
        name: "Vol",
        target: "https://example.com/",
        steps,
      }),
    });
    expect(patch.status).toBe(404);
  });

  it("refuses to run without a browser and records nothing", async () => {
    const { cookie, workspaceId } = await signUp("flow@example.com");
    const created = (await (await create(cookie, workspaceId)).json()) as ScenarioBody;
    const run = await harness.request(`/api/v1/flow/scenarios/${created.scenario.id}/run`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ workspaceId }),
    });
    expect(run.status).toBe(503);
    const body = (await run.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("browser_unavailable");
    expect(body.error.message).toContain("proofcore audit interact");

    const analyses = (await (
      await harness.request(`/api/v1/analyses?workspaceId=${workspaceId}`, { headers: { cookie } })
    ).json()) as { total: number };
    expect(analyses.total).toBe(0);
  });
});
