#!/usr/bin/env node
/**
 * Backup/restore drill on isolated local D1 databases.
 *
 * This is the executable part of docs/PROOFCORE_BACKUP_RESTORE.md: it creates a
 * database with the real migrations, seeds a workspace → project → run → report →
 * finding chain, backs it up with db-backup.mjs, restores into a second, empty
 * database with db-restore.mjs, and then queries the restored rows directly. Every
 * step is a real wrangler invocation against workerd; nothing is mocked.
 *
 *   pnpm db:drill            # exits 0 only if all counts and the seeded row match
 *   pnpm db:drill -- --keep  # keep the temporary directories for inspection
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { API_DIR, query, ROOT, tableCounts, tableNames, wrangler } from "./lib/d1-backup.mjs";

const DATABASE = "proofcore_drill";
const DATABASE_ID = "1d1d1d1d-0000-4000-8000-000000000001";
const keep = process.argv.includes("--keep");

const SEED = `
INSERT INTO workspaces (id, name, slug, created_at)
VALUES ('ws_drill', 'Drill workspace', 'drill-workspace', '2026-11-26T00:00:00.000Z');
INSERT INTO projects (id, workspace_id, name, base_url, stack, environment, enabled_modules, created_at, updated_at)
VALUES ('prj_drill', 'ws_drill', 'Drill project', 'https://drill.example', NULL, 'production', '[]', '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z');
INSERT INTO test_runs (id, workspace_id, project_id, status, started_at, ended_at, duration_ms, environment, revision, totals, created_at)
VALUES ('run_drill', 'ws_drill', 'prj_drill', 'passed', '2026-11-26T00:00:00.000Z', '2026-11-26T00:01:00.000Z', 60000, 'production', 'drill-rev', '{"passed":1,"failed":0,"skipped":0}', '2026-11-26T00:01:00.000Z');
INSERT INTO reports (id, run_id, workspace_id, project_id, status, payload, created_at, retained_until)
VALUES ('rep_drill', 'run_drill', 'ws_drill', 'prj_drill', 'passed', '{"drill":true}', '2026-11-26T00:01:00.000Z', '2027-01-01T00:00:00.000Z');
INSERT INTO findings (id, report_id, workspace_id, project_id, module, title, severity, status, code, fingerprint, detected_at)
VALUES ('fnd_drill', 'rep_drill', 'ws_drill', 'prj_drill', 'WORLD', 'Drill finding', 'high', 'fail', 'drill.demo', 'fp_drill', '2026-11-26T00:01:00.000Z');
`;

/** @param {string} dir */
function writeConfig(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "wrangler.toml"),
    [
      'name = "proofcore-drill"',
      'compatibility_date = "2026-11-01"',
      "",
      "[[d1_databases]]",
      'binding = "DB"',
      `database_name = "${DATABASE}"`,
      `database_id = "${DATABASE_ID}"`,
      `migrations_dir = "${resolve(API_DIR, "migrations").replaceAll("\\", "/")}"`,
      "",
    ].join("\n")
  );
}

/** @param {string[]} args @param {string} cwd */
function node(args, cwd) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
  });
  if (result.status !== 0) {
    throw new Error(
      `${process.execPath} ${args.join(" ")} failed (exit ${result.status})\n${result.stdout ?? ""}${result.stderr ?? ""}`
    );
  }
  return result.stdout ?? "";
}

/** @param {string[]} args @param {string} cwd @returns {string} */
function nodeFailure(args, cwd) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
  });
  if (result.status === 0) throw new Error(`${args[0]} was expected to fail`);
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

/** @param {string} label @param {boolean} ok */
function check(label, ok) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) throw new Error(`drill check failed: ${label}`);
}

function main() {
  const base = mkdtempSync(join(tmpdir(), "proofcore-d1-drill-"));
  const source = join(base, "source");
  const target = join(base, "target");
  const backups = join(base, "backups");
  const dump = join(backups, "drill.sql");
  mkdirSync(backups, { recursive: true });
  console.log(`[drill] ${base}`);

  try {
    writeConfig(source);
    writeConfig(target);

    console.log("[drill] applying the real migrations to the source database");
    wrangler(["d1", "migrations", "apply", DATABASE, "--local"], { cwd: source });

    const seedPath = join(base, "seed.sql");
    writeFileSync(seedPath, SEED);
    console.log("[drill] seeding workspace → project → run → report → finding");
    wrangler(["d1", "execute", DATABASE, "--local", "--file", seedPath, "--yes"], { cwd: source });

    console.log("[drill] backup (db-backup.mjs)");
    const backupOut = node(
      [
        join(ROOT, "tooling/scripts/db-backup.mjs"),
        "--cwd",
        source,
        "--database",
        DATABASE,
        "--out",
        dump,
      ],
      ROOT
    );
    console.log(backupOut.trim());

    console.log("[drill] restore into an empty database (db-restore.mjs)");
    const restoreOut = node(
      [
        join(ROOT, "tooling/scripts/db-restore.mjs"),
        "--cwd",
        target,
        "--database",
        DATABASE,
        "--confirm",
        DATABASE,
        "--file",
        dump,
      ],
      ROOT
    );
    console.log(restoreOut.trim());

    console.log("[drill] independent verification");
    const before = tableCounts(DATABASE, tableNames(DATABASE, { cwd: source }), { cwd: source });
    const after = tableCounts(DATABASE, tableNames(DATABASE, { cwd: target }), { cwd: target });
    const differing = Object.keys(before).filter((name) => before[name] !== after[name]);
    check(
      `${Object.keys(before).length} table(s) with identical row counts`,
      differing.length === 0
    );
    check("the seeded workspace row is present", after.workspaces === 1);
    check("the seeded project row is present", after.projects === 1);
    check("the seeded run row is present", after.test_runs === 1);
    check("the seeded report row is present", after.reports === 1);
    check("the seeded finding row is present", after.findings === 1);
    const rows = query(DATABASE, "SELECT title FROM findings WHERE id = 'fnd_drill'", {
      cwd: target,
    });
    check("the finding content survived the round trip", rows[0]?.title === "Drill finding");

    console.log("[drill] safety checks");
    const tampered = join(backups, "tampered.sql");
    const bytes = readFileSync(dump);
    bytes[bytes.length - 1] = 0x20;
    writeFileSync(tampered, bytes);
    copyFileSync(`${dump}.manifest.json`, `${tampered}.manifest.json`);
    const tamperOut = nodeFailure(
      [
        join(ROOT, "tooling/scripts/db-restore.mjs"),
        "--cwd",
        target,
        "--database",
        DATABASE,
        "--confirm",
        DATABASE,
        "--file",
        tampered,
      ],
      ROOT
    );
    check("a tampered dump is refused", tamperOut.includes("checksum mismatch"));
    const nonEmptyOut = nodeFailure(
      [
        join(ROOT, "tooling/scripts/db-restore.mjs"),
        "--cwd",
        source,
        "--database",
        DATABASE,
        "--confirm",
        DATABASE,
        "--file",
        dump,
      ],
      ROOT
    );
    check("a non-empty target is refused", nonEmptyOut.includes("not empty"));

    console.log("[drill] PASS — backup and restore verified on local D1 (workerd)");
  } finally {
    if (keep) console.log(`[drill] kept ${base}`);
    else rmSync(base, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`[drill] FAIL — ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
