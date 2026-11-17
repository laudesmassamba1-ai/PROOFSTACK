#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * Build a self-contained, globally installable PROOFSTACK CLI.
 *
 * The workspace packages are ESM and reference each other with `workspace:*`.
 * Publishing them one by one would make `npm install -g` depend on twelve separate
 * releases. This script bundles the CLI and every workspace/runtime dependency into
 * one ESM file, then writes a minimal package manifest with no dependencies.
 *
 * Usage:
 *   node tooling/scripts/package-cli.mjs
 *   pnpm cli:package
 */
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cliDir = join(root, "packages/cli");
const releaseDir = join(cliDir, "release");
const artifactsDir = join(root, "artifacts");
const cliPackage = JSON.parse(await readFile(join(cliDir, "package.json"), "utf8"));
const version = cliPackage.version;

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

console.log("PROOFSTACK CLI — build standalone release");

// Build every workspace package first: esbuild resolves @proofstack/* through the
// package `main` fields, so their dist files must exist and match the source.
run(process.execPath, [join(root, "tooling/scripts/build.mjs")], root);

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });
await mkdir(artifactsDir, { recursive: true });

const bundlePath = join(releaseDir, "proofstack.js");
await build({
  absWorkingDir: root,
  entryPoints: [join(cliDir, "src/index.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "inline",
  logLevel: "info",
});
await chmod(bundlePath, 0o755);

await cp(join(root, "LICENSE"), join(releaseDir, "LICENSE"));
await writeFile(
  join(releaseDir, "README.md"),
  `# PROOFSTACK CLI

The PROOFSTACK terminal client: project setup, module execution, reports, sync and
the interactive console.

## Install globally

\`\`\`bash
npm install -g ./proofstack-cli-${version}.tgz
proofstack --version
\`\`\`

Requires Node.js 22.18 or newer. The tarball is self-contained: it has no runtime
npm dependencies.

## First use in an application

\`\`\`bash
proofstack --cwd /path/to/your/app init
proofstack --cwd /path/to/your/app doctor
proofstack --cwd /path/to/your/app test --module world,flow,exit
proofstack --cwd /path/to/your/app report text
\`\`\`

The interactive console:

\`\`\`bash
proofstack login
proofstack
\`\`\`

A skipped case is not a pass. Exit codes: 0 pass, 1 defect, 2 harness error or
invalid configuration, 3 cancelled.
`,
  "utf8"
);

await writeFile(
  join(releaseDir, "package.json"),
  `${JSON.stringify(
    {
      name: "@proofstack/cli",
      version,
      description: cliPackage.description,
      license: "MPL-2.0",
      type: "module",
      bin: { proofstack: "proofstack.js" },
      files: ["proofstack.js", "README.md", "LICENSE"],
      engines: { node: ">=22.18.0" },
      publishConfig: { access: "public" },
      keywords: ["proofstack", "testing", "quality", "reliability", "cli"],
    },
    null,
    2
  )}\n`,
  "utf8"
);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(npm, ["pack", "--pack-destination", artifactsDir], releaseDir);

const tarball = join(artifactsDir, `proofstack-cli-${version}.tgz`);
console.log(`\nCreated ${tarball}`);
console.log(`Install: npm install -g ${tarball}`);
