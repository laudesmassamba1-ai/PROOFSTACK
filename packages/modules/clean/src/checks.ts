/**
 * CLEAN — interface quality, measured from the HTML that was served.
 *
 * The hard case is a page that draws itself in JavaScript. Its landmarks, headings, images
 * and labels are created after the response, so judging them here would report the absence
 * of a page that was never rendered as a defect of the interface. A shell is therefore
 * `SKIPPED` and the caller marks the module `not_measured`; only the metadata checks that
 * are decidable from the response still run.
 *
 * A check that does not apply is `SKIPPED` for the same reason: no images means image alt
 * text cannot be wrong, and saying "PASS" would claim a measurement nobody made.
 */

export type ScanStatus = "PASS" | "WARN" | "FAIL" | "SKIPPED";

export interface CleanFinding {
  module: "clean";
  id: string;
  status: ScanStatus;
  /** What was observed, in one line. Never a judgement: the raw fact. */
  observed: string;
  /** Why it matters, in one sentence. */
  why: string;
}

export interface CleanInput {
  /** The HTML body, already decoded. */
  html: string;
  /** The visible text, used to recognise a client-rendered shell. */
  text: string;
  /** Bytes read from the response, before decoding. */
  bytes: number;
}

function attrTags(html: string, tag: string): string[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))].map((match) => match[0]);
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[2] ?? match[3] ?? match[4] ?? "") : null;
}

function finding(id: string, status: ScanStatus, observed: string, why: string): CleanFinding {
  return { module: "clean", id, status, observed, why };
}

export function cleanFindings(input: CleanInput): CleanFinding[] {
  const { html, text, bytes } = input;
  const findings: CleanFinding[] = [];

  const shellOnly =
    text.length < 300 && /<script\b[^>]*\bsrc=/i.test(html) && !/<main\b/i.test(html);
  const shellObservation = "client-rendered shell; this requires a browser to measure";
  const lang = attrTags(html, "html")[0] ? attr(attrTags(html, "html")[0] as string, "lang") : null;
  findings.push(
    finding(
      "html_lang",
      lang ? "PASS" : "FAIL",
      lang ?? "no lang attribute",
      "Without it screen readers read your page with the wrong pronunciation rules."
    )
  );
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  findings.push(
    finding(
      "title",
      title.length === 0 ? "FAIL" : title.length > 65 ? "WARN" : "PASS",
      title.length === 0 ? "missing" : `${title.length} characters`,
      "The title is what a tab, a search result and a bookmark show."
    )
  );
  const description =
    attrTags(html, "meta").find(
      (tag) => (attr(tag, "name") ?? "").toLowerCase() === "description"
    ) ?? "";
  const descriptionContent = description ? (attr(description, "content") ?? "") : "";
  findings.push(
    finding(
      "meta_description",
      descriptionContent.length > 0 ? "PASS" : "WARN",
      descriptionContent ? `${descriptionContent.length} characters` : "missing",
      "Search engines and link previews use it to describe the page."
    )
  );
  findings.push(
    finding(
      "viewport",
      attrTags(html, "meta").some((tag) => (attr(tag, "name") ?? "").toLowerCase() === "viewport")
        ? "PASS"
        : "FAIL",
      "meta viewport",
      "Without it the page is rendered at desktop width on a phone."
    )
  );
  const landmarks = ["main", "nav", "header", "footer"].filter((tag) =>
    new RegExp(`<${tag}\\b`, "i").test(html)
  );
  findings.push(
    finding(
      "landmarks",
      shellOnly ? "SKIPPED" : landmarks.length >= 3 ? "PASS" : "WARN",
      shellOnly ? shellObservation : landmarks.length > 0 ? landmarks.join(", ") : "none",
      "Landmarks are how a screen-reader user jumps between regions."
    )
  );
  const images = attrTags(html, "img");
  const withoutAlt = images.filter((tag) => attr(tag, "alt") === null).length;
  findings.push(
    finding(
      "image_alt",
      shellOnly
        ? "SKIPPED"
        : images.length === 0
          ? "SKIPPED"
          : withoutAlt === 0
            ? "PASS"
            : withoutAlt <= images.length / 4
              ? "WARN"
              : "FAIL",
      shellOnly
        ? shellObservation
        : images.length === 0
          ? "no images"
          : `${withoutAlt} of ${images.length} without alt`,
      "An image with no alt is silence to a screen reader."
    )
  );
  const headings = [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
  const h1 = headings.filter((level) => level === 1).length;
  findings.push(
    finding(
      "headings",
      shellOnly ? "SKIPPED" : h1 === 0 ? "FAIL" : h1 > 1 ? "WARN" : "PASS",
      shellOnly ? shellObservation : `${h1} h1, ${headings.length} heading(s)`,
      "One h1 and an ordered outline is how the page is navigated without a mouse."
    )
  );
  const weightKb = Math.round(bytes / 1024);
  findings.push(
    finding(
      "html_weight",
      weightKb < 200 ? "PASS" : weightKb < 600 ? "WARN" : "FAIL",
      `${weightKb} kB of HTML`,
      "The HTML alone is what has to arrive before anything can be drawn."
    )
  );
  const inlineStyles = (html.match(/\bstyle="/g) ?? []).length;
  findings.push(
    finding(
      "inline_styles",
      inlineStyles === 0 ? "PASS" : inlineStyles < 40 ? "WARN" : "FAIL",
      `${inlineStyles} inline style attribute(s)`,
      "Inline styles defeat caching and make theming a rewrite."
    )
  );
  const inputs = attrTags(html, "input").filter(
    (tag) => !["hidden", "submit", "button"].includes((attr(tag, "type") ?? "text").toLowerCase())
  );
  // An id is not a label. The accessible name comes from aria-*, a <label for="id">,
  // a wrapping <label>, or a title. Counting the bare id made an unlabelled input pass.
  const labelTargets = new Set(
    [...html.matchAll(/<label\b[^>]*\bfor\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map(
      (match) => match[2] ?? match[3] ?? match[4] ?? ""
    )
  );
  const labelBlocks = [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)].map(
    (match) => match[0]
  );
  const labelled = inputs.filter((tag) => {
    const id = attr(tag, "id");
    return Boolean(
      attr(tag, "aria-label") ||
        attr(tag, "aria-labelledby") ||
        attr(tag, "title") ||
        (id && labelTargets.has(id)) ||
        labelBlocks.some((block) => block.includes(tag))
    );
  }).length;
  findings.push(
    finding(
      "field_labels",
      shellOnly
        ? "SKIPPED"
        : inputs.length === 0
          ? "SKIPPED"
          : labelled === inputs.length
            ? "PASS"
            : labelled >= inputs.length / 2
              ? "WARN"
              : "FAIL",
      shellOnly
        ? shellObservation
        : inputs.length === 0
          ? "no form fields"
          : `${inputs.length - labelled} of ${inputs.length} unlabelled`,
      "A field without a label is unusable with a screen reader."
    )
  );
  findings.push(
    finding(
      "rendered_dom",
      shellOnly ? "SKIPPED" : "PASS",
      shellOnly ? "the response is a client-rendered shell" : "content present in the HTML",
      "Checks about text and layout cannot judge a page that only draws itself in a browser."
    )
  );

  return findings;
}
