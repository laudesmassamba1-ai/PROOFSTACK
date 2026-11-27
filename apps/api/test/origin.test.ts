import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { originAllowed } from "../src/env.js";

/**
 * Origin allowlisting.
 *
 * This is the rule that decides whether a browser on our own deployment may write to the
 * API. It broke in production for a boring reason — Cloudflare Pages was renamed, the
 * new hostname was never added to WEB_ORIGIN, and every non-GET call from that origin
 * answered `cross_origin_denied`. The wildcard exists so a preview deployment does not
 * reproduce it, and the negative cases below are the reason the wildcard is one label
 * wide instead of a suffix match.
 */

const ORIGINS = [
  "https://proofstack-iota.vercel.app",
  "https://proofstack-01z.pages.dev",
  "https://*.proofstack-01z.pages.dev",
  "https://proofstack-*-laudesmassamba1-ais-projects.vercel.app",
  "http://localhost:5173",
];

describe("originAllowed", () => {
  it("accepts the canonical deployments and local development", () => {
    expect(originAllowed(ORIGINS, "https://proofstack-iota.vercel.app")).toBe(true);
    expect(originAllowed(ORIGINS, "https://proofstack-01z.pages.dev")).toBe(true);
    expect(originAllowed(ORIGINS, "http://localhost:5173")).toBe(true);
  });

  it("accepts a preview hostname, which is what the wildcard is for", () => {
    expect(originAllowed(ORIGINS, "https://6f0fee2d.proofstack-01z.pages.dev")).toBe(true);
    expect(
      originAllowed(ORIGINS, "https://proofstack-3lh66ezz5-laudesmassamba1-ais-projects.vercel.app")
    ).toBe(true);
  });

  it("rejects lookalikes that a naive suffix comparison would let through", () => {
    for (const hostile of [
      "https://proofstack-01z.pages.dev.attacker.com",
      "https://attacker.com/proofstack-01z.pages.dev",
      "https://evil.pages.dev",
      "https://proofstack-iota.vercel.app.evil.io",
      "https://a.b.proofstack-01z.pages.dev",
      "http://proofstack-01z.pages.dev",
      "https://PROOFSTACK-01Z.PAGES.DEV.example",
      "null",
      "",
    ]) {
      expect(originAllowed(ORIGINS, hostile), hostile).toBe(false);
    }
  });

  it("ignores an undefined origin (native clients send none)", () => {
    expect(originAllowed(ORIGINS, undefined)).toBe(false);
  });
});

async function bootstrap(): Promise<{
  request: (path: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
}> {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({
    db,
    env: {
      NODE_ENV: "test",
      ADMIN_EMAILS: "ops@example.com",
      WEB_ORIGIN: ORIGINS.join(","),
    },
  });
  return {
    request: (path, init = {}) =>
      built.app.request(`http://localhost${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...init.headers },
      }),
    close: async () => db.close(),
  };
}

describe("cross-origin write guard", () => {
  it("lets a write through from the Cloudflare Pages origin", async () => {
    const harness = await bootstrap();
    const response = await harness.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        origin: "https://proofstack-01z.pages.dev",
        "sec-fetch-site": "same-site",
      },
      body: JSON.stringify({
        email: "pages@example.com",
        password: "correct horse battery",
        name: "Pages",
      }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://proofstack-01z.pages.dev"
    );
    await harness.close();
  });

  it("refuses a hostile origin and names it in the message", async () => {
    const harness = await bootstrap();
    // `/api/v1/*` carries the cookie-authenticated write guard; the check runs before
    // routing, so an unauthenticated call is enough to prove the refusal.
    const response = await harness.request("/api/v1/workspaces", {
      method: "POST",
      headers: {
        origin: "https://proofstack-01z.pages.dev.attacker.com",
        "sec-fetch-site": "same-site",
      },
      body: JSON.stringify({ name: "Evil workspace" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("cross_origin_denied");
    expect(body.error.message).toContain("proofstack-01z.pages.dev.attacker.com");
    // And the allowlisted origin reaches the handler instead of the guard.
    const allowed = await harness.request("/api/v1/workspaces", {
      method: "POST",
      headers: {
        origin: "https://proofstack-01z.pages.dev",
        "sec-fetch-site": "same-site",
      },
      body: JSON.stringify({ name: "Allowed workspace" }),
    });
    expect(allowed.status).not.toBe(403);
    // A refused origin never gets a CORS grant.
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await harness.close();
  });

  it("answers the preflight for a preview hostname", async () => {
    const harness = await bootstrap();
    const response = await harness.request("/api/v1/workspaces/ws_1/members", {
      method: "OPTIONS",
      headers: {
        origin: "https://abc123.proofstack-01z.pages.dev",
        "access-control-request-method": "POST",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://abc123.proofstack-01z.pages.dev"
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    await harness.close();
  });
});
