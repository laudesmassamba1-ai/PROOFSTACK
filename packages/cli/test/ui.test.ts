import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { apiPost, validateProjectDraft } from "../dist/ui.js";

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/**
 * The console's keyboard loop needs a real TTY, but its data path does not. `--once`
 * exercises the same login/session/HTTP/render code as the full-screen mode and is
 * what CI can assert: the account, workspace, plan and run really reached the screen.
 */

async function cli(
  args: string[],
  cwd: string,
  env: Record<string, string> = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await exec(process.execPath, [CLI, ...args], {
      cwd,
      timeout: 30_000,
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "proofcore-ui-"));
}

function reply(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const OVERVIEW = {
  workspace: { id: "ws_1", name: "Acme", myRole: "owner" },
  projects: [
    {
      id: "prj_1",
      name: "Shop",
      baseUrl: "http://localhost:3000",
      environment: "local",
      enabledModules: ["world", "flow"],
    },
  ],
  recentRuns: [
    {
      id: "run_1",
      projectId: "prj_1",
      projectName: "Shop",
      status: "COMPLETED",
      environment: "local",
      startedAt: "2026-11-16T20:00:00.000Z",
      durationMs: 4200,
      findingCount: 0,
      totals: {
        world: { passed: 8, failed: 0, warnings: 0, errors: 0, skipped: 0, total: 8 },
      },
    },
  ],
  recentFailures: [],
  usage: {
    counters: [{ key: "monthly_test_runs", label: "Test runs this period", used: 3, limit: 100 }],
  },
  subscription: {
    planKey: "developer",
    planName: "Developer",
    entitled: true,
    state: "ACTIVE",
    amountMinor: "2900",
    currency: "USD",
    recurringSupported: false,
    renewalDueAt: null,
    currentPeriodEnd: "2026-12-16T20:00:00.000Z",
  },
};

const SESSION = {
  user: {
    id: "usr_1",
    email: "ada@example.com",
    name: "Ada Lovelace",
    createdAt: "2026-11-16T20:00:00.000Z",
    emailVerified: false,
  },
  workspaces: [{ id: "ws_1", name: "Acme", slug: "acme", role: "owner" }],
  isAdmin: true,
};

async function api(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/api/auth/session") return reply(response, SESSION);
    if (url.pathname === "/api/v1/overview") return reply(response, OVERVIEW);
    if (url.pathname === "/api/v1/projects") return reply(response, { items: OVERVIEW.projects });
    if (url.pathname === "/api/v1/runs") return reply(response, { items: OVERVIEW.recentRuns });
    if (url.pathname === "/api/v1/billing") {
      return reply(response, {
        subscription: OVERVIEW.subscription,
        usage: OVERVIEW.usage.counters,
        payments: [],
        provider: { name: "Sandbox", slug: "sandbox", notes: ["test provider"] },
      });
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "not_found", message: "no route" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("terminal console", () => {
  it("renders real API data in one-shot mode", async () => {
    const server = await api();
    try {
      const dir = await project();
      const result = await cli(["ui", "--once", "--screen", "overview", "--api", server.url], dir, {
        PROOFCORE_SESSION_COOKIE: "ps_session=test",
        PROOFCORE_SESSION_FILE: join(dir, "session.json"),
      });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Acme");
      expect(result.stdout).toContain("Developer");
      expect(result.stdout).toContain("COMPLETED");
      expect(result.stdout).toContain("3 / 100");
    } finally {
      await server.close();
    }
  });

  it("serves a machine-readable status command", async () => {
    const server = await api();
    try {
      const dir = await project();
      const result = await cli(["status", "--json", "--api", server.url], dir, {
        PROOFCORE_SESSION_COOKIE: "ps_session=test",
      });
      expect(result.code, result.stderr).toBe(0);
      const body = JSON.parse(result.stdout) as {
        user: { email: string };
        workspace: { name: string };
        overview: { subscription: { planName: string } };
      };
      expect(body.user.email).toBe("ada@example.com");
      expect(body.workspace.name).toBe("Acme");
      expect(body.overview.subscription.planName).toBe("Developer");
    } finally {
      await server.close();
    }
  });

  it("refuses to render without a session and points at login", async () => {
    const dir = await project();
    const result = await cli(["ui", "--once", "--api", "http://127.0.0.1:9"], dir, {
      PROOFCORE_SESSION_FILE: join(dir, "missing.json"),
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("proofcore login");
  });

  it("prints help without requiring a session", async () => {
    const dir = await project();
    const result = await cli(["ui", "--once", "--screen", "help"], dir, {
      PROOFCORE_SESSION_FILE: join(dir, "missing.json"),
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("terminal console");
    expect(result.stdout).toContain("1 Overview");
  });

  it("validates project drafts before calling the API", () => {
    expect(
      validateProjectDraft({ name: " ", baseUrl: "http://localhost:3000", stack: "" })
    ).toContain("name");
    expect(validateProjectDraft({ name: "Shop", baseUrl: "not-a-url", stack: "" })).toContain(
      "http"
    );
    expect(
      validateProjectDraft({ name: "Shop", baseUrl: "ftp://example.com", stack: "" })
    ).toContain("http");
    expect(
      validateProjectDraft({
        name: "Shop",
        baseUrl: "http://localhost:3000",
        stack: "x".repeat(61),
      })
    ).toContain("Stack");
    expect(
      validateProjectDraft({ name: "Shop", baseUrl: "http://localhost:3000", stack: "nextjs" })
    ).toBeNull();
  });

  it("posts the exact project contract with the session cookie", async () => {
    let received: { cookie?: string; body?: unknown } = {};
    const server = createServer((request, response) => {
      if (request.method !== "POST" || request.url !== "/api/v1/projects") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { code: "not_found", message: "no route" } }));
        return;
      }
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        raw += chunk;
      });
      request.on("end", () => {
        received = { cookie: request.headers.cookie, body: JSON.parse(raw) as unknown };
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ project: { id: "prj_2", name: "Shop 2" } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const created = await apiPost<{ project: { id: string } }>(
        {
          apiUrl: `http://127.0.0.1:${port}`,
          cookie: "ps_session=test",
          email: "ada@example.com",
          savedAt: "2026-11-16T20:00:00.000Z",
        },
        "/api/v1/projects",
        {
          workspaceId: "ws_1",
          name: "Shop 2",
          baseUrl: "http://localhost:3000",
          environment: "local",
          enabledModules: ["world", "flow", "exit"],
        }
      );
      expect(created.project.id).toBe("prj_2");
      expect(received.cookie).toBe("ps_session=test");
      expect(received.body).toEqual({
        workspaceId: "ws_1",
        name: "Shop 2",
        baseUrl: "http://localhost:3000",
        environment: "local",
        enabledModules: ["world", "flow", "exit"],
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("logout removes the stored session file", async () => {
    const dir = await project();
    const path = join(dir, "session.json");
    await writeFile(
      path,
      JSON.stringify({
        apiUrl: "https://example.invalid",
        cookie: "ps_session=test",
        email: "ada@example.com",
        savedAt: "2026-11-16T20:00:00.000Z",
      }),
      "utf8"
    );
    expect(existsSync(path)).toBe(true);
    const result = await cli(["logout"], dir, { PROOFCORE_SESSION_FILE: path });
    expect(result.code).toBe(0);
    expect(existsSync(path)).toBe(false);
  });
});
