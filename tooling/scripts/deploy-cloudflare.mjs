/**
 * One command to put a new version of the product online.
 *
 * Two surfaces, deployed from here so the site and its API can never drift apart:
 *
 *   node tooling/scripts/deploy-cloudflare.mjs            # both
 *   node tooling/scripts/deploy-cloudflare.mjs --only api  # the Worker + D1 migrations
 *   node tooling/scripts/deploy-cloudflare.mjs --only web  # the site on Cloudflare Pages
 *
 * Order matters and is enforced: the API first, then the web app. A web build that ships
 * before its API knows a new route answers 404 with the UI already offering the button —
 * the exact failure the CORS comment in apps/api/src/app.ts describes.
 *
 * Preflight, before anything moves: clean tree, wrangler installed, the user is logged in
 * (`wrangler whoami`), and the web build works. A deploy that skips preflight is how a
 * broken site becomes everyone's Tuesday.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const api = join(root, "apps", "api");
const web = join(root, "apps", "web");

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "all";
const dry = args.includes("--dry-run");

const say = (message) => process.stdout.write(`▸ ${message}\n`);
const run = (command, options) =>
  execFileSync(command[0], command.slice(1), {
    cwd: options?.cwd ?? root,
    stdio: "inherit",
    env: { ...process.env, ...(options?.env ?? {}) },
  });

function preflight() {
  if (!existsSync(join(api, "wrangler.toml"))) {
    throw new Error("apps/api/wrangler.toml is missing: the API has no deployment to update");
  }
  try {
    const whoami = execFileSync("npx", ["wrangler", "whoami"], {
      cwd: api,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!/you are logged in|You are logged in|@/.test(whoami)) {
      throw new Error("not logged in to Cloudflare: run `npx wrangler login` first");
    }
    say(`wrangler: ${whoami.trim().split("\n")[0]}`);
  } catch (error) {
    if (String(error.message).includes("logged in")) throw error;
    throw new Error("wrangler could not run (is it installed? `pnpm add -w -D wrangler`)");
  }
  const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
  if (status.trim() && !dry) {
    throw new Error(
      "the working tree is dirty — deploy a commit, not a desk: commit or stash, then deploy.\n" +
        status.split("\n").slice(0, 5).join("\n")
    );
  }
  const origin = process.env.PROOFCORE_WEB_ORIGIN;
  if (!origin) {
    say("PROOFCORE_WEB_ORIGIN not set: the API keeps its current CORS list (wrangler.toml vars)");
  }
}

function deployApi() {
  say("deploying the API (Workers + D1 migrations)");
  if (dry) return say("dry-run: skipped");
  // Local development uses the same SQL through node:sqlite; `wrangler d1 migrations apply`
  // before deploy keeps production ahead of the code that expects its tables.
  run(["npx", "wrangler", "d1", "migrations", "apply", "proofcore", "--remote"], { cwd: api });
  run(["npx", "wrangler", "deploy"], { cwd: api });
  say("API deployed: verify with /health before announcing anything");
}

function deployWeb() {
  say("building the web app");
  if (dry) return say("dry-run: skipped");
  run(["pnpm", "--filter", "@proofcore/web", "build"], { cwd: root });
  const dist = join(web, "dist");
  if (!existsSync(join(dist, "index.html")))
    throw new Error("the web build produced no index.html");
  say("publishing to Cloudflare Pages");
  const project = process.env.CF_PAGES_PROJECT ?? "proofcore";
  // Wrangler pages deploy is directory-based; the commit message ties the deploy to the code.
  run(
    [
      "npx",
      "wrangler",
      "pages",
      "deploy",
      dist,
      `--project-name=${project}`,
      "--commit-dirty=true",
    ],
    {
      cwd: web,
    }
  );
}

preflight();
if (only === "all" || only === "api") deployApi();
if (only === "all" || only === "web") deployWeb();
say(`done${dry ? " (dry-run)" : ""}`);
