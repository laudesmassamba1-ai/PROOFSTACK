/**
 * The desktop app is CommonJS Electron code, not a TypeScript package. `node --check` is
 * the check that matters: it catches a syntax error before `electron-builder` spends
 * minutes packaging a window that cannot start.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
for (const file of [
  "main.cjs",
  "preload.cjs",
  "src/access.cjs",
  "src/store.cjs",
  "src/login-page.cjs",
]) {
  execFileSync(process.execPath, ["--check", join(root, file)], { stdio: "inherit" });
}
process.stdout.write("desktop syntax OK\n");
