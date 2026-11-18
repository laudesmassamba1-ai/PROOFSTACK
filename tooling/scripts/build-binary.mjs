/**
 * Builds a single self-contained `proofcore` executable, with no Node.js install required.
 *
 * Why a binary at all: `npm install -g` is fine on a machine that already has Node, and
 * useless on a Windows laptop that does not. The people this is for want to double-click
 * something, or run one install script, and have the tool work - the same tool, connected
 * to the same account.
 *
 * How: Node's built-in Single Executable Application. The CLI is bundled to one CommonJS
 * file with esbuild, turned into a SEA blob, and injected next to the runtime of a Node
 * binary with postject. Nothing is reimplemented: it is the same code the npm package runs,
 * with the runtime glued in front of it.
 *
 * Cross-building works because the blob is architecture-independent: only the host Node
 * binary differs, so we download the one we are targeting from nodejs.org.
 *
 *   node tooling/scripts/build-binary.mjs                        # this machine
 *   node tooling/scripts/build-binary.mjs --target win-x64       # proofcore.exe, from Linux
 *   node tooling/scripts/build-binary.mjs --all                  # every target to ship
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
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(root, "artifacts", "bin");
const work = join(tmpdir(), `proofcore-sea-${process.pid}`);

/** Node's own version decides the runtime we embed: same major as the one that builds. */
const NODE_VERSION = process.version.replace(/^v/, "");

const TARGETS = {
  "linux-x64": {
    node: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz`,
    extract: "tar.xz",
    binary: "node",
    name: "proofcore-linux-x64",
  },
  "linux-arm64": {
    node: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz`,
    extract: "tar.xz",
    binary: "node",
    name: "proofcore-linux-arm64",
  },
  "darwin-x64": {
    node: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-x64.tar.gz`,
    extract: "tar.gz",
    binary: "node",
    name: "proofcore-darwin-x64",
  },
  "darwin-arm64": {
    node: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    extract: "tar.gz",
    binary: "node",
    name: "proofcore-darwin-arm64",
  },
  "win-x64": {
    node: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`,
    extract: "zip",
    binary: "node.exe",
    name: "proofcore-win-x64.exe",
  },
};

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: "inherit", cwd: root, ...options });
}

function hostTarget() {
  const platform = process.platform === "win32" ? "win" : process.platform;
  return `${platform}-${process.arch}`;
}

function step(message) {
  process.stdout.write(`\u001b[2m▸\u001b[0m ${message}\n`);
}

/** One file, CommonJS, no dependency on the repository's node_modules. */
function bundle() {
  step("bundling the CLI");
  const output = join(work, "proofcore.cjs");
  run(join(root, "node_modules/.bin/esbuild"), [
    join(root, "packages/cli/src/index.ts"),
    "--bundle",
    "--platform=node",
    "--target=node20",
    "--format=cjs",
    `--outfile=${output}`,
    // Native and optional modules stay external: they are resolved at run time, and a
    // bundled native addon would be the one thing that cannot be injected into a binary.
    "--external:playwright",
    "--external:playwright-core",
    "--external:@playwright/test",
    "--external:ws",
    "--log-level=warning",
  ]);
  return output;
}

function seaBlob(entry) {
  step("creating the SEA blob");
  const config = join(work, "sea-config.json");
  writeFileSync(
    config,
    JSON.stringify(
      {
        main: entry,
        output: join(work, "sea-prep.blob"),
        // The CLI reads the filesystem, opens sockets and spawns a browser: disabling the
        // snapshot keeps that honest instead of silently limiting it.
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      },
      null,
      2
    )
  );
  run(process.execPath, ["--experimental-sea-config", config]);
  return join(work, "sea-prep.blob");
}

async function download(url, destination) {
  step(`downloading ${url.split("/").pop()}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${response.status} ${url}`);
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
  return destination;
}

async function runtimeFor(target) {
  const spec = TARGETS[target];
  if (!spec)
    throw new Error(`unknown target ${target} (known: ${Object.keys(TARGETS).join(", ")})`);
  if (target === hostTarget()) return process.execPath;

  const archive = await download(spec.node, join(work, `node-${target}.${spec.extract}`));
  const dir = join(work, `extract-${target}`);
  mkdirSync(dir, { recursive: true });
  if (spec.extract === "zip") run("unzip", ["-q", archive, "-d", dir]);
  else run("tar", ["-xf", archive, "-C", dir]);
  const nested = join(dir, `node-v${NODE_VERSION}-${target}`, spec.binary);
  if (!existsSync(nested)) throw new Error(`runtime binary missing after extraction: ${nested}`);
  return nested;
}

const runtimeCache = join(root, "artifacts", ".cache");

/** Keeps the downloaded runtime around: the installer builder embeds the same binary. */
function cacheRuntime(target, runtime) {
  mkdirSync(runtimeCache, { recursive: true });
  const cached = join(runtimeCache, `runtime-${target}${target.startsWith("win") ? ".exe" : ""}`);
  if (!existsSync(cached)) copyFileSync(runtime, cached);
  return cached;
}

async function buildTarget(target, blob) {
  const spec = TARGETS[target];
  const runtime = await runtimeFor(target);
  cacheRuntime(target, runtime);
  const output = join(outDir, spec.name);
  step(`assembling ${spec.name}`);
  copyFileSync(runtime, output);
  chmodSync(output, 0o755);

  // macOS refuses to run a signed binary whose signature no longer matches, so the
  // signature goes before the injection and comes back after.
  const isMac = target.startsWith("darwin");
  if (isMac) run("codesign", ["--remove-signature", output]);

  run(join(root, "node_modules/.bin/postject"), [
    output,
    "NODE_SEA_BLOB",
    blob,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ...(isMac ? ["--macho-segment-name", "NODE_SEA"] : []),
  ]);

  if (isMac) run("codesign", ["--sign", "-", output]);

  const digest = createHash("sha256").update(readFileSync(output)).digest("hex");
  writeFileSync(`${output}.sha256`, `${digest}  ${spec.name}\n`);
  step(
    `${spec.name}  ${(readFileSync(output).length / 1024 / 1024).toFixed(1)} MB  sha256 ${digest.slice(0, 12)}…`
  );
  return output;
}

const args = process.argv.slice(2);
const all = args.includes("--all");
const flag = args.indexOf("--target");
const targets = all
  ? ["linux-x64", "win-x64", "linux-arm64", "darwin-arm64", "darwin-x64"]
  : [flag >= 0 ? args[flag + 1] : hostTarget()];

mkdirSync(outDir, { recursive: true });
mkdirSync(work, { recursive: true });
const blob = seaBlob(bundle());
for (const target of targets) await buildTarget(target, blob);
process.stdout.write(`\n${existsSync(outDir) ? `Binaries in ${outDir}\n` : ""}`);
