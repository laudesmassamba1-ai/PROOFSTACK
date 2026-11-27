import { beforeEach, describe, expect, it } from "vitest";
import { bootstrap, type Harness, paidWorkspace } from "./harness.js";

/**
 * The machine API (`/v1/*`, used by the CLI and CI) had no request budget. A leaked key
 * could hammer the upload path without a ceiling, and nothing slowed down guessing of
 * `psk_` tokens. Two budgets fix this, both in the database like the AI limits:
 *   - a per-key budget for valid keys;
 *   - a per-client-address budget for failed authentications.
 * A refusal answers 429 with `Retry-After` and a stable code.
 */
describe("machine API rate limit", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await bootstrap({
      MACHINE_RATE_LIMIT_PER_MINUTE: "2",
      MACHINE_AUTH_FAILURES_PER_MINUTE: "2",
    });
  });

  it("answers 429 with Retry-After once one key exceeds its per-minute budget", async () => {
    const paid = await paidWorkspace(h);
    const headers = { authorization: `Bearer ${paid.token}` };

    expect((await h.request("/v1/project", { headers })).status).toBe(200);
    expect((await h.request("/v1/project", { headers })).status).toBe(200);

    const third = await h.request("/v1/project", { headers });
    expect(third.status).toBe(429);
    const retryAfter = Number(third.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    const body = (await third.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });

  it("does not let one key's traffic exhaust another key's budget", async () => {
    const paid = await paidWorkspace(h);
    const headers = { authorization: `Bearer ${paid.token}` };
    await h.request("/v1/project", { headers });
    await h.request("/v1/project", { headers });
    expect((await h.request("/v1/project", { headers })).status).toBe(429);

    // A second key on the same workspace starts with its own budget.
    const created = await h.request("/api/v1/api-keys", {
      method: "POST",
      cookie: paid.cookie,
      body: JSON.stringify({
        workspaceId: paid.workspaceId,
        projectId: paid.projectId,
        label: "second",
        scopes: ["runs:write"],
      }),
    });
    expect(created.status).toBe(201);
    const other = (await created.json()) as { token: string };
    const otherResponse = await h.request("/v1/project", {
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(otherResponse.status).toBe(200);
  });

  it("limits repeated unknown psk_ keys from one client address", async () => {
    const bad = { authorization: "Bearer psk_not_a_real_key", "x-forwarded-for": "203.0.113.7" };
    expect((await h.request("/v1/project", { headers: bad })).status).toBe(401);
    expect((await h.request("/v1/project", { headers: bad })).status).toBe(401);

    const third = await h.request("/v1/project", { headers: bad });
    expect(third.status).toBe(429);
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    const body = (await third.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });
});
