/**
 * Project-level conflicts: the ones that make a working tool fail on someone's repository.
 *
 * These are the arguments people have with their own project, not with PROOFCORE:
 *
 * - two lockfiles, so npm and pnpm disagree about what is installed;
 * - a `engines.node` range the runtime does not satisfy;
 * - two copies of React in `node_modules` (the "invalid hook call" family of bugs);
 * - `@playwright/test` and `playwright` at different versions, which makes the browser
 *   binary and the test runner disagree;
 * - a framework major the current module knows nothing about.
 *
 * Everything here is decided from files that are already on disk. No network, no guessing.
 * The analysis is pure so the tests are facts, not the machine.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Check } from "./doctor-env.js";

export interface StackFacts {
  /** Parsed package.json, or null when there is none. */
  packageJson: Record<string, unknown> | null;
  /** Every lockfile present at the project root. */
  lockfiles: string[];
  /** Installed versions, by package name; absent when not installed. */
  installed: Record<string, string | null>;
  nodeVersion: string;
  /** Major versions found for react, when it appears twice in the tree. */
  reactDuplicates?: string[];
}

/** A dependency range like `>=18`, `^20`, `22.x` checked against a concrete version. */
export function satisfiesNodeRange(range: string, version: string): boolean {
  const current = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const major = current[0] ?? 0;
  const minor = current[1] ?? 0;
  const patch = current[2] ?? 0;

  return range
    .split("||")
    .map((part) => part.trim())
    .some((alternative) => {
      // Only the operators that appear in real `engines` fields.
      const match = /^(>=|>|<=|<|=|\^|~)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(
        alternative
      );
      if (!match) return false;
      const [, operator = "=", rawMajor, rawMinor, rawPatch] = match;
      const wantMajor = Number(rawMajor);
      const wantMinor = rawMinor && /\d/.test(rawMinor) ? Number(rawMinor) : null;
      const wantPatch = rawPatch && /\d/.test(rawPatch) ? Number(rawPatch) : null;

      const compareTo = (moment: number[], target: number[]) => {
        for (let index = 0; index < 3; index += 1) {
          const difference = (moment[index] ?? 0) - (target[index] ?? 0);
          if (difference !== 0) return difference > 0 ? 1 : -1;
        }
        return 0;
      };

      const target = [wantMajor, wantMinor ?? 0, wantPatch ?? 0];
      const order = compareTo([major, minor, patch], target);

      switch (operator) {
        case ">=":
          return order >= 0;
        case ">":
          return order > 0;
        case "<=":
          return order <= 0;
        case "<":
          return order < 0;
        case "^":
          // Major-pinned: ^18 means 18.x and nothing above, which is what it means for Node.
          return major === wantMajor && (wantMinor === null || minor >= wantMinor);
        case "~":
          return major === wantMajor && (wantMinor === null || minor === wantMinor);
        default:
          return wantMinor === null
            ? major === wantMajor
            : wantPatch === null
              ? major === wantMajor && minor === wantMinor
              : order === 0;
      }
    });
}

export function analyzeStack(facts: StackFacts): Check[] {
  const checks: Check[] = [];
  const pkg = facts.packageJson;

  if (!pkg) {
    checks.push({
      name: "project",
      status: "skip",
      detail: "no package.json here",
      fix: "Run the project checks from a repository root, or `proofcore init` to create a config.",
    });
    return checks;
  }

  const name = typeof pkg.name === "string" ? pkg.name : "unnamed";
  checks.push({ name: "project", status: "ok", detail: name });

  // Two lockfiles is not a style opinion: the tools then install different trees.
  if (facts.lockfiles.length > 1) {
    checks.push({
      name: "lockfile",
      status: "warn",
      detail: facts.lockfiles.join(", "),
      fix: "Keep one: delete the others, then reinstall. `proofcore exec` and CI will otherwise disagree with your machine.",
    });
  } else if (facts.lockfiles.length === 1) {
    checks.push({ name: "lockfile", status: "ok", detail: facts.lockfiles[0] ?? "" });
  } else {
    checks.push({
      name: "lockfile",
      status: "warn",
      detail: "none",
      fix: "Commit a lockfile: without one, the dependency set is different on every machine.",
    });
  }

  const engines = pkg.engines as Record<string, unknown> | undefined;
  if (engines && typeof engines.node === "string") {
    const ok = satisfiesNodeRange(engines.node, facts.nodeVersion);
    checks.push({
      name: "engines.node",
      status: ok ? "ok" : "warn",
      detail: `requires ${engines.node}, running ${facts.nodeVersion}`,
      ...(ok
        ? {}
        : { fix: "Use a runtime that satisfies the project, or update the range if it is stale." }),
    });
  }

  const dependencies = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };
  const frameworks = [
    "next",
    "react",
    "vue",
    "svelte",
    "@angular/core",
    "nuxt",
    "express",
    "hono",
  ].filter((candidate) => candidate in dependencies);
  if (frameworks.length) {
    const versions = frameworks.map((framework) => {
      const range = dependencies[framework];
      const installed = facts.installed[framework];
      return `${framework}@${installed ?? range}`;
    });
    checks.push({ name: "framework", status: "ok", detail: versions.join(" ") });
  }

  if (facts.installed.typescript) {
    checks.push({ name: "typescript", status: "ok", detail: facts.installed.typescript });
  }

  // The Playwright split that bites: the runner and the driver must be the same version.
  const playwright = facts.installed.playwright;
  const playwrightTest = facts.installed["@playwright/test"];
  if (playwright && playwrightTest && playwright !== playwrightTest) {
    checks.push({
      name: "playwright",
      status: "warn",
      detail: `playwright ${playwright} ≠ @playwright/test ${playwrightTest}`,
      fix: "Install both at the same version, or `proofcore devtools` may drive a different browser build than your tests.",
    });
  } else if (playwright ?? playwrightTest) {
    checks.push({ name: "playwright", status: "ok", detail: playwright ?? playwrightTest ?? "" });
  }

  if (facts.reactDuplicates && facts.reactDuplicates.length > 1) {
    checks.push({
      name: "react copies",
      status: "warn",
      detail: facts.reactDuplicates.join(", "),
      fix: "Deduplicate (pnpm dedupe / npm dedupe): two React copies produce 'invalid hook call'.",
    });
  }

  return checks;
}

/** Reads the facts for a directory. Missing files are a fact, not an error. */
export function readStackFacts(cwd: string, nodeVersion: string): StackFacts {
  const read = (path: string) => {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const lockfiles = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb"].filter(
    (file) => {
      try {
        readFileSync(join(cwd, file));
        return true;
      } catch {
        return false;
      }
    }
  );

  const installed: Record<string, string | null> = {};
  for (const name of [
    "react",
    "react-dom",
    "next",
    "vue",
    "svelte",
    "nuxt",
    "express",
    "hono",
    "@angular/core",
    "typescript",
    "playwright",
    "@playwright/test",
  ]) {
    const manifest = read(join(cwd, "node_modules", name, "package.json"));
    installed[name] = typeof manifest?.version === "string" ? manifest.version : null;
  }

  return { packageJson: read(join(cwd, "package.json")), lockfiles, installed, nodeVersion };
}
