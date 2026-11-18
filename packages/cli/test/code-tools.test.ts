import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyPatch,
  gitStatus,
  listFiles,
  mapArchitecture,
  readFileSlice,
  runCommand,
  searchCode,
  type ToolContext,
  unifiedDiff,
  writeFileWithDiff,
} from "../src/code-tools.js";

/**
 * Code tools: the layer an AI uses to read and change a real project.
 *
 * The refusals are tested as seriously as the successes, because a code agent is only
 * safe if it cannot read outside the workspace, cannot silently overwrite a file without
 * a diff, cannot apply a patch to the wrong place, and cannot run an arbitrary shell.
 */

let root: string;
let context: ToolContext;

async function seed(): Promise<void> {
  await mkdir(join(root, "src/payments"), { recursive: true });
  await mkdir(join(root, "node_modules/left-pad"), { recursive: true });
  await writeFile(
    join(root, "src/payments/charge.ts"),
    `import { Money } from "@proofcore/core";\nimport { refund } from "./refund.js";\n\nexport function charge(amount: Money): void {\n  // TODO: idempotency\n}\n`,
    "utf8"
  );
  await writeFile(
    join(root, "src/payments/refund.ts"),
    `export function refund(): string {\n  return "refunded";\n}\n`,
    "utf8"
  );
  await writeFile(
    join(root, "src/index.ts"),
    `import { charge } from "./payments/charge.js";\n`,
    "utf8"
  );
  await writeFile(join(root, "node_modules/left-pad/index.js"), "module.exports = 1;\n", "utf8");
  await writeFile(join(root, "README.md"), "# Project\n", "utf8");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "proofcore-tools-"));
  context = { root };
  await seed();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("list_files", () => {
  it("lists the project tree and skips build/vendor directories", async () => {
    const result = await listFiles(context);
    const paths = result.entries.map((entry) => entry.path);
    expect(paths).toContain("src");
    expect(paths).toContain("src/payments/charge.ts");
    expect(paths).toContain("README.md");
    // node_modules is not source and must never be offered as context.
    expect(paths.some((path) => path.startsWith("node_modules"))).toBe(false);
  });

  it("respects the depth limit and says when it truncated", async () => {
    const shallow = await listFiles(context, { depth: 1 });
    expect(
      shallow.entries.every((entry) => !entry.path.includes("/", entry.path.indexOf("/") + 1))
    ).toBe(true);
    expect(shallow.truncated).toBe(true);
  });
});

describe("read_file", () => {
  it("returns line numbers so a patch can name exact lines", async () => {
    const slice = await readFileSlice(context, { path: "src/payments/charge.ts" });
    expect(slice.totalLines).toBeGreaterThan(3);
    expect(slice.content).toContain("     1│ import { Money }");
    expect(slice.content).toContain("     5│   // TODO: idempotency");
  });

  it("paginates instead of dumping a huge file", async () => {
    await writeFile(
      join(root, "big.ts"),
      Array.from({ length: 50 }, (_, i) => `// ${i}`).join("\n"),
      "utf8"
    );
    const slice = await readFileSlice(context, { path: "big.ts", startLine: 10, endLine: 12 });
    expect(slice.startLine).toBe(10);
    expect(slice.endLine).toBe(12);
    expect(slice.content.split("\n")).toHaveLength(3);
  });

  it("refuses to escape the workspace", async () => {
    await expect(readFileSlice(context, { path: "../../../etc/passwd" })).rejects.toThrow(
      /escapes the workspace/
    );
    await expect(readFileSlice(context, { path: "/etc/passwd" })).rejects.toThrow(
      /escapes the workspace/
    );
    await expect(readFileSlice(context, { path: "src/../../outside.txt" })).rejects.toThrow(
      /escapes the workspace/
    );
  });

  it("reports a missing file as an error instead of an empty string", async () => {
    await expect(readFileSlice(context, { path: "src/nope.ts" })).rejects.toThrow(/Cannot read/);
  });

  it("does not pretend a binary file is text", async () => {
    await writeFile(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const slice = await readFileSlice(context, { path: "logo.png" });
    expect(slice.binary).toBe(true);
    expect(slice.content).toBe("");
  });
});

describe("search_code", () => {
  it("finds a literal string with file and line", async () => {
    const result = await searchCode(context, { query: "idempotency" });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.path).toBe("src/payments/charge.ts");
    expect(result.hits[0]?.line).toBe(5);
  });

  it("supports regular expressions and reports honestly when nothing matches", async () => {
    const found = await searchCode(context, { query: "export function \\w+", regex: true });
    expect(found.hits.length).toBeGreaterThanOrEqual(2);
    const missing = await searchCode(context, { query: "kubernetes" });
    expect(missing.hits).toHaveLength(0);
    expect(missing.filesScanned).toBeGreaterThan(0);
  });

  it("never searches node_modules", async () => {
    const result = await searchCode(context, { query: "module.exports" });
    expect(result.hits).toHaveLength(0);
  });

  it("refuses an invalid regular expression instead of silently matching nothing", async () => {
    await expect(searchCode(context, { query: "([", regex: true })).rejects.toThrow(
      /Invalid regular/
    );
  });
});

