import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../src/http/errors.js";
import { type ReleaseOptions, releaseRoutes, resetReleaseCache } from "../src/routes/releases.js";

/**
 * The download endpoints.
 *
 * The product promised "download from our site" and shipped links to GitHub, where a
 * corporate network blocks the file and the visitor leaves the product. These tests pin
 * what replaced it: our own URL, the real bytes, the file name, ranges for the updater,
 * and a mirror that only serves what a published release actually contains.
 */

const ASSET_BYTES = new TextEncoder().encode("binary-payload");
const TAG = "v9.9.9";

const manifest: NonNullable<ReleaseOptions["manifest"]> = {
  release: {
    tag: TAG,
    name: "PROOFCORE 9.9.9",
    url: "https://github.com/laudesmassamba1-ai/PROOFSTACK/releases/tag/v9.9.9",
    publishedAt: "2026-11-22T10:00:00Z",
    prerelease: false,
    assets: [
      {
        name: "proofcore-linux-x64",
        url: "https://github.com/example/releases/download/v9.9.9/proofcore-linux-x64",
        size: ASSET_BYTES.length,
        digest: "sha256:abc",
        contentType: "application/octet-stream",
      },
      {
        name: "manifest.json",
        url: "https://github.com/example/releases/download/v9.9.9/manifest.json",
        size: 120,
        digest: null,
        contentType: "application/json",
      },
    ],
  },
};

function app(extra: Partial<ReleaseOptions> = {}) {
  const routes = releaseRoutes({ manifest, baseUrl: "https://api.example", ...extra });
  routes.onError((error, c) => {
    const status = error instanceof HttpError ? error.status : 500;
    return c.json(
      {
        error: {
          code: error instanceof HttpError ? error.code : "internal_error",
          message: error.message,
        },
      },
      status as 400
    );
  });
  return routes;
}

