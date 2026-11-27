import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { migrate } from "./db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "./db/node-sqlite.js";
import { runLocalScenario } from "./local-browser.js";
import { createLocalBrowserAgent } from "./local-browser-agent.js";

/**
 * Local development server.
 *
 * Uses Node's built-in SQLite with the same schema D1 gets, and the sandbox payment
 * provider unless real SasPay test credentials are present. It exists so the whole
 * product runs with zero paid infrastructure — not as a mock of the production path.
 */
async function main(): Promise<void> {
  // `:memory:` is a SQLite sentinel, not a path. Resolving it first turns it into
  // `/abs/path/:memory:`, which SQLite happily creates as a *file* — so a run meant to
  // be throwaway silently persists to disk. Keep the sentinel intact.
  const requested = process.env.DATA_PATH ?? ".proofcore/api.db";
  const dataPath = requested === ":memory:" ? ":memory:" : resolve(requested);
  if (dataPath !== ":memory:") mkdirSync(dirname(dataPath), { recursive: true });

  const db = NodeSqliteDatabase.open(dataPath);
  const applied = await migrate(db, migrationFiles());
  if (applied.length > 0) console.log(`[api] applied migrations: ${applied.join(", ")}`);

  const { app, services } = createApp({ db });
  // The Worker has Cloudflare's BROWSER binding; this server has the machine's Chromium.
  // Injecting the CLI's own engine keeps one execution path and avoids a paid service.
  services.localScenario = runLocalScenario;
  services.browserAgent = createLocalBrowserAgent();
  const port = Number(process.env.PORT ?? 8787);
  const capabilities = services.provider.getCapabilities();

  serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" }, (info) => {
    console.log(`[api] listening on http://127.0.0.1:${info.port}`);
    console.log(`[api] database: ${dataPath}`);
    console.log(
      `[api] payments: ${capabilities.displayName} (${capabilities.provider === "sandbox" ? "sandbox" : "live adapter"})`
    );
    if (capabilities.provider === "sandbox") {
      console.log(
        "[api] SASPAY_API_KEY / SASPAY_WEBHOOK_SECRET are not set: checkout uses scripted sandbox outcomes."
      );
    }
    console.log(`[api] allowed web origin: ${services.config.webOrigin}`);
    console.log("[api] browser: local Chromium over CDP (FLOW scenarios)");
  });
}

main().catch((error: unknown) => {
  console.error(
    "[api] failed to start",
    error instanceof Error ? (error.stack ?? error.message) : error
  );
  process.exitCode = 1;
});
