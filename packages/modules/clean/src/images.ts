/**
 * CLEAN — image quality, measured without seeing the picture.
 *
 * A vision model is not required to say something true about an image. The markup and the
 * bytes already answer the questions a visitor feels: is the picture announced at all, is
 * the alternative text a real description or a filename, does it declare its size (so the
 * layout does not jump), does it load at all, and is a "photo" actually a 1×1 tracking
 * pixel or an empty file.
 *
 * This module is deliberately deterministic: it reads `<img>` tags and, when the caller
 * supplies them, the probed responses. It never guesses what the picture shows, and it
 * never claims a measurement it did not make.
 */

export type ImageStatus = "PASS" | "WARN" | "FAIL" | "SKIPPED";

export interface ImageFinding {
  module: "clean";
  id: string;
  status: ImageStatus;
  observed: string;
  why: string;
}

/** What a probe of one image URL established. */
export interface ImageProbe {
  url: string;
  /** HTTP status, or null when the request could not be made. */
  status: number | null;
  /** Bytes actually received. */
  bytes: number | null;
  /** `image/png`, `image/svg+xml`, … when the server said so. */
  contentType: string | null;
  /** Pixel width/height when the format declares them (PNG, GIF, JPEG, WebP). */
  width?: number | null;
  height?: number | null;
}

export interface ImageAuditInput {
  html: string;
  /** Probes keyed by absolute URL. Absent means the network checks are SKIPPED. */
  probes?: Map<string, ImageProbe>;
  /** Absolute base for resolving relative `src`. */
  baseUrl?: string;
}

interface ImageTag {
  src: string | null;
  alt: string | null;
  width: string | null;
  height: string | null;
  loading: string | null;
  srcset: string | null;
  /** True when the tag is inside a link or button: its alt is the control's name. */
  decorativeHint: boolean;
}

function attrTags(html: string, tag: string): string[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))].map((match) => match[0]);
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[2] ?? match[3] ?? match[4] ?? "") : null;
}

function finding(id: string, status: ImageStatus, observed: string, why: string): ImageFinding {
  return { module: "clean", id, status, observed, why };
}

/** A filename is not a description: `IMG_2043.jpg` tells a screen reader nothing. */
function looksLikeFilename(alt: string): boolean {
  const value = alt.trim();
  if (value.length === 0) return false;
  return (
    /\.(?:jpe?g|png|gif|webp|avif|svg|bmp|tiff?)$/i.test(value) ||
    /^(?:img|dsc|image|photo|screenshot|capture)[-_ ]?\d+/i.test(value) ||
    /^[a-f0-9]{16,}$/i.test(value)
  );
}

/** The same alt repeated on many images is a template, not a description. */
function repeatedAlt(tags: ImageTag[]): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const tag of tags) {
    const alt = (tag.alt ?? "").trim();
    if (alt.length === 0) continue;
    counts.set(alt, (counts.get(alt) ?? 0) + 1);
  }
  let worst: { value: string; count: number } | null = null;
  for (const [value, count] of counts) {
    if (count >= 3 && (!worst || count > worst.count)) worst = { value, count };
  }
  return worst;
}

function absolute(src: string | null, base: string | undefined): string | null {
  if (!src) return null;
  if (/^data:/i.test(src)) return src;
  try {
    return new URL(src, base ?? "https://example.invalid/").toString();
  } catch {
    return null;
  }
}

/** Reads the `<img>` tags into the shape the checks need. */
export function readImages(html: string): ImageTag[] {
  return attrTags(html, "img").map((tag) => {
    const alt = attr(tag, "alt");
    return {
      src: attr(tag, "src"),
      alt,
      width: attr(tag, "width"),
      height: attr(tag, "height"),
      loading: attr(tag, "loading"),
      srcset: attr(tag, "srcset"),
      decorativeHint: alt !== null && alt.trim().length === 0,
    };
  });
}

/**
 * Audit the images of one document.
 *
 * Every finding is a fact about markup or bytes. A check whose input is missing is
 * SKIPPED with the reason, never PASS: "we did not look" and "it is fine" are different
 * statements, and a report that merges them is worthless.
 */
