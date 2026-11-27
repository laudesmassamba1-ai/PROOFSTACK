import { afterEach, describe, expect, it } from "vitest";
import { bootstrap } from "./harness.js";

/**
 * The sign-up throttle used to be a Map inside one isolate. A burst spread across fresh
 * isolates, or simply a cold start, reset it. The counter now lives in `rate_limits`, so
 * the budget survives the process that spent it.
 */

const body = (email: string) =>
  JSON.stringify({
    email,
    password: "correct horse battery",
    name: "Ada Lovelace",
    workspace: "Throttle",
  });

const saved = {
  limit: process.env.SIGNUP_RATE_LIMIT,
  window: process.env.SIGNUP_RATE_WINDOW_MS,
};

function setLimit(limit: number): void {
  process.env.SIGNUP_RATE_LIMIT = String(limit);
  process.env.SIGNUP_RATE_WINDOW_MS = "60000";
}

afterEach(() => {
  if (saved.limit === undefined) delete process.env.SIGNUP_RATE_LIMIT;
  else process.env.SIGNUP_RATE_LIMIT = saved.limit;
  if (saved.window === undefined) delete process.env.SIGNUP_RATE_WINDOW_MS;
  else process.env.SIGNUP_RATE_WINDOW_MS = saved.window;
});

describe("durable sign-up throttle", () => {
  it("refuses the third account from one address within the window", async () => {
    setLimit(2);
    const h = await bootstrap({ NODE_ENV: "production" });
    const headers = { "cf-connecting-ip": "203.0.113.9" };
    for (const email of ["one@example.test", "two@example.test"]) {
      const response = await h.request("/api/auth/sign-up/email", {
        method: "POST",
        headers,
        body: body(email),
      });
      expect(response.status).toBe(201);
    }

    const limited = await h.request("/api/auth/sign-up/email", {
      method: "POST",
      headers,
      body: body("three@example.test"),
    });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const error = (await limited.json()) as { error: { code: string } };
    expect(error.error.code).toBe("too_many_signups");
  });

  it("keeps a separate budget per address", async () => {
    setLimit(1);
    const h = await bootstrap({ NODE_ENV: "production" });
    for (const address of ["203.0.113.1", "203.0.113.2"]) {
      const response = await h.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "cf-connecting-ip": address },
        body: body(`first.${address.replaceAll(".", "-")}@example.test`),
      });
      expect(response.status).toBe(201);
    }
    const limited = await h.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.1" },
      body: body("second@example.test"),
    });
    expect(limited.status).toBe(429);
  });

  it("is off under test, where one suite creates many accounts", async () => {
    const h = await bootstrap();
    for (const email of ["a@example.test", "b@example.test", "c@example.test"]) {
      const response = await h.request("/api/auth/sign-up/email", {
        method: "POST",
        body: body(email),
      });
      expect(response.status).toBe(201);
    }
  });
});
