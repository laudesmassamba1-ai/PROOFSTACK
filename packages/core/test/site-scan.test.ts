import { describe, expect, it } from "vitest";
import type { CrawlPage, CrawlResult } from "../src/crawl.js";
import type { ScanFinding } from "../src/page-scan.js";
import { buildSiteFindings, scoreFindings, siteScore, wilsonLower } from "../src/site-scan.js";

/**
 * The site-level checks and the scoring maths.
 *
 * The scoring tests are written as arithmetic, not as snapshots: a number nobody can
 * recompute is a slogan, and a formula that changes silently is worse than no score.
 */

function page(overrides: Partial<CrawlPage> & { url: string }): CrawlPage {
  return {
    finalUrl: overrides.url,
    status: 200,
    contentType: "text/html",
    bytes: 30_000,
    durationMs: 120,
    depth: 0,
    html: "",
    title: "A page",
    links: [],
    externalLinks: [],
    assets: [],
    error: null,
    ...overrides,
  };
}

function crawl(pages: CrawlPage[], overrides: Partial<CrawlResult> = {}): CrawlResult {
  return {
    startUrl: "https://site.example/",
    origin: "https://site.example",
    pages,
    skipped: [],
    robots: { found: true, disallowed: [], crawlDelayMs: null },
    sitemap: { found: true, urls: pages.length },
    truncated: false,
    truncatedBy: null,
    durationMs: 900,
    requests: pages.length + 2,
    ...overrides,
  };
}

function finding(id: string, status: ScanFinding["status"]): ScanFinding {
  return { module: "clean", id, status, observed: "", why: "" };
}

describe("site findings", () => {
  it("names the broken links instead of counting them", () => {
    const pages = [
      page({ url: "https://site.example/" }),
      page({ url: "https://site.example/mentions", status: 404, error: "HTTP 404" }),
      page({ url: "https://site.example/tarifs", status: 500, error: "HTTP 500" }),
    ];
    const broken = buildSiteFindings({ crawl: crawl(pages), pages: [] }).find(
      (item) => item.id === "broken_links"
    );
    expect(broken?.status).toBe("FAIL");
    expect(broken?.observed).toContain("2 of 3");
    expect(broken?.pages).toEqual(["https://site.example/mentions", "https://site.example/tarifs"]);
  });

  it("catches two pages that share a title", () => {
    const pages = [
      page({ url: "https://site.example/a", title: "Boutique" }),
      page({ url: "https://site.example/b", title: "boutique" }),
      page({ url: "https://site.example/c", title: "Contact" }),
    ];
    const item = buildSiteFindings({ crawl: crawl(pages), pages: [] }).find(
      (entry) => entry.id === "duplicate_titles"
    );
    expect(item?.status).toBe("WARN");
    expect(item?.pages).toHaveLength(2);
  });

  it("flags a page that took too long, with its time", () => {
    const pages = [
      page({ url: "https://site.example/", durationMs: 200 }),
      page({ url: "https://site.example/lent", durationMs: 4200 }),
    ];
    const item = buildSiteFindings({ crawl: crawl(pages), pages: [] }).find(
      (entry) => entry.id === "slow_pages"
    );
    expect(item?.status).toBe("WARN");
    expect(item?.observed).toContain("4200 ms");
  });

  it("flags published source maps", () => {
    const pages = [
      page({
        url: "https://site.example/",
        assets: [{ kind: "script", url: "https://site.example/app.js.map" }],
      }),
    ];
    const item = buildSiteFindings({ crawl: crawl(pages), pages: [] }).find(
      (entry) => entry.id === "source_maps_exposed"
    );
    expect(item?.status).toBe("WARN");
    expect(item?.pages).toContain("https://site.example/app.js.map");
  });

  it("says a truncated crawl is truncated", () => {
    const item = buildSiteFindings({
      crawl: crawl([page({ url: "https://site.example/" })], {
        truncated: true,
        truncatedBy: "pages",
      }),
      pages: [],
    }).find((entry) => entry.id === "crawl_coverage");
    expect(item?.status).toBe("WARN");
    expect(item?.observed).toContain("page limit");
  });

  it("does not accuse a page of missing TLS when nothing was measured", () => {
    const item = buildSiteFindings({
      crawl: crawl([page({ url: "https://site.example/" })]),
      pages: [{ url: "https://site.example/", findings: [] }],
    }).find((entry) => entry.id === "pages_without_tls");
    // No page findings means no measurement: SKIPPED, never FAIL and never PASS.
    expect(item?.status).toBe("SKIPPED");
  });
});

