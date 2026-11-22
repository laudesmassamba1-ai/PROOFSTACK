import { Hono } from "hono";
import { HttpError } from "../http/errors.js";
import type { AppEnv } from "../http/services.js";
import { RELEASE_MANIFEST } from "../release-manifest.js";

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

const DEFAULT_MANIFEST: ReleaseBody = RELEASE_MANIFEST as ReleaseBody;

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
  /** Generator output, injected by tests; the module default is the checked-in manifest. */
  manifest?: ReleaseBody;
  /**
   * Public base the download endpoints are reachable at, e.g. `https://api.example`.
   *
   * Every asset URL handed to the browser points here, not at GitHub: the download starts
   * on our domain, keeps our name for the file, and works when the visitor's network
   * blocks the release host.
   */
  baseUrl?: string;
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
    // 403 here is almost always the anonymous rate limit. That is a limit on one address,
    // not on the truth: ask the release itself before giving up on the caller.
    const tag = await latestTag();
    if (tag !== null) return { release: await releaseFromIndex(tag) };
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

/**
 * The release's own index: `release.json`, written by the build that produced the files it
 * describes and attached to the release itself.
 *
 * The REST API allows 60 anonymous calls an hour per address, and Cloudflare Workers share
 * their egress addresses — in production that allowance is spent by strangers, and the
 * download page then shows whatever it last saw. A release asset carries no such limit, so
 * the page can be rebuilt from the release even when the API says 403.
 */
const INDEX_NAME = "release.json";

async function timed(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** The tag of the newest release, read from the redirect rather than from the API. */
async function latestTag(): Promise<string | null> {
  try {
    const response = await timed(`https://github.com/${REPO}/releases/latest`, {
      redirect: "manual",
      headers: { "user-agent": "proofstack-releases" },
    });
    const location = response.headers.get("location") ?? "";
    const match = location.match(/\/releases\/tag\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

interface IndexBody {
  version?: unknown;
  tag?: unknown;
  publishedAt?: unknown;
  assets?: unknown;
}

/** One release, described by itself. */
async function releaseFromIndex(tag: string): Promise<ReleaseBody["release"]> {
  const response = await timed(
    `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${INDEX_NAME}`,
    { headers: { "user-agent": "proofstack-releases" } }
  );
  if (!response.ok) {
    throw new HttpError(
      502,
      "release_unavailable",
      `${tag} does not carry ${INDEX_NAME} (HTTP ${response.status}), and the release API is rate-limited.`
    );
  }
  const raw = (await response.json()) as IndexBody;
  const list = Array.isArray(raw.assets) ? raw.assets : [];
  const assets: ReleaseAsset[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const file = item as Record<string, unknown>;
    const name = typeof file.name === "string" ? file.name : "";
    if (!name) continue;
    assets.push({
      name,
      url: `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`,
      size: typeof file.size === "number" ? file.size : 0,
      digest:
        typeof file.sha256 === "string" && file.sha256.length > 0 ? `sha256:${file.sha256}` : null,
      contentType: null,
    });
  }
  if (assets.length === 0) {
    throw new HttpError(502, "release_unavailable", `${tag} describes no files.`);
  }
  return {
    tag: typeof raw.tag === "string" && raw.tag.length > 0 ? raw.tag : tag,
    name:
      typeof raw.version === "string" && raw.version.length > 0 ? `PROOFCORE ${raw.version}` : tag,
    url: `https://github.com/${REPO}/releases/tag/${encodeURIComponent(tag)}`,
    publishedAt: typeof raw.publishedAt === "string" ? raw.publishedAt : "",
    prerelease: false,
    assets,
  };
}

/** Recent tags, read from the public feed (no API quota, no HTML scraping). */
async function tagsFromAtom(): Promise<{ tag: string; publishedAt: string }[]> {
  try {
    const response = await timed(`https://github.com/${REPO}/releases.atom`, {
      headers: { "user-agent": "proofstack-releases", accept: "application/atom+xml" },
    });
    if (!response.ok) return [];
    const xml = await response.text();
    const found: { tag: string; publishedAt: string }[] = [];
    for (const entry of xml.split("<entry>").slice(1)) {
      const link = entry.match(/\/releases\/tag\/([^"'<\s]+)/);
      if (!link?.[1]) continue;
      const tag = decodeURIComponent(link[1]);
      if (found.some((item) => item.tag === tag)) continue;
      const updated = entry.match(/<updated>([^<]+)<\/updated>/);
      found.push({ tag, publishedAt: updated?.[1] ?? "" });
      if (found.length >= VERSION_LIMIT) break;
    }
    return found;
  } catch {
    return [];
  }
}

/** At most a handful: the selector is a dropdown, not a changelog. */
const VERSION_LIMIT = 8;

interface GitHubRelease {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  prerelease?: unknown;
  draft?: unknown;
  assets?: unknown;
}

function toRelease(raw: GitHubRelease): ReleaseBody["release"] {
  if (typeof raw.tag_name !== "string") return null;
  const assets = Array.isArray(raw.assets)
    ? raw.assets.map(assetFrom).filter((item): item is ReleaseAsset => item !== null)
    : [];
  return {
    tag: raw.tag_name,
    name: typeof raw.name === "string" && raw.name.length > 0 ? raw.name : raw.tag_name,
    url:
      typeof raw.html_url === "string"
        ? raw.html_url
        : `https://github.com/${REPO}/releases/latest`,
    publishedAt: typeof raw.published_at === "string" ? raw.published_at : "",
    prerelease: raw.prerelease === true,
    assets,
  };
}

async function fetchReleases(token: string | undefined, limit: number): Promise<ReleaseBody[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=${limit}`, {
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
  if (!response.ok) {
    // Same reasoning as the latest release: a rate limit is not a missing version. Ask
    // the releases themselves, newest first, from the public feed.
    const tagged = await tagsFromAtom();
    if (tagged.length > 0) {
      const described = await Promise.all(
        tagged.map((item) => releaseFromIndex(item.tag).catch(() => null))
      );
      const usable = described.filter((item): item is NonNullable<typeof item> => item !== null);
      if (usable.length > 0) {
        // A tag from before releases described themselves is still a version a person may
        // want. It is listed with the date the feed gives it and no files, rather than
        // vanishing from a list that claims to show the versions.
        const known = new Set(usable.map((item) => item.tag));
        const bare: NonNullable<ReleaseBody["release"]>[] = tagged
          .filter((item) => !known.has(item.tag))
          .map((item) => ({
            tag: item.tag,
            name: item.tag,
            url: `https://github.com/${REPO}/releases/tag/${encodeURIComponent(item.tag)}`,
            publishedAt: item.publishedAt,
            prerelease: false,
            assets: [],
          }));
        return [...usable, ...bare].map((release) => ({ release }));
      }
    }
    throw new HttpError(
      502,
      "release_unavailable",
      response.status === 403
        ? "The release source refused the call (rate limit). Set GITHUB_TOKEN on the API to raise it."
        : `The release source answered HTTP ${response.status}.`
    );
  }
  const raw = (await response.json()) as GitHubRelease[];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item?.draft !== true)
    .map((item) => ({ release: toRelease(item) }))
    .filter((item): item is ReleaseBody => item.release !== null);
}

