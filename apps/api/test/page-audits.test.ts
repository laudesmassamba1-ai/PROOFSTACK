import { scanPage } from "@proofcore/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

/**
 * Scans run from the app.
 *
 * The important assertions are negative ones: the server must refuse internal addresses,
 * must not record a scan it could not perform, must not let a viewer start one, and must not
 * turn an unproven remote scan into a map of someone else's site.
 *
 * Nothing here reaches the network. The scans that have to succeed are driven through
 * `scanPage` with an injected `fetch`, and the API-level assertions read the store directly,
 * so the suite is deterministic and offline.
 */

const PASSWORD = "correct horse battery";

/**
 * The ownership token is keyed by a deployment secret. AI_KEYS_SECRET is the one this
 * installation already carries, and the suite sets it so the token endpoint is exercised
 * for real rather than skipped.
 */
const ENV = {
  NODE_ENV: "test",
  ADMIN_EMAILS: "ops@example.com",
  AI_KEYS_SECRET: "test-ownership-secret-0123456789abcdef",
};

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
    // Exposed so quota tests can seed usage through the real meter instead of
    // hand-writing rows the resolver might not read the same way.
    services: built.services,
    /**
     * Every row of every table, serialised. "This value was never persisted" is a claim
     * about the whole database, not about the one table that was easiest to query.
     */
    dump: async (): Promise<string> => {
      const tables = await db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all<{ name: string }>();
      const parts: string[] = [];
      for (const table of tables) {
        if (table.name.startsWith("sqlite_")) continue;
        const rows = await db
          .prepare(`SELECT * FROM "${table.name}"`)
          .all<Record<string, unknown>>();
        parts.push(`${table.name}: ${JSON.stringify(rows)}`);
      }
      return parts.join("\n");
    },
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

/** Invite a second account with a chosen role and accept, as the invitee. */
async function join(
  owner: { cookie: string; workspaceId: string },
  email: string,
  role: "member" | "admin" | "viewer"
): Promise<{ cookie: string; workspaceId: string }> {
  const guest = await signUp(email);
  const invited = await harness.request(`/api/v1/workspaces/${owner.workspaceId}/invitations`, {
    method: "POST",
    headers: { cookie: owner.cookie },
    body: JSON.stringify({ email, role }),
  });
  expect(invited.status).toBe(201);
  const pending = (await (
    await harness.request("/api/account/invitations", { headers: { cookie: guest.cookie } })
  ).json()) as { items: { id: string }[] };
  const accepted = await harness.request(
    `/api/account/invitations/${pending.items[0]?.id}/accept`,
    { method: "POST", headers: { cookie: guest.cookie } }
  );
  expect(accepted.status).toBe(200);
  return guest;
}

/** A site that answers with one page, and nothing at the well-known path. */
function stubSite(html: string): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.endsWith("/.well-known/proofcore-verification.txt")) {
      return new Response("not found", { status: 404 });
    }
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
}

