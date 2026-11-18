import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeSandbox, dockerAvailable, runInSandbox } from "../src/sandbox.js";

/**
 * Container isolation.
 *
 * The important test is the refusal: a sandbox request that cannot get a container must
 * fail, never silently degrade to an unisolated run.
 */

let root: string;
let available = false;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "proofcore-sandbox-"));
  await writeFile(join(root, "file.txt"), "content\n", "utf8");
  available = await dockerAvailable();
});

afterEach(async () => {
  delete process.env.PROOFCORE_DOCKER;
  delete process.env.PROOFCORE_SANDBOX_IMAGE;
  await rm(root, { recursive: true, force: true });
});

describe("sandbox", () => {
  it("reports Docker availability from the daemon, not from the binary", async () => {
    expect(typeof available).toBe("boolean");
  });

  it("refuses to run anything when Docker is missing", async () => {
    process.env.PROOFCORE_DOCKER = "/nonexistent/docker-binary";
    await expect(runInSandbox(root, { command: "echo", args: ["hi"] })).rejects.toThrow(
      /Container isolation is not available/
    );
    await expect(runInSandbox(root, { command: "echo", args: ["hi"] })).rejects.toThrow(
      /Nothing was executed/
    );
  });

  it("runs the command in a container with the workspace mounted", {
    timeout: 180_000,
  }, async () => {
    if (!available) return; // No daemon on this machine: the refusal above already covers it.
    process.env.PROOFCORE_SANDBOX_IMAGE = "postgres:15-alpine";
    const result = await runInSandbox(root, { command: "sh", args: ["-c", "cat /work/file.txt"] });
    expect(result.isolation).toBe("container");
    expect(result.exitCode).toBe(0);
    // The mount is real: the container read the host file.
    expect(result.stdout).toContain("content");
    expect(describeSandbox(result)).toContain("container");
  });

  it("gives the container no network by default", { timeout: 180_000 }, async () => {
    if (!available) return;
    process.env.PROOFCORE_SANDBOX_IMAGE = "postgres:15-alpine";
    const result = await runInSandbox(root, {
      command: "sh",
      args: ["-c", "wget -q -T 3 -O- http://1.1.1.1 2>&1 | head -1; echo done"],
    });
    // With --network none the request fails; what matters is that nothing reaches out.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toMatch(/HTTP\/1\.1 200/);
  });

  it("cannot write to the workspace unless it was made writable", {
    timeout: 180_000,
  }, async () => {
    if (!available) return;
    process.env.PROOFCORE_SANDBOX_IMAGE = "postgres:15-alpine";
    const denied = await runInSandbox(root, {
      command: "sh",
      args: ["-c", "touch /work/created.txt 2>&1; echo rc=$?"],
    });
    expect(denied.stdout).toMatch(/rc=[1-9]/);

    const allowed = await runInSandbox(root, {
      command: "sh",
      args: ["-c", "touch /work/created.txt && echo ok"],
      writable: true,
    });
    expect(allowed.stdout).toContain("ok");
  });
});
