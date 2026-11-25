import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { scanPage } from "@proofcore/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import type { Services } from "../src/http/services.js";
import { analyzeRun, configureModule, moduleStatus, runModule } from "../src/module-copilot.js";

/**
 * AI ↔ modules, end to end.
 *
 * The assistant is not trusted to claim a module ran. These tests drive the real HTTP
 * routes with a fake model upstream, then read the stored configuration and run back
 * from the database. FLOW executes on the real engine against a local product; FAIL
 * scans a real page. Nothing here asserts model prose as proof.
 */

const ENV = {
  NODE_ENV: "test",
  WEB_ORIGIN: "http://localhost:5173",
  API_ORIGIN: "http://localhost:8787",
  AI_KEYS_SECRET: "0123456789abcdef0123456789abcdef",
};

interface Harness {
  services: Services;
  request: (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;
  signUp: (email: string) => Promise<{ cookie: string; workspaceId: string; userId: string }>;
}

async function bootstrap(): Promise<Harness> {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({
    db,
    env: ENV,
    // The fixture product is on loopback. Production still refuses private targets;
    // this injection is the test harness, not a relaxation of scanPage.
    scan: (url, options) => scanPage(url, { ...options, allowPrivate: true }),
  });
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
    const body = (await response.json()) as {
      user: { id: string };
      workspace: { id: string };
    };
    return { cookie, workspaceId: body.workspace.id, userId: body.user.id };
  };
  return { services: built.services, request, signUp };
}

interface FixtureOptions {
  /** Create a second order on a retried checkout: the defect FLOW must catch. */
  duplicateOnRetry?: boolean;
}

interface Fixture {
  base: string;
  close: () => void;
  orders: Map<string, { id: string; status: string; count: number; amount: string }>;
}

async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const orders = new Map<string, { id: string; status: string; count: number; amount: string }>();
  let seq = 0;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };

      if (req.method === "POST" && url.pathname === "/checkout") {
        const input = JSON.parse(raw || "{}") as {
          order_reference?: string;
          amount?: string;
        };
        const reference = input.order_reference ?? "unknown";
        const existing = orders.get(reference);
        if (existing && !options.duplicateOnRetry) {
          json(200, {
            order_id: existing.id,
            payment_id: `pay_${existing.id}`,
            state: existing.status,
          });
          return;
        }
        seq += 1;
        const id = `ord_${seq}`;
        const order = {
          id,
          status: "paid",
          count: existing ? existing.count + 1 : 1,
          amount: input.amount ?? "2500.00",
        };
        orders.set(reference, order);
        json(200, { order_id: id, payment_id: `pay_${id}`, state: "paid" });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/orders/")) {
        const reference = decodeURIComponent(url.pathname.slice("/orders/".length));
        const order = orders.get(reference);
        if (!order) {
          json(404, { error: "unknown order" });
          return;
        }
        json(200, {
          order_id: order.id,
          status: order.status,
          order_count: order.count,
          amount: order.amount,
          currency: "XOF",
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/refund") {
        const input = JSON.parse(raw || "{}") as { payment_id?: string };
        for (const order of orders.values()) {
          if (`pay_${order.id}` === input.payment_id) order.status = "refunded";
        }
        json(200, { accepted: true, state: "refunded" });
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><html lang="fr"><head><meta charset="utf-8">
           <meta name="viewport" content="width=device-width, initial-scale=1">
           <title>Fixture checkout</title></head><body>
           <h1>Boutique de test</h1><img src="/x.png" alt="Produit">
           <form><label for="email">E-mail</label><input id="email" name="email"></form>
           </body></html>`
        );
        return;
      }

      json(404, { error: "not found" });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => server.close(),
    orders,
  };
}

// --------------------------------------------------------------- fake upstream

interface UpstreamState {
  requests: { body: string }[];
  respond: (attempt: number, body: Record<string, unknown>) => Response | Promise<Response>;
}

function startUpstream(state: UpstreamState): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && (req.url ?? "").endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
        return;
      }
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += String(chunk);
      });
      req.on("end", () => {
        state.requests.push({ body: raw });
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        Promise.resolve(state.respond(state.requests.length, parsed)).then((response) => {
          res.writeHead(response.status, { "content-type": "application/json" });
          res.end(JSON.stringify(response.body ?? {}));
        });
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve(`http://127.0.0.1:${port}/v1`);
      afterEach(() => server.close());
    });
  });
}

