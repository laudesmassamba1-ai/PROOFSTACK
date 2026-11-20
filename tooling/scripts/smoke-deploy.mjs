/**
 * Post-deploy smoke check: is the product actually reachable, and is the release that
 * was just published the one being served?
 *
 * A deploy command that exits 0 only proves the upload was accepted. It does not prove
 * that /health answers, that D1 is reachable, that a deep link such as /pricing is
 * rewritten to the SPA, or that the HTML references an asset that exists. Those are the
 * failures users meet first, and they are exactly what this script checks.
 *
 *   node tooling/scripts/smoke-deploy.mjs                          # API + both sites
 *   node tooling/scripts/smoke-deploy.mjs --api https://…          # API only
 *   node tooling/scripts/smoke-deploy.mjs --web https://… --web …  # chosen sites
 *
 * Targets can also come from the environment: PROOFCORE_API_URL and PROOFCORE_SMOKE_WEB
 * (comma separated). Exit code 1 means at least one check failed; the output names each
 * URL and what was expected, so a red build is actionable without reading this file.
 */

const DEFAULTS = {
  api: "https://proofcore-api.laudesmassamba1.workers.dev",
  // The two production surfaces: the Vercel canonical origin and the Cloudflare Pages
  // project. Both serve the same build and must both survive a release.
  web: ["https://proofstack-iota.vercel.app", "https://proofstack-01z.pages.dev"],
};

const KEY_PAGES = ["/", "/product", "/pricing", "/download", "/signin"];
const ATTEMPTS = 4;
const RETRY_DELAY_MS = 2500;
const TIMEOUT_MS = 15_000;

const args = process.argv.slice(2);
const flagValues = (flag) => {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
};

