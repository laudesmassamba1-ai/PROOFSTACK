import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { HttpError } from "../src/http/errors.js";
import { releaseRoutes, resetReleaseCache } from "../src/routes/releases.js";

/**
 * The download page reads releases through this endpoint, not GitHub.
 *
 * These tests pin the three states the page must tell apart: a real release, a repository
 * with no release yet, and an upstream failure. Collapsing the last two into "no release"
 * would make an outage look like "nothing was ever published".
 */

const app = releaseRoutes();

// The production app maps HttpError through `onError`; this standalone app needs the same
// mapping so the test asserts the status a client actually receives.
app.onError((error, c) => {
  const status = error instanceof HttpError ? error.status : 500;
  return c.json(
    {
      error: {
        code: error instanceof HttpError ? error.code : "internal_error",
        message: error.message,
      },
    },
    status as 502
  );
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const RELEASE = {
  tag_name: "v0.6.0",
  name: "PROOFSTACK 0.6.0",
  html_url: "https://github.com/laudesmassamba1-ai/PROOFSTACK/releases/tag/v0.6.0",
  published_at: "2026-11-20T12:00:00Z",
  prerelease: false,
  assets: [
    {
      name: "proofcore-linux-x64",
      browser_download_url: "https://example.test/proofcore-linux-x64",
      size: 42_000_000,
      digest: "sha256:abcdef",
      content_type: "application/octet-stream",
    },
    {
      name: "notes.txt",
      browser_download_url: "https://example.test/notes.txt",
      size: 12,
    },
  ],
};

beforeEach(() => resetReleaseCache());
afterEach(() => vi.unstubAllGlobals());

describe("releases", () => {
  it("maps a published release to the assets the page can link to", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(RELEASE))
    );
    const response = await app.request("http://localhost/releases/latest");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      release: { tag: string; assets: { name: string; digest: string | null }[] };
    };
    expect(body.release.tag).toBe("v0.6.0");
    expect(body.release.assets).toHaveLength(2);
    expect(body.release.assets[0]).toMatchObject({
      name: "proofcore-linux-x64",
      digest: "sha256:abcdef",
    });
    // An asset without a digest is kept, with an explicit null rather than a made-up hash.
    expect(body.release.assets[1]?.digest).toBeNull();
  });

  it("says there is no release instead of failing when the repository has none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "Not Found" }, 404))
    );
    const response = await app.request("http://localhost/releases/latest");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ release: null });
  });

  it("reports an upstream failure as 502, not as an empty release list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "boom" }, 500))
    );
    const response = await app.request("http://localhost/releases/latest");
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("release_unavailable");
  });

  it("is reachable without a session through the real application", async () => {
    // This is the regression that mattered: the workspace router mounts a session guard on
    // `/api/v1/*`. Registered after it, the release route answered 401 to every anonymous
    // visitor, so the public download page only worked for signed-in users.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(RELEASE))
    );
    const db = NodeSqliteDatabase.open(":memory:");
    await migrate(db, migrationFiles());
    const { app: full } = createApp({ db, env: { NODE_ENV: "test" } });
    const response = await full.request("http://localhost/api/v1/releases/latest");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { release: { tag: string } }).release.tag).toBe("v0.6.0");
    await db.close();
  });

  it("serves the cached answer without calling the source twice", async () => {
    const fetchMock = vi.fn(async () => json(RELEASE));
    vi.stubGlobal("fetch", fetchMock);
    await app.request("http://localhost/releases/latest");
    await app.request("http://localhost/releases/latest");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
