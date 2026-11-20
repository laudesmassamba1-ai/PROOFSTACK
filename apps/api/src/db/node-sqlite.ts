import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Database, DbStatement } from "./types.js";

/**
 * Node's built-in SQLite, wrapped in the D1 statement interface.
 *
 * `node:sqlite` is still flagged experimental in Node 22, so the API's dev script and
 * tests run with `--experimental-sqlite`. It is a development and test runtime only:
 * production is D1.
 */
export class NodeSqliteDatabase implements Database {
  constructor(private readonly db: DatabaseSync) {}

  static open(path = ":memory:"): NodeSqliteDatabase {
    const db = new NodeSqliteDatabase(new DatabaseSync(path));
    db.db.exec("PRAGMA foreign_keys = ON");
    return db;
  }

  prepare(sql: string): DbStatement {
    const statement = this.db.prepare(sql);
    let bound: readonly unknown[] = [];
    const api: DbStatement = {
      bind: (...values: readonly unknown[]) => {
        bound = values.map(normalize);
        return api;
      },
      all: async <T>() => statement.all(...(bound as never[])) as T[],
      first: async <T>() => (statement.get(...(bound as never[])) as T | undefined) ?? null,
      run: async () => {
        const result = statement.run(...(bound as never[]));
        return { changes: Number(result.changes ?? 0) };
      },
    };
    return api;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}

/** node:sqlite accepts null, number, bigint, string, Uint8Array — nothing else. */
function normalize(value: unknown): null | number | bigint | string | Uint8Array {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string")
    return value;
  if (value instanceof Uint8Array) return value;
  throw new TypeError(`Cannot bind ${typeof value} to SQLite`);
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

/** Migration files, ordered. The filename is the version. */
export function migrationFiles(): { id: string; sql: string }[] {
  const names = [
    "0001_init.sql",
    "0002_report_per_run.sql",
    "0003_device_grants.sql",
    "0004_workspace_webhooks.sql",
    "0005_ai_experience.sql",
    "0006_account_lifecycle.sql",
    "0007_provider_kind.sql",
    "0008_browser_sessions.sql",
    "0009_auth_attempts.sql",
    "0010_paged_list_indexes.sql",
    "0011_workspace_invitations.sql",
    "0012_page_audits.sql",
    "0013_audit_ownership.sql",
  ];
  return names.map((name) => ({ id: name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));
}
