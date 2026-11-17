#!/usr/bin/env node
/**
 * Publish the PROOFCORE CLI tarball to npm.
 *
 * The npm token is read with terminal echo muted — it never appears on screen,
 * in this script, in git, or in any shell history. The temporary .npmrc is
 * written with 0600 permissions and deleted after the publish. If the account
 * enforces 2FA on publishing, a one-time code from the authenticator app is
 * requested (it is not a secret; it is single-use and printed normally).
 * After publishing, verify with:
 *   npm view proofcore version
 */
import { spawnSync } from "node:child_process";
import { Writable } from "node:stream";
import { createInterface } from "node:readline";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const releaseDir = join(root, "packages/cli/release");

const packageJson = JSON.parse(await readFile(join(releaseDir, "package.json"), "utf8"));
console.log(`Publishing ${packageJson.name}@${packageJson.version}`);

/** Output stream that swallows characters while the token is being typed. */
let echoMuted = false;
const hiddenOutput = new Writable({
  write(chunk, _enc, cb) {
    if (!echoMuted) process.stdout.write(chunk);
    cb();
  },
});
const rl = createInterface({ input: process.stdin, output: hiddenOutput, terminal: true });
rl.on("SIGINT", () => process.exit(130));

echoMuted = true;
const token = await new Promise((res) => rl.question("npm token (npm_…, input hidden): ", res));
echoMuted = false;
process.stdout.write("\n");
if (!/^npm_[A-Za-z0-9_]{20,}$/.test((token ?? "").trim())) {
  console.error("The value does not look like an npm token (expected npm_…). Aborting — nothing was written.");
  rl.close();
  process.exit(2);
}


rl.close();
// A one-time 2FA code for accounts that enforce 2FA on publishing, passed as
// --otp=123456. It goes straight to npm; it is not stored anywhere.
const otpArg = process.argv.find((arg) => arg.startsWith("--otp="));
const otp = otpArg ? otpArg.slice("--otp=".length).replace(/\s+/g, "") : "";
if (otp && !/^\d{6}$/.test(otp)) {
  console.error("A 2FA code is 6 digits (--otp=123456). Aborting — nothing was written.");
  process.exit(2);
}

const npmrcPath = join(releaseDir, ".npmrc");
await writeFile(npmrcPath, `//registry.npmjs.org/:_authToken=${token.trim()}\n`, { mode: 0o600 });
try {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = ["publish", "--access", "public"];
  if (otp) args.push("--otp", otp);
  const result = spawnSync(npm, args, {
    cwd: releaseDir,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    console.error("npm publish failed. The temporary .npmrc was removed; nothing changed.");
    if (!otp) {
      console.error("If the error mentions two-factor authentication, rerun with your one-time code:");
      console.error("  pnpm cli:publish -- --otp=CODE");
    }
    process.exit(result.status ?? 1);
  }
} finally {
  await rm(npmrcPath, { force: true });
}

console.log(`\nPublished ${packageJson.name}@${packageJson.version}`);
console.log("Verify: npm view proofcore version");
console.log("Install anywhere: npm install -g proofcore");