const explicitApi = flagValues("--api")[0];
const explicitWeb = flagValues("--web");
const envWeb = (process.env.PROOFCORE_SMOKE_WEB ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
// Defaults describe production; any explicit target means "check these and only these",
// so an API-only deploy never waits on a site it did not publish.
const explicit = Boolean(
  explicitApi || explicitWeb.length > 0 || process.env.PROOFCORE_API_URL || envWeb.length
);
const apiTarget = explicitApi ?? process.env.PROOFCORE_API_URL ?? (explicit ? null : DEFAULTS.api);
const webTargets = [...new Set([...explicitWeb, ...envWeb, ...(explicit ? [] : DEFAULTS.web)])];

const say = (message) => process.stdout.write(`${message}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url, options = {}) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "proofcore-smoke/1", ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.text();
  return { status: response.status, headers: response.headers, body };
}

/**
 * Propagation is not instantaneous on either provider, so a 5xx or a network error on the
 * first seconds after an upload is retried. A wrong answer that stays wrong is a failure.
 */
async function withRetries(label, check) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const result = await check();
      if (result.ok) return result;
      lastError = new Error(result.detail);
    } catch (error) {
      lastError = error;
    }
    if (attempt < ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }
  throw new Error(`${label}: ${lastError?.message ?? "no response"}`);
}

const results = [];
function record(ok, label, detail) {
  results.push({ ok, label, detail });
  say(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function checkApi(api) {
  const health = await withRetries(`GET ${api}/health`, async () => {
    const response = await request(`${api}/health`);
    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      return { ok: false, detail: `HTTP ${response.status}, body is not JSON` };
    }
    const problems = [];
    if (response.status !== 200) problems.push(`HTTP ${response.status}`);
    if (parsed.service !== "proofcore-api") problems.push(`service=${parsed.service}`);
    if (parsed.status !== "ok") problems.push(`status=${parsed.status}`);
    if (parsed.database !== "ok") problems.push(`database=${parsed.database}`);
    return {
      ok: problems.length === 0,
      detail: problems.length
        ? problems.join(", ")
        : `database ok, payments: ${parsed.payments?.provider ?? "unknown"}`,
    };
  });
  record(true, `API ${api}/health`, health.detail);

  for (const web of webTargets) {
    const origin = new URL(web).origin;
    const cors = await withRetries(`CORS ${origin}`, async () => {
      const response = await request(`${api}/health`, { headers: { origin } });
      const allowed = response.headers.get("access-control-allow-origin");
      const credentials = response.headers.get("access-control-allow-credentials");
      return {
        ok: allowed === origin && credentials === "true",
        detail:
          allowed === origin
            ? `allow-origin=${origin}, credentials=${credentials}`
            : `allow-origin=${allowed ?? "missing"} (expected ${origin})`,
      };
    });
    record(true, `API CORS for ${origin}`, cors.detail);
  }
}

async function checkWeb(web) {
  const root = await withRetries(`GET ${web}/`, async () => {
    const response = await request(`${web}/`);
    const type = response.headers.get("content-type") ?? "";
    const hasRoot = /<div id="root"/.test(response.body);
    return {
      ok: response.status === 200 && type.includes("text/html") && hasRoot,
      detail:
        response.status === 200 && type.includes("text/html") && hasRoot
          ? "html shell ok"
          : `HTTP ${response.status}, type=${type || "none"}, root=${hasRoot}`,
      asset: response.body.match(/\/assets\/[A-Za-z0-9_.-]+\.js/)?.[0] ?? null,
    };
  });
  record(true, `web ${web}/`, root.detail);

  if (!root.asset) {
    record(false, `web ${web} asset`, "index.html references no /assets/*.js bundle");
  } else {
    const asset = await withRetries(`GET ${web}${root.asset}`, async () => {
      const response = await request(`${web}${root.asset}`);
      const type = response.headers.get("content-type") ?? "";
      return {
        ok: response.status === 200 && response.body.length > 1000 && type.includes("javascript"),
        detail:
          response.status === 200 && response.body.length > 1000 && type.includes("javascript")
            ? `${root.asset} (${Math.round(response.body.length / 1024)} KB)`
            : `HTTP ${response.status}, type=${type || "none"}, ${response.body.length} bytes`,
      };
    });
    record(true, `web ${web} asset`, asset.detail);
  }

  for (const path of KEY_PAGES.filter((value) => value !== "/")) {
    const page = await withRetries(`GET ${web}${path}`, async () => {
      const response = await request(`${web}${path}`);
      const type = response.headers.get("content-type") ?? "";
      const hasRoot = /<div id="root"/.test(response.body);
      return {
        ok: response.status === 200 && type.includes("text/html") && hasRoot,
        detail:
          response.status === 200 && type.includes("text/html") && hasRoot
            ? "deep link rewritten to the SPA"
            : `HTTP ${response.status}, type=${type || "none"}, root=${hasRoot}`,
      };
    });
    record(true, `web ${web}${path}`, page.detail);
  }
}

// A target passed explicitly is stripped of its trailing slash: `--web https://host/`
// and `--web https://host` must not produce `https://host//health`.
const normalize = (value) => value?.replace(/\/+$/, "");

if (!apiTarget && webTargets.length === 0) {
  say("✗ nothing to check: pass --api and/or --web");
  process.exit(1);
}

const started = Date.now();
// One failing target must not hide the state of the others: a group that cannot even
// answer is reported, and the remaining targets are still checked.
async function runTarget(label, check) {
  try {
    await check();
  } catch (error) {
    record(false, label, error instanceof Error ? error.message : String(error));
  }
}

if (apiTarget) await runTarget(`API ${apiTarget}`, () => checkApi(normalize(apiTarget)));
for (const web of webTargets) await runTarget(`web ${web}`, () => checkWeb(normalize(web)));

const failed = results.filter((result) => !result.ok);
say(
  `\n${failed.length === 0 ? "smoke passed" : `smoke failed (${failed.length}/${results.length})`} in ${Math.round((Date.now() - started) / 1000)}s`
);
if (failed.length > 0) {
  for (const failure of failed) say(`  ✗ ${failure.label}: ${failure.detail}`);
  process.exit(1);
}