describe("write_file", () => {
  it("does not write by default and returns a diff to review", async () => {
    const before = await readFile(join(root, "README.md"), "utf8");
    const result = await writeFileWithDiff(context, {
      path: "README.md",
      content: "# Project\n\n## Install\n",
    });
    expect(result.applied).toBe(false);
    expect(result.diff).toContain("-");
    expect(result.diff).toContain("+## Install");
    // The file is untouched: a suggestion is not a change.
    expect(await readFile(join(root, "README.md"), "utf8")).toBe(before);
  });

  it("writes only when apply is explicitly true", async () => {
    const result = await writeFileWithDiff(context, {
      path: "src/new.ts",
      content: "export const x = 1;\n",
      apply: true,
    });
    expect(result.applied).toBe(true);
    expect(result.created).toBe(true);
    expect(await readFile(join(root, "src/new.ts"), "utf8")).toBe("export const x = 1;\n");
  });

  it("refuses to write outside the workspace", async () => {
    await expect(
      writeFileWithDiff(context, { path: "../escape.ts", content: "x", apply: true })
    ).rejects.toThrow(/escapes the workspace/);
  });
});

describe("apply_patch", () => {
  const patchForCharge = [
    "--- a/src/payments/charge.ts",
    "+++ b/src/payments/charge.ts",
    "@@ -3,3 +3,5 @@",
    " ",
    " export function charge(amount: Money): void {",
    "-  // TODO: idempotency",
    '+  if (amount.minor <= 0n) throw new Error("amount must be positive");',
    "+  // Idempotency is enforced by the caller's key.",
    " }",
  ].join("\n");

  it("validates without applying when apply is not true", async () => {
    const before = await readFile(join(root, "src/payments/charge.ts"), "utf8");
    const result = await applyPatch(context, { patch: patchForCharge });
    expect(result.applied).toBe(false);
    expect(await readFile(join(root, "src/payments/charge.ts"), "utf8")).toBe(before);
  });

  it("applies when the context matches exactly", async () => {
    const result = await applyPatch(context, { patch: patchForCharge, apply: true });
    expect(result.applied).toBe(true);
    expect(result.hunksApplied).toBe(1);
    const after = await readFile(join(root, "src/payments/charge.ts"), "utf8");
    expect(after).toContain("amount must be positive");
    expect(after).not.toContain("TODO: idempotency");
  });

  it("refuses the whole patch when its context does not match", async () => {
    const stale = patchForCharge.replace("// TODO: idempotency", "// this line never existed");
    await expect(applyPatch(context, { patch: stale, apply: true })).rejects.toThrow(
      /does not match/
    );
    // Nothing was written: no partial application.
    const after = await readFile(join(root, "src/payments/charge.ts"), "utf8");
    expect(after).toContain("TODO: idempotency");
  });

  it("finds a hunk that moved a few lines", async () => {
    await writeFile(
      join(root, "src/payments/charge.ts"),
      `// banner\n// banner 2\n\nimport { Money } from "@proofcore/core";\n\nexport function charge(amount: Money): void {\n  // TODO: idempotency\n}\n`,
      "utf8"
    );
    const result = await applyPatch(context, { patch: patchForCharge, apply: true });
    expect(result.applied).toBe(true);
    expect(await readFile(join(root, "src/payments/charge.ts"), "utf8")).toContain(
      "amount must be positive"
    );
  });

  it("refuses an empty patch instead of reporting success", async () => {
    await expect(applyPatch(context, { patch: "nothing here" })).rejects.toThrow(/no hunks/);
  });
});

