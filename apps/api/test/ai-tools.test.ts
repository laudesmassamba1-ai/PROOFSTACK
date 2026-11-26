import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AI_TOOL_PERMISSIONS,
  AnalysisBudget,
  MAX_ANALYSIS_CALLS_PER_TURN,
  permissionOf,
} from "../src/ai-tool-policy.js";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

/**
 * The assistant's tool catalogue and its authority.
 *
 * Two claims are pinned here: every advertised tool has been classified on purpose (no
 * tool is granted by omission), and the per-turn scan budget stops a loop instead of
 * letting it spend the account's quota.
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
      built.app.request("http://localhost" + path, {
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

async function signUp(email: string): Promise<{ cookie: string }> {
  const response = await harness.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD, name: "Tester" }),
  });
  expect(response.status).toBe(201);
  return { cookie: (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "" };
}

interface ToolEntry {
  name: string;
  description: string;
  permission: string;
  parameters: Record<string, unknown>;
}

describe("assistant tool catalogue", () => {
  it("publishes every tool with its permission class", async () => {
    const auth = await signUp("tools@example.com");
    const response = await harness.request("/api/v1/ai/tools", {
      headers: { cookie: auth.cookie },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      classes: string[];
      maxAnalysisCallsPerTurn: number;
      tools: ToolEntry[];
    };
    expect(body.classes).toEqual(["read", "analysis", "write", "sensitive"]);
    expect(body.maxAnalysisCallsPerTurn).toBe(MAX_ANALYSIS_CALLS_PER_TURN);
    expect(body.tools.length).toBeGreaterThanOrEqual(24);
    const names = body.tools.map((tool) => tool.name);
    expect(names).toContain("capabilities");
    expect(names).toContain("analysis_findings");
    expect(names).toContain("open_remediation");
    for (const tool of body.tools) {
      expect(body.classes).toContain(tool.permission);
      expect(tool.description.length).toBeGreaterThan(10);
      expect(Object.keys(tool.parameters).length).toBeGreaterThan(0);
    }
  });

  it("classifies every advertised tool explicitly, and nothing else", async () => {
    const auth = await signUp("coverage@example.com");
    const response = await harness.request("/api/v1/ai/tools", {
      headers: { cookie: auth.cookie },
    });
    const body = (await response.json()) as { tools: ToolEntry[] };
    const advertised = new Set(body.tools.map((tool) => tool.name));
    const classified = new Set(Object.keys(AI_TOOL_PERMISSIONS));
    expect([...advertised].sort()).toEqual([...classified].sort());
  });

  it("refuses an unclassified tool by default", () => {
    expect(permissionOf("a_tool_nobody_classified")).toBe("sensitive");
    expect(permissionOf("analysis_findings")).toBe("read");
    expect(permissionOf("open_remediation")).toBe("write");
  });

  it("reads the analysis findings through a read tool, not an analysis one", () => {
    expect(permissionOf("analysis_findings")).toBe("read");
    expect(permissionOf("analyze_run")).toBe("analysis");
  });
});

describe("per-turn analysis budget", () => {
  it("allows three scans and refuses the fourth", () => {
    const budget = new AnalysisBudget();
    expect(budget.consume()).toBe(true);
    expect(budget.consume()).toBe(true);
    expect(budget.consume()).toBe(true);
    expect(budget.consume()).toBe(false);
    expect(budget.remaining).toBe(0);
  });

  it("reports how much is left before it is spent", () => {
    const budget = new AnalysisBudget(2);
    expect(budget.remaining).toBe(2);
    budget.consume();
    expect(budget.remaining).toBe(1);
  });
});
