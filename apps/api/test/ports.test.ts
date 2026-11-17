import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Monolith port contract.
 *
 * The dev stack runs as one process tree with fixed ports: the API on :8787 and
 * the web app on :5173, which proxies /api and /v1 to the API. These tests assert
 * the contract statically so a change to one side cannot silently orphan the
 * other (the classic failure: the Worker and the web proxy disagree on the port,
 * and every local session breaks).
 */

const root = resolve(import.meta.dirname, "../../..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("dev-stack port contract", () => {
  it("the API listens on 8787 unless PORT overrides it", () => {
    expect(read("apps/api/src/node.ts")).toContain("process.env.PORT ?? 8787");
  });

  it("the web dev server listens on 5173 unless DEV_PORT overrides it", () => {
    const config = read("apps/web/vite.config.ts");
    expect(config).toContain("DEV_PORT");
    expect(config).toContain("5173");
  });

  it("the web dev proxy forwards /api and /v1 to the API port", () => {
    const config = read("apps/web/vite.config.ts");
    expect(config).toContain("8787");
    expect(config).toContain("/api");
    expect(config).toContain("/v1");
  });

  it("the dev-stack script starts both sides on the same ports", () => {
    const script = read("tooling/scripts/dev-stack.mjs");
    expect(script).toContain('process.env.PORT ?? "8787"');
    expect(script).toContain('process.env.DEV_PORT ?? "5173"');
    expect(script).toContain("src/node.ts");
  });

  it("the web production proxy (Vercel rewrites) targets the deployed Worker, not localhost", () => {
    const vercel = read("vercel.json");
    expect(vercel).toContain("https://proofcore-api.laudesmassamba1.workers.dev");
    expect(vercel).not.toContain("localhost:8787");
  });
});