export function releaseRoutes(options: ReleaseOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const ttlMs = options.ttlMs ?? TTL_MS;

  /**
   * The release the client should use, as a value both the JSON routes and the download
   * route can share. Cached for the same window as the page: a download that resolves a
   * different version than the page displayed is a bug people can see.
   */
  const currentRelease = async (): Promise<ReleaseBody["release"]> => {
    const hit = cache.get(REPO);
    if (hit && Date.now() - hit.at < ttlMs) return hit.body.release;
    try {
      const body = await fetchLatest(options.token);
      cache.set(REPO, { at: Date.now(), body });
      return body.release;
    } catch (error) {
      if (hit) return hit.body.release;
      const manifest = options.manifest ?? DEFAULT_MANIFEST;
      if (manifest.release) return manifest.release;
      throw error;
    }
  };

  /** Every asset URL we hand out points at this API, never at the release host. */
  const localise = (release: NonNullable<ReleaseBody["release"]>) => {
    const base = (options.baseUrl ?? "").replace(/\/+$/, "");
    if (base.length === 0) return release;
    return {
      ...release,
      assets: release.assets.map((asset) => ({
        ...asset,
        url: `${base}/api/v1/releases/assets/${encodeURIComponent(asset.name)}?version=${encodeURIComponent(release.tag)}`,
      })),
    };
  };

  /**
   * The version selector's data: recent releases, newest first, with our own asset URLs.
   *
   * GitHub is read once per window for the list; a failure is a 502, not an empty list
   * that would make the page claim nothing was ever published.
   */
  app.get("/releases/versions", async (c) => {
    const key = `${REPO}:list`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) {
      c.header("Cache-Control", "public, max-age=300");
      return c.json(hit.body);
    }
    try {
      const releases = await fetchReleases(options.token, VERSION_LIMIT);
      const body = {
        releases: releases
          .filter((item) => item.release !== null)
          .map((item) => localise(item.release as NonNullable<ReleaseBody["release"]>)),
      } as unknown as ReleaseBody;
      cache.set(key, { at: Date.now(), body });
      c.header("Cache-Control", "public, max-age=300");
      return c.json(body);
    } catch (error) {
      if (hit) {
        c.header("Cache-Control", "public, max-age=60");
        c.header("x-release-cache", "stale");
        return c.json(hit.body);
      }
      throw error;
    }
  });

  /**
   * One file of a release, streamed from our own origin.
   *
   * The download page used to send people to GitHub. Two things were wrong with that: the
   * visitor left the product, and on a corporate network the release host is often
   * blocked, so the button did nothing. Here the browser downloads from us, the file keeps
   * its name, and range requests are forwarded so the updater's differential download
   * still works.
   *
   * Only names that appear in a published release are served: this route is a mirror of
   * the release, never an open proxy.
   */
  app.get("/releases/assets/:name", async (c) => {
    const name = c.req.param("name");
    if (!/^[A-Za-z0-9._+-]{1,160}$/.test(name)) {
      throw new HttpError(400, "invalid_asset_name", "That is not a release asset name.");
    }
    const wanted = c.req.query("version");
    const release = await currentRelease();
    if (release === null) {
      throw new HttpError(404, "no_release", "No release has been published yet.");
    }
    if (wanted !== undefined && wanted !== release.tag) {
      // Pinning a version matters for reproducible downloads; an unknown one is refused
      // rather than silently swapped for the latest, which is how scripts break quietly.
      const known = await fetchReleases(options.token, VERSION_LIMIT).catch(() => []);
      const match = known.find((item) => item.release?.tag === wanted)?.release ?? null;
      if (match === null) {
        throw new HttpError(
          404,
          "release_not_found",
          `No release is tagged ${wanted}. Drop the version to get the latest.`
        );
      }
    }
    const asset = release.assets.find((item) => item.name === name);
    if (!asset) {
      throw new HttpError(
        404,
        "asset_not_found",
        `${name} is not part of release ${release.tag}. Available: ${
          release.assets.map((item) => item.name).join(", ") || "none"
        }`
      );
    }

    const range = c.req.header("range");
    let upstream: Response | null = null;
    try {
      upstream = await fetch(asset.url, {
        headers: {
          "user-agent": "proofstack-download",
          // A token raises the release host's per-address limit. Workers share their
          // egress addresses, so the anonymous limit is spent by everyone on the account
          // before a visitor ever clicks.
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          ...(range ? { range } : {}),
        },
        redirect: "follow",
      });
    } catch {
      upstream = null;
    }
    if (upstream === null || (!upstream.ok && upstream.status !== 206)) {
      // The mirror is a convenience, not a single point of failure: when the release host
      // refuses the Worker (429 is its per-address limit, and Workers share addresses),
      // the browser is sent to fetch the file itself. It still never lands on a GitHub
      // page — it downloads, with the right name, from the release host's asset URL.
      const status = upstream?.status ?? 0;
      c.header("x-download-fallback", status === 0 ? "unreachable" : String(status));
      return c.redirect(asset.url, 302);
    }

    const isText = /\.(json|ya?ml|txt|sha256)$/.test(name);
    const headers = new Headers({
      "content-type": isText ? "text/plain; charset=utf-8" : "application/octet-stream",
      // The name the browser saves, and the length it can show while downloading.
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": isText ? "public, max-age=300" : "public, max-age=3600, immutable",
      "accept-ranges": "bytes",
    });
    for (const header of ["content-length", "content-range", "etag"]) {
      const value = upstream.headers.get(header);
      if (value !== null) headers.set(header, value);
    }
    // `body` is piped, never buffered: an installer is 100 MB and a Worker has 128 MB of
    // memory for everything it is doing at that moment.
    return new Response(upstream.body, { status: upstream.status, headers });
  });

  app.get("/releases/latest", async (c) => {
    // `?version=v0.5.0` names one release, for a version the selector lists but could not
    // describe: the page asks for its files when somebody chooses it, instead of hiding a
    // version that exists because its files could not be read up front.
    const wantedTag = c.req.query("version");
    if (wantedTag !== undefined && wantedTag.length > 0) {
      const described = await releaseFromIndex(wantedTag).catch(() => null);
      if (described !== null) {
        c.header("Cache-Control", "public, max-age=300");
        return c.json({ release: localise(described) });
      }
      const known = await fetchReleases(options.token, VERSION_LIMIT).catch(() => []);
      const match = known.find((item) => item.release?.tag === wantedTag)?.release ?? null;
      if (match !== null) {
        c.header("Cache-Control", "public, max-age=300");
        return c.json({ release: localise(match) });
      }
      throw new HttpError(
        404,
        "release_not_found",
        `No release is tagged ${wantedTag}. Drop the version to get the latest.`
      );
    }
    const hit = cache.get(REPO);
    if (hit && Date.now() - hit.at < ttlMs) {
      c.header("Cache-Control", "public, max-age=60");
      return c.json(hit.body);
    }
    try {
      const body = await fetchLatest(options.token);
      cache.set(REPO, { at: Date.now(), body });
      c.header("Cache-Control", "public, max-age=60");
      return c.json({ release: body.release === null ? null : localise(body.release) });
    } catch (error) {
      // A rate-limited source is not proof that the release disappeared. Serving the last
      // real answer is more truthful than an empty page, and the header says which it is.
      if (hit) {
        c.header("Cache-Control", "public, max-age=30");
        c.header("x-release-cache", "stale");
        return c.json({
          release: hit.body.release === null ? null : localise(hit.body.release),
        });
      }
      // Cold isolate plus a rate-limited source: the deploy-time manifest is the last
      // release actually read from GitHub, not a guess. It is dated, and the header says
      // it did not come from the live call.
      const manifest = options.manifest ?? DEFAULT_MANIFEST;
      if (manifest.release) {
        c.header("Cache-Control", "public, max-age=30");
        c.header("x-release-cache", "manifest");
        return c.json({ release: localise(manifest.release) });
      }
      throw error;
    }
  });

  return app;
}
