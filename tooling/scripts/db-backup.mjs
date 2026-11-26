#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * Take a verifiable backup of a D1 database.
 *
 *   node tooling/scripts/db-backup.mjs                  # local D1 (wrangler dev state)
 *   node tooling/scripts/db-backup.mjs --remote         # production D1 (wrangler auth)
 *   node tooling/scripts/db-backup.mjs --out backups    # directory (default)
 *
 * Wrangler writes the SQL dump; this script computes the checksum, records the row
 * count of every table, and writes a manifest next to it. `db-restore.mjs` refuses a
 * dump whose bytes or counts do not match the manifest.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  API_DIR,
  BackupError,
  ensureParent,
  fileSize,
  formatBytes,
  ROOT,
  resolveOutput,
  sha256File,
  tableCounts,
  tableNames,
  wrangler,
} from "./lib/d1-backup.mjs";

const USAGE = `Usage: node tooling/scripts/db-backup.mjs [options]

  --remote            Back up the deployed D1 database instead of the local one
  --database <name>   D1 database name (default: proofcore)
  --cwd <dir>         Directory containing wrangler.toml (default: apps/api)
  --out <path>        Output file, or directory (default: backups/)
  --force             Overwrite an existing dump
  --json              Print only the manifest on stdout
  -h, --help          Show this help`;

/** @param {string[]} argv */
function parse(argv) {
  /** @type {Record<string, string | boolean>} */
  const args = { remote: false, database: "proofcore", cwd: API_DIR, force: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--remote") args.remote = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--database") args.database = requireValue(argv, ++i, "--database");
    else if (arg === "--cwd") args.cwd = requireValue(argv, ++i, "--cwd");
    else if (arg === "--out") args.out = requireValue(argv, ++i, "--out");
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

/** @param {string} dir */
function configIn(dir) {
  for (const name of ["wrangler.toml", "wrangler.json", "wrangler.jsonc"]) {
    if (existsSync(`${dir}/${name}`)) return `${dir}/${name}`;
  }
  throw new BackupError(`no wrangler.toml/json/jsonc in ${dir}`);
}

/** @returns {string} */
function wranglerVersion() {
  try {
    const out = wrangler(["--version"]);
    return out.trim().split("\n")[0] || "unknown";
  } catch {
    return "unknown";
  }
}

/** @returns {string | null} */
function gitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? (result.stdout ?? "").trim() || null : null;
}

async function main() {
  const args = parse(process.argv.slice(2));
  const cwd = String(args.cwd);
  const database = String(args.database);
  if (!/^[A-Za-z0-9_-]+$/.test(database)) {
    throw new BackupError(`invalid database name: ${database}`);
  }
  configIn(cwd);
  const mode = args.remote ? "remote" : "local";
  const now = new Date();
  const file = resolveOutput(
    typeof args.out === "string" ? args.out : undefined,
    database,
    mode,
    now
  );
  if (existsSync(file) && !args.force) {
    throw new BackupError(`refusing to overwrite ${file} (use --force)`);
  }
  ensureParent(file);

  if (!args.json) {
    console.log(`[backup] ${database} (${mode}) → ${file}`);
    if (mode === "remote") console.log("[backup] using the wrangler session/token of this machine");
  }

  const exportArgs = ["d1", "export", database, `--${mode}`, "--output", file];
  wrangler(exportArgs, { cwd });

  if (!existsSync(file)) throw new BackupError("wrangler reported success but wrote no file");
  chmodSync(file, 0o600);
  const sizeBytes = fileSize(file);
  if (sizeBytes === 0) throw new BackupError("the export is empty");

  const tables = tableNames(database, { cwd, remote: Boolean(args.remote) });
  const counts = tableCounts(database, tables, { cwd, remote: Boolean(args.remote) });
  const sql = readFileSync(file, "utf8");
  if (tables.length > 0 && !sql.includes("CREATE TABLE")) {
    throw new BackupError("the export contains no CREATE TABLE statement");
  }

  /** @type {Record<string, unknown>} */
  const manifest = {
    format: "proofcore.d1-backup",
    version: 1,
    createdAt: now.toISOString(),
    mode,
    database,
    file: file.split("/").at(-1),
    sizeBytes,
    sha256: sha256File(file),
    tables: counts,
    rowCount: Object.values(counts).reduce((sum, n) => sum + n, 0),
    wranglerVersion: wranglerVersion(),
    gitCommit: gitCommit(),
    command: "tooling/scripts/db-backup.mjs",
  };
  const manifestPath = `${file}.manifest.json`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  if (args.json) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    console.log(
      `[backup] ${Object.keys(counts).length} table(s), ${manifest.rowCount} row(s), ${formatBytes(sizeBytes)}`
    );
    console.log(`[backup] sha256 ${manifest.sha256}`);
    console.log(`[backup] manifest ${manifestPath}`);
  }
}

main().catch((error) => {
  console.error(`[backup] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
