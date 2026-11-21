import { Hono } from "hono";
import { HttpError } from "../http/errors.js";
import type { AppEnv } from "../http/services.js";

/**
 * Published desktop/CLI releases, read by the public download page.
 *
 * The page used to call `api.github.com` from the browser, which a strict CSP blocks and
 * which ties every visitor to GitHub's unauthenticated rate limit (60 requests an hour,
 * shared by IP). Proxying it here keeps the browser on our own origin, lets the Worker
 * cache one answer for everyone, and lets the page show exactly the assets that exist —
 * including their digest — instead of a generic link that may 404.
 *
 * Nothing is invented: a repository with no release answers `{ release: null }`, and an
 * upstream failure is a 502, never an empty but successful-looking list. When a previous
 * answer exists, it is served instead, marked `x-release-cache: stale`, because a
 * rate-limited source is not evidence that the release was withdrawn.
 */

const REPO = "laudesmassamba1-ai/PROOFSTACK";
const TTL_MS = 5 * 60_000;
const UPSTREAM_TIMEOUT_MS = 8_000;

interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  digest: string | null;
  contentType: string | null;
}

interface ReleaseBody {
  release: {
    tag: string;
    name: string;
    url: string;
    publishedAt: string;
    prerelease: boolean;
    assets: ReleaseAsset[];
  } | null;
}

export interface ReleaseOptions {
  /**
   * A GitHub token, read from the deployment environment on the server.
   *
   * Anonymous calls are limited to 60/hour per IP, and Cloudflare Workers share their
   * egress addresses: without a token the endpoint works intermittently in production.
   * The token is never sent to the browser.
   */
  token?: string;
  /** Test hook: a zero TTL exercises the stale path without waiting five minutes. */
  ttlMs?: number;
}

let cache = new Map<string, { at: number; body: ReleaseBody }>();

/** Test hook: the cache is process-wide, so a suite must be able to start cold. */
export function resetReleaseCache(): void {
  cache = new Map();
}

function assetFrom(value: unknown): ReleaseAsset | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name : "";
  const url = typeof raw.browser_download_url === "string" ? raw.browser_download_url : "";
  if (!name || !url) return null;
  return {
    name,
    url,
    size: typeof raw.size === "number" ? raw.size : 0,
    digest: typeof raw.digest === "string" && raw.digest.length > 0 ? raw.digest : null,
    contentType: typeof raw.content_type === "string" ? raw.content_type : null,
  };
}

async function fetchLatest(token: string | undefined): Promise<ReleaseBody> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      signal: controller.signal,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "proofstack-releases",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (error) {
    throw new HttpError(
      502,
      "release_unavailable",
      `Could not read the published releases: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  } finally {
    clearTimeout(timer);
  }

  // No release yet is a normal state for a young repository, not an error.
  if (response.status === 404) return { release: null };
  if (!response.ok) {
    // 403 here is almost always the anonymous rate limit; name the fix for the operator.
    throw new HttpError(
      502,
      "release_unavailable",
      response.status === 403
        ? "The release source refused the call (rate limit). Set GITHUB_TOKEN on the API to raise it."
        : `The release source answered HTTP ${response.status}.`
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;
  if (typeof raw.tag_name !== "string") {
    throw new HttpError(502, "release_unavailable", "The release source returned no tag.");
  }
  const assets = Array.isArray(raw.assets)
    ? raw.assets.map(assetFrom).filter((item): item is ReleaseAsset => item !== null)
    : [];
  return {
    release: {
      tag: raw.tag_name,
      name: typeof raw.name === "string" && raw.name.length > 0 ? raw.name : raw.tag_name,
      url:
        typeof raw.html_url === "string"
          ? raw.html_url
          : `https://github.com/${REPO}/releases/latest`,
      publishedAt: typeof raw.published_at === "string" ? raw.published_at : "",
      prerelease: raw.prerelease === true,
      assets,
    },
  };
}

export function releaseRoutes(options: ReleaseOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const ttlMs = options.ttlMs ?? TTL_MS;

  app.get("/releases/latest", async (c) => {
    const hit = cache.get(REPO);
    if (hit && Date.now() - hit.at < ttlMs) {
      c.header("Cache-Control", "public, max-age=60");
      return c.json(hit.body);
    }
    try {
      const body = await fetchLatest(options.token);
      cache.set(REPO, { at: Date.now(), body });
      c.header("Cache-Control", "public, max-age=60");
      return c.json(body);
    } catch (error) {
      // A rate-limited source is not proof that the release disappeared. Serving the last
      // real answer is more truthful than an empty page, and the header says it is stale.
      if (hit) {
        c.header("Cache-Control", "public, max-age=30");
        c.header("x-release-cache", "stale");
        return c.json(hit.body);
      }
      throw error;
    }
  });

  return app;
}
