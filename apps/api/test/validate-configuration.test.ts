import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import type { Services } from "../src/http/services.js";
import { configureModule, validateModuleSettings } from "../src/module-copilot.js";

/**
 * Configuration preflight.
 *
 * `validate_configuration` must answer exactly what `module_configure` would do, minus
 * the write. These tests pin the three answers a save can give — accepted, blocked by
 * validateConfig, refused by the schema — and prove the project's stored config is
 * untouched after each one.
 */

const ENV = { NODE_ENV: "test" };

interface Harness {
  services: Services;
  request: (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;
}

async function bootstrap(): Promise<Harness> {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env: ENV });
  return {
    services: built.services,
    request: async (path, init = {}) => {
      const headers = new Headers(init.headers);
      if (init.cookie) headers.set("cookie", init.cookie);
      if (init.body && !headers.has("content-type"))
        headers.set("content-type", "application/json");
      return built.app.request(path, { ...init, headers });
    },
  };
}

let harness: Harness;
let cookie = "";
let workspaceId = "";
let projectId = "";

beforeEach(async () => {
  harness = await bootstrap();
  const signUp = await harness.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({
      email: "preflight@example.com",
      password: "correct horse battery",
      name: "Owner",
    }),
  });
  expect(signUp.status).toBe(201);
  cookie = (signUp.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  workspaceId = ((await signUp.json()) as { workspace: { id: string } }).workspace.id;

  const created = await harness.request("/api/v1/projects", {
    method: "POST",
    cookie,
    body: JSON.stringify({
      workspaceId,
      name: "Preflight",
      baseUrl: "https://shop.example",
      environment: "staging",
    }),
  });
  expect(created.status).toBe(201);
  projectId = ((await created.json()) as { project: { id: string } }).project.id;
});

async function savedSource(): Promise<{ source: string; savedAt: string | null }> {
  const response = await harness.request(
    `/api/v1/projects/${projectId}/config?workspaceId=${workspaceId}`,
    { cookie }
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { source: string; savedAt: string | null };
}

describe("validate_configuration", () => {
  it("validates the active configuration with empty settings and writes nothing", async () => {
    const check = await validateModuleSettings(
      harness.services,
      workspaceId,
      projectId,
      "flow",
      {}
    );
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.blocking).toEqual([]);
      expect(check.issues).toEqual(expect.any(Array));
      expect(check.config).toMatchObject({ paymentMode: "simulated" });
    }
    const stored = await savedSource();
    expect(stored.source).toBe("defaults");
    expect(stored.savedAt).toBeNull();
  });

  it("reports the same blocker a save would refuse, and still writes nothing", async () => {
    const check = await validateModuleSettings(harness.services, workspaceId, projectId, "flow", {
      paymentMode: "live_charge",
    });
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.blocking.some((issue) => issue.message.includes("live_charge"))).toBe(true);
    }

    // The write path refuses that same patch, which is why the preflight is believable.
    const refused = await configureModule(harness.services, workspaceId, projectId, "flow", {
      paymentMode: "live_charge",
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("Nothing was saved");

    const stored = await savedSource();
    expect(stored.source).toBe("defaults");
  });

  it("refuses a patch the real schema rejects, with the field path", async () => {
    const check = await validateModuleSettings(harness.services, workspaceId, projectId, "flow", {
      scenarios: ["not_a_scenario"],
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      const issues = check.issues as { path: string }[];
      expect(issues.some((issue) => issue.path.startsWith("scenarios"))).toBe(true);
    }
    expect((await savedSource()).source).toBe("defaults");
  });

  it("says FAIL and CLEAN have no stored settings instead of pretending to validate them", async () => {
    const check = await validateModuleSettings(
      harness.services,
      workspaceId,
      projectId,
      "fail",
      {}
    );
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toContain("no persisted module settings");
  });
});