export function imageFindings(input: ImageAuditInput): ImageFinding[] {
  const images = readImages(input.html);
  const findings: ImageFinding[] = [];

  if (images.length === 0) {
    return [
      finding(
        "image_quality",
        "SKIPPED",
        "no img element in the document",
        "A page with no image has no image defect; this is not a pass."
      ),
    ];
  }

  // 1. Announced at all. `alt=""` is a deliberate decorative choice and counts as
  //    announced; a missing attribute is silence.
  const missingAlt = images.filter((tag) => tag.alt === null);
  findings.push(
    finding(
      "image_alt_present",
      missingAlt.length === 0 ? "PASS" : missingAlt.length <= images.length / 4 ? "WARN" : "FAIL",
      `${missingAlt.length} of ${images.length} img without an alt attribute`,
      "An image with no alt attribute is complete silence to a screen reader."
    )
  );

  // 2. A real description, not a filename or a template.
  const described = images.filter((tag) => (tag.alt ?? "").trim().length > 0);
  const filenames = described.filter((tag) => looksLikeFilename(tag.alt ?? ""));
  const repeated = repeatedAlt(images);
  const qualityIssues = filenames.length + (repeated ? repeated.count - 1 : 0);
  findings.push(
    finding(
      "image_alt_quality",
      described.length === 0
        ? "SKIPPED"
        : qualityIssues === 0
          ? "PASS"
          : qualityIssues <= described.length / 2
            ? "WARN"
            : "FAIL",
      described.length === 0
        ? "no non-empty alt text to judge"
        : `${filenames.length} filename-like alt${repeated ? `, "${repeated.value}" repeated ${repeated.count} times` : ""}`,
      "A filename or a copy-pasted label describes nothing; the alt is the image for anyone who cannot see it."
    )
  );

  // 3. Declared size. Without it the browser reserves no space and the layout jumps as
  //    each picture arrives — the defect visitors feel most on a phone.
  const unsized = images.filter((tag) => tag.width === null && tag.height === null);
  findings.push(
    finding(
      "image_dimensions",
      unsized.length === 0 ? "PASS" : unsized.length <= images.length / 2 ? "WARN" : "FAIL",
      `${unsized.length} of ${images.length} img without width/height`,
      "Without a declared size the page reflows while images load, which is a layout shift the visitor feels."
    )
  );

  // 4. Lazy loading. Below-the-fold images that all load eagerly are the usual reason a
  //    page is slow on a mobile connection.
  const eager = images.filter((tag) => (tag.loading ?? "").toLowerCase() !== "lazy");
  findings.push(
    finding(
      "image_loading",
      images.length < 4
        ? "SKIPPED"
        : eager.length === 0
          ? "PASS"
          : eager.length <= images.length / 2
            ? "WARN"
            : "FAIL",
      images.length < 4
        ? `only ${images.length} image(s): lazy loading is not the bottleneck`
        : `${eager.length} of ${images.length} img without loading="lazy"`,
      "Eagerly loading every image delays the text a visitor came for."
    )
  );

  // 5. Network facts, when the caller probed the URLs.
  if (!input.probes) {
    findings.push(
      finding(
        "image_reachable",
        "SKIPPED",
        "image URLs were not probed",
        "Whether a picture actually loads needs a request; without one this is not measured."
      )
    );
    return findings;
  }

  const probed: ImageProbe[] = [];
  for (const tag of images) {
    const url = absolute(tag.src, input.baseUrl);
    if (!url) continue;
    const probe = input.probes.get(url);
    if (probe) probed.push(probe);
  }
  if (probed.length === 0) {
    findings.push(
      finding(
        "image_reachable",
        "SKIPPED",
        "no image URL matched a probe",
        "The probe map did not cover the images on this page."
      )
    );
    return findings;
  }

  const broken = probed.filter((probe) => probe.status === null || probe.status >= 400);
  findings.push(
    finding(
      "image_reachable",
      broken.length === 0 ? "PASS" : broken.length <= probed.length / 4 ? "WARN" : "FAIL",
      `${broken.length} of ${probed.length} image(s) did not answer`,
      "A picture that does not load leaves a hole where the content was."
    )
  );

  const empty = probed.filter(
    (probe) => probe.status !== null && probe.status < 400 && (probe.bytes ?? 0) === 0
  );
  findings.push(
    finding(
      "image_not_empty",
      empty.length === 0 ? "PASS" : "FAIL",
      `${empty.length} of ${probed.length} image(s) answered with zero bytes`,
      "An empty response is a broken picture the server reports as a success."
    )
  );

  // A 1×1 (or 2×2) picture is a tracking pixel, not content: it is invisible, costs a
  // request, and is often a third-party beacon.
  const pixels = probed.filter(
    (probe) =>
      (probe.width ?? 0) > 0 &&
      (probe.height ?? 0) > 0 &&
      (probe.width ?? 0) <= 2 &&
      (probe.height ?? 0) <= 2
  );
  findings.push(
    finding(
      "image_tracking_pixels",
      pixels.length === 0 ? "PASS" : "WARN",
      `${pixels.length} of ${probed.length} image(s) are 1–2 px tracking pixels`,
      "An invisible pixel is a beacon: it costs a request and usually reports the visitor to a third party."
    )
  );

  const oversized = probed.filter((probe) => (probe.bytes ?? 0) > 500_000);
  findings.push(
    finding(
      "image_weight",
      oversized.length === 0 ? "PASS" : oversized.length <= 2 ? "WARN" : "FAIL",
      `${oversized.length} image(s) above 500 kB`,
      "One oversized picture costs more than the whole page around it on a mobile network."
    )
  );

  const wrongType = probed.filter(
    (probe) => probe.contentType !== null && !/^image\//i.test(probe.contentType)
  );
  findings.push(
    finding(
      "image_content_type",
      wrongType.length === 0 ? "PASS" : "FAIL",
      `${wrongType.length} image URL(s) answered with a non-image content type`,
      "A browser asked for an image and got something else: the picture cannot render."
    )
  );

  return findings;
}
