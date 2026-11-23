import { Money } from "@proofcore/core";
import { describe, expect, it } from "vitest";
import { SandboxProvider } from "../src/sandbox.js";

/**
 * Cloudflare Workers do not guarantee that two requests reach the same isolate, so the
 * sandbox provider cannot rely on a process-local Map between checkout and settlement.
 * Production proved this the hard way: checkout succeeded, then settle answered
 * `sandbox: unknown transaction` and the billing finalisation returned 500.
 */

const INPUT = {
  idempotencyKey: "ps_sandbox_cross_isolate",
  amount: Money.of("XOF", 9000n),
  description: "PROOFCORE Developer (monthly)",
  customer: { email: "ada@example.com", name: "Ada Lovelace" },
  metadata: { workspace_id: "ws_test", plan_key: "developer" },
  flow: "hosted" as const,
};

describe("SandboxProvider references", () => {
  it("settles in a second provider instance and verifies in a third", async () => {
    const created = await new SandboxProvider().createCheckout(INPUT);

    const settledReference = new SandboxProvider().settle(created.providerReference, "success");
    expect(settledReference).not.toBe(created.providerReference);

    const verified = await new SandboxProvider().verifyTransaction(settledReference);
    expect(verified.state).toBe("SUCCEEDED");
    expect(verified.providerStatus).toBe("SUCCESS");
    expect(verified.amount).toEqual(Money.of("XOF", 9000n));
    expect(verified.raw).toEqual({ sandbox: true, metadata: INPUT.metadata });
  });

  it("settles a legacy reference using the amount already stored on the intent", async () => {
    const settledReference = new SandboxProvider().settle(
      "sbx_legacy_in_memory_reference",
      "declined",
      { amount: Money.of("XOF", 9000n), metadata: { plan_key: "developer" } }
    );

    const verified = await new SandboxProvider().verifyTransaction(settledReference);
    expect(verified.state).toBe("FAILED");
    expect(verified.providerStatus).toBe("DECLINED");
    expect(verified.amount).toEqual(Money.of("XOF", 9000n));
  });

  it("still rejects an unknown reference when no fallback amount exists", () => {
    expect(() => new SandboxProvider().settle("sbx_not_a_transaction", "success")).toThrow(
      /unknown transaction/
    );
  });
});
