import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";
import type { ScenarioReport } from "../src/scenario.js";

/**
 * The local execution path.
 *
 * The deployed Worker uses Cloudflare's BROWSER binding; the Node server uses the machine's
 * Chromium through the adapter the CLI already drives. This file pins the wiring: the same
 * Analysis is recorded, the report is the runner's own, and a runner that dies fails the
 * Analysis instead of leaving a `running` row or inventing a pass.
 */

const ENV = { NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" };
const PASSWORD = "correct horse battery";

const STEPS = [
  { id: "open", kind: "navigate", label: "Ouvrir la page", value: "https://example.com/" },
  { id: "buy", kind: "click", label: "Cliquer sur Acheter", target: "Acheter" },
];

function report(input: { url: string; name: string }): ScenarioReport {
  return {
    scenarioId: "flow-local",
    name: input.name,
    url: input.url,
    findings: [
      {
        id: "buy",
        status: "FAIL",
        observed: "Le panier ne s'ouvre pas après le clic.",
        why: "Le parcours ne peut pas aboutir.",
      },
    ],
    stepsRun: 2,
    stepsSkipped: 0,
    final: {
      url: "https://example.com/",
      title: "Example Domain",
      headings: ["Example Domain"],
      elementCount: 12,
      formCount: 0,
    },
    durationMs: 42,
  };
}

async function bootstrap() {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env: ENV });
  const config = readConfig(ENV);
  return {
    services: built.services,
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

describe("local browser execution", () => {
  it("runs the steps on the injected runner and records a completed WORKFLOW analysis", async () => {
    const calls: { url: string; allowDestructive: boolean }[] = [];
    harness.services.localScenario = async (input) => {
      calls.push({ url: input.url, allowDestructive: input.allowDestructive });
      return report(input);
    };
    const { cookie, workspaceId } = await signUp("local-flow@example.com");

    const response = await harness.request("/api/v1/browser/scenario", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({
        workspaceId,
        url: "https://example.com/",
        name: "Parcours d'achat",
        steps: STEPS,
        allowDestructive: false,
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { analysisId: string; findings: { status: string }[] };
    expect(body.findings[0]?.status).toBe("FAIL");
    expect(calls).toEqual([{ url: "https://example.com/", allowDestructive: false }]);

    const detail = await harness.request(
      `/api/v1/analyses/${body.analysisId}?workspaceId=${workspaceId}`,
      { headers: { cookie } }
    );
    expect(detail.status, await detail.clone().text()).toBe(200);
    const analysis = (
      (await detail.json()) as {
        analysis: {
          status: string;
          environment: string;
          source: string;
          targetType: string;
          coverage: { measuredModules: string[] };
          result: { findings: Record<string, number>; stepsRun: number };
        };
      }
    ).analysis;
    expect(analysis.status).toBe("completed");
    expect(analysis.environment).toBe("local-chromium");
    expect(analysis.source).toBe("WEB");
    expect(analysis.targetType).toBe("WORKFLOW");
    expect(analysis.coverage.measuredModules).toEqual(["flow"]);
    expect(analysis.result.findings).toEqual({ PASS: 0, WARN: 0, FAIL: 1, SKIPPED: 0 });
    expect(analysis.result.stepsRun).toBe(2);
  });

  it("passes the destructive opt-in through, never enables it on its own", async () => {
    let seen: boolean | null = null;
    harness.services.localScenario = async (input) => {
      seen = input.allowDestructive;
      return report(input);
    };
    const { cookie, workspaceId } = await signUp("local-destructive@example.com");
    const response = await harness.request("/api/v1/browser/scenario", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({
        workspaceId,
        url: "https://example.com/",
        steps: STEPS,
        allowDestructive: true,
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(seen).toBe(true);
  });

  it("fails the analysis, with the error, when the runner dies", async () => {
    harness.services.localScenario = async () => {
      throw new Error("Chromium exited before the first step.");
    };
    const { cookie, workspaceId } = await signUp("local-crash@example.com");
    const response = await harness.request("/api/v1/browser/scenario", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ workspaceId, url: "https://example.com/", steps: STEPS }),
    });
    expect(response.status).toBe(500);

    const list = await harness.request(`/api/v1/analyses?workspaceId=${workspaceId}`, {
      headers: { cookie },
    });
    const body = (await list.json()) as { items: { id: string; status: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.status).toBe("failed");
  });
});
