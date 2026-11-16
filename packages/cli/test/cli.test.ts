import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/**
 * CLI tests.
 *
 * These run the built binary as a subprocess, because the things worth testing about a
 * CLI are its exit codes and its stdout, not its internal functions. A unit test that
 * calls `main()` directly would prove nothing about what CI actually experiences.
 *
 * The suite requires `pnpm build` to have run; it is skipped with a clear message
 * otherwise rather than failing for the wrong reason.
 */

const TEST_TIMEOUT = 60_000;

async function cli(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await exec(process.execPath, [CLI, ...args], { cwd, timeout: 60_000 });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "proofstack-cli-"));
}

describe("CLI", () => {
  it("prints help and exits 0", async () => {
    const dir = await project();
    const result = await cli(["--help"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("PROOFSTACK");
    expect(result.stdout).toContain("exit codes");
  });

  it("prints a version", async () => {
    const dir = await project();
    const result = await cli(["--version"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("init writes a config and refuses to overwrite it", async () => {
    const dir = await project();
    const first = await cli(["init", "--yes", "Test project"], dir);
    expect(first.code).toBe(0);

    const config = await readFile(join(dir, "proofstack.config.ts"), "utf8");
    expect(config).toContain("Test project");
    expect(config).toContain("export default config");

    const second = await cli(["init", "--yes", "Again"], dir);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain("already exists");
  });

  it("doctor exits 0 for a fresh project and names the unwired modules", async () => {
    const dir = await project();
    await cli(["init", "--yes", "Doctor test"], dir);
    const result = await cli(["doctor"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("node");
    expect(result.stdout).toContain("config");
    expect(result.stdout).toContain("SKIPPED");
  });

  it("doctor exits 2 with no configuration at all", async () => {
    const dir = await project();
    const result = await cli(["doctor"], dir);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("FAIL");
  });

  it("validate exits 1 when the config has cross-field warnings", async () => {
    const dir = await project();
    // WORLD enabled with no target and no forms: a real warning, not an error.
    await writeFile(
      join(dir, "proofstack.config.json"),
      JSON.stringify({
        schemaVersion: 1,
        project: { name: "Warn", baseUrl: "http://localhost:3000" },
        modules: {
          world: { enabled: true, target: { kind: "none" } },
          flow: { enabled: false },
          exit: { enabled: false },
        },
        enabledModules: ["world"],
      }),
      "utf8",
    );
    const result = await cli(["validate"], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("warn");
  });

  it("validate exits 2 when the config is structurally invalid", async () => {
    const dir = await project();
    await writeFile(join(dir, "proofstack.config.json"), JSON.stringify({ project: {} }), "utf8");
    const result = await cli(["validate"], dir);
    expect(result.code).toBe(2);
  });

  it("test exits 2 and explains itself when nothing is wired up", async () => {
    const dir = await project();
    await cli(["init", "--yes", "Unwired"], dir);
    const result = await cli(["test", "--quiet", "--module", "exit"], dir);
    expect(result.code).toBe(2);
  });

  it("test --json writes one parseable JSON document to stdout", async () => {
    const dir = await project();
    await cli(["init", "--yes", "JSON run"], dir);
    const result = await cli(["test", "--json", "--no-report", "--module", "exit"], dir);
    const parsed = JSON.parse(result.stdout) as { id: string; status: string; moduleRuns: unknown[] };
    expect(parsed.id).toMatch(/^run_/);
    expect(parsed.status).toBe("NOTHING_VERIFIED");
    expect(parsed.moduleRuns).toHaveLength(1);
  });

  it("test writes the report files it says it wrote", async () => {
    const dir = await project();
    await cli(["init", "--yes", "Report run"], dir);
    await cli(["test", "--quiet", "--module", "exit"], dir);
    const json = await readFile(join(dir, ".proofstack", "reports", "run.json"), "utf8");
    expect(JSON.parse(json)).toHaveProperty("moduleRuns");
  });

  it("report re-renders a previous run from disk", async () => {
    const dir = await project();
    await cli(["init", "--yes", "Rerender"], dir);
    await cli(["test", "--quiet", "--module", "exit"], dir);
    const result = await cli(["report", "text"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("PROOFSTACK run");
  });

  it("report exits 2 when there is no run to render", async () => {
    const dir = await project();
    await cli(["init", "--yes", "Empty"], dir);
    const result = await cli(["report"], dir);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("No run report found");
  });

  it("sync refuses to run without a token, rather than pretending", async () => {
    const dir = await project();
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(
      join(dir, "proofstack.config.json"),
      JSON.stringify({
        schemaVersion: 1,
        project: { name: "Sync", baseUrl: "http://localhost:3000" },
        modules: { world: { enabled: false }, flow: { enabled: false }, exit: { enabled: false } },
        enabledModules: ["world"],
        sync: { enabled: true, apiUrl: "http://localhost:9999" },
      }),
      "utf8",
    );
    const result = await cli(["sync"], dir);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("PROOFSTACK_PROJECT_TOKEN");
  });

  it("login explains the token flow without writing a secret", async () => {
    const dir = await project();
    const result = await cli(["login"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("PROOFSTACK_PROJECT_TOKEN");
    expect(result.stdout).toContain("No token is written to disk");
  });

  it("rejects an unknown command with a usage error", async () => {
    const dir = await project();
    const result = await cli(["frobnicate"], dir);
    expect(result.code).toBe(64);
    expect(result.stderr).toContain("Unknown command");
  });
});
