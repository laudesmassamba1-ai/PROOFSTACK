import type { scanPage } from "@proofcore/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

/**
 * The verification loop: re-check one finding against the live site, now.
 *
 * The scanner is injected, so these tests describe the whole HTTP path — auth, role,
 * rate limit, comparison of before/after, persistence — without a network call.
 */

const PASSWORD = "correct horse battery";
const ENV = { NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" };

/** A scanner stub that answers with whatever the current "site" would emit. */
function scanner(result: "pass" | "fail" | "warn" | "missing" | "offline") {
  return (async () => {
    if (result === "offline") throw new Error("ECONNREFUSED");
    const findings =
      result === "missing"
        ? [{ module: "clean", id: "headings", status: "PASS", observed: "1 h1", why: "…" }]
        : [
            {
              module: "fail",
              id: "hsts",
              status: result === "pass" ? "PASS" : result === "warn" ? "WARN" : "FAIL",
              observed: result === "pass" ? "max-age=31536000" : "absent",
              why: "HSTS prevents a protocol downgrade.",
            },
          ];
    return { url: "https://shop.example/", finalUrl: "https://shop.example/", findings };
  }) as unknown as typeof scanPage;
}

async function bootstrap(result: Parameters<typeof scanner>[0]) {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env: ENV, scan: scanner(result) });
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

type Harness = Awaited<ReturnType<typeof bootstrap>>;
let harness: Harness;

async function setup(result: Parameters<typeof scanner>[0]) {
  harness = await bootstrap(result);
  const response = await harness.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email: "verify@example.com", password: PASSWORD, name: "Tester" }),
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
  await harness.store.createPageAudit({
    workspaceId: session.workspaceId,
    createdBy: "u",
    status: 200,
    durationMs: 90,
    worstVerdict: "fail",
    failed: 1,
    warnings: 0,
    ownership: "unverified",
    redacted: true,
    projectId: project.id,
    id: "aud_base",
    url: "https://shop.example/",
    finalUrl: "https://shop.example/",
    payload: JSON.stringify({
      url: "https://shop.example/",
      finalUrl: "https://shop.example/",
      findings: [{ module: "fail", id: "hsts", status: "FAIL", observed: "absent", why: "…" }],
    }),
  });
  return { cookie, workspaceId: session.workspaceId, projectId: project.id };
}

beforeEach(() => {
  // Each test sets its own scanner through setup().
});
afterEach(async () => {
  await harness.close();
});

describe("verifying a correction", () => {
  it("records 'fixed' when the control now passes, and moves the state to fixed", async () => {
    const { cookie, workspaceId, projectId } = await setup("pass");
    const response = await harness.request(
      `/api/v1/projects/${projectId}/corrections/fail:hsts/verify?workspaceId=${workspaceId}`,
      { method: "POST", headers: { cookie } }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      verdict: string;
      before: { status: string };
      after: { status: string };
    };
    expect(body.verdict).toBe("fixed");
    expect(body.before.status).toBe("FAIL");
    expect(body.after.status).toBe("PASS");

    const board = (await (
      await harness.request(
        `/api/v1/projects/${projectId}/corrections?workspaceId=${workspaceId}`,
        { headers: { cookie } }
      )
    ).json()) as {
      items: {
        key: string;
        state: string;
        verification: { verdict: string; before: string; observed: string } | null;
      }[];
    };
    const item = board.items.find((entry) => entry.key === "fail:hsts");
    expect(item?.state).toBe("fixed");
    expect(item?.verification?.verdict).toBe("fixed");
    expect(item?.verification?.before).toBe("absent");
    expect(item?.verification?.observed).toBe("max-age=31536000");
  });

  it("records 'still_present' and leaves the workflow state alone", async () => {
    const { cookie, workspaceId, projectId } = await setup("fail");
    await harness.store.setAuditFindingState({
      workspaceId,
      projectId,
      findingKey: "fail:hsts",
      state: "in_progress",
    });
    const body = (await (
      await harness.request(
        `/api/v1/projects/${projectId}/corrections/fail:hsts/verify?workspaceId=${workspaceId}`,
        { method: "POST", headers: { cookie } }
      )
    ).json()) as { verdict: string; ok: boolean };
    expect(body.verdict).toBe("still_present");
    expect(body.ok).toBe(false);

    const states = await harness.store.listAuditFindingStates(workspaceId, projectId);
    const row = states.find((entry) => String(entry.finding_key) === "fail:hsts");
    expect(String(row?.state)).toBe("in_progress");
    expect(String(row?.verified_verdict)).toBe("still_present");
  });

  it("calls a warning that became a failure worse, not fixed", async () => {
    const { workspaceId, projectId, cookie } = await setup("fail");
    // Distinct timestamps are what make "the latest scan" unambiguous.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await harness.store.createPageAudit({
      workspaceId,
      createdBy: "u",
      status: 200,
      durationMs: 90,
      worstVerdict: "warnings",
      failed: 0,
      warnings: 1,
      ownership: "unverified",
      redacted: true,
      projectId,
      id: "aud_warn",
      url: "https://shop.example/",
      finalUrl: "https://shop.example/",
      payload: JSON.stringify({
        url: "https://shop.example/",
        finalUrl: "https://shop.example/",
        findings: [{ module: "fail", id: "hsts", status: "WARN", observed: "weak", why: "…" }],
      }),
    });
    const body = (await (
      await harness.request(
        `/api/v1/projects/${projectId}/corrections/fail:hsts/verify?workspaceId=${workspaceId}`,
        { method: "POST", headers: { cookie } }
      )
    ).json()) as { verdict: string };
    expect(body.verdict).toBe("worse");
  });

  it("says inconclusive when the site cannot be read, instead of claiming a fix", async () => {
    const { cookie, workspaceId, projectId } = await setup("offline");
    const body = (await (
      await harness.request(
        `/api/v1/projects/${projectId}/corrections/fail:hsts/verify?workspaceId=${workspaceId}`,
        { method: "POST", headers: { cookie } }
      )
    ).json()) as { verdict: string; ok: boolean; error?: string };
    expect(body.verdict).toBe("inconclusive");
    expect(body.ok).toBe(false);
    expect(body.error).toContain("ECONNREFUSED");
  });

  it("refuses a finding that is not in the project's latest scan", async () => {
    const { cookie, workspaceId, projectId } = await setup("pass");
    const response = await harness.request(
      `/api/v1/projects/${projectId}/corrections/fail:csp/verify?workspaceId=${workspaceId}`,
      { method: "POST", headers: { cookie } }
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("finding_not_current");
  });

  it("refuses an anonymous caller", async () => {
    const { workspaceId, projectId } = await setup("pass");
    const response = await harness.request(
      `/api/v1/projects/${projectId}/corrections/fail:hsts/verify?workspaceId=${workspaceId}`,
      { method: "POST" }
    );
    expect(response.status).toBe(401);
  });
});
