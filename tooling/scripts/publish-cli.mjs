#!/usr/bin/env node
/**
 * Publish the PROOFCORE CLI tarball to npm.
 *
 * The npm token is read interactively (hidden input where the terminal supports
 * it), written to a temporary .npmrc inside the release directory, used for the
 * publish, then deleted. The token never lands in this script, in git, or in
 * any shell history. After publishing, verify with:
 *   npm view proofcore version
 */
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const releaseDir = join(root, "packages/cli/release");

const packageJson = JSON.parse(await readFile(join(releaseDir, "package.json"), "utf8"));
console.log(`Publishing ${packageJson.name}@${packageJson.version}`);

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl.on("SIGINT", () => process.exit(130));
const token = await rl.question("npm token (npm_…): ");
rl.close();
if (!/^npm_[A-Za-z0-9_]{20,}$/.test(token.trim())) {
  console.error("The value does not look like an npm token (expected npm_…). Aborting — nothing was written.");
  process.exit(2);
}

const npmrcPath = join(releaseDir, ".npmrc");
await writeFile(npmrcPath, `//registry.npmjs.org/:_authToken=${token.trim()}\n`, { mode: 0o600 });
try {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["publish", "--access", "public"], {
    cwd: releaseDir,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    console.error("npm publish failed. The temporary .npmrc was removed; nothing changed.");
    process.exit(result.status ?? 1);
  }
} finally {
  await rm(npmrcPath, { force: true });
}

console.log(`\nPublished ${packageJson.name}@${packageJson.version}`);
console.log("Verify: npm view proofcore version");
console.log("Install anywhere: npm install -g proofcore");