/** Stands in for api.github.com and the release host, so no test touches the network. */
function stubUpstream() {
  const calls: { url: string; range: string | null }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, range: headers.get("range") });
    if (url.includes("api.github.com")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("proofcore-linux-x64")) {
      return new Response(ASSET_BYTES, {
        status: headers.get("range") ? 206 : 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(ASSET_BYTES.length),
          ...(headers.get("range")
            ? { "content-range": `bytes 0-${ASSET_BYTES.length - 1}/999` }
            : {}),
        },
      });
    }
    return new Response("missing", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

beforeEach(() => {
  resetReleaseCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("release asset URLs", () => {
  it("hands the browser a URL on our own origin, not the release host", async () => {
    stubUpstream();
    const response = await app().request("/releases/latest");
    const body = (await response.json()) as {
      release: { tag: string; assets: { name: string; url: string }[] };
    };
    expect(body.release.tag).toBe(TAG);
    for (const asset of body.release.assets) {
      expect(asset.url.startsWith("https://api.example/api/v1/releases/assets/")).toBe(true);
      expect(asset.url).not.toContain("github.com");
      expect(asset.url).toContain(`version=${TAG}`);
    }
  });

  it("streams the bytes with the file name and the original length", async () => {
    stubUpstream();
    const response = await app().request("/releases/assets/proofcore-linux-x64");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="proofcore-linux-x64"'
    );
    expect(response.headers.get("content-length")).toBe(String(ASSET_BYTES.length));
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe("binary-payload");
  });

  it("forwards a range request, because the updater downloads differences", async () => {
    const calls = stubUpstream();
    const response = await app().request("/releases/assets/proofcore-linux-x64", {
      headers: { range: "bytes=0-13" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toContain("bytes 0-13");
    expect(calls.some((call) => call.range === "bytes=0-13")).toBe(true);
  });

  it("refuses a file the release does not contain, and says what it does contain", async () => {
    stubUpstream();
    const response = await app().request("/releases/assets/passwd");
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("asset_not_found");
    expect(body.error.message).toContain("proofcore-linux-x64");
  });

  it("refuses a name that could escape the route, before any request is made", async () => {
    const calls = stubUpstream();
    const response = await app().request("/releases/assets/..%2F..%2Fetc%2Fpasswd");
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("refuses an unknown version instead of silently serving the latest", async () => {
    stubUpstream();
    const response = await app().request("/releases/assets/proofcore-linux-x64?version=v0.0.1");
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("release_not_found");
  });

  it("serves a text asset with a text type so the updater can parse it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.github.com")) {
          return new Response("[]", { status: 200 });
        }
        return new Response("version: 9.9.9\npath: PROOFCORE-9.9.9.AppImage\n", { status: 200 });
      })
    );
    const response = await app({
      manifest: {
        release: {
          tag: TAG,
          name: "PROOFCORE 9.9.9",
          url: "https://github.com/laudesmassamba1-ai/PROOFSTACK/releases/tag/v9.9.9",
          publishedAt: "2026-11-22T10:00:00Z",
          prerelease: false,
          assets: [
            {
              name: "latest-linux.yml",
              url: "https://github.com/example/releases/download/v9.9.9/latest-linux.yml",
              size: 60,
              digest: null,
              contentType: "text/yaml",
            },
          ],
        },
      },
    }).request("/releases/assets/latest-linux.yml");
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain("version: 9.9.9");
  });
});

describe("when the release API is rate-limited", () => {
  /**
   * Workers share their egress addresses, so the anonymous allowance is spent by strangers
   * and the download page was showing a release four days old. A release asset has no such
   * allowance: the release describes itself, and that description is enough to rebuild the
   * page — name, size, digest, and the tag it belongs to.
   */
  const INDEX = {
    version: "9.9.9",
    tag: TAG,
    publishedAt: "2026-11-22T10:00:00Z",
    assets: [
      { name: "proofcore-linux-x64", size: ASSET_BYTES.length, sha256: "abc" },
      { name: "PROOFCORE-9.9.9-amd64.deb", size: 4096, sha256: "def" },
    ],
  };

  function stubRateLimited() {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.includes("api.github.com")) {
          return new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/releases/latest")) {
          return new Response(null, {
            status: 302,
            headers: {
              location: `https://github.com/laudesmassamba1-ai/PROOFSTACK/releases/tag/${TAG}`,
            },
          });
        }
        if (url.endsWith("/proofcore-linux-x64")) {
          return new Response(ASSET_BYTES, {
            status: 200,
            headers: { "content-length": String(ASSET_BYTES.length) },
          });
        }
        if (url.endsWith("/release.json")) {
          return new Response(JSON.stringify(INDEX), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/releases.atom")) {
          const xml = `<feed><entry><link href="https://github.com/laudesmassamba1-ai/PROOFSTACK/releases/tag/${TAG}"/></entry></feed>`;
          return new Response(xml, { status: 200 });
        }
        return new Response("missing", { status: 404 });
      })
    );
    return seen;
  }

  it("serves the newest release from the release's own index", async () => {
    stubRateLimited();
    const response = await app().request("/releases/latest");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      release: { tag: string; assets: { name: string; size: number; digest: string | null }[] };
    };
    expect(body.release.tag).toBe(TAG);
    expect(body.release.assets.map((asset) => asset.name)).toEqual([
      "proofcore-linux-x64",
      "PROOFCORE-9.9.9-amd64.deb",
    ]);
    expect(body.release.assets[0].size).toBe(ASSET_BYTES.length);
    expect(body.release.assets[0].digest).toBe("sha256:abc");
  });

  it("still localises the URLs it read from the index", async () => {
    stubRateLimited();
    const response = await app().request("/releases/latest");
    const body = (await response.json()) as { release: { assets: { url: string }[] } };
    for (const asset of body.release.assets) {
      expect(asset.url.startsWith("https://api.example/api/v1/releases/assets/")).toBe(true);
    }
  });

  it("builds the version list from the feed and the indexes", async () => {
    stubRateLimited();
    const response = await app().request("/releases/versions");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { releases: { tag: string; assets: unknown[] }[] };
    expect(body.releases).toHaveLength(1);
    expect(body.releases[0].tag).toBe(TAG);
    expect(body.releases[0].assets).toHaveLength(2);
  });

  it("downloads a file that only the index knows about", async () => {
    stubRateLimited();
    const response = await app().request(`/releases/assets/proofcore-linux-x64?version=${TAG}`);
    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe("binary-payload");
  });

  it("refuses a file the index does not describe", async () => {
    stubRateLimited();
    const response = await app().request("/releases/assets/not-in-any-release.bin");
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("not part of release");
  });
});
