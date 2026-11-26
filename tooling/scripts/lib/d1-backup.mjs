/**
 * Shared plumbing for the D1 backup and restore commands.
 *
 * Wrangler is invoked as a child process with an argv array and `shell: false`
 * (AGENTS.md): a database name or a path is never interpolated into a shell string.
 * The manifest is the contract between the two commands — it records what was
 * exported, how many rows each table held, and the exact bytes — so a restore can
 * prove it put back what the backup took, instead of merely exiting 0.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const API_DIR = resolve(ROOT, "apps/api");
export const WRANGLER_BIN = resolve(API_DIR, "node_modules/.bin/wrangler");

/** Tables wrangler keeps for itself or for D1 internals: not part of the data set. */
const INTERNAL_TABLE = /^(?:sqlite_|_cf_)/;

export class BackupError extends Error {
  /** @param {string} message @param {{ cause?: unknown }} [options] */
  constructor(message, options = {}) {
    super(message, options);
    this.name = "BackupError";
  }
}

/**
 * Run wrangler and return its stdout. Wrangler prints its banner on stderr, so the
 * two streams stay separate: a caller that parses JSON must never see the banner.
 *
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 * @returns {string}
 */
export function wrangler(args, options = {}) {
  if (!existsSync(WRANGLER_BIN)) {
    throw new BackupError(
      `wrangler is not installed at ${WRANGLER_BIN}. Run \`pnpm install\` first.`
    );
  }
  const result = spawnSync(WRANGLER_BIN, args, {
    cwd: options.cwd ?? API_DIR,
    encoding: "utf8",
    shell: false,
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new BackupError(`wrangler could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim().split("\n").slice(-8).join("\n");
    throw new BackupError(`wrangler ${args.join(" ")} failed (exit ${result.status}):\n${detail}`);
  }
  return result.stdout ?? "";
}

/**
 * Run one read-only query through `wrangler d1 execute --json`.
 *
 * @param {string} database
 * @param {string} sql
 * @param {{ cwd?: string, remote?: boolean }} options
 * @returns {Record<string, unknown>[]}
 */
export function query(database, sql, options = {}) {
  const mode = options.remote ? "--remote" : "--local";
  const args = ["d1", "execute", database, mode, "--json", "--command", sql];
  if (options.cwd) args.push("--cwd", options.cwd);
  const stdout = wrangler(args, { cwd: options.cwd ?? API_DIR });
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new BackupError(`wrangler returned output that is not JSON:\n${stdout.slice(0, 800)}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !Array.isArray(parsed[0]?.results)) {
    throw new BackupError(`unexpected wrangler JSON shape: ${stdout.slice(0, 800)}`);
  }
  return parsed[0].results;
}

/** @param {string} name */
export function quoteIdentifier(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

/** Tables that hold product data, in creation order (parents before children). */
export function tableNames(database, options = {}) {
  const rows = query(
    database,
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY rowid",
    options
  );
  return rows
    .map((row) => String(row.name ?? ""))
    .filter((name) => name.length > 0 && !INTERNAL_TABLE.test(name));
}

/**
 * Exact row count for every table, in one round trip.
 *
 * A missing table is not silently skipped: the caller compares the counts to the
 * manifest, so a restore that lost a table fails instead of looking complete.
 *
 * @param {string} database
 * @param {string[]} tables
 * @param {{ cwd?: string, remote?: boolean }} options
 * @returns {Record<string, number>}
 */
export function tableCounts(database, tables, options = {}) {
  if (tables.length === 0) return {};
  // One SELECT with scalar subqueries, not a UNION: D1 caps a compound SELECT far
  // below SQLite's 500-term default, and a 38-table schema is already over it.
  const sql = `SELECT ${tables
    .map((name) => `(SELECT COUNT(*) FROM ${quoteIdentifier(name)}) AS ${quoteIdentifier(name)}`)
    .join(", ")}`;
  const rows = query(database, sql, options);
  const row = rows[0] ?? {};
  /** @type {Record<string, number>} */
  const counts = {};
  for (const name of tables) counts[name] = Number(row[name] ?? 0);
  return counts;
}

/** @param {string} path */
export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** @param {string} path */
export function fileSize(path) {
  return statSync(path).size;
}

/** @param {string} path */
export function readManifest(path) {
  if (!existsSync(path)) throw new BackupError(`manifest not found: ${path}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new BackupError(`manifest is not valid JSON: ${path}`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object") throw new BackupError("manifest is empty");
  if (parsed.format !== "proofcore.d1-backup") {
    throw new BackupError(`unknown manifest format: ${String(parsed.format)}`);
  }
  if (parsed.version !== 1)
    throw new BackupError(`unsupported manifest version: ${parsed.version}`);
  return parsed;
}

/**
 * Compare what a restore produced with what the manifest promised.
 *
 * @param {Record<string, number>} expected
 * @param {Record<string, number>} actual
 */
export function diffCounts(expected, actual) {
  const missing = [];
  const extra = [];
  const mismatched = [];
  for (const [name, rows] of Object.entries(expected)) {
    if (!(name in actual)) missing.push(name);
    else if (actual[name] !== rows)
      mismatched.push({ table: name, expected: rows, actual: actual[name] });
  }
  for (const name of Object.keys(actual)) {
    if (!(name in expected)) extra.push(name);
  }
  const ok = missing.length === 0 && extra.length === 0 && mismatched.length === 0;
  return { ok, missing, extra, mismatched };
}

/** @param {number} bytes */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * Absolute output path. A path ending in `.sql` is a file; anything else is a
 * directory. `backups/` is git-ignored, because a dump contains customer data.
 *
 * @param {string | undefined} out
 * @param {string} database
 * @param {"local" | "remote"} mode
 * @param {Date} now
 */
export function resolveOutput(out, database, mode, now) {
  const stamp = now
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d+Z$/, "Z");
  if (out?.endsWith(".sql")) return resolve(process.cwd(), out);
  const dir = resolve(process.cwd(), out ?? "backups");
  return resolve(dir, `${database}-${mode}-${stamp}.sql`);
}

/** @param {string} path */
export function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true });
}
