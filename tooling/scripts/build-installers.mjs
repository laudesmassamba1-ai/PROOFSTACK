/**
 * Builds the installers: one file per platform, which is the whole point.
 *
 * A binary next to an install script is two things to explain. What we ship instead:
 *
 *   proofcore-0.2.0-setup-win-x64.exe    double-click; installs for the current user
 *   proofcore-0.2.0-installer-linux-x64.run   chmod +x, run; installs and updates PATH
 *   proofcore_0.2.0_amd64.deb            sudo dpkg -i, for Debian, Ubuntu, Linux Mint
 *
 * The Windows setup is itself a SEA binary (Node runtime + installer script) with the real
 * CLI appended after it: one .exe carries the installer and its payload. The .run is a
 * shell header followed by a tar.gz, the oldest trick that still works everywhere.
 *
 *   node tooling/scripts/build-installers.mjs --target win-x64
 *   node tooling/scripts/build-installers.mjs --target linux-x64
 *   node tooling/scripts/build-installers.mjs --all
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const binDir = join(root, "artifacts", "bin");
const outDir = join(root, "artifacts", "installers");
const cache = join(root, "artifacts", ".cache");
const work = join(root, "artifacts", ".work");

// The CLI's own version, not the monorepo's: the installer must name the version it installs.
const cliPackage = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8"));
const version = process.env.PROOFCORE_VERSION ?? cliPackage.version ?? "0.0.0";

const MARKER = "PROOFCORE_PAYLOAD_V1";

const TARGETS = {
  "win-x64": { binary: "proofcore-win-x64.exe", runtime: "runtime-win-x64.exe", arch: "amd64" },
  "linux-x64": { binary: "proofcore-linux-x64", runtime: "runtime-linux-x64", arch: "amd64" },
  "linux-arm64": { binary: "proofcore-linux-arm64", runtime: "runtime-linux-arm64", arch: "arm64" },
  "darwin-x64": { binary: "proofcore-darwin-x64", runtime: "runtime-darwin-x64", arch: "amd64" },
  "darwin-arm64": {
    binary: "proofcore-darwin-arm64",
    runtime: "runtime-darwin-arm64",
    arch: "arm64",
  },
};

const say = (message) => process.stdout.write(`\u001b[2m▸\u001b[0m ${message}\n`);
const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: "inherit", cwd: root, ...options });

function ensureBinary(target) {
  const spec = TARGETS[target];
  const binary = join(binDir, spec.binary);
  const runtime = join(cache, spec.runtime);
  if (!existsSync(binary) || !existsSync(runtime)) {
    say(`building ${target} first`);
    run(process.execPath, [join(root, "tooling/scripts/build-binary.mjs"), "--target", target]);
  }
  if (!existsSync(binary)) throw new Error(`missing binary: ${binary}`);
  if (!existsSync(runtime))
    throw new Error(`missing runtime: ${runtime} (needed to build the setup)`);
  return { binary, runtime };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Writes the .sha256 next to an artifact, in the format `sha256sum -c` reads. */
function writeChecksum(path) {
  const digest = sha256(readFileSync(path));
  writeFileSync(`${path}.sha256`, `${digest}  ${path.split("/").pop()}\n`);
  const size = (readFileSync(path).length / 1024 / 1024).toFixed(1);
  say(`${path.split("/").pop()}  ${size} MB  sha256 ${digest.slice(0, 12)}…`);
}

