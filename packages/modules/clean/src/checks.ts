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

/** A hidden element is not announced, so a missing name on it is not a defect. */
function isHidden(tag: string): boolean {
  return /(?:^|\s)hidden(?=\s|\/?>)/i.test(tag) || /\baria-hidden\s*=\s*["']?true/i.test(tag);
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
  // Without a doctype the browser renders in quirks mode, which silently changes box
  // sizing and can break the layout on the very browsers the site supports.
  const doctype = /^\s*<!doctype\s+html\b/i.test(html);
  findings.push(
    finding(
      "doctype",
      shellOnly ? "SKIPPED" : doctype ? "PASS" : "FAIL",
      shellOnly ? shellObservation : doctype ? "html5 doctype" : "missing",
      "Without it the browser renders in quirks mode and layout rules change."
    )
  );
  const lang = attrTags(html, "html")[0] ? attr(attrTags(html, "html")[0] as string, "lang") : null;
  // `lang="english"` is not a language tag a screen reader can use; the value has to be
  // a BCP 47 tag such as `fr`, `en-GB` or `pt-BR`.
  const validLang = lang ? /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(lang.trim()) : false;
  findings.push(
    finding(
      "html_lang",
      !lang ? "FAIL" : validLang ? "PASS" : "WARN",
      !lang ? "no lang attribute" : validLang ? lang : `invalid: ${lang}`,
      "Without it screen readers read your page with the wrong pronunciation rules."
    )
  );
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  findings.push(
    finding(
      "title",
      title.length === 0 ? "FAIL" : title.length < 10 || title.length > 65 ? "WARN" : "PASS",
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
  const viewport = attrTags(html, "meta").find(
    (tag) => (attr(tag, "name") ?? "").toLowerCase() === "viewport"
  );
  const viewportContent = viewport ? (attr(viewport, "content") ?? "") : "";
  const viewportWidth = /width\s*=\s*device-width/i.test(viewportContent);
  const zoomBlocked = /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?\b/i.test(
    viewportContent
  );
  findings.push(
    finding(
      "viewport",
      !viewport ? "FAIL" : viewportWidth && !zoomBlocked ? "PASS" : "WARN",
      !viewport
        ? "meta viewport missing"
        : zoomBlocked
          ? "zoom disabled"
          : viewportWidth
            ? "width=device-width"
            : "no width=device-width",
      "Without it the page is rendered at desktop width on a phone; blocking zoom takes the choice away."
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
  // Skipping a level (`h1` then `h4`) breaks the outline a screen reader announces.
  const headingJump = headings.findIndex(
    (level, index) => index > 0 && level - (headings[index - 1] as number) > 1
  );
  findings.push(
    finding(
      "heading_order",
      shellOnly ? "SKIPPED" : headingJump > 0 ? "WARN" : "PASS",
      shellOnly
        ? shellObservation
        : headingJump > 0
          ? `h${headings[headingJump - 1]} then h${headings[headingJump]}`
          : `${headings.length} heading(s) in order`,
      "A skipped heading level is a gap in the page outline screen readers navigate by."
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
  // A duplicate id is invalid HTML and breaks `label for`, `aria-labelledby` and anchors:
  // the browser resolves the first one, so the second control silently loses its name.
  const ids = [...html.matchAll(/\sid\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map(
    (match) => match[2] ?? match[3] ?? match[4] ?? ""
  );
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  findings.push(
    finding(
      "duplicate_ids",
      shellOnly ? "SKIPPED" : duplicateIds.length > 0 ? "WARN" : "PASS",
      shellOnly
        ? shellObservation
        : duplicateIds.length > 0
          ? `${duplicateIds.length} duplicated: ${duplicateIds.slice(0, 3).join(", ")}`
          : "no duplicate id",
      "A duplicate id makes the browser resolve the wrong label or anchor target."
    )
  );
  // A link whose name is empty, or is "click here", is unusable when a screen reader
  // lists links out of context — which is exactly how they are navigated.
  const GENERIC_LINK_TEXT = new Set([
    "click here",
    "here",
    "read more",
    "learn more",
    "more",
    "en savoir plus",
    "cliquez ici",
    "ici",
    "lire la suite",
    "plus",
  ]);
  const anchors = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)]
    .map((match) => match[0])
    .filter((tag) => {
      const open = tag.slice(0, tag.indexOf(">") + 1);
      return attr(open, "href") !== null && !isHidden(open);
    });
  let unnamedLinks = 0;
  let genericLinks = 0;
  for (const tag of anchors) {
    const open = tag.slice(0, tag.indexOf(">") + 1);
    const inner = tag.slice(tag.indexOf(">") + 1, tag.lastIndexOf("</a>"));
    const visible = inner
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z0-9#]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const imageAlt = [...inner.matchAll(/<img\b[^>]*>/gi)]
      .map((match) => attr(match[0], "alt") ?? "")
      .join(" ")
      .trim();
    const referenced = (attr(open, "aria-labelledby") ?? "").trim();
    const name =
      referenced ||
      (attr(open, "aria-label") ?? "").trim() ||
      (attr(open, "title") ?? "").trim() ||
      visible ||
      imageAlt;
    if (!name) unnamedLinks += 1;
    // A reference names the link with another element's text, so the visible word
    // here is not what a screen reader announces and must not be judged as generic.
    else if (!referenced && GENERIC_LINK_TEXT.has(name.toLowerCase())) genericLinks += 1;
  }
  findings.push(
    finding(
      "link_text",
      shellOnly
        ? "SKIPPED"
        : anchors.length === 0
          ? "SKIPPED"
          : unnamedLinks > 0
            ? "FAIL"
            : genericLinks > 0
              ? "WARN"
              : "PASS",
      shellOnly
        ? shellObservation
        : anchors.length === 0
          ? "no links"
          : unnamedLinks > 0
            ? `${unnamedLinks} of ${anchors.length} with no accessible name`
            : genericLinks > 0
              ? `${genericLinks} generic link text`
              : `${anchors.length} named link(s)`,
      "A link read out of context must say where it goes; the name is all a screen reader has."
    )
  );
  const iframes = attrTags(html, "iframe").filter((tag) => !isHidden(tag));
  const untitledIframes = iframes.filter((tag) => (attr(tag, "title") ?? "").trim().length === 0);
  findings.push(
    finding(
      "iframe_title",
      shellOnly
        ? "SKIPPED"
        : iframes.length === 0
          ? "SKIPPED"
          : untitledIframes.length > 0
            ? "FAIL"
            : "PASS",
      shellOnly
        ? shellObservation
        : iframes.length === 0
          ? "no exposed iframe"
          : `${untitledIframes.length} of ${iframes.length} without a title`,
      "An iframe without a title is announced as an unnamed frame, with no hint of its content."
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