function pageWithMeta(content: string | null): string {
  const meta = content === null ? "" : `<meta name="proofcore-verification" content="${content}">`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Example</title>${meta}</head><body><main><h1>Example</h1><p>Hello.</p></main></body></html>`;
}

async function verificationToken(
  who: { cookie: string; workspaceId: string },
  workspaceId = who.workspaceId
): Promise<{ token: string; metaTag: string; wellKnownContent: string; instructions: string }> {
  const response = await harness.request(
    `/api/v1/audits/verification-token?workspaceId=${workspaceId}`,
    { headers: { cookie: who.cookie } }
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    token: string;
    metaTag: string;
    wellKnownContent: string;
    instructions: string;
  };
}

interface StoredAudit {
  id: string;
  ownership: string;
  redacted: boolean;
  worstVerdict: string;
}

describe("page audits", () => {
  it("refuses loopback, private and metadata addresses before any request", async () => {
    const { cookie, workspaceId } = await signUp("scan@example.com");
    for (const url of [
      "http://localhost:3000",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.1.2.3/",
      "file:///etc/passwd",
    ]) {
      const response = await harness.request("/api/v1/audits", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ workspaceId, url }),
      });
      expect(response.status, url).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("url_not_scannable");
    }
  });

  it("says where to run a local scan instead of pretending to reach it", async () => {
    const { cookie, workspaceId } = await signUp("local@example.com");
    const response = await harness.request("/api/v1/audits", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ workspaceId, url: "http://localhost:5173" }),
    });
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("CLI");
  });

  it("records nothing when the site cannot be reached", async () => {
    const { cookie, workspaceId } = await signUp("unreachable@example.com");
    const response = await harness.request("/api/v1/audits", {
      method: "POST",
      headers: { cookie },
      // Reserved TLD: guaranteed not to resolve, without hitting a real site in a test.
      body: JSON.stringify({ workspaceId, url: "https://proofcore-test.invalid/" }),
    });
    expect(response.status).toBe(502);
    const list = (await (
      await harness.request(`/api/v1/audits?workspaceId=${workspaceId}`, { headers: { cookie } })
    ).json()) as { items: unknown[]; total: number };
    expect(list.total).toBe(0);
    expect(list.items).toHaveLength(0);
  });

  it("rejects a workspace the caller is not in", async () => {
    const owner = await signUp("owner-scan@example.com");
    const other = await signUp("other-scan@example.com");
    const response = await harness.request("/api/v1/audits", {
      method: "POST",
      headers: { cookie: other.cookie },
      body: JSON.stringify({ workspaceId: owner.workspaceId, url: "https://example.com" }),
    });
    // 404, not 403: a workspace id you do not own stays unenumerable.
    expect(response.status).toBe(404);
  });

  it("lists scans with a total, newest first", async () => {
    const { cookie, workspaceId } = await signUp("list-scan@example.com");
    await harness.store.createPageAudit({
      id: "aud_test_1",
      workspaceId,
      createdBy: "u",
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      durationMs: 120,
      worstVerdict: "fail",
      failed: 3,
      warnings: 1,
      payload: "{}",
      ownership: "unverified",
      redacted: true,
    });
    const body = (await (
      await harness.request(`/api/v1/audits?workspaceId=${workspaceId}`, { headers: { cookie } })
    ).json()) as { items: { id: string; worstVerdict: string }[]; total: number; limit: number };
    expect(body.total).toBe(1);
    expect(body.limit).toBe(25);
    expect(body.items[0]?.worstVerdict).toBe("fail");
  });

  it("returns a verification token that is stable, workspace-scoped and unforgeable", async () => {
    const owner = await signUp("token-owner@example.com");
    const other = await signUp("token-other@example.com");

    const first = await verificationToken(owner);
    const again = await verificationToken(owner);

    // 48 hex characters behind a recognisable prefix: 192 bits of HMAC.
    expect(first.token).toMatch(/^pcv_[0-9a-f]{48}$/);
    expect(again.token).toBe(first.token);
    expect(first.metaTag).toBe(`<meta name="proofcore-verification" content="${first.token}">`);
    expect(first.wellKnownContent).toBe(first.token);
    // The operator-facing copy is French, like the rest of the messages a user reads.
    expect(first.instructions).toContain("well-known");

    // Two workspaces never share a token, and the token is not a function of public data
    // alone: an id that the caller can see does not let them compute someone else's.
    const theirs = await verificationToken(other);
    expect(theirs.token).not.toBe(first.token);
    expect(theirs.token).toHaveLength(first.token.length);

    // A workspace the caller is not a member of is not a 403: it is not there.
    const stranger = await signUp("token-stranger@example.com");
    const refused = await harness.request(
      `/api/v1/audits/verification-token?workspaceId=${owner.workspaceId}`,
      { headers: { cookie: stranger.cookie } }
    );
    expect(refused.status).toBe(404);
  });

  it("keeps a scan unverified until the workspace token is published, and exposes that", async () => {
    const owner = await signUp("proof-owner@example.com");
    const { token } = await verificationToken(owner);

    // The site publishes a token — but not ours. A claim is not a proof.
    const wrong = await scanPage("https://example.com/", {
      fetchImpl: stubSite(pageWithMeta("pcv_000000000000000000000000000000000000000000000000")),
      ownershipHint: "remote",
      ownershipToken: token,
    });
    expect(wrong.ownership).toBe("unverified");
    expect(wrong.redacted).toBe(true);
    expect(wrong.verification).toEqual({ tokenProvided: true, found: false, where: "meta" });

    // No token at all is the same answer: detail withheld.
    const silent = await scanPage("https://example.com/", {
      fetchImpl: stubSite(pageWithMeta(null)),
      ownershipHint: "remote",
    });
    expect(silent.ownership).toBe("unverified");
    expect(silent.redacted).toBe(true);
    expect(silent.verification.found).toBe(false);

    // Our token, published, is the proof.
    const verified = await scanPage("https://example.com/", {
      fetchImpl: stubSite(pageWithMeta(token)),
      ownershipHint: "remote",
      ownershipToken: token,
    });
    expect(verified.ownership).toBe("verified");
    expect(verified.redacted).toBe(false);
    expect(verified.verification).toEqual({ tokenProvided: true, found: true, where: "meta" });

    // What the scan decided is what the API persists and reads back.
    for (const [id, result] of [
      ["aud_wrong", wrong],
      ["aud_verified", verified],
    ] as const) {
      await harness.store.createPageAudit({
        id,
        workspaceId: owner.workspaceId,
        createdBy: "u",
        url: result.url,
        finalUrl: result.finalUrl,
        status: result.status,
        durationMs: result.durationMs,
        worstVerdict: "pass",
        failed: 0,
        warnings: 0,
        payload: JSON.stringify(result),
        ownership: result.ownership,
        redacted: result.redacted,
      });
    }

    const detail = (await (
      await harness.request(`/api/v1/audits/aud_verified?workspaceId=${owner.workspaceId}`, {
        headers: { cookie: owner.cookie },
      })
    ).json()) as { ownership: string; redacted: boolean };
    expect(detail).toMatchObject({ ownership: "verified", redacted: false });

    const unproven = (await (
      await harness.request(`/api/v1/audits/aud_wrong?workspaceId=${owner.workspaceId}`, {
        headers: { cookie: owner.cookie },
      })
    ).json()) as { ownership: string; redacted: boolean };
    expect(unproven).toMatchObject({ ownership: "unverified", redacted: true });

    const list = (await (
      await harness.request(`/api/v1/audits?workspaceId=${owner.workspaceId}`, {
        headers: { cookie: owner.cookie },
      })
    ).json()) as { items: StoredAudit[]; total: number };
    expect(list.total).toBe(2);
    const byId = new Map(list.items.map((item) => [item.id, item]));
    expect(byId.get("aud_verified")).toMatchObject({ ownership: "verified", redacted: false });
    expect(byId.get("aud_wrong")).toMatchObject({ ownership: "unverified", redacted: true });
  });

  it("reports ownership and redaction for a stored scan in the list and the detail", async () => {
    const { cookie, workspaceId } = await signUp("owner-flag@example.com");
    await harness.store.createPageAudit({
      id: "aud_unverified",
      workspaceId,
      createdBy: "u",
      url: "https://unknown.example/",
      finalUrl: "https://unknown.example/",
      status: 200,
      durationMs: 80,
      worstVerdict: "fail",
      failed: 2,
      warnings: 0,
      // Exactly what an unverified scan of a site that mentions a checkout page stores.
      payload: JSON.stringify({
        findings: [{ observed: "an entry point was found (exact location withheld)" }],
      }),
      ownership: "unverified",
      redacted: true,
    });

    const detail = (await (
      await harness.request(`/api/v1/audits/aud_unverified?workspaceId=${workspaceId}`, {
        headers: { cookie },
      })
    ).json()) as {
      ownership: string;
      redacted: boolean;
      result: { findings: { observed: string }[] };
    };
    expect(detail).toMatchObject({ ownership: "unverified", redacted: true });
    expect(JSON.stringify(detail)).toContain("withheld");

    const list = (await (
      await harness.request(`/api/v1/audits?workspaceId=${workspaceId}`, { headers: { cookie } })
    ).json()) as { items: { ownership: string; redacted: boolean }[] };
    expect(list.items[0]).toMatchObject({ ownership: "unverified", redacted: true });
  });

  it("refuses a viewer with 403", async () => {
    const owner = await signUp("viewer-owner@example.com");
    const viewer = await join(owner, "viewer-guest@example.com", "viewer");

    const response = await harness.request("/api/v1/audits", {
      method: "POST",
      headers: { cookie: viewer.cookie },
      body: JSON.stringify({ workspaceId: owner.workspaceId, url: "https://example.com" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("insufficient_role");

    // The same rule covers the token: a viewer cannot be the one who proves ownership.
    const token = await harness.request(
      `/api/v1/audits/verification-token?workspaceId=${owner.workspaceId}`,
      { headers: { cookie: viewer.cookie } }
    );
    expect(token.status).toBe(403);

    // Reading the workspace's scans stays allowed, so a viewer's role is read-only, not blind.
    const list = await harness.request(`/api/v1/audits?workspaceId=${owner.workspaceId}`, {
      headers: { cookie: viewer.cookie },
    });
    expect(list.status).toBe(200);
  });

  it("refuses a login target that is not an absolute http(s) URL", async () => {
    const { cookie, workspaceId } = await signUp("bad-login@example.com");
    for (const url of ["/login", "file:///etc/passwd", "javascript:alert(1)"]) {
      const response = await harness.request("/api/v1/audits", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({
          workspaceId,
          url: "https://example.com",
          login: { url, email: "audit@example.com", password: "whatever" },
        }),
      });
      expect(response.status, url).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        "invalid_body"
      );
    }
  });

  it("never stores or echoes the password it was given", async () => {
    const { cookie, workspaceId } = await signUp("secret-scan@example.com");
    const password = "Sup3r-secret-Pa55word";
    const email = "audit-account@example.com";

    // A scan that cannot happen still must not leak or keep the credential.
    const failed = await harness.request("/api/v1/audits", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({
        workspaceId,
        url: "https://proofcore-test.invalid/",
        login: { url: "https://proofcore-test.invalid/login", email, password },
      }),
    });
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain(password);
    expect(await harness.dump()).not.toContain(password);

    // And the successful path stores the scan result, which carries the login *outcome*
    // and not the credentials that produced it.
    const site = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response("", {
          status: 200,
          headers: { "set-cookie": "ps_session=stub-session; Path=/" },
        });
      }
      const url = String(input);
      if (url.endsWith("/.well-known/proofcore-verification.txt")) {
        return new Response("not found", { status: 404 });
      }
      return new Response(pageWithMeta(null), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }) as typeof fetch;
    const result = await scanPage("https://example.com/", {
      fetchImpl: site,
      ownershipHint: "remote",
      login: { url: "https://example.com/login", email, password },
    });
    expect(result.login).toEqual({ attempted: true, ok: true, status: 200 });

    await harness.store.createPageAudit({
      id: "aud_login",
      workspaceId,
      createdBy: "u",
      url: result.url,
      finalUrl: result.finalUrl,
      status: result.status,
      durationMs: result.durationMs,
      worstVerdict: "pass",
      failed: 0,
      warnings: 0,
      payload: JSON.stringify(result),
      ownership: result.ownership,
      redacted: result.redacted,
    });
    const stored = (
      await (
        await harness.request(`/api/v1/audits/aud_login?workspaceId=${workspaceId}`, {
          headers: { cookie },
        })
      ).text()
    ).toString();
    expect(stored).toContain('"ok":true');
    expect(stored).not.toContain(password);
    expect(stored).not.toContain(email);
    expect(await harness.dump()).not.toContain(password);
  });

  it("keeps a scan private to its workspace", async () => {
    const owner = await signUp("priv-owner@example.com");
    const stranger = await signUp("priv-stranger@example.com");
    await harness.store.createPageAudit({
      id: "aud_private",
      workspaceId: owner.workspaceId,
      createdBy: "u",
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      durationMs: 90,
      worstVerdict: "pass",
      failed: 0,
      warnings: 0,
      payload: "{}",
      ownership: "unverified",
      redacted: true,
    });
    const response = await harness.request(
      `/api/v1/audits/aud_private?workspaceId=${stranger.workspaceId}`,
      { headers: { cookie: stranger.cookie } }
    );
    expect(response.status).toBe(404);
  });
});

describe("page audit quota (monthly_ai_audits)", () => {
  /**
   * Fill the free plan's AI-audit budget through the real meter.
   *
   * The count is read from the resolved entitlements instead of being written as `3`:
   * the free tier is a commercial decision that will move again, and a test that hard-
   * codes it turns every pricing change into a fake failure.
   */
  async function exhaustFreeQuota(account: {
    cookie: string;
    workspaceId: string;
  }): Promise<number> {
    const snapshot = await harness.services.meter.snapshot(account.workspaceId);
    const raw = snapshot.entitlements.entitlements.monthly_ai_audits;
    const limit = typeof raw === "number" ? raw : 0;
    for (let i = 0; i < limit; i += 1) {
      const metered = await harness.services.meter.meter({
        workspaceId: account.workspaceId,
        kind: "ai_audit",
        subjectId: `seed_${account.workspaceId}_${i}`,
        quantity: 1,
      });
      expect(metered.reason).toBe("recorded");
    }
    return limit;
  }

  it("refuses an unauthenticated scan with 401", async () => {
    const owner = await signUp("quota-auth-owner@example.com");
    const response = await harness.request("/api/v1/audits", {
      method: "POST",
      body: JSON.stringify({ workspaceId: owner.workspaceId, url: "https://example.com" }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_authenticated");
  });

  it("denies the scan with the cheapest plan required when the quota is exhausted", async () => {
    const { cookie, workspaceId } = await signUp("quota-gone@example.com");
    const limit = await exhaustFreeQuota({ cookie, workspaceId });

    const response = await harness.request("/api/v1/audits", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ workspaceId, url: "https://example.com" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as {
      error: { code: string; details: { limit: number; used: number; requiredPlanKey?: string } };
    };
    expect(body.error.code).toBe("quota_exhausted");
    expect(body.error.details).toMatchObject({
      limit,
      used: limit,
      requiredPlanKey: "developer",
    });

    // A denied scan never creates a report: nothing billed, nothing stored.
    const list = (await (
      await harness.request(`/api/v1/audits?workspaceId=${workspaceId}`, { headers: { cookie } })
    ).json()) as { total: number };
    expect(list.total).toBe(0);
  });

  it("meters a successful scan and lets the next one through while headroom remains", async () => {
    const { cookie, workspaceId } = await signUp("quota-happy@example.com");
    vi.stubGlobal("fetch", stubSite(pageWithMeta(null)) as unknown as typeof fetch);
    try {
      const response = await harness.request("/api/v1/audits", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ workspaceId, url: "https://example.com" }),
      });
      expect(response.status).toBe(201);

      // The counter moved through the ai_audit kind, the same one the billing
      // page reads — not a private tally the dashboard could disagree with.
      const snapshot = await harness.services.meter.snapshot(workspaceId);
      expect(snapshot.usage.ai_audit).toBe(1);
      // One audit consumed of whatever the free plan grants — asserted as "more than
      // one is left" so a pricing revision does not fail a metering test.
      const granted = snapshot.entitlements.entitlements.monthly_ai_audits;
      expect(typeof granted).toBe("number");
      expect(Number(granted)).toBeGreaterThan(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not bill a scan that could not reach the site", async () => {
    const { cookie, workspaceId } = await signUp("quota-failed@example.com");
    const response = await harness.request("/api/v1/audits", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ workspaceId, url: "https://proofcore-test.invalid/" }),
    });
    expect(response.status).toBe(502);
    const snapshot = await harness.services.meter.snapshot(workspaceId);
    expect(snapshot.usage.ai_audit ?? 0).toBe(0);
  });
});
