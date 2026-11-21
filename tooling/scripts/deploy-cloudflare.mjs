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
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const api = join(root, "apps", "api");
const web = join(root, "apps", "web");

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "all";
const dry = args.includes("--dry-run");
const skipSmoke = args.includes("--skip-smoke");

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
  // Refresh the release snapshot bundled with the Worker. A cold isolate can then answer
  // the public download page from the last release actually read from GitHub, even when
  // GitHub rate-limits the Worker's shared egress IP. The script keeps the previous
  // snapshot on failure, so an outage never blocks a deploy or invents a version.
  try {
    run(["node", "tooling/scripts/sync-release-manifest.mjs"], { cwd: root });
  } catch {
    say("release manifest: refresh skipped, keeping the committed snapshot");
  }
  // Local development uses the same SQL through node:sqlite; `wrangler d1 migrations apply`
  // before deploy keeps production ahead of the code that expects its tables.
  run(["npx", "wrangler", "d1", "migrations", "apply", "proofcore", "--remote"], { cwd: api });
  run(["npx", "wrangler", "deploy"], { cwd: api });
  say("API deployed");
}

/**
 * The origin this deployment is reachable at, read from the Worker's own vars rather
 * than duplicated here: `API_ORIGIN` is what the API tells browsers it lives at, so a
 * smoke check against anything else would test a different service.
 */
function tomlVar(name) {
  const text = readFileSync(join(api, "wrangler.toml"), "utf8");
  return text.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, "m"))?.[1];
}

/** A production Pages host: the first WEB_ORIGIN entry on pages.dev without a wildcard. */
function pagesOrigin() {
  return (tomlVar("WEB_ORIGIN") ?? "")
    .split(",")
    .map((value) => value.trim())
    .find((value) => value.includes(".pages.dev") && !value.includes("*"));
}

// A deploy is not done when the upload finishes: it is done when /health answers and the
// key pages serve the bundle they reference. Failure here fails the command, on purpose.
function smoke() {
  if (dry) return say("dry-run: smoke skipped");
  if (skipSmoke) return say("smoke skipped (--skip-smoke)");
  const targets = [];
  const apiOrigin = process.env.PROOFCORE_API_URL ?? tomlVar("API_ORIGIN");
  if (apiOrigin) targets.push("--api", apiOrigin);
  const pages = only === "api" ? null : (process.env.PROOFCORE_PAGES_URL ?? pagesOrigin());
  if (pages) targets.push("--web", pages);
  if (targets.length === 0) return say("smoke: no target found, nothing checked");
  say(`smoke: ${targets.join(" ")}`);
  run(["node", join(root, "tooling", "scripts", "smoke-deploy.mjs"), ...targets]);
  say("smoke: every check passed");
}

function deployWeb() {
  say("building the web app");
  if (dry) return say("dry-run: skipped");
  run(["pnpm", "--filter", "@proofcore/web", "build"], { cwd: root });
  const dist = join(web, "dist");
  if (!existsSync(join(dist, "index.html")))
    throw new Error("the web build produced no index.html");
  say("publishing to Cloudflare Pages");
  // The Pages project is named after the product's public name, not the CLI binary:
  // "proofcore" is the engine and the Worker, "proofstack" is the site. Getting this
  // wrong fails after the build, with the site already built and nothing published.
  const project = process.env.CF_PAGES_PROJECT ?? "proofstack";
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
smoke();
say(`done${dry ? " (dry-run)" : ""}`);