function toolCall(id: string, name: string, args: unknown) {
  return {
    status: 200,
    body: {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id,
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
    },
  };
}

function answer(text: string) {
  return {
    status: 200,
    body: { choices: [{ message: { role: "assistant", content: text } }] },
  };
}

function toolResult(body: Record<string, unknown>): Record<string, unknown> | null {
  const messages = (body.messages ?? []) as { role?: string; content?: unknown }[];
  const last = [...messages].reverse().find((message) => message.role === "tool");
  if (!last || typeof last.content !== "string") return null;
  const newline = last.content.indexOf("\n");
  try {
    return JSON.parse(last.content.slice(newline + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

let harness: Harness;
let upstreamBase: string;
const upstreamState: UpstreamState = { requests: [], respond: () => answer("no") };

beforeEach(async () => {
  upstreamState.requests = [];
  upstreamState.respond = () => answer("no");
  harness = await bootstrap();
});

describe("module copilot service", () => {
  it("reports the five modules with honest runtime capability", async () => {
    const { request, signUp, services } = harness;
    const { workspaceId, cookie } = await signUp("modules-status@example.com");
    const created = await request("/api/v1/projects", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        name: "Status project",
        baseUrl: "https://shop.example",
        environment: "staging",
      }),
    });
    const project = ((await created.json()) as { project: { id: string } }).project;

    const status = await moduleStatus(services, workspaceId, project.id);
    expect(status.modules.map((module) => module.module)).toEqual([
      "world",
      "flow",
      "exit",
      "fail",
      "clean",
    ]);
    const flow = status.modules.find((module) => module.module === "flow");
    expect(flow?.runnableHere).toBe(true);
    const exit = status.modules.find((module) => module.module === "exit");
    expect(exit?.runnableHere).toBe(false);
    expect(exit?.runLocally).toContain("proofcore test --module exit");
  });

  it("refuses an invalid FLOW journey with the real schema and saves nothing", async () => {
    const { request, signUp, services } = harness;
    const { workspaceId, cookie } = await signUp("modules-invalid@example.com");
    const created = await request("/api/v1/projects", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        name: "Invalid project",
        baseUrl: "https://shop.example",
        environment: "staging",
      }),
    });
    const project = ((await created.json()) as { project: { id: string } }).project;

    const result = await configureModule(services, workspaceId, project.id, "flow", {
      journeys: [
        {
          id: "checkout",
          name: "Checkout",
          steps: [{ id: "s1", action: "teleport", target: "#pay" }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("invalid journey was accepted");
    expect(JSON.stringify(result.issues)).toContain("action");

    const config = await request(
      `/api/v1/projects/${project.id}/config?workspaceId=${workspaceId}`,
      {
        cookie,
      }
    );
    const body = (await config.json()) as {
      config: { modules: { flow: { journeys: unknown[] } } };
    };
    expect(body.config.modules.flow.journeys).toEqual([]);
  });

  it("refuses FAIL scans on a different protocol or port, even for the same hostname", async () => {
    const server = await fixture();
    try {
      const { request, signUp, services } = harness;
      const { workspaceId, cookie, userId } = await signUp("modules-origin-guard@example.com");
      const created = await request("/api/v1/projects", {
        method: "POST",
        cookie,
        body: JSON.stringify({
          workspaceId,
          name: "Origin guard project",
          baseUrl: server.base,
          environment: "local",
        }),
      });
      const project = ((await created.json()) as { project: { id: string } }).project;
      const wrongOrigin = new URL(server.base);
      wrongOrigin.port = wrongOrigin.port === "1" ? "2" : "1";

      await expect(
        runModule(services, workspaceId, project.id, "fail", {
          actorUserId: userId,
          url: wrongOrigin.toString(),
        })
      ).rejects.toThrow("exact origin");
    } finally {
      server.close();
    }
  });

  it("scans FAIL on a real page and returns observed controls", async () => {
    const server = await fixture();
    try {
      const { request, signUp, services } = harness;
      const { workspaceId, cookie, userId } = await signUp("modules-fail@example.com");
      const created = await request("/api/v1/projects", {
        method: "POST",
        cookie,
        body: JSON.stringify({
          workspaceId,
          name: "Fail project",
          baseUrl: server.base,
          environment: "local",
        }),
      });
      const project = ((await created.json()) as { project: { id: string } }).project;

      const run = await runModule(services, workspaceId, project.id, "fail", {
        actorUserId: userId,
      });
      expect(run.status).toBe("COMPLETED");
      expect(run.runId).toBeNull();
      expect(run.reportId).toBeNull();
      expect(run.auditId).toMatch(/^aud_[a-f0-9]{20}$/);
      const stored = await services.store.getPageAudit(workspaceId, run.auditId as string);
      expect(stored).not.toBeNull();
      expect(stored?.created_by).toBe(userId);
      expect(stored?.project_id).toBe(project.id);
      expect(stored?.ownership).toBe("unverified");
      const history = await services.store.listPageAudits(workspaceId, {
        limit: 10,
        offset: 0,
        projectId: project.id,
      });
      expect(history.total).toBe(1);
      expect(history.rows[0]?.id).toBe(run.auditId);
      const totals = run.totals as { total?: number; passed?: number } | null;
      expect(totals?.total ?? 0).toBeGreaterThan(0);
      expect(run.cases.some((item) => item.status === "FAIL" || item.status === "WARN")).toBe(true);
      // A skipped control is still reported, never silently turned into a pass.
      expect(Array.isArray(run.skipped)).toBe(true);
    } finally {
      server.close();
    }
  });
});

describe("AI ↔ FLOW, end to end", () => {
  it("reads the schema, saves a valid config, runs the engine, stores the run and analyses it", async () => {
    const server = await fixture();
    try {
      upstreamBase = await startUpstream(upstreamState);
      const { request, signUp, services } = harness;
      const { workspaceId, cookie } = await signUp("flow-copilot@example.com");
      const created = await request("/api/v1/projects", {
        method: "POST",
        cookie,
        body: JSON.stringify({
          workspaceId,
          name: "FLOW copilot",
          baseUrl: server.base,
          environment: "local",
        }),
      });
      const project = ((await created.json()) as { project: { id: string } }).project;

      const profile = await request("/api/v1/ai/profile", {
        method: "PUT",
        cookie,
        body: JSON.stringify({
          providerId: "custom",
          baseUrl: upstreamBase,
          model: "test-model",
          apiKey: "sk-flow-copilot-1234",
        }),
      });
      expect(profile.status).toBe(200);

      const target = {
        checkoutUrl: `${server.base}/checkout`,
        orderUrlTemplate: `${server.base}/orders/{reference}`,
        refundUrl: `${server.base}/refund`,
        timeoutMs: 5000,
      };

      upstreamState.respond = (attempt, body) => {
        if (attempt === 1) {
          return toolCall("call_status", "module_status", { projectId: project.id });
        }
        if (attempt === 2) {
          return toolCall("call_config", "module_config", {
            projectId: project.id,
            module: "flow",
          });
        }
        if (attempt === 3) {
          return toolCall("call_save", "module_configure", {
            projectId: project.id,
            module: "flow",
            settings: {
              paymentMode: "simulated",
              baseUrl: server.base,
              scenarios: ["checkout_success", "order_duplicate", "refund_flow"],
              target,
            },
            confirm: true,
          });
        }
        if (attempt === 4) {
          return toolCall("call_run", "module_run", {
            projectId: project.id,
            module: "flow",
            confirm: true,
          });
        }
        if (attempt === 5) {
          const result = toolResult(body);
          const runId = typeof result?.runId === "string" ? result.runId : "";
          expect(runId, "module_run did not return a run id").not.toBe("");
          return toolCall("call_analysis", "analyze_run", { runId });
        }
        return answer("FLOW exécuté sur le produit de test; analyse enregistrée.");
      };

      const chat = await request("/api/v1/ai/chat", {
        method: "POST",
        cookie,
        body: JSON.stringify({
          workspaceId,
          message: "Configure FLOW pour tester le checkout, lance-le, puis explique le résultat.",
          effort: "deep",
        }),
      });
      expect(chat.status).toBe(200);
      const body = (await chat.json()) as {
        message: string;
        trace: { tool: string; summary: string }[];
      };
      expect(body.trace.map((item) => item.tool)).toEqual([
        "module_status",
        "module_config",
        "module_configure",
        "module_run",
        "analyze_run",
      ]);
      expect(body.trace[2]?.summary).toContain("saved");
      expect(body.trace[3]?.summary).toContain("COMPLETED");

      // The saved config is the real schema, not a model-authored blob.
      const config = await request(
        `/api/v1/projects/${project.id}/config?workspaceId=${workspaceId}`,
        { cookie }
      );
      const saved = (await config.json()) as {
        config: {
          modules: {
            flow: {
              scenarios: string[];
              target: { checkoutUrl: string; refundUrl: string };
            };
          };
        };
      };
      expect(saved.config.modules.flow.scenarios).toEqual([
        "checkout_success",
        "order_duplicate",
        "refund_flow",
      ]);
      expect(saved.config.modules.flow.target.checkoutUrl).toBe(`${server.base}/checkout`);
      expect(saved.config.modules.flow.target.refundUrl).toBe(`${server.base}/refund`);

      // The run is in history, and every case passed against the fixture.
      const runs = await request(`/api/v1/runs?workspaceId=${workspaceId}`, { cookie });
      const history = (await runs.json()) as {
        items: {
          id: string;
          status: string;
          totals: Record<string, { passed: number; failed: number }>;
        }[];
      };
      const stored = history.items.find((run) => run.totals.flow !== undefined);
      expect(stored).toBeDefined();
      expect(stored?.status).toBe("COMPLETED");
      expect(stored?.totals.flow?.passed).toBe(3);
      expect(stored?.totals.flow?.failed).toBe(0);

      // The model received the stored diagnosis, not just the run summary.
      const analysisCall = upstreamState.requests
        .map((request) => request.body)
        .find((body) => body.includes("passedCount") && body.includes("failures"));
      expect(analysisCall).toBeDefined();
      expect(analysisCall).toContain("passedCount");
      expect(analysisCall).toContain("failures");
      expect(body.message).toContain("FLOW");

      // And the same run is readable again in a later turn.
      const analysis = await analyzeRun(services, workspaceId, stored?.id ?? "");
      expect(analysis?.run.status).toBe("COMPLETED");
      expect(analysis?.failures).toEqual([]);
      expect(analysis?.skipped).toEqual([]);
      expect(analysis?.passedCount).toBe(3);
    } finally {
      server.close();
    }
  }, 60_000);

  it("turns a real duplicate-order defect into a failed case and an analysis the AI can act on", async () => {
    const server = await fixture({ duplicateOnRetry: true });
    try {
      const { request, signUp, services } = harness;
      const { workspaceId, cookie } = await signUp("flow-defect@example.com");
      const created = await request("/api/v1/projects", {
        method: "POST",
        cookie,
        body: JSON.stringify({
          workspaceId,
          name: "FLOW defect",
          baseUrl: server.base,
          environment: "local",
        }),
      });
      const project = ((await created.json()) as { project: { id: string } }).project;

      const configured = await configureModule(services, workspaceId, project.id, "flow", {
        paymentMode: "simulated",
        scenarios: ["order_duplicate"],
        target: {
          checkoutUrl: `${server.base}/checkout`,
          orderUrlTemplate: `${server.base}/orders/{reference}`,
          timeoutMs: 5000,
        },
      });
      expect(configured.ok).toBe(true);

      const run = await runModule(services, workspaceId, project.id, "flow");
      expect(run.status).toBe("FAILED");
      expect(run.runId).not.toBeNull();
      const failed = run.cases.find((item) => item.status === "FAILED");
      expect(failed?.failure?.code).toBe("duplicate_order_created");

      const analysis = await analyzeRun(services, workspaceId, run.runId ?? "");
      expect(analysis?.failures).toHaveLength(1);
      expect(analysis?.failures[0]?.code).toBe("duplicate_order_created");
      expect(analysis?.failures[0]?.caseId).toContain("order_duplicate");
      expect(analysis?.note).toContain("fix");

      const runs = await request(`/api/v1/runs?workspaceId=${workspaceId}`, { cookie });
      const history = (await runs.json()) as { items: { id: string }[] };
      expect(history.items.some((item) => item.id === run.runId)).toBe(true);
    } finally {
      server.close();
    }
  }, 60_000);
});
