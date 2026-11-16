/**
 * The database port.
 *
 * Deliberately D1-shaped: `prepare().bind().all()/first()/run()`. Cloudflare D1
 * provides that interface natively, and a ~40-line adapter gives Node's built-in
 * SQLite the same one. Everything above this boundary is identical in production and
 * in tests, so a query that passes locally runs on D1.
 *
 * SQL is written by hand rather than through an ORM: two runtimes, one dialect, and
 * an explicit place where a tenant-scoped query is written. The trade-off is
 * documented in docs/ARCHITECTURE.md — migrations stay plain, reviewable SQL.
 */

export interface DbStatement {
  bind(...values: readonly unknown[]): DbStatement;
  all<T = Record<string, unknown>>(): Promise<T[]>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ changes: number }>;
}

export interface Database {
  prepare(sql: string): DbStatement;
}

/** D1 rejects booleans; convert at the boundary rather than scattering 0/1 ints. */
export function bool(value: boolean): number {
  return value ? 1 : 0;
}

export function json(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Rows always come back with snake_case columns; map explicitly per entity. */
export type Row = Record<string, unknown>;

export function str(row: Row, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

export function num(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}

export function nullableStr(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
