#!/usr/bin/env node
/**
 * Start the whole PROOFCORE dev stack as one monolith with fixed ports:
 *   - API (Node 22 SQLite):  http://localhost:8787  (health: /health)
 *   - Web (Vite):            http://localhost:5173  (proxies /api and /v1 to the API)
 * A single Ctrl+C stops both. Each port is configurable through the same env the
 * apps already honour (PORT for the API, DEV_PORT for the web), so a test can
 * spin the stack on alternate ports without editing configs.
 */
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const apiPort = process.env.PORT ?? "8787";
const webPort = process.env.DEV_PORT ?? "5173";
const children = [];

function start(name, cwd, command, args) {
  const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const pipe = (stream) => {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      for (const line of chunk.split("\n")) if (line.trim()) console.log(`[${name}] ${line}`);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on("exit", (code) => {
    if (code !== null && code !== 0 && !stopping) {
      console.error(`[${name}] exited with code ${code}`);
      process.exitCode = 1;
    }
  });
  children.push({ name, child });
}

let stopping = false;
function stop() {
  stopping = true;
  for (const { name, child } of children) {
    console.log(`\nStopping ${name}…`);
    child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 800);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function waitFor(url, name) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        console.log(`✓ ${name} ready: ${url}`);
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`✗ ${name} did not come up on ${url}`);
  process.exitCode = 1;
}

console.log(`PROOFCORE dev stack — api :${apiPort} · web :${webPort}`);
start("api", join(root, "apps/api"), process.execPath, [
  "--experimental-sqlite",
  "--import",
  "tsx/esm",
  "src/node.ts",
]);
start("web", join(root, "apps/web"), "pnpm", [
  "exec",
  "vite",
  "--port",
  webPort,
  "--strictPort",
  "--host",
]);

await waitFor(`http://localhost:${apiPort}/health`, "api");
await waitFor(`http://localhost:${webPort}/`, "web");
console.log("\nStack is up. Press Ctrl+C to stop everything.");
