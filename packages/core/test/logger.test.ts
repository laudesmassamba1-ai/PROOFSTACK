import { describe, expect, it } from "vitest";
import { MemorySink, Logger, maskValue, redactKey } from "@proofstack/core";

describe("structured logging with redaction", () => {
  it("recognises sensitive field names in any casing or nesting", () => {
    for (const key of ["apiKey", "api_key", "SIGNING_SECRET", "authorization", "client-secret", "otp", "cvv", "msisdn", "email"]) {
      expect(redactKey(key)).toBe(true);
    }
    for (const key of ["runId", "durationMs", "profile", "status"]) {
      expect(redactKey(key)).toBe(false);
    }
  });

  it("never writes a payment secret or token into a log line", () => {
    const sink = new MemorySink();
    const log = new Logger({ level: "debug", sinks: [sink] });
    log.info("checkout created", {
      apiKey: "sk_test_abcdefghijklmnop",
      headers: { Authorization: "Bearer sk_live_0123456789abcdef" },
      webhook: { signing_secret: "whsec_deadbeefcafebabe" },
      customer: { email: "awa@example.com", phone: "+22997505050" },
      plan: "developer",
    });
    const line = JSON.stringify(sink.records[0]!.fields);
    expect(line).not.toContain("sk_test_abcdefghijklmnop");
    expect(line).not.toContain("sk_live_0123456789abcdef");
    expect(line).not.toContain("whsec_deadbeefcafebabe");
    expect(line).not.toContain("awa@example.com");
    expect(line).toContain("[redacted]");
    expect(line).toContain("developer");
  });

  it("masks opaque secrets that appear inside free-text messages", () => {
    const masked = maskValue("failed with key sk_test_supersecretvalue123");
    expect(masked).not.toContain("supersecretvalue123");
    expect(masked).toContain("sk_test_");
    expect(maskValue("nothing sensitive here")).toBe("nothing sensitive here");
  });

  it("truncates oversized strings and caps nesting instead of dumping a dataset", () => {
    const sink = new MemorySink();
    const log = new Logger({ sinks: [sink] });
    log.info("big", { payload: "x".repeat(5000), deep: { a: { b: { c: { d: { e: "too deep" } } } } } });
    const fields = sink.records[0]!.fields as Record<string, unknown>;
    expect(String(fields.payload).length).toBeLessThan(700);
    expect(fields.deep).toBeDefined();
    expect(JSON.stringify(fields)).not.toContain("too deep");
  });

  it("filters by level and keeps a bounded ring buffer", () => {
    const sink = new MemorySink(3);
    const log = new Logger({ level: "warn", sinks: [sink] });
    log.debug("nope");
    log.info("nope");
    for (let i = 0; i < 10; i++) log.warn(`w${i}`);
    expect(sink.records.length).toBe(3);
    expect(sink.records.map((r) => r.message)).toEqual(["w7", "w8", "w9"]);
  });

  it("child loggers inherit sinks and add fields without mutating the parent", () => {
    const sink = new MemorySink();
    const log = new Logger({ sinks: [sink] });
    log.child({ runId: "run_1" }).info("started");
    log.info("global");
    expect((sink.records[0]!.fields as Record<string, unknown>).runId).toBe("run_1");
    expect((sink.records[1]!.fields as Record<string, unknown>).runId).toBeUndefined();
  });
});
