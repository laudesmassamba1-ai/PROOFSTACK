import { describe, expect, it } from "vitest";
import { type ImageProbe, imageFindings, readImages } from "../src/images.js";

/**
 * Image quality without a vision model.
 *
 * The point is that every verdict comes from markup or bytes. A check whose input is
 * missing must be SKIPPED, never PASS: "we did not look" and "it is fine" are different
 * claims, and a report that merges them is worthless.
 */

const statusOf = (findings: ReturnType<typeof imageFindings>, id: string) =>
  findings.find((item) => item.id === id)?.status;

const page = (body: string) =>
  `<!doctype html><html lang="fr"><body><main>${body}</main></body></html>`;

describe("image audit", () => {
  it("reads the attributes the checks depend on", () => {
    const images = readImages(
      '<img src="/a.png" alt="Équipe" width="800" height="600" loading="lazy">'
    );
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      src: "/a.png",
      alt: "Équipe",
      width: "800",
      height: "600",
      loading: "lazy",
    });
  });

  it("skips every image check when the page has no image", () => {
    const findings = imageFindings({ html: page("<h1>Texte seul</h1>") });
    expect(statusOf(findings, "image_quality")).toBe("SKIPPED");
  });

  it("fails a page where most images have no alt", () => {
    const html = page(
      '<img src="/a.png"><img src="/b.png"><img src="/c.png" alt="ok"><img src="/d.png">'
    );
    const findings = imageFindings({ html });
    expect(statusOf(findings, "image_alt_present")).toBe("FAIL");
  });

  it("treats an empty alt as a deliberate decorative choice", () => {
    const html = page('<img src="/a.png" alt=""><img src="/b.png" alt="Facture 2026-014">');
    const findings = imageFindings({ html });
    expect(statusOf(findings, "image_alt_present")).toBe("PASS");
  });

  it("catches a filename used as alt text", () => {
    const html = page(
      '<img src="/a.png" alt="IMG_2043.jpg"><img src="/b.png" alt="Photo du stand">'
    );
    const findings = imageFindings({ html });
    expect(statusOf(findings, "image_alt_quality")).not.toBe("PASS");
  });

  it("catches one alt repeated across many images", () => {
    const html = page(
      Array.from({ length: 5 }, (_, i) => `<img src="/p${i}.png" alt="Produit">`).join("")
    );
    const findings = imageFindings({ html });
    expect(statusOf(findings, "image_alt_quality")).toBe("FAIL");
  });

  it("fails images that declare no dimensions", () => {
    const html = page('<img src="/a.png" alt="a"><img src="/b.png" alt="b">');
    const findings = imageFindings({ html });
    expect(statusOf(findings, "image_dimensions")).toBe("FAIL");
  });

  it("skips lazy-loading advice on a page with few images", () => {
    const html = page('<img src="/a.png" alt="a" width="1" height="1">');
    expect(statusOf(imageFindings({ html }), "image_loading")).toBe("SKIPPED");
  });

  it("skips network checks when nothing was probed", () => {
    const html = page('<img src="/a.png" alt="a" width="10" height="10">');
    const findings = imageFindings({ html });
    expect(statusOf(findings, "image_reachable")).toBe("SKIPPED");
  });

  it("reports broken, empty, tracking and non-image responses from the probes", () => {
    const html = page(
      [
        '<img src="/ok.png" alt="ok" width="10" height="10">',
        '<img src="/broken.png" alt="broken" width="10" height="10">',
        '<img src="/empty.png" alt="empty" width="10" height="10">',
        '<img src="/pixel.png" alt="" width="1" height="1">',
        '<img src="/html.png" alt="html" width="10" height="10">',
      ].join("")
    );
    const probes = new Map<string, ImageProbe>([
      [
        "https://example.invalid/ok.png",
        {
          url: "https://example.invalid/ok.png",
          status: 200,
          bytes: 1200,
          contentType: "image/png",
          width: 10,
          height: 10,
        },
      ],
      [
        "https://example.invalid/broken.png",
        {
          url: "https://example.invalid/broken.png",
          status: 404,
          bytes: 0,
          contentType: "text/html",
        },
      ],
      [
        "https://example.invalid/empty.png",
        {
          url: "https://example.invalid/empty.png",
          status: 200,
          bytes: 0,
          contentType: "image/png",
        },
      ],
      [
        "https://example.invalid/pixel.png",
        {
          url: "https://example.invalid/pixel.png",
          status: 200,
          bytes: 43,
          contentType: "image/gif",
          width: 1,
          height: 1,
        },
      ],
      [
        "https://example.invalid/html.png",
        {
          url: "https://example.invalid/html.png",
          status: 200,
          bytes: 900,
          contentType: "text/html",
        },
      ],
    ]);
    const findings = imageFindings({ html, probes, baseUrl: "https://example.invalid/" });
    expect(statusOf(findings, "image_reachable")).not.toBe("PASS");
    expect(statusOf(findings, "image_not_empty")).toBe("FAIL");
    expect(statusOf(findings, "image_tracking_pixels")).toBe("WARN");
    expect(statusOf(findings, "image_content_type")).toBe("FAIL");
  });

  it("passes a page whose images are described, sized and reachable", () => {
    const html = page(
      [
        '<img src="/a.png" alt="Équipe au salon" width="800" height="600" loading="lazy">',
        '<img src="/b.png" alt="Stand numéro 12" width="800" height="600" loading="lazy">',
        '<img src="/c.png" alt="Badge visiteur" width="800" height="600" loading="lazy">',
        '<img src="/d.png" alt="Affiche du programme" width="800" height="600" loading="lazy">',
      ].join("")
    );
    const probes = new Map<string, ImageProbe>(
      ["a", "b", "c", "d"].map((name) => [
        `https://example.invalid/${name}.png`,
        {
          url: `https://example.invalid/${name}.png`,
          status: 200,
          bytes: 20_000,
          contentType: "image/png",
          width: 800,
          height: 600,
        },
      ])
    );
    const findings = imageFindings({ html, probes, baseUrl: "https://example.invalid/" });
    for (const id of [
      "image_alt_present",
      "image_alt_quality",
      "image_dimensions",
      "image_loading",
      "image_reachable",
      "image_not_empty",
      "image_tracking_pixels",
      "image_weight",
      "image_content_type",
    ]) {
      expect(statusOf(findings, id), id).toBe("PASS");
    }
  });
});
