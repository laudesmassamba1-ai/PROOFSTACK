import {
  type ModuleId,
  type ProofstackConfig,
  proofstackConfigSchema,
} from "@proofstack/contracts";
import { FixedClock, Logger, MemorySink } from "@proofstack/core";
import {
  ENGINE_VERSION,
  MemoryEvidenceStore,
  type ModuleProvider,
  runEngine,
  type TestContext,
} from "@proofstack/engine";
import { describe, expect, it } from "vitest";

function baseConfig(overrides: Record<string, unknown> = {}): ProofstackConfig {
  return proofstackConfigSchema.parse({
    project: { name: "Demo SaaS", baseUrl: "http://localhost:3000" },
    ...overrides,
  });
}

function provider(
  id: ModuleId,
  cases: Array<{
    id: string;
    run: (ctx: TestContext) => void | Promise<void>;
    severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  }>
): ModuleProvider {
  return {
    id,
    version: "test",
    label: id.toUpperCase(),
    suites: () => [
      {
        id: `${id}-suite`,
        name: `${id} suite`,
        module: id,
        cases: cases.map((c) => ({
          id: c.id,
          name: c.id,
          description: `case ${c.id}`,
          module: id,
          severity: c.severity ?? "MEDIUM",
          suiteId: `${id}-suite`,
          execute: c.run,
        })),
      },
    ],
  };
}