/** Windows: a SEA binary that installs the payload appended to itself. */
function buildWindowsSetup(target) {
  const { binary, runtime } = ensureBinary(target);
  mkdirSync(work, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  say("bundling the installer script");
  const installerJs = join(work, "installer.cjs");
  run(join(root, "node_modules/.bin/esbuild"), [
    join(root, "packaging/installer-main.mjs"),
    "--bundle",
    "--platform=node",
    "--target=node20",
    "--format=cjs",
    `--outfile=${installerJs}`,
    "--log-level=warning",
  ]);

  say("creating the installer SEA blob");
  const config = join(work, "installer-sea.json");
  const blob = join(work, "installer.blob");
  writeFileSync(
    config,
    JSON.stringify({
      main: installerJs,
      output: blob,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      // The installer reads its own executable to find the payload.
      assets: {},
    })
  );
  run(process.execPath, ["--experimental-sea-config", config]);

  const setup = join(outDir, `proofcore-${version}-setup-${target}.exe`);
  copyFileSync(runtime, setup);
  run(join(root, "node_modules/.bin/postject"), [
    setup,
    "NODE_SEA_BLOB",
    blob,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ]);

  say("appending the CLI payload");
  const payload = gzipSync(readFileSync(binary), { level: 9 });
  const header = Buffer.from(
    JSON.stringify({
      version,
      target,
      uncompressed: readFileSync(binary).length,
      compressed: true,
      length: payload.length,
      sha256: sha256(payload),
    }),
    "utf8"
  );
  const lengthPrefix = Buffer.alloc(4);
  lengthPrefix.writeUInt32LE(header.length);
  writeFileSync(
    setup,
    Buffer.concat([readFileSync(setup), Buffer.from(MARKER, "utf8"), lengthPrefix, header, payload])
  );
  // Verify what we just produced, by reading it the way the installer will. A setup file
  // that cannot find its own payload is a file someone double-clicks and nothing happens.
  const produced = readFileSync(setup);
  const markerIndex = produced.lastIndexOf(Buffer.from(MARKER, "utf8"));
  if (markerIndex < 0) throw new Error("setup file has no payload marker");
  const headerLength = produced.readUInt32LE(markerIndex + MARKER.length);
  const parsed = JSON.parse(
    produced
      .subarray(markerIndex + MARKER.length + 4, markerIndex + MARKER.length + 4 + headerLength)
      .toString("utf8")
  );
  const payloadBytes = produced.subarray(
    markerIndex + MARKER.length + 4 + headerLength,
    markerIndex + MARKER.length + 4 + headerLength + parsed.length
  );
  if (parsed.sha256 !== sha256(payloadBytes)) throw new Error("setup payload checksum mismatch");
  if (gunzipSync(payloadBytes).length !== parsed.uncompressed)
    throw new Error("setup payload does not inflate to the binary");
  say(`verified: the setup carries a ${(parsed.uncompressed / 1024 / 1024).toFixed(0)} MB binary`);
  writeChecksum(setup);
  return setup;
}

/** Linux/macOS: a shell header, then a tar.gz of the binary and the install script. */
function buildShellInstaller(target) {
  const { binary } = ensureBinary(target);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(work, { recursive: true });

  const stage = join(work, `run-${target}`);
  mkdirSync(stage, { recursive: true });
  copyFileSync(binary, join(stage, `proofcore-${target}`));
  copyFileSync(join(root, "packaging/install.sh"), join(stage, "install.sh"));
  chmodSync(join(stage, "install.sh"), 0o755);
  chmodSync(join(stage, `proofcore-${target}`), 0o755);

  const archive = join(work, `payload-${target}.tar.gz`);
  run("tar", ["-czf", archive, "-C", stage, "."]);

  const head = `#!/bin/sh
# PROOFCORE ${version} installer (${target})
#
# One file. Extracts the binary and the installer to a temporary folder, installs to
# ~/.local/share/proofcore by default, and adds that folder to your PATH.
#
#   chmod +x this-file && ./this-file
#   PROOFCORE_PREFIX=/opt/proofcore ./this-file     # choose the location
set -e
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
line="$(awk '/^__PROOFCORE_PAYLOAD_BELOW__$/ { print NR + 1; exit 0; }' "$0")"
tail -n +"$line" "$0" | tar -xzf - -C "$tmp"
"$tmp/install.sh" "$@"
exit 0
__PROOFCORE_PAYLOAD_BELOW__
`;
  const runFile = join(outDir, `proofcore-${version}-installer-${target}.run`);
  writeFileSync(runFile, Buffer.concat([Buffer.from(head, "utf8"), readFileSync(archive)]));
  chmodSync(runFile, 0o755);
  writeChecksum(runFile);
  return runFile;
}

/** Debian package: what `apt install ./file.deb` expects, for Linux Mint and friends. */
function buildDeb(target) {
  const { binary } = ensureBinary(target);
  const spec = TARGETS[target];
  const stage = join(work, `deb-${target}`);
  const control = join(stage, "DEBIAN");
  mkdirSync(join(stage, "usr", "bin"), { recursive: true });
  mkdirSync(control, { recursive: true });
  copyFileSync(binary, join(stage, "usr", "bin", "proofcore"));
  chmodSync(join(stage, "usr", "bin", "proofcore"), 0o755);

  writeFileSync(
    join(control, "control"),
    `${[
      "Package: proofcore",
      `Version: ${version}`,
      `Architecture: ${spec.arch}`,
      "Maintainer: PROOFCORE <support@proofcore.dev>",
      `Installed-Size: ${Math.round(readFileSync(binary).length / 1024)}`,
      "Section: devel",
      "Priority: optional",
      "Description: software quality and reliability",
      " PROOFCORE checks compatibility, transaction reliability and data portability,",
      " audits HTTP security and UI quality, and gives your AI assistant the same tools",
      " locally. Compute runs on this machine; the account is only used for sign-in,",
      " projects, reports and billing.",
      "Homepage: https://proofstack-iota.vercel.app",
    ].join("\n")}\n`
  );
  writeFileSync(
    join(control, "postinst"),
    [
      "#!/bin/sh",
      "set -e",
      "if [ -x /usr/bin/proofcore ]; then",
      "  /usr/bin/proofcore --version >/dev/null 2>&1 || true",
      "fi",
      "exit 0",
      "",
    ].join("\n")
  );
  chmodSync(join(control, "postinst"), 0o755);

  mkdirSync(outDir, { recursive: true });
  const deb = join(outDir, `proofcore_${version}_${spec.arch}.deb`);
  run("dpkg-deb", ["--root-owner-group", "--build", stage, deb]);
  writeChecksum(deb);
  return deb;
}

const args = process.argv.slice(2);
const all = args.includes("--all");
// `--target` may repeat: building several installers in one run is the normal case.
const selected = all
  ? ["win-x64", "linux-x64", "linux-arm64", "darwin-arm64", "darwin-x64"]
  : args.flatMap((arg, index) => (arg === "--target" ? [args[index + 1]] : []));
if (!selected.length)
  selected.push(`${process.platform === "win32" ? "win" : process.platform}-${process.arch}`);

for (const target of selected) {
  if (!TARGETS[target]) throw new Error(`unknown target ${target}`);
  if (target.startsWith("win")) buildWindowsSetup(target);
  else buildShellInstaller(target);
  if (target.startsWith("linux") && process.platform === "linux") buildDeb(target);
}

say(`installers in ${outDir}`);