describe("scoring", () => {
  it("brackets the true rate with a Wilson lower bound", () => {
    // 3 of 3: high but not 1.0 — three samples cannot prove perfection.
    expect(wilsonLower(3, 3)).toBeGreaterThan(0.3);
    expect(wilsonLower(3, 3)).toBeLessThan(0.85);
    // 30 of 30 is far more convincing than 3 of 3.
    expect(wilsonLower(30, 30)).toBeGreaterThan(wilsonLower(3, 3));
    // Nothing measured is zero, not one.
    expect(wilsonLower(0, 0)).toBe(0);
  });

  it("weights a high-risk failure above a low-risk one", () => {
    const low = scoreFindings(
      [
        { module: "fail", status: "PASS", risk: "high" },
        { module: "fail", status: "FAIL", risk: "low" },
      ],
      ["fail"]
    )[0];
    const high = scoreFindings(
      [
        { module: "fail", status: "PASS", risk: "low" },
        { module: "fail", status: "FAIL", risk: "high" },
      ],
      ["fail"]
    )[0];
    expect(low?.score).toBeGreaterThan(high?.score ?? 0);
  });

  it("never scores a module with nothing judged as a pass", () => {
    const score = scoreFindings(
      [
        { module: "world", status: "SKIPPED" },
        { module: "world", status: "SKIPPED" },
      ],
      ["world"]
    )[0];
    expect(score?.verdict).toBe("not_measured");
    expect(score?.score).toBe(0);
    expect(score?.coverage).toBe(0);
  });

  it("separates coverage from quality", () => {
    const score = scoreFindings(
      [
        { module: "clean", status: "PASS", risk: "medium" },
        { module: "clean", status: "PASS", risk: "medium" },
        { module: "clean", status: "SKIPPED", risk: "medium" },
        { module: "clean", status: "SKIPPED", risk: "medium" },
      ],
      ["clean"]
    )[0];
    expect(score?.coverage).toBe(0.5);
    expect(score?.verdict).toBe("pass");
  });

  it("discounts a site score when coverage is low, and says it is provisional", () => {
    const full = scoreFindings(
      [
        { module: "fail", status: "PASS", risk: "high" },
        { module: "fail", status: "PASS", risk: "high" },
      ],
      ["fail"]
    );
    const thin = scoreFindings(
      [
        { module: "fail", status: "PASS", risk: "high" },
        { module: "fail", status: "SKIPPED", risk: "high" },
        { module: "fail", status: "SKIPPED", risk: "high" },
        { module: "fail", status: "SKIPPED", risk: "high" },
      ],
      ["fail"]
    );
    const fullScore = siteScore(full);
    const thinScore = siteScore(thin);
    expect(fullScore.provisional).toBe(false);
    expect(thinScore.provisional).toBe(true);
    expect(thinScore.score).toBeLessThan(fullScore.score);
  });

  it("counts a warning as half a failure, so it still costs", () => {
    const clean = scoreFindings(
      [{ module: "clean", status: "PASS", risk: "medium" }],
      ["clean"]
    )[0];
    const warned = scoreFindings(
      [{ module: "clean", status: "WARN", risk: "medium" }],
      ["clean"]
    )[0];
    expect(warned?.score).toBeLessThan(clean?.score ?? 0);
    expect(warned?.score).toBeGreaterThan(0);
  });

  it("uses page findings when they exist", () => {
    const pages = [
      { url: "https://site.example/a", findings: [finding("tls", "FAIL")] },
      { url: "https://site.example/b", findings: [finding("tls", "PASS")] },
    ];
    const item = buildSiteFindings({
      crawl: crawl([
        page({ url: "https://site.example/a" }),
        page({ url: "https://site.example/b" }),
      ]),
      pages,
    }).find((entry) => entry.id === "pages_without_tls");
    expect(item?.status).toBe("FAIL");
    expect(item?.pages).toEqual(["https://site.example/a"]);
  });
});
