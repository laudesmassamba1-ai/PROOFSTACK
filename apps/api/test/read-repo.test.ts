import { describe, expect, it } from "vitest";
import { readRepo } from "../src/routes/ai.js";

/**
 * `read_repo`: reading a public repository without cloning.
 *
 * The unit-level guarantees are tested here (host allowlist, URL parsing, no credential
 * assumed). The real GitHub call is exercised too, but skipped when the network is
 * unavailable so a sandboxed CI does not report a lie either way.
 */

const offline = Boolean(process.env.PROOFSTACK_OFFLINE);

/**
 * The live calls share the runner address with every other job on it.
 *
 * Unauthenticated GitHub allows 60 core calls per hour per IP; once exhausted it answers
 * 403 and a tree read looks like an empty repository. That is an external quota, not a
 * regression of this code, so the live tests are skipped with the measured reason instead
 * of failing the build — a skip is reported as a skip, never as a pass.
 */
async function githubQuotaExhausted(): Promise<boolean> {
  if (offline) return false;
  try {
    const response = await fetch("https://api.github.com/rate_limit", {
      headers: { accept: "application/json", "user-agent": "PROOFCORE-tests" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as {
      resources?: { core?: { remaining?: number } };
    };
    return body.resources?.core?.remaining === 0;
  } catch {
    return false;
  }
}

const liveSkip = offline
  ? "network disabled"
  : (await githubQuotaExhausted())
    ? "GitHub API quota exhausted"
    : false;

describe("read_repo", () => {
  it("refuses a host it does not know how to read", async () => {
    const result = await readRepo({ url: "https://bitbucket.org/owner/repo" });
    const body = JSON.parse(result.content) as { error: string; supported: string[] };
    expect(body.error).toBe("unsupported host");
    expect(body.supported).toContain("github.com");
  });

  it("refuses a malicious URL through the SSRF guard", async () => {
    const result = await readRepo({ url: "http://169.254.169.254/latest/meta-data" }).catch(
      (error: Error) => ({ content: JSON.stringify({ error: error.message }), summary: "refused" })
    );
    expect(result.summary).toBe("refused");
    expect(result.content).toMatch(/169\.254|blocked|private|loopback|not reachable/i);
  });

  it("refuses a URL that does not name owner/repo", async () => {
    const result = await readRepo({ url: "https://github.com/onlyowner" });
    expect(JSON.parse(result.content)).toMatchObject({
      error: expect.stringContaining("owner/repo"),
    });
  });

  it("reads a real public repository tree and file", {
    skip: liveSkip,
    timeout: 30_000,
  }, async () => {
    const tree = await readRepo({ url: "https://github.com/sindresorhus/is-plain-obj" });
    const parsed = JSON.parse(tree.content) as {
      repo?: string;
      files?: number;
      paths?: string[];
      error?: string;
    };
    expect(parsed.error).toBeUndefined();
    expect(parsed.repo).toBe("sindresorhus/is-plain-obj");
    expect(parsed.files).toBeGreaterThan(0);
    expect(parsed.paths).toContain("index.js");

    const file = await readRepo({
      url: "https://github.com/sindresorhus/is-plain-obj",
      path: "index.js",
    });
    const content = JSON.parse(file.content) as { content?: string; path?: string };
    expect(content.path).toBe("index.js");
    expect(content.content).toContain("export default");
  });

  it("reports a private or missing repository as not found, without pretending", {
    skip: liveSkip,
    timeout: 20_000,
  }, async () => {
    const result = await readRepo({ url: "https://github.com/proofcore/this-repo-does-not-exist" });
    const body = JSON.parse(result.content) as { error?: string; note?: string };
    expect(body.error).toMatch(/not found, or private/);
    expect(body.note).toContain("token");
  });
});
