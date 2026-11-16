import type { Database, DbStatement } from "./types.js";

/**
 * Cloudflare D1 already provides `prepare().bind().all()/first()/run()`, but its
 * signatures return D1 envelopes. This thin adapter normalises them to the port so no
 * repository code has to know which runtime it is in.
 */
type D1Like = {
  prepare(sql: string): {
    bind(...values: readonly unknown[]): {
      all<T>(): Promise<{ results?: T[] }>;
      first<T>(): Promise<T | null>;
      run(): Promise<{ meta?: { changes?: number } }>;
    };
  };
};

export function d1Database(db: D1Like): Database {
  return {
    prepare(sql: string): DbStatement {
      const statement = db.prepare(sql);
      let bound: readonly unknown[] = [];
      const normalized: DbStatement = {
        bind: (...values: readonly unknown[]) => {
          bound = values;
          return normalized;
        },
        all: async <T>() => {
          const result = await statement.bind(...bound).all<T>();
          return result.results ?? [];
        },
        first: async <T>() => statement.bind(...bound).first<T>(),
        run: async () => {
          const result = await statement.bind(...bound).run();
          return { changes: Number(result.meta?.changes ?? 0) };
        },
      };
      return normalized;
    },
  };
}

export function splitStatements(sql: string): string[] {
  const withoutLineComments = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  return withoutLineComments
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** Apply pending migrations, recording each one. Used by local dev and by tests. */
export async function migrate(
  db: Database,
  migrations: { id: string; sql: string }[]
): Promise<string[]> {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
    )
    .run();
  const applied = new Set(
    (await db.prepare("SELECT id FROM schema_migrations").all<{ id: string }>()).map(
      (row) => row.id
    )
  );
  const done: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    // Neither D1 nor node:sqlite executes a multi-statement string through
    // `prepare`, so a migration is split into statements. Line comments are removed
    // first: a semicolon inside a comment is not a terminator, and a comment-only
    // chunk is not a statement.
    for (const statement of splitStatements(migration.sql)) {
      await db.prepare(statement).run();
    }
    await db
      .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
      .bind(migration.id, new Date().toISOString())
      .run();
    done.push(migration.id);
  }
  return done;
}
