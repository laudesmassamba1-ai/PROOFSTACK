#!/usr/bin/env node
/**
 * Topological TypeScript build orchestrator for the PROOFCORE monorepo.
 *
 * Internal packages are ESM/NodeNext: a package can only be emitted after every
 * @proofcore/* dependency it imports has been emitted (its .d.ts must exist).
 * Packages at the same topological level are built in parallel.
 *
 * Usage:
 *   node tooling/scripts/build.mjs            # emit dist for every package
 *   node tooling/scripts/build.mjs --noEmit   # typecheck only
 */
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const noEmit = process.argv.includes("--noEmit");
const GROUPS = ["packages", "packages/modules", "packages/adapters", "apps"];

/** @typedef {{ name: string, dir: string, deps: string[] }} Node */

async function collect() {
  /** @type {Map<string, Node>} */
  const nodes = new Map();
  for (const group of GROUPS) {
    const base = join(root, group);
    let entries = [];
    try {
      entries = await readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = join(base, e.name);
      let pkg;
      try {
        pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
      } catch {
        continue;
      }
      if (!pkg.name || pkg.privateBuild === false) continue;
      // Apps that are not plain-tsc packages (web) opt out with "buildOrder": false
      if (pkg.buildOrder === false) continue;
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) =>
        d.startsWith("@proofcore/")
      );
      nodes.set(pkg.name, { name: pkg.name, dir, deps });
    }
  }
  return nodes;
}

function topo(nodes) {
  /** @type {string[][]} */
  const levels = [];
  const done = new Set();
  let remaining = [...nodes.values()];
  while (remaining.length) {
    const ready = remaining.filter((n) => n.deps.every((d) => done.has(d) || !nodes.has(d)));
    if (ready.length === 0) {
      throw new Error(`Dependency cycle among: ${remaining.map((n) => n.name).join(", ")}`);
    }
    levels.push(ready.map((n) => n.name));
    for (const n of ready) done.add(n.name);
    remaining = remaining.filter((n) => !done.has(n.name));
  }
  return levels;
}

function run(dir, args) {
  return new Promise((res, rej) => {
    const child = spawn(
      process.execPath,
      [join(root, "node_modules/typescript/bin/tsc"), ...args],
      { cwd: dir, stdio: "inherit", env: process.env }
    );
    child.on("exit", (code) =>
      code === 0 ? res() : rej(new Error(`tsc failed in ${dir} (exit ${code})`))
    );
  });
}

const nodes = await collect();
if (nodes.size === 0) {
  console.error("build.mjs: no packages discovered — check pnpm-workspace.yaml");
  process.exit(1);
}
const levels = topo(nodes);
console.log(
  `proofcore build (${noEmit ? "typecheck" : "emit"}) — ${nodes.size} packages, ${levels.length} levels`
);
for (const [i, level] of levels.entries()) {
  console.log(`\n── level ${i + 1}: ${level.join(", ")}`);
  await Promise.all(
    level.map((name) => {
      const node = nodes.get(name);
      const args = noEmit ? ["-p", "tsconfig.json", "--noEmit"] : ["-p", "tsconfig.json"];
      return run(node.dir, args).then(
        () => console.log(`   ok  ${name}`),
        (err) => {
          console.error(`   FAIL ${name}`);
          throw err;
        }
      );
    })
  );
}
console.log(`\n✔ ${noEmit ? "typecheck" : "build"} complete`);
