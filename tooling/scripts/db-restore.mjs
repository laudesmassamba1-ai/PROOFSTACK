#!/usr/bin/env node
/**
 * Restore a D1 backup, and prove it matches the manifest row for row.
 *
 *   node tooling/scripts/db-restore.mjs --file backups/proofcore-local-....sql \
 *     --confirm proofcore --cwd apps/api
 *
 * Safety rules, in order:
 *   1. the dump must match the sha256 recorded by db-backup.mjs;
 *   2. the target database must contain no product tables — a restore never
 *      overwrites live data in place; create a new database and swap the binding;
 *   3. every table count must equal the manifest after the import.
 * A failure at any step exits non-zero and prints the table-level difference.
 */
import { existsSync } from "node:fs";
import {
  API_DIR,
  BackupError,
  diffCounts,
  fileSize,
  formatBytes,
  readManifest,
  sha256File,
  tableCounts,
  tableNames,
  wrangler,
} from "./lib/d1-backup.mjs";

const USAGE = `Usage: node tooling/scripts/db-restore.mjs --file <dump.sql> --confirm <database> [options]

  --file <path>       Backup produced by db-backup.mjs (required)
  --manifest <path>   Manifest path (default: <file>.manifest.json)
  --confirm <name>    Must equal the target database name (required)
  --database <name>   Target database (default: the manifest database)
  --cwd <dir>         Directory containing wrangler.toml (default: apps/api)
  --remote            Restore into the deployed D1 database (default: manifest mode)
  --json              Print a machine-readable result
  -h, --help          Show this help`;

/** @param {string[]} argv */
function parse(argv) {
  /** @type {Record<string, string | boolean>} */
  const args = { cwd: API_DIR, remote: false, remoteSet: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--remote") {
      args.remote = true;
      args.remoteSet = true;
    } else if (arg === "--json") args.json = true;
    else if (arg === "--file") args.file = requireValue(argv, ++i, "--file");
    else if (arg === "--manifest") args.manifest = requireValue(argv, ++i, "--manifest");
    else if (arg === "--database") args.database = requireValue(argv, ++i, "--database");
    else if (arg === "--confirm") args.confirm = requireValue(argv, ++i, "--confirm");
    else if (arg === "--cwd") args.cwd = requireValue(argv, ++i, "--cwd");
    else throw new BackupError(`unknown option: ${arg}`);
  }
  return args;
}

/** @param {string[]} argv @param {number} index @param {string} flag */
function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new BackupError(`${flag} expects a value`);
  return value;
}

function main() {
  const args = parse(process.argv.slice(2));
  if (typeof args.file !== "string") throw new BackupError("--file is required");
  if (typeof args.confirm !== "string") throw new BackupError("--confirm <database> is required");
  const file = args.file;
  if (!existsSync(file)) throw new BackupError(`dump not found: ${file}`);
  const manifestPath = typeof args.manifest === "string" ? args.manifest : `${file}.manifest.json`;
  const manifest = readManifest(manifestPath);
  const database = typeof args.database === "string" ? args.database : manifest.database;
  if (typeof database !== "string" || !/^[A-Za-z0-9_-]+$/.test(database)) {
    throw new BackupError(`invalid target database: ${String(database)}`);
  }
  if (args.confirm !== database) {
    throw new BackupError(
      `--confirm ${args.confirm} does not match the target database ${database}`
    );
  }
  const remote = args.remoteSet ? Boolean(args.remote) : manifest.mode === "remote";
  const opts = { cwd: String(args.cwd), remote };

  const actualSize = fileSize(file);
  if (actualSize !== manifest.sizeBytes) {
    throw new BackupError(`size mismatch: manifest ${manifest.sizeBytes}, file ${actualSize}`);
  }
  const digest = sha256File(file);
  if (digest !== manifest.sha256) {
    throw new BackupError(`checksum mismatch: manifest ${manifest.sha256}, file ${digest}`);
  }

  const existing = tableNames(database, opts);
  if (existing.length > 0) {
    throw new BackupError(
      [
        `target ${database} is not empty (${existing.length} table(s): ${existing.slice(0, 6).join(", ")}).`,
        "A restore never overwrites live data in place.",
        "Use a fresh database (or a fresh --cwd for a local drill), restore there,",
        "verify the counts below, then swap the binding after review.",
      ].join("\n")
    );
  }

  if (!args.json) {
    console.log(
      `[restore] ${manifest.database} (${manifest.mode}) → ${database} (${remote ? "remote" : "local"})`
    );
    console.log(`[restore] ${formatBytes(actualSize)}, sha256 verified`);
  }

  wrangler(["d1", "execute", database, remote ? "--remote" : "--local", "--file", file, "--yes"], {
    cwd: opts.cwd,
  });

  const expected = manifest.tables ?? {};
  const after = tableCounts(database, Object.keys(expected), opts);
  const diff = diffCounts(expected, after);
  const unknown = tableNames(database, opts).filter((name) => !(name in expected));

  /** @type {Record<string, unknown>} */
  const result = {
    ok: diff.ok && unknown.length === 0,
    database,
    mode: remote ? "remote" : "local",
    tables: Object.keys(expected).length,
    rows: Object.values(after).reduce((sum, n) => sum + n, 0),
    sha256: digest,
    diff,
    unknownTables: unknown,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (diff.missing.length > 0)
      console.log(`[restore] missing tables: ${diff.missing.join(", ")}`);
    if (diff.extra.length > 0) console.log(`[restore] unexpected tables: ${diff.extra.join(", ")}`);
    for (const row of diff.mismatched) {
      console.log(`[restore] ${row.table}: expected ${row.expected}, got ${row.actual}`);
    }
    if (unknown.length > 0)
      console.log(`[restore] tables outside the manifest: ${unknown.join(", ")}`);
    console.log(
      result.ok
        ? `[restore] PASS — ${result.tables} table(s), ${result.rows} row(s) match the manifest`
        : "[restore] FAIL — the restored database does not match the manifest"
    );
  }

  if (!result.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`[restore] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
