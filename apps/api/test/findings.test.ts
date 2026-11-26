import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

/**
 * Findings, read from a stored analysis.
 *
 * The assertions are about what a reader is given: a verdict, a severity, a priority, the
 * seven levels of explanation, a cause to group by, and a comparison that refuses to call
 * two empty analyses "no change".
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

const SCAN = {
  findings: [
    {
      module: "fail",
      id: "hsts",
      status: "FAIL",
      observed: "Strict-Transport-Security absent",
      why: "a downgrade stays possible",
    },
    {
      module: "fail",
      id: "csp",
      status: "FAIL",
      observed: "no Content-Security-Policy",
      why: "injected script would run",
    },
    {
      module: "fail",
      id: "secrets_in_html",
      status: "FAIL",
      observed: "key sk_live_... in the HTML",
      why: "readable by anyone",
    },
    {
      module: "clean",
      id: "html_lang",
      status: "WARN",
      observed: "html lang is empty",
      why: "screen readers pick the wrong voice",
    },
  ],
};

async function createAnalysis(
  auth: { cookie: string; workspaceId: string },
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const response = await harness.request("/api/v1/analyses", {
    method: "POST",
    headers: { cookie: auth.cookie },
    body: JSON.stringify({
      workspaceId: auth.workspaceId,
      source: "API",
      targetType: "PAGE",
      target: "https://shop.example/checkout",
      requestedModules: ["fail", "clean"],
      ...overrides,
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { analysis: { id: string } };
  return body.analysis.id;
}

async function finish(
  auth: { cookie: string; workspaceId: string },
  id: string,
  result: unknown
): Promise<void> {
  // A runner claims the analysis, then closes it: queued never jumps to completed.
  const claimed = await harness.request(`/api/v1/analyses/${id}?workspaceId=${auth.workspaceId}`, {
    method: "PATCH",
    headers: { cookie: auth.cookie },
    body: JSON.stringify({ status: "running" }),
  });
  expect(claimed.status).toBe(200);
  const response = await harness.request(`/api/v1/analyses/${id}?workspaceId=${auth.workspaceId}`, {
    method: "PATCH",
    headers: { cookie: auth.cookie },
    body: JSON.stringify({ status: "completed", result }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
}

function findingsPath(auth: { workspaceId: string }, id: string, query = ""): string {
  return `/api/v1/analyses/${id}/findings?workspaceId=${auth.workspaceId}${query}`;
}

interface FindingItem {
  key: string;
  controlId: string;
  status: string;
  severity: string;
  priority: string;
  cause: string;
  explanation: Record<string, string>;
  evidence: { method: string; observed: string; expected: string | null };
}

interface FindingBody {
  loaded: boolean;
  findings: { items: FindingItem[]; total: number };
  counts: { total: number; byStatus: Record<string, number>; conclusive: number };
  groups: Array<{ cause: string; findings: unknown[]; worstSeverity: string }>;
  measuredModules: string[];
}

describe("analysis findings", () => {
  it("returns enriched findings with a cause, a severity and seven explanations", async () => {
    const auth = await signUp("reader@example.com");
    const id = await createAnalysis(auth);
    await finish(auth, id, SCAN);

    const response = await harness.request(findingsPath(auth, id), {
      headers: { cookie: auth.cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as FindingBody;

    expect(body.loaded).toBe(true);
    expect(body.findings.total).toBe(4);
    expect(body.measuredModules.sort()).toEqual(["clean", "fail"]);
    expect(body.findings.items).toHaveLength(4);

    const secret = body.findings.items.find((item) => item.controlId === "secrets_in_html");
    expect(secret?.severity).toBe("critical");
    expect(secret?.priority).toBe("P0");
    for (const level of [
      "fact",
      "meaning",
      "impact",
      "scope",
      "verification",
      "fix",
      "confidence",
    ]) {
      expect(secret?.explanation[level]?.length ?? 0, level).toBeGreaterThan(5);
    }
    expect(secret?.evidence.observed).toContain("sk_live");

    // Highest exposure first; HSTS is a transport problem, CSP a header one.
    expect(body.findings.items[0]?.controlId).toBe("secrets_in_html");
    expect(body.groups.find((group) => group.cause === "headers")?.findings).toHaveLength(1);
    expect(body.groups.find((group) => group.cause === "transport")?.findings).toHaveLength(1);
    expect(body.counts.byStatus.FAILED).toBe(3);
  });

  it("filters by status, cause and severity, and rejects an unknown status", async () => {
    const auth = await signUp("filter@example.com");
    const id = await createAnalysis(auth);
    await finish(auth, id, SCAN);
    const cookie = auth.cookie;

    const failed = (await (
      await harness.request(findingsPath(auth, id, "&status=FAILED"), { headers: { cookie } })
    ).json()) as FindingBody;
    expect(failed.findings.total).toBe(3);

    const exposure = (await (
      await harness.request(findingsPath(auth, id, "&cause=exposure"), { headers: { cookie } })
    ).json()) as FindingBody;
    expect(exposure.findings.total).toBe(1);

    const critical = (await (
      await harness.request(findingsPath(auth, id, "&severity=critical"), { headers: { cookie } })
    ).json()) as FindingBody;
    expect(critical.findings.items[0]?.controlId).toBe("secrets_in_html");

    const invalid = await harness.request(findingsPath(auth, id, "&status=NOPE"), {
      headers: { cookie },
    });
    expect(invalid.status).toBe(400);
  });

  it("says an analysis with no payload is not loaded instead of clean", async () => {
    const auth = await signUp("empty@example.com");
    const id = await createAnalysis(auth);
    const body = (await (
      await harness.request(findingsPath(auth, id), { headers: { cookie: auth.cookie } })
    ).json()) as FindingBody;
    expect(body.loaded).toBe(false);
    expect(body.findings.total).toBe(0);
  });
});

describe("analysis comparison", () => {
  it("separates what was fixed, what persists and what appeared", async () => {
    const auth = await signUp("compare@example.com");
    const base = await createAnalysis(auth);
    await finish(auth, base, SCAN);
    const target = await createAnalysis(auth);
    await finish(auth, target, {
      findings: [
        { module: "fail", id: "hsts", status: "FAIL", observed: "still absent", why: "" },
        { module: "fail", id: "csp", status: "PASS", observed: "CSP present", why: "" },
        { module: "fail", id: "tls", status: "FAIL", observed: "certificate expired", why: "" },
      ],
    });

    const response = await harness.request(
      `/api/v1/analyses/compare?workspaceId=${auth.workspaceId}&base=${base}&target=${target}`,
      { headers: { cookie: auth.cookie } }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      comparison: {
        comparable: boolean;
        counts: Record<string, number>;
        appeared: Array<{ controlId: string }>;
        resolved: Array<{ controlId: string }>;
        persisting: Array<{ controlId: string }>;
      };
    };
    expect(body.comparison.comparable).toBe(true);
    // The response always carries the unmeasured list, so a client cannot read a
    // "resolved" count without also being able to show what was never re-read.
    expect(body.comparison).toHaveProperty("unmeasured");
    expect(body.comparison.persisting.map((item) => item.controlId)).toEqual(["hsts"]);
    expect(body.comparison.appeared.map((item) => item.controlId)).toEqual(["tls"]);
    expect(body.comparison.resolved.map((item) => item.controlId).sort()).toEqual([
      "csp",
      "html_lang",
      "secrets_in_html",
    ]);
  });

  it("refuses to compare an analysis that measured nothing", async () => {
    const auth = await signUp("nothing@example.com");
    const base = await createAnalysis(auth);
    await finish(auth, base, { findings: [] });
    const target = await createAnalysis(auth);
    await finish(auth, target, SCAN);

    const body = (await (
      await harness.request(
        `/api/v1/analyses/compare?workspaceId=${auth.workspaceId}&base=${base}&target=${target}`,
        { headers: { cookie: auth.cookie } }
      )
    ).json()) as {
      comparison: { comparable: boolean; reasons: string[] };
    };
    expect(body.comparison.comparable).toBe(false);
    expect(body.comparison.reasons.length).toBeGreaterThan(0);
  });

  it("requires both ids", async () => {
    const auth = await signUp("params@example.com");
    const response = await harness.request(
      `/api/v1/analyses/compare?workspaceId=${auth.workspaceId}&base=only`,
      { headers: { cookie: auth.cookie } }
    );
    expect(response.status).toBe(400);
  });
});
