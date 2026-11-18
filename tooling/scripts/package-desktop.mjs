/**
 * Builds the native package for the machine running the command.
 *
 * The app installer is a per-OS artifact: Electron packages Windows as an NSIS .exe and
 * Linux as .deb + AppImage. The web build and the CLI sidecar are prerequisites in both
 * cases, and `apps/desktop/package.json` owns those scripts so a local run and CI run the
 * same commands.
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const script =
  process.env.PROOFCORE_DESKTOP_TARGET ??
  (process.platform === "win32"
    ? "dist:win"
    : process.platform === "darwin"
      ? "dist:mac"
      : "dist:linux");

const result = spawnSync("pnpm", ["--filter", "@proofcore/desktop", script], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`desktop packaging failed (${script}, exit ${result.status})`);
}

process.stdout.write(`\nDesktop artifacts are in ${join(root, "artifacts", "desktop")}\n`);
