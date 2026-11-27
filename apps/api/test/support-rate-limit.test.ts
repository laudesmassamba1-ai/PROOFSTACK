import { describe, expect, it } from "vitest";
import { bootstrap } from "./harness.js";

/**
 * The support form is unauthenticated and costs an operator a real read. Its limit used
 * to live in one isolate; it now shares the durable counter with the other auth-adjacent
 * throttles.
 */

const body = JSON.stringify({
  email: "reader@example.test",
  subject: "Une question",
  body: "Bonjour, ceci est un message de test suffisamment long.",
});

describe("durable support throttle", () => {
  it("refuses the sixth message from one address but not from another", async () => {
    const h = await bootstrap();
    const send = (address: string) =>
      h.request("/api/account/support", {
        method: "POST",
        headers: { "cf-connecting-ip": address },
        body,
      });

    for (let index = 0; index < 5; index += 1) {
      const response = await send("203.0.113.20");
      expect(response.status).toBe(200);
    }
    const limited = await send("203.0.113.20");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const error = (await limited.json()) as { error: { code: string } };
    expect(error.error.code).toBe("too_many_attempts");

    const other = await send("203.0.113.21");
    expect(other.status).toBe(200);
  });
});