describe("shared execution engine", () => {
  it("passes when every case passes and validates the run against the contract", async () => {
    const { run } = await runEngine({
      config: baseConfig(),
      providers: [
        provider("world", [{ id: "w1", run: (ctx) => ctx.check(true, { description: "ok" }) }]),
      ],
      clock: new FixedClock("2026-01-15T12:00:00.000Z"),
    });
    expect(run.status).toBe("COMPLETED");
    expect(run.engineVersion).toBe(ENGINE_VERSION);
    expect(run.moduleRuns[0]!.totals).toEqual({
      total: 1,
      passed: 1,
      failed: 0,
      warnings: 0,
      skipped: 0,
      errors: 0,
    });
    expect(run.findings).toEqual([]);
  });

  it("turns a failed assertion into a FAILED case plus one fingerprinted finding", async () => {
    const { run } = await runEngine({
      config: baseConfig(),
      providers: [
        provider("world", [
          {
            id: "w1",
            run: (ctx) =>
              ctx.check(false, {
                description: "accepts accented name",
                expected: "accepted",
                actual: "rejected",
                target: "last_name",
              }),
          },
        ]),
      ],
    });
    expect(run.status).toBe("FAILED");
    const result = run.moduleRuns[0]!.cases[0]!;
    expect(result.status).toBe("FAILED");
    expect(result.failure?.category).toBe("ASSERTION");
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0]!.fingerprint).toMatch(/^ps1:[0-9a-f]{64}$/);
    expect(run.findings[0]!.reproduction.command).toBe("proofstack test --module world --only w1");
    expect(result.findingIds).toEqual([run.findings[0]!.id]);
  });

  it("reports an exception as ERROR, never as a product failure", async () => {
    const { run } = await runEngine({
      config: baseConfig(),
      providers: [
        provider("flow", [
          {
            id: "f1",
            run: () => {
              throw new Error("browser crashed");
            },
          },
        ]),
      ],
    });
    expect(run.moduleRuns[0]!.cases[0]!.status).toBe("ERROR");
    expect(run.status).toBe("ERROR");
    expect(run.findings[0]!.detail).toContain("browser crashed");
  });

  it("enforces the per-case timeout and marks the case ERROR/TIMEOUT", async () => {
    const { run } = await runEngine({
      config: baseConfig({ engine: { timeoutMs: 25 } }),
      providers: [provider("exit", [{ id: "e1", run: async (ctx) => ctx.sleep(5_000) }])],
    });
    const caseResult = run.moduleRuns[0]!.cases[0]!;
    expect(caseResult.status).toBe("ERROR");
    expect(caseResult.failure?.code).toBe("case_timeout");
  });

  it("honours a per-case timeout override", async () => {
    const { run } = await runEngine({
      config: baseConfig({ engine: { timeoutMs: 60_000 } }),
      providers: [
        {
          id: "exit",
          version: "test",
          label: "EXIT",
          suites: () => [
            {
              id: "s",
              name: "s",
              module: "exit",
              cases: [
                {
                  id: "slow",
                  name: "slow",
                  description: "d",
                  module: "exit",
                  severity: "LOW",
                  suiteId: "s",
                  timeoutMs: 20,
                  execute: async (ctx) => ctx.sleep(500),
                },
              ],
            },
          ],
        },
      ],
    });
    expect(run.moduleRuns[0]!.cases[0]!.failure?.code).toBe("case_timeout");
  });

  it("retries transient harness errors, never a real failure or an internal bug", async () => {
    let networkAttempts = 0;
    let internalAttempts = 0;
    const { run } = await runEngine({
      config: baseConfig({ engine: { retries: 2 } }),
      providers: [
        provider("world", [
          {
            id: "transient",
            run: (ctx) => {
              networkAttempts += 1;
              if (networkAttempts < 3) throw new Error("fetch failed: ECONNREFUSED 127.0.0.1:3000");
              ctx.check(true, { description: "finally ran" });
            },
          },
          {
            id: "broken",
            run: (ctx) => ctx.check(false, { description: "always fails", expected: 1, actual: 2 }),
          },
          {
            id: "bug",
            run: () => {
              internalAttempts += 1;
              throw new TypeError("cannot read property of undefined");
            },
          },
        ]),
      ],
    });
    const cases = run.moduleRuns[0]!.cases;
    expect(cases.find((c) => c.id === "transient")!.attempts).toBe(3);
    expect(networkAttempts).toBe(3);
    expect(cases.find((c) => c.id === "transient")!.status).toBe("PASSED");
    // A product failure is attempted exactly once: retrying a defect does not hide it.
    expect(cases.find((c) => c.id === "broken")!.attempts).toBe(1);
    // An engine bug is not retried either; it must surface, not loop.
    expect(cases.find((c) => c.id === "bug")!.attempts).toBe(1);
    expect(internalAttempts).toBe(1);
    expect(cases.find((c) => c.id === "bug")!.failure?.category).toBe("INTERNAL");
  });

  it("produces the same ordering and identical output under parallel scheduling", async () => {
    const build = () =>
      provider(
        "world",
        Array.from({ length: 24 }, (_unused, i) => ({
          id: `c${String(i).padStart(2, "0")}`,
          run: async (ctx: TestContext) => {
            await new Promise((r) => setTimeout(r, ((i) => i % 5)(i)));
            ctx.check(true, { description: "ok" });
          },
        }))
      );
    const a = await runEngine({
      config: baseConfig({ engine: { ...baseConfig().engine, parallel: 8 } }),
      providers: [build()],
      clock: new FixedClock(0),
    });
    const b = await runEngine({
      config: baseConfig({ engine: { ...baseConfig().engine, parallel: 2 } }),
      providers: [build()],
      clock: new FixedClock(0),
    });
    expect(a.run.moduleRuns[0]!.cases.map((c) => c.id)).toEqual(
      Array.from({ length: 24 }, (_unused, i) => `c${String(i).padStart(2, "0")}`)
    );
    expect(JSON.stringify(b.run.moduleRuns[0]!.cases.map((c) => [c.id, c.status]))).toBe(
      JSON.stringify(a.run.moduleRuns[0]!.cases.map((c) => [c.id, c.status]))
    );
  });

  it("cancels: in-flight work stops and un-run cases are SKIPPED with a reason", async () => {
    const controller = new AbortController();
    const { run, cancelled } = await runEngine({
      config: baseConfig({ engine: { parallel: 1 } }),
      signal: controller.signal,
      providers: [
        provider("world", [
          {
            id: "a",
            run: async (ctx) => {
              controller.abort("user requested");
              ctx.check(true, { description: "x" });
            },
          },
          { id: "b", run: () => undefined },
          { id: "c", run: () => undefined },
        ]),
      ],
    });
    expect(cancelled).toBe(true);
    expect(run.status).toBe("CANCELLED");
    const statuses = run.moduleRuns[0]!.cases.map((c) => c.status);
    expect(statuses).toContain("SKIPPED");
    const skipped = run.moduleRuns[0]!.cases.find((c) => c.status === "SKIPPED")!;
    expect(skipped.skippedReason).toContain("cancelled");
  });

  it("stopOnCritical halts scheduling instead of burning the remaining quota", async () => {
    const { run } = await runEngine({
      config: baseConfig({ engine: { parallel: 1, stopOnCritical: true } }),
      providers: [
        provider("flow", [
          {
            id: "critical",
            severity: "CRITICAL",
            run: (ctx) => ctx.check(false, { description: "double charge" }),
          },
          { id: "later", run: () => undefined },
        ]),
      ],
    });
    expect(run.status).toBe("PARTIAL");
    expect(run.moduleRuns[0]!.cases.find((c) => c.id === "later")!.status).toBe("SKIPPED");
    expect(run.findings[0]!.severity).toBe("CRITICAL");
  });

  it("records warnings as WARNING status and keeps the finding", async () => {
    const { run } = await runEngine({
      config: baseConfig(),
      providers: [
        provider("world", [
          {
            id: "w1",
            run: (ctx) => {
              ctx.report({
                title: "silent truncation",
                detail: "name was truncated at 32 chars",
                severity: "LOW",
                field: "full_name",
              });
              ctx.check(true, { description: "submitted" });
            },
          },
        ]),
      ],
    });
    expect(run.moduleRuns[0]!.cases[0]!.status).toBe("WARNING");
    expect(run.status).toBe("PARTIAL");
    expect(run.findings[0]!.status).toBe("WARNING");
    expect(run.findings[0]!.field).toBe("full_name");
  });

  it("skips explicitly, with the reason surfaced", async () => {
    const { run } = await runEngine({
      config: baseConfig(),
      providers: [
        {
          id: "flow",
          version: "test",
          label: "FLOW",
          suites: () => [
            {
              id: "s",
              name: "s",
              module: "flow",
              cases: [
                {
                  id: "needs-browser",
                  name: "needs-browser",
                  description: "d",
                  module: "flow",
                  severity: "LOW",
                  suiteId: "s",
                  skip: "Playwright is not installed in this environment",
                  execute: () => undefined,
                },
              ],
            },
          ],
        },
      ],
    });
    const c = run.moduleRuns[0]!.cases[0]!;
    expect(c.status).toBe("SKIPPED");
    expect(c.skippedReason).toContain("Playwright");
  });

  it("gives every case a deterministic rng derived from the seed and case id", async () => {
    const seen: number[] = [];
    const collect = async () => {
      const { run } = await runEngine({
        config: baseConfig({ engine: { seed: 1234 } }),
        providers: [
          provider("world", [
            {
              id: "w1",
              run: (ctx) => {
                seen.push(ctx.rng.next());
                ctx.check(true, { description: "x" });
              },
            },
          ]),
        ],
      });
      return run;
    };
    await collect();
    await collect();
    expect(seen.length).toBe(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it("attaches evidence through the store and keeps digests", async () => {
    const store = new MemoryEvidenceStore();
    const { run } = await runEngine({
      config: baseConfig(),
      evidenceStore: store,
      providers: [
        provider("world", [
          {
            id: "w1",
            run: async (ctx) => {
              await ctx.attachText({
                label: "response body",
                text: '{"name":"Kòfí"}',
                kind: "payload",
                mediaType: "application/json",
              });
              ctx.check(false, { description: "name preserved" });
            },
          },
        ]),
      ],
    });
    const c = run.moduleRuns[0]!.cases[0]!;
    expect(c.evidence).toHaveLength(1);
    expect(c.evidence[0]!.ref?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(run.findings[0]!.evidenceIds).toEqual([c.evidence[0]!.id]);
    expect(store.blobs.size).toBe(1);
  });

  it("refuses to run with no provider and never invents an empty pass", async () => {
    await expect(runEngine({ config: baseConfig(), providers: [] })).rejects.toThrowError(
      /no module provider/
    );
    // A suite that produced no checks is an ERROR, never a vacuous pass.
    const empty = await runEngine({ config: baseConfig(), providers: [provider("world", [])] });
    expect(empty.run.status).toBe("ERROR");
    expect(empty.run.moduleRuns[0]!.status).toBe("ERROR");
  });

  it("keeps module scoping: only the requested providers run", async () => {
    const { run } = await runEngine({
      config: baseConfig(),
      only: ["exit"],
      providers: [
        provider("world", [{ id: "w1", run: () => undefined }]),
        provider("exit", [{ id: "e1", run: () => undefined }]),
      ],
    });
    expect(run.modules).toEqual(["exit"]);
    expect(run.moduleRuns).toHaveLength(1);
  });

  it("writes engine decisions to the log without leaking secrets", async () => {
    const sink = new MemorySink();
    await runEngine({
      config: baseConfig(),
      logger: new Logger({ level: "debug", sinks: [sink] }),
      providers: [
        provider("world", [
          {
            id: "w1",
            run: (ctx) => {
              ctx.log.info("ran", { apiKey: "sk_test_abcdefghijklmnop" });
            },
          },
        ]),
      ],
    });
    expect(JSON.stringify(sink.records)).not.toContain("sk_test_abcdefghijklmnop");
  });
});
