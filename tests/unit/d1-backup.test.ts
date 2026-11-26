import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  diffCounts,
  formatBytes,
  quoteIdentifier,
  readManifest,
  resolveOutput,
} from "../../tooling/scripts/lib/d1-backup.mjs";

/**
 * The contract between db-backup.mjs and db-restore.mjs.
 *
 * The restore command is only as trustworthy as these comparisons: a manifest that
 * cannot be parsed, a table that disappeared, or a count that moved must all fail
 * loudly. The end-to-end drill (`pnpm db:drill`) proves the wrangler side; these
 * tests pin the decisions that command makes before it touches a database.
 */
describe("backup manifest", () => {
  it("rejects a document that is not a PROOFCORE D1 manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "proofcore-manifest-"));
    const path = join(dir, "wrong.json");
    writeFileSync(path, JSON.stringify({ format: "something-else", version: 1 }));
    expect(() => readManifest(path)).toThrow(/unknown manifest format/);
  });

  it("rejects an unsupported manifest version", () => {
    const dir = mkdtempSync(join(tmpdir(), "proofcore-manifest-"));
    const path = join(dir, "v2.json");
    writeFileSync(path, JSON.stringify({ format: "proofcore.d1-backup", version: 2 }));
    expect(() => readManifest(path)).toThrow(/unsupported manifest version/);
  });

  it("accepts the current format", () => {
    const dir = mkdtempSync(join(tmpdir(), "proofcore-manifest-"));
    const path = join(dir, "ok.json");
    const manifest = { format: "proofcore.d1-backup", version: 1, tables: { workspaces: 2 } };
    writeFileSync(path, JSON.stringify(manifest));
    expect(readManifest(path)).toMatchObject(manifest);
  });
});

describe("row-count comparison", () => {
  it("accepts identical counts", () => {
    expect(diffCounts({ workspaces: 2, findings: 0 }, { workspaces: 2, findings: 0 })).toEqual({
      ok: true,
      missing: [],
      extra: [],
      mismatched: [],
    });
  });

  it("names a table the restore lost", () => {
    const diff = diffCounts({ workspaces: 2, findings: 1 }, { workspaces: 2 });
    expect(diff.ok).toBe(false);
    expect(diff.missing).toEqual(["findings"]);
  });

  it("names a table the restore invented", () => {
    const diff = diffCounts({ workspaces: 2 }, { workspaces: 2, extra: 1 });
    expect(diff.ok).toBe(false);
    expect(diff.extra).toEqual(["extra"]);
  });

  it("reports both numbers when a row count moved", () => {
    const diff = diffCounts({ workspaces: 2 }, { workspaces: 1 });
    expect(diff.ok).toBe(false);
    expect(diff.mismatched).toEqual([{ table: "workspaces", expected: 2, actual: 1 }]);
  });
});

describe("SQL and path safety", () => {
  it("doubles a quote instead of letting it close the identifier", () => {
    expect(quoteIdentifier("workspaces")).toBe('"workspaces"');
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
  });

  it("writes a .sql path as a file and any other path as a directory", () => {
    const now = new Date("2026-11-26T12:34:56.000Z");
    expect(resolveOutput("/tmp/dump.sql", "proofcore", "local", now)).toBe("/tmp/dump.sql");
    expect(resolveOutput("/tmp/backups", "proofcore", "remote", now)).toMatch(
      /\/tmp\/backups\/proofcore-remote-2026-11-26T12-34-56Z\.sql$/
    );
  });

  it("formats sizes without inventing precision", () => {
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MiB");
  });
});
