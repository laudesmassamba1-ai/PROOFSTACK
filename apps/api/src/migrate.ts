import { resolve } from "node:path";
import { migrate } from "./db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "./db/node-sqlite.js";

/**
 * Local migration runner.
 *
 * Remote D1 migrations are applied by Wrangler (`pnpm db:migrate:remote`), which reads
 * the same files in `migrations/`. The `schema_migrations` table means running this
 * twice is a no-op.
 */
async function main(): Promise<void> {
  const path = resolve(
    process.argv.find((arg) => arg.endsWith(".db")) ?? process.env.DATA_PATH ?? ".proofstack/api.db"
  );
  const db = NodeSqliteDatabase.open(path);
  const applied = await migrate(db, migrationFiles());
  console.log(applied.length > 0 ? `Applied: ${applied.join(", ")}` : "No pending migrations.");
  db.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
