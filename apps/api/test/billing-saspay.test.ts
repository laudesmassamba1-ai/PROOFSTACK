import { SasPayProvider } from "@proofcore/adapter-payments";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";

/**
 * SasPay test checkout.
 *
 * The billing page used to send the first catalogue price (USD) even though SasPay only
 * declares XOF/XAF. The API refused with `no_chargeable_currency`, so choosing a plan in
 * test mode never reached the provider. This pins the working path: the frontend picks a
 * provider-supported currency, and the adapter receives that amount as a decimal string.
 */

const WEB_ORIGIN = "http://localhost:5173";

interface Call {
  path: string;
  body: Record<string, unknown>;
  authorization: string;
}

async function deployment() {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());

  const calls: Call[] = [];
  const provider = new SasPayProvider({
    apiKey: "sk_test_0123456789abcdef",
    webhookSecret: "whsec_test_secret_value",
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        path: new URL(String(input)).pathname,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        authorization: headers.get("authorization") ?? "",
      });
      return new Response(
        JSON.stringify({
          id: "cs_test_checkout",
          status: "PENDING",
          checkout_url: "https://pay.saspay.me/checkout/cs_test_checkout",
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch,
  });

  const { app } = createApp({ db, env: { NODE_ENV: "test", WEB_ORIGIN }, provider });

  const request = (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    headers.set("origin", WEB_ORIGIN);
    if (init.cookie) headers.set("cookie", init.cookie);
    return app.request(`http://localhost${path}`, { ...init, headers });
  };

  const signUp = async () => {
    const response = await request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        email: "saspay@example.com",
        password: "correct horse battery",
        name: "Ada Lovelace",
        workspace: "Acme",
      }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { workspace: { id: string } };
    return {
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
      workspaceId: body.workspace.id,
    };
  };

  return { request, signUp, calls, close: async () => db.close() };
}

describe("SasPay test checkout", () => {
  let harness: Awaited<ReturnType<typeof deployment>>;
  afterEach(async () => {
    await harness.close();
  });

  it("charges the XOF catalogue price and returns the hosted checkout URL", async () => {
    harness = await deployment();
    const { cookie, workspaceId } = await harness.signUp();

    const summary = await harness.request(`/api/v1/billing?workspaceId=${workspaceId}`, {
      cookie,
    });
    expect(summary.status).toBe(200);
    const billing = (await summary.json()) as {
      provider: { slug: string; currencies: string[] };
    };
    expect(billing.provider.slug).toBe("saspay");
    expect(billing.provider.currencies).toContain("XOF");

    const response = await harness.request("/api/v1/checkout/start", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        planKey: "developer",
        period: "monthly",
        currency: "XOF",
      }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      redirectUrl?: string;
      intent: { amount: { currency: string; minor: string } };
    };
    expect(body.redirectUrl).toBe("https://pay.saspay.me/checkout/cs_test_checkout");
    expect(body.intent.amount).toEqual({ currency: "XOF", minor: "9000" });

    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]?.path).toBe("/api/v1/checkout-sessions/");
    expect(harness.calls[0]?.authorization).toBe("Bearer sk_test_0123456789abcdef");
    expect(harness.calls[0]?.body).toMatchObject({
      amount: "9000.00",
      currency: "XOF",
    });
  });
});