describe("unifiedDiff", () => {
  it("is empty when nothing changed", () => {
    expect(unifiedDiff({ path: "a.ts", before: "x", after: "x" })).toBe("");
  });

  it("marks a created file against /dev/null", () => {
    const diff = unifiedDiff({ path: "new.ts", before: "", after: "a\n", created: true });
    expect(diff).toContain("--- /dev/null");
    expect(diff).toContain("+++ b/new.ts");
  });
});

describe("run_command", () => {
  it("runs an allowlisted command and returns its real output", async () => {
    const result = await runCommand(context, { command: "node", args: ["-e", "console.log(6*7)"] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("42");
    expect(result.timedOut).toBe(false);
  });

  it("returns a non-zero exit code and stderr instead of throwing", async () => {
    const result = await runCommand(context, {
      command: "node",
      args: ["-e", "process.exit(3)"],
    });
    expect(result.exitCode).toBe(3);
  });

  it("refuses a command that is not on the allowlist", async () => {
    await expect(runCommand(context, { command: "bash", args: ["-c", "echo hi"] })).rejects.toThrow(
      /not on the allowlist/
    );
    await expect(runCommand(context, { command: "sh", args: ["-c", "id"] })).rejects.toThrow(
      /not on the allowlist/
    );
  });

  it("refuses shell metacharacters in the command name", async () => {
    await expect(runCommand(context, { command: "node;curl evil.test" })).rejects.toThrow(
      /forbidden characters/
    );
  });

  it("refuses destructive argument patterns", async () => {
    await expect(
      runCommand(context, { command: "git", args: ["push", "--force"] })
    ).rejects.toThrow(/refused/);
  });

  it("times out a command that hangs and says so", async () => {
    const result = await runCommand(context, {
      command: "node",
      args: ["-e", "setTimeout(() => {}, 10000)"],
      timeoutMs: 400,
    });
    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(5000);
  });

  it("runs inside the workspace only", async () => {
    await expect(runCommand(context, { command: "ls", args: [], cwd: "/etc" })).rejects.toThrow(
      /escapes the workspace/
    );
  });
});

describe("git", () => {
  it("reports a clear failure when the directory is not a repository", async () => {
    const status = await gitStatus(context);
    expect(status.exitCode).not.toBe(0);
    expect(status.stderr).toMatch(/not a git repository/i);
  });
});

describe("map_architecture", () => {
  it("builds a real import graph and renders Mermaid", async () => {
    const map = await mapArchitecture(context);
    expect(map.files).toBeGreaterThanOrEqual(3);
    const charge = map.nodes.find((node) => node.path === "src/payments/charge.ts");
    expect(charge?.imports).toContain("./refund.js");
    expect(map.mermaid.startsWith("graph LR")).toBe(true);
    // A real edge: index imports charge, charge imports refund.
    expect(map.mermaid).toContain("-->");
    // External packages are reported separately from local files.
    expect(map.external.map((entry) => entry.name)).toContain("@proofcore/core");
  });

  it("ignores node_modules when building the graph", async () => {
    const map = await mapArchitecture(context);
    expect(map.nodes.some((node) => node.path.includes("node_modules"))).toBe(false);
  });
});
