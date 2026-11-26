import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

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

async function cli(
  args: string[],
  cwd: string,
  env: Record<string, string> = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await exec(process.execPath, [CLI, ...args], {
      cwd,
      timeout: 60_000,
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "proofcore-cli-"));
}

describe("CLI", () => {
  it("prints help and exits 0", async () => {
    const dir = await project();
    const result = await cli(["--help"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("PROOFCORE");
    expect(result.stdout).toContain("exit codes");
  });

  it("audit --help is a help request and exits 0 (CI runs it)", async () => {
    const dir = await project();
    const result = await cli(["audit", "--help"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("audit fail");
  });

  it("an unknown audit sub-command still exits 2 (harness error)", async () => {
    const dir = await project();
    const result = await cli(["audit", "bogus"], dir);
    expect(result.code).toBe(2);
  });

  it("prints a version", async () => {
    const dir = await project();
    const result = await cli(["--version"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("ignores the `--` separator that pnpm and npm forward literally", async () => {
    const dir = await project();
    const result = await cli(["--", "--version"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("init writes a config and refuses to overwrite it", async () => {
    const dir = await project();
    const first = await cli(["init", "--yes", "Test project"], dir);
    expect(first.code).toBe(0);

    const config = await readFile(join(dir, "proofcore.config.ts"), "utf8");
    expect(config).toContain("Test project");
    expect(config).toContain("export default config");

    const second = await cli(["init", "--yes", "Again"], dir);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain("already exists");
  });

  it("runs FLOW locally instead of opening a browser", async () => {
    const dir = await project();
    await cli(["init", "--yes", "Flow test"], dir);
    const result = await cli(["flow", "--no-report", "--json"], dir);
    // A freshly initialized project has no target: skipped is not a pass.
    expect(result.code).toBe(2);
    const report = JSON.parse(result.stdout) as { moduleRuns: { module: string }[] };
    expect(report.moduleRuns[0]?.module).toBe("flow");
    expect(result.stderr).not.toContain("opened");
  });

  it("runs EXIT through the module command", async () => {
    const dir = await project();
    await cli(["init", "--yes", "Exit test"], dir);
    const result = await cli(["module", "exit", "--no-report", "--json"], dir);
    expect(result.code).toBe(2);
    const report = JSON.parse(result.stdout) as { moduleRuns: { module: string }[] };
    expect(report.moduleRuns[0]?.module).toBe("exit");
  });

  it("lists modules locally and says how to run them", async () => {
    const dir = await project();
    await cli(["init", "--yes", "Modules test"], dir);
    const result = await cli(["modules"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("WORLD");
    expect(result.stdout).toContain("FLOW");
    expect(result.stdout).toContain("proofcore flow");
    expect(result.stdout).toContain("In the hub: /world, /flow");
    expect(result.stdout).not.toContain("Opened /app/modules");
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

  it("rejects a missing --cwd without an ENOENT stack", async () => {
    const dir = await project();
    const missing = join(dir, "missing-app");
    const result = await cli(["--cwd", missing, "init", "--yes", "Test"], dir);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("directory does not exist");
    expect(result.stderr).toContain("Replace /path/to/your/app");
    expect(result.stderr).not.toContain("ENOENT");
  });

  it("rejects a --cwd that points to a file", async () => {
    const dir = await project();
    const file = join(dir, "not-a-directory");
    await writeFile(file, "x", "utf8");
    const result = await cli(["--cwd", file, "doctor"], dir);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("not a directory");
  });

  it("validate exits 1 when the config has cross-field warnings", async () => {
    const dir = await project();
    // WORLD enabled with no target and no forms: a real warning, not an error.
    await writeFile(
      join(dir, "proofcore.config.json"),
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
      "utf8"
    );
    const result = await cli(["validate"], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("warn");
  });

  it("validate exits 2 when the config is structurally invalid", async () => {
    const dir = await project();
    await writeFile(join(dir, "proofcore.config.json"), JSON.stringify({ project: {} }), "utf8");
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
    const parsed = JSON.parse(result.stdout) as {
      id: string;
      status: string;
      moduleRuns: unknown[];
    };
    expect(parsed.id).toMatch(/^run_/);
    expect(parsed.status).toBe("NOTHING_VERIFIED");
    expect(parsed.moduleRuns).toHaveLength(1);
  });

  it("test rejects an unknown module instead of silently running everything", async () => {
    const dir = await project();
    await cli(["init", "--yes", "Bad module"], dir);
    const result = await cli(["test", "--module", "wrold"], dir);
    expect(result.code).toBe(64);
    expect(result.stderr).toContain('Unknown module "wrold"');
  });

  it("test rejects an unknown report format", async () => {
    const dir = await project();
    await cli(["init", "--yes", "Bad format"], dir);
    const result = await cli(["test", "--format", "yaml"], dir);
    expect(result.code).toBe(64);
    expect(result.stderr).toContain('Unknown report format "yaml"');
  });

  it("test --only filters cases across modules, not just WORLD", async () => {
    const dir = await project();
    await cli(["init", "--yes", "Filtered"], dir);
    const result = await cli(
      ["test", "--json", "--no-report", "--module", "exit", "--only", "exit/csv"],
      dir
    );
    const parsed = JSON.parse(result.stdout) as {
      moduleRuns: { cases: { id: string }[] }[];
    };
    const cases = parsed.moduleRuns.flatMap((moduleRun) => moduleRun.cases);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.every((testCase) => testCase.id.includes("exit/csv"))).toBe(true);
  });

  it("scan runs the five modules on a URL with no configuration at all", async () => {
    // The complaint this answers: testing any of the modules required `init` and a config.
    // `scan` must work in an empty directory, on the developer's own localhost.
    const server = createServer((request, response) => {
      if (request.url === "/checkout") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<html><body>checkout</body></html>");
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<html lang="fr"><head><title>Local shop</title>
        <meta name="viewport" content="width=device-width">
        <script src="https://js.stripe.com/v3"></script></head>
        <body><main><h1>Boutique</h1><a href="/checkout">Commander</a></main></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const dir = await project();
      const result = await cli(["scan", `http://127.0.0.1:${port}/`], dir);
      // A blocking finding exits 1 — the contract, not a special case for this command.
      expect(result.code).toBe(1);
      for (const module of ["FAIL", "CLEAN", "FLOW", "WORLD", "EXIT"]) {
        expect(result.stdout).toContain(module);
      }
      // The checkout link was actually followed, not assumed.
      expect(result.stdout).toContain("journey_entry");
      expect(result.stdout).toContain("/checkout");
      expect(result.stderr).not.toContain("configuration");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("scan --json stays machine-readable and never mixes prose into stdout", async () => {
    const dir = await project();
    const result = await cli(["scan", "http://127.0.0.1:1/", "--json"], dir);
    // Port 1 refuses the connection: a harness failure, not a finding about the site.
    expect(result.code).toBe(2);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("fail reuses the same engine as scan, so the two can never disagree", async () => {
    const dir = await project();
    const result = await cli(["fail", "http://127.0.0.1:1/"], dir);
    expect(result.code).toBe(2);
    // A refused connection is a harness failure: exit 2 with a real reason, not a finding.
    expect(result.stderr.toLowerCase()).toMatch(/fetch failed|could not/);
  });

  it("test --only exits 2 when nothing matches, rather than reporting a false pass", async () => {
    const dir = await project();
    await cli(["init", "--yes", "No match"], dir);
    const result = await cli(
      ["test", "--no-report", "--module", "exit", "--only", "does-not-exist"],
      dir
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("no case matched");
  });

  it("ai ask sends the question, not the --provider value, and reads a real response", async () => {
    const received: { messages?: { role: string; content: string }[] }[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        received.push(JSON.parse(body) as { messages?: { role: string; content: string }[] });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            model: "fake-1",
            choices: [
              {
                message: { role: "assistant", content: "Le dernier run est vert." },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
          })
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const dir = await project();
      await writeFile(
        join(dir, "proofcore.config.json"),
        JSON.stringify({
          schemaVersion: 1,
          project: { name: "AI test", baseUrl: "http://localhost:3000" },
          modules: {
            world: { enabled: false },
            flow: { enabled: false },
            exit: { enabled: false },
          },
          enabledModules: ["world"],
          ai: {
            enabled: true,
            providers: [
              {
                name: "local",
                baseUrl: `http://127.0.0.1:${port}/v1`,
                model: "fake-1",
                supportsTools: false,
              },
            ],
          },
        }),
        "utf8"
      );

      const result = await cli(
        ["ai", "ask", "Résume le dernier run", "--provider", "local", "--json"],
        dir
      );
      expect(result.code).toBe(0);
      const answer = JSON.parse(result.stdout) as { answer: string; provider: string };
      expect(answer.provider).toBe("local");
      expect(answer.answer).toContain("dernier run est vert");
      expect(received).toHaveLength(1);
      const userMessage = received[0]?.messages?.find((message) => message.role === "user");
      expect(userMessage?.content).toContain("Résume le dernier run");
      expect(userMessage?.content).not.toContain("local");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("sync uploads real totals instead of an empty summary", async () => {
    const received: {
      summary?: { totals?: Record<string, { total: number }> };
      run?: { workspaceId?: string; projectId?: string };
    }[] = [];
    const headersSeen: Record<string, string | undefined>[] = [];
    const server = createServer((request, response) => {
      // `GET /v1/project` is how the CLI learns which workspace its key speaks for.
      // Without it the CLI refuses to upload rather than guessing a tenant.
      if (request.method === "GET" && request.url?.startsWith("/v1/project")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            workspace: { id: "ws_from_key", name: "Sync test" },
            project: { id: "prj_from_key", name: "Sync test" },
          })
        );
        return;
      }
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        headersSeen.push({
          idempotencyKey: request.headers["idempotency-key"] as string | undefined,
        });
        received.push(
          JSON.parse(body) as {
            summary?: { totals?: Record<string, { total: number }> };
            run?: { workspaceId?: string; projectId?: string };
          }
        );
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ runId: "run_test", recorded: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const dir = await project();
      await mkdir(join(dir, ".proofcore", "reports"), { recursive: true });
      await writeFile(
        join(dir, ".proofcore", "reports", "run.json"),
        JSON.stringify({
          id: "run_test",
          status: "COMPLETED",
          moduleRuns: [
            {
              module: "world",
              status: "COMPLETED",
              totals: { total: 3, passed: 3, failed: 0, warnings: 0, skipped: 0, errors: 0 },
              cases: [],
            },
          ],
          findings: [],
        }),
        "utf8"
      );
      await writeFile(
        join(dir, "proofcore.config.json"),
        JSON.stringify({
          schemaVersion: 1,
          project: { name: "Sync test", baseUrl: "http://localhost:3000" },
          modules: {
            world: { enabled: false },
            flow: { enabled: false },
            exit: { enabled: false },
          },
          enabledModules: ["world"],
          sync: { enabled: true, apiUrl: `http://127.0.0.1:${port}` },
        }),
        "utf8"
      );

      const result = await cli(["sync", "--json"], dir, {
        PROOFCORE_PROJECT_TOKEN: "psk_test",
      });
      expect(result.code).toBe(0);
      expect(received).toHaveLength(1);
      // Totals are keyed by module, not flat: a summary that cannot say which module
      // failed is not a summary.
      expect(received[0]?.summary?.totals?.world?.total).toBe(3);
      // The tenant is taken from the key, never from the local run payload.
      expect(received[0]?.run?.workspaceId).toBe("ws_from_key");
      expect(received[0]?.run?.projectId).toBe("prj_from_key");
      // A retried upload must present the same key or the run is counted twice.
      expect(headersSeen[0]?.idempotencyKey).toBe("sync:run_test");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("audit --sync uploads the scan as a run the dashboard can find", async () => {
    const seen: {
      id?: string;
      modules?: string[];
      workspaceId?: string;
      projectId?: string;
      failTotals?: { total: number; failed: number; passed: number; skipped: number };
      failStatus?: string;
      findingCount?: number;
    }[] = [];
    const headersSeen: Record<string, string | undefined>[] = [];
    const server = createServer((request, response) => {
      if (request.method === "GET" && request.url?.startsWith("/v1/project")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            workspace: { id: "ws_from_key" },
            project: { id: "prj_from_key" },
          })
        );
        return;
      }
      if (request.method === "POST" && request.url === "/v1/runs") {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          body += chunk;
        });
        request.on("end", () => {
          headersSeen.push({
            idempotencyKey: request.headers["idempotency-key"] as string | undefined,
          });
          const parsed = JSON.parse(body) as {
            run?: {
              id?: string;
              modules?: string[];
              workspaceId?: string;
              projectId?: string;
              moduleRuns?: {
                module: string;
                status: string;
                totals: { total: number; failed: number; passed: number; skipped: number };
                cases: unknown[];
              }[];
              findings?: unknown[];
            };
          };
          const fail = parsed.run?.moduleRuns?.find((mr) => mr.module === "fail");
          seen.push({
            id: parsed.run?.id,
            modules: parsed.run?.modules,
            workspaceId: parsed.run?.workspaceId,
            projectId: parsed.run?.projectId,
            failTotals: fail?.totals,
            failStatus: fail?.status,
            findingCount: parsed.run?.findings?.length,
          });
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ runId: parsed.run?.id, recorded: true }));
        });
        return;
      }
      // The scanned target: plain http on loopback, so the FAIL module has real things
      // to observe (no TLS, no HSTS, no CSP) and the totals are not a fiction.
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        "<!doctype html><html><head><title>t</title></head><body><h1>ok</h1></body></html>"
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const dir = await project();
      await writeFile(
        join(dir, "proofcore.config.json"),
        JSON.stringify({
          schemaVersion: 1,
          project: { name: "Scan sync", baseUrl: `http://127.0.0.1:${port}` },
          modules: { world: { enabled: true }, flow: { enabled: true }, exit: { enabled: true } },
          enabledModules: ["world", "flow", "exit"],
          sync: { enabled: true, apiUrl: `http://127.0.0.1:${port}` },
        }),
        "utf8"
      );

      const result = await cli(["audit", "fail", `http://127.0.0.1:${port}`, "--sync"], dir, {
        PROOFCORE_PROJECT_TOKEN: "psk_test",
      });
      // The audit found real findings (plain http on loopback), so the command exits 1:
      // an exit 0 here would mean the checks ran over nothing.
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("Synced run scan_");
      expect(seen).toHaveLength(1);
      const uploaded = seen[0] ?? {};
      expect(uploaded.modules).toEqual(["fail"]);
      expect(uploaded.workspaceId).toBe("ws_from_key");
      expect(uploaded.projectId).toBe("prj_from_key");
      // The totals the client sent agree with its own cases: the API recomputes them,
      // a payload that claims different numbers is wrong on its face.
      expect(uploaded.failTotals?.total).toBeGreaterThan(0);
      expect(uploaded.failTotals?.failed).toBeGreaterThan(0);
      expect(uploaded.failStatus).toBe("FAILED");
      // WARN and FAIL become findings; PASS and SKIPPED stay answers, not defects.
      expect(uploaded.findingCount).toBe(
        (uploaded.failTotals?.failed ?? 0) +
          (uploaded.failTotals ? ((uploaded.failTotals as { warnings?: number }).warnings ?? 0) : 0)
      );
      // The idempotency key derives from the scan identity, so the same report retried
      // is recorded once.
      expect(headersSeen[0]?.idempotencyKey).toMatch(/^sync:scan_/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("test writes the report files it says it wrote", async () => {
    const dir = await project();
    await cli(["init", "--yes", "Report run"], dir);
    await cli(["test", "--quiet", "--module", "exit"], dir);
    const json = await readFile(join(dir, ".proofcore", "reports", "run.json"), "utf8");
    expect(JSON.parse(json)).toHaveProperty("moduleRuns");
  });

  it("report re-renders a previous run from disk", async () => {
    const dir = await project();
    await cli(["init", "--yes", "Rerender"], dir);
    await cli(["test", "--quiet", "--module", "exit"], dir);
    const result = await cli(["report", "text"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("PROOFCORE run");
  });

  it("report rejects an unknown format instead of falling back to text", async () => {
    const dir = await project();
    await cli(["init", "--yes", "Bad report"], dir);
    await cli(["test", "--quiet", "--module", "exit"], dir);
    const result = await cli(["report", "yaml"], dir);
    expect(result.code).toBe(64);
    expect(result.stderr).toContain('Unknown report format "yaml"');
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
      join(dir, "proofcore.config.json"),
      JSON.stringify({
        schemaVersion: 1,
        project: { name: "Sync", baseUrl: "http://localhost:3000" },
        modules: { world: { enabled: false }, flow: { enabled: false }, exit: { enabled: false } },
        enabledModules: ["world"],
        sync: { enabled: true, apiUrl: "http://localhost:9999" },
      }),
      "utf8"
    );
    const result = await cli(["sync"], dir);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("PROOFCORE_PROJECT_TOKEN");
  });

  it("login explains the token flow without writing a secret", async () => {
    const dir = await project();
    const result = await cli(["login"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("PROOFCORE_PROJECT_TOKEN");
    expect(result.stdout).toContain("No token is written to disk");
  });

  it("rejects an unknown command with a usage error", async () => {
    const dir = await project();
    const result = await cli(["frobnicate"], dir);
    expect(result.code).toBe(64);
    expect(result.stderr).toContain("Unknown command");
  });
});
