#!/usr/bin/env node
/**
 * Install the newest locally-built standalone CLI tarball globally.
 *
 * Usage:
 *   pnpm cli:package && node tooling/scripts/install-cli.mjs
 *   pnpm cli:install
 */
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifactsDir = join(root, "artifacts");

let entries;
try {
  entries = await readdir(artifactsDir, { withFileTypes: true });
} catch {
  console.error("No artifacts directory. Run `pnpm cli:package` first.");
  process.exit(2);
}

const tarballs = entries
  .filter((entry) => entry.isFile() && /^proofcore-cli-\d+\.\d+\.\d+\.tgz$/.test(entry.name))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const latest = tarballs.at(-1);
if (!latest) {
  console.error("No proofcore-cli-*.tgz found. Run `pnpm cli:package` first.");
  process.exit(2);
}

const path = join(artifactsDir, latest);
console.log(`Installing ${path} globally…`);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["install", "-g", path], { stdio: "inherit", env: process.env });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const check = spawnSync("proofcore", ["--version"], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});
if (check.error) {
  console.error("The package installed, but `proofcore` is not on PATH.");
  console.error("Add your npm global bin directory to PATH, then run `proofcore --version`.");
  process.exit(1);
}
process.exit(check.status ?? 1);
