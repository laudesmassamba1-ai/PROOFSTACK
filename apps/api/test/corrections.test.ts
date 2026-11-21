import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

/**
 * Correction tracking and comparative re-control.
 *
 * A state is a person's workflow, never a verdict. The comparison is derived from two
 * stored scans by `module:id`, so "resolved" can only mean "the later scan no longer
 * reports it". These tests seed both scans and check that the API says exactly that.
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

function payload(findings: { module: string; id: string; status: string }[]) {
  return JSON.stringify({
    url: "https://shop.example/",
    finalUrl: "https://shop.example/",
    findings: findings.map((item) => ({
      ...item,
      observed: `observed ${item.id}`,
      why: `why ${item.id}`,
    })),
  });
}

async function setup() {
  const response = await harness.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email: "corrections@example.com", password: PASSWORD, name: "Tester" }),
  });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  const session = (await (
    await harness.request("/api/auth/session", { headers: { cookie } })
  ).json()) as { workspaceId: string };
  const project = await harness.store.createProject({
    workspaceId: session.workspaceId,
    name: "Shop",
    baseUrl: "https://shop.example",
    environment: "production",
    enabledModules: ["world", "flow", "exit"],
  });
  return { cookie, workspaceId: session.workspaceId, projectId: project.id };
}

describe("correction tracking", () => {
  it("merges the latest scan with workflow states and compares the previous one", async () => {
    const { cookie, workspaceId, projectId } = await setup();
    const base = {
      workspaceId,
      createdBy: "u",
      status: 200,
      durationMs: 90,
      worstVerdict: "fail",
      failed: 2,
      warnings: 0,
      ownership: "unverified",
      redacted: true,
      projectId,
    };
    await harness.store.createPageAudit({
      ...base,
      id: "aud_before",
      url: "https://shop.example/",
      finalUrl: "https://shop.example/",
      payload: payload([
        { module: "fail", id: "a", status: "FAIL" },
        { module: "fail", id: "b", status: "FAIL" },
      ]),
    });
    // Distinct timestamps are what make "the latest scan" unambiguous.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await harness.store.createPageAudit({
      ...base,
      id: "aud_after",
      url: "https://shop.example/",
      finalUrl: "https://shop.example/",
      payload: payload([
        { module: "fail", id: "b", status: "FAIL" },
        { module: "fail", id: "c", status: "FAIL" },
      ]),
    });
    // The person had started working on "a"; it disappeared from the later scan.
    await harness.store.setAuditFindingState({
      workspaceId,
      projectId,
      findingKey: "fail:a",
      state: "in_progress",
    });

    const response = await harness.request(
      `/api/v1/projects/${projectId}/corrections?workspaceId=${workspaceId}`,
      { headers: { cookie } }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      auditId: string;
      items: { key: string; state: string; present: boolean }[];
      comparison: { counts: { resolved: number; persisting: number; appeared: number } };
    };
    expect(body.auditId).toBe("aud_after");
    expect(body.comparison.counts).toEqual({ resolved: 1, persisting: 1, appeared: 1 });
    expect(body.items.find((item) => item.key === "fail:b")).toMatchObject({
      state: "todo",
      present: true,
    });
    expect(body.items.find((item) => item.key === "fail:c")).toMatchObject({
      state: "todo",
      present: true,
    });
    // It is gone from the latest scan, but it is still on the board because it was tracked.
    expect(body.items.find((item) => item.key === "fail:a")).toMatchObject({
      state: "in_progress",
      present: false,
    });
  });

  it("saves a state, refuses a finding outside the last two scans, and keeps workspace scope", async () => {
    const { cookie, workspaceId, projectId } = await setup();
    await harness.store.createPageAudit({
      id: "aud_one",
      workspaceId,
      createdBy: "u",
      url: "https://shop.example/",
      finalUrl: "https://shop.example/",
      status: 200,
      durationMs: 80,
      worstVerdict: "fail",
      failed: 1,
      warnings: 0,
      payload: payload([{ module: "flow", id: "checkout", status: "FAIL" }]),
      ownership: "unverified",
      redacted: true,
      projectId,
    });

    const saved = await harness.request(
      `/api/v1/projects/${projectId}/corrections/flow%3Acheckout?workspaceId=${workspaceId}`,
      {
        method: "PATCH",
        headers: { cookie },
        body: JSON.stringify({ state: "fixed" }),
      }
    );
    expect(saved.status).toBe(200);
    expect((await saved.json()) as { state: string }).toMatchObject({ state: "fixed" });

    const listed = (await (
      await harness.request(
        `/api/v1/projects/${projectId}/corrections?workspaceId=${workspaceId}`,
        {
          headers: { cookie },
        }
      )
    ).json()) as { items: { key: string; state: string }[] };
    expect(listed.items.find((item) => item.key === "flow:checkout")?.state).toBe("fixed");

    const unknown = await harness.request(
      `/api/v1/projects/${projectId}/corrections/flow%3Amissing?workspaceId=${workspaceId}`,
      {
        method: "PATCH",
        headers: { cookie },
        body: JSON.stringify({ state: "todo" }),
      }
    );
    expect(unknown.status).toBe(404);

    // Another workspace cannot read this project's board.
    const stranger = await harness.request(
      `/api/v1/projects/${projectId}/corrections?workspaceId=ws_other`,
      { headers: { cookie } }
    );
    expect(stranger.status).toBe(404);
  });
});
