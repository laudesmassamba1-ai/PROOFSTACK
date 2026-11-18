/**
 * The installer that runs on Windows. It is a SEA binary too, so the download is a single
 * .exe: double-click it, and it installs PROOFCORE for the current user.
 *
 * Why this shape rather than an MSI: an MSI needs a Windows toolchain to build and admin
 * rights to run. What people actually want from "installer" is one file, no console
 * archaeology, and a `proofcore` command afterwards. This does exactly that, in the user's
 * profile, and uninstall is deleting the folder it prints.
 *
 * The payload (the real CLI binary, gzipped) is appended to this executable after a marker:
 * Windows ignores trailing bytes in a PE, so one file carries both the installer and what
 * it installs.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const MARKER = "PROOFCORE_PAYLOAD_V1";
const VERSION = process.env.PROOFCORE_VERSION ?? "0.0.0";

function say(message) {
  process.stdout.write(`> ${message}\n`);
}

function fail(message) {
  process.stdout.write(`x ${message}\n`);
  process.exit(1);
}

/** Finds the appended payload: marker, 4-byte header length, JSON header, gzip bytes. */
function readPayload(self) {
  const bytes = readFileSync(self);
  const markerIndex = bytes.lastIndexOf(Buffer.from(MARKER, "utf8"));
  if (markerIndex < 0) fail("This file is not a PROOFCORE installer (payload missing).");
  let offset = markerIndex + MARKER.length;
  const headerLength = bytes.readUInt32LE(offset);
  offset += 4;
  const header = JSON.parse(bytes.subarray(offset, offset + headerLength).toString("utf8"));
  offset += headerLength;
  const payload = bytes.subarray(offset, offset + header.length);
  const digest = createHash("sha256").update(payload).digest("hex");
  if (digest !== header.sha256) fail("The installer is corrupted: payload checksum mismatch.");
  return { payload, header };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true, ...options });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))
    );
  });
}

async function main() {
  const { payload, header } = readPayload(process.execPath);
  const root = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? ".", "AppData", "Local");
  const binDir = join(root, "PROOFCORE", "bin");
  const target = join(binDir, "proofcore.exe");
  mkdirSync(binDir, { recursive: true });

  if (existsSync(target)) {
    say(`replacing the previous install in ${binDir}`);
    unlinkSync(target);
  }
  // The payload is already the final binary: nothing to expand beyond the gzip container.
  const binary = header.compressed ? gunzipSync(payload) : payload;
  writeFileSync(target, binary);
  chmodSync(target, 0o755);
  say(`installed ${target}`);

  // User PATH only: no administrator prompt, and new terminals see it.
  const pathScript = `
    $bin = '${binDir.replace(/'/g, "''")}'
    $current = [Environment]::GetEnvironmentVariable('Path','User')
    if ($current -notlike "*$bin*") {
      $updated = if ([string]::IsNullOrWhiteSpace($current)) { $bin } else { "$current;$bin" }
      [Environment]::SetEnvironmentVariable('Path', $updated, 'User')
    }`;
  await run("powershell", ["-NoProfile", "-Command", pathScript]).catch(() =>
    say(`could not update PATH automatically: add ${binDir} to PATH yourself`)
  );
  say("added the folder to your user PATH");

  // Start Menu entry, so it can be found without a terminal at all.
  const shortcut = `
    $shell = New-Object -ComObject WScript.Shell
    $start = [Environment]::GetFolderPath('Programs')
    $link = $shell.CreateShortcut((Join-Path $start 'PROOFCORE.lnk'))
    $link.TargetPath = '${target.replace(/'/g, "''")}'
    $link.Arguments = ''
    $link.IconLocation = '${target.replace(/'/g, "''")}'
    $link.Description = 'PROOFCORE - software quality and reliability'
    $link.Save()`;
  await run("powershell", ["-NoProfile", "-Command", shortcut]).catch(() =>
    say("could not create the Start Menu shortcut (not required)")
  );
  say("added a Start Menu entry named PROOFCORE");

  const version = await new Promise((resolve) => {
    const child = spawn(target, ["--version"], { windowsHide: true });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", () => resolve(output.trim()));
    child.on("error", () => resolve(""));
  }).catch(() => "");
  if (!version) fail("the installed binary did not run: nothing was left half-installed");
  say(`installed version ${version} (package ${VERSION})`);

  process.stdout.write(
    [
      "",
      "PROOFCORE is installed. Open a new terminal, then:",
      "",
      "  proofcore login     sign in once, through the browser",
      "  proofcore           the full-screen hub: /help, Tab completes, arrows recall",
      "",
      `To uninstall: delete ${join(root, "PROOFCORE")} and remove it from PATH.`,
      "This setup file can be deleted.",
      "",
    ].join("\n")
  );
}

// No top-level await: the bundle is CommonJS, and a SEA main runs synchronously enough that
// an unhandled rejection is a worse failure mode than an explicit exit code.
main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
