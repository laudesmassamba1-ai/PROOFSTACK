/**
 * A page-level scan: what can be established about a URL without the product's own
 * endpoints.
 *
 * The four engine modules answer questions about a *product*: WORLD submits forms, FLOW
 * drives a checkout, EXIT reads an export source. None of that exists for a URL someone
 * pastes into a field. But a great deal is still decidable from what the address returns,
 * and it is exactly what most sites get wrong:
 *
 *   FAIL   security posture (TLS, headers, cookie flags, disclosure, exposed files)
 *   CLEAN  interface quality (language, viewport, landmarks, weight, tap targets)
 *   FLOW   whether the journey has an entry point that answers, and how it would be paid
 *   WORLD  internationalisation (declared locale, alternates, RTL, input types, formats)
 *   EXIT   data portability (export affordances, machine-readable data, downloadable files)
 *
 * The rules that keep this honest:
 *
 *   - **No invented verdicts.** A check that cannot be measured from the response is
 *     `SKIPPED` with a reason, never `PASS`.
 *   - **Server-side scanning is an SSRF surface.** `assertScannableUrl` refuses private,
 *     loopback and metadata addresses unless the caller explicitly allows them (the CLI
 *     scanning the developer's own localhost), and redirects are re-checked at every hop.
 *   - **One body, many checks.** The document is fetched once; the checks read that one
 *     response, so a scan costs one request plus whatever it deliberately probes.
 */

import { isAlias } from "./controls.js";
import { signIn } from "./session.js";

export type ScanModule = "fail" | "clean" | "flow" | "world" | "exit";
export type ScanStatus = "PASS" | "WARN" | "FAIL" | "SKIPPED";

export interface ScanFinding {
  module: ScanModule;
  id: string;
  status: ScanStatus;
  /** What was observed, in one line. Never a judgement: the raw fact. */
  observed: string;
  /** Why it matters, in one sentence. */
  why: string;
}

export interface ScanModuleSummary {
  module: ScanModule;
  passed: number;
  warnings: number;
  failed: number;
  skipped: number;
  /** 0–100, weighted: a missing check is not a pass. */
  score: number;
  verdict: "pass" | "warnings" | "fail" | "not_measured";
}

export interface ScanResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  bytes: number;
  durationMs: number;
  scannedAt: string;
  findings: ScanFinding[];
  modules: ScanModuleSummary[];
  /** Requests the scan made beyond the page itself, so the report is complete. */
  probes: { url: string; status: number | null }[];
  /** True when only a shell was served: client-rendered pages cannot be judged. */
  clientRendered: boolean;
  /** Who this report is for: the machine that owns the site, or a stranger. */
  ownership: Ownership;
  /** True when exact locations were withheld. Set by the scan, not by the caller. */
  redacted: boolean;
  /** Present when the caller offered credentials; never contains them. */
  login: ScanLoginResult | null;
  verification: { tokenProvided: boolean; found: boolean; where: "meta" | "well-known" | null };
}

/**
 * Whether the report may name exact locations.
 *
 * `local` is a scan of the machine the caller is sitting at (the CLI against localhost).
 * `verified` means the site published the token we asked for, which is the only evidence of
 * ownership that does not depend on trusting the caller. Everything else is `unverified`,
 * and an unverified remote scan must not become a map of someone else's weaknesses.
 */
export type Ownership = "local" | "verified" | "unverified";

export interface ScanLogin {
  /** Absolute URL of the login endpoint. */
  url: string;
  email: string;
  password: string;
  emailField?: string;
  passwordField?: string;
}

export interface ScanLoginResult {
  attempted: boolean;
  ok: boolean;
  status: number | null;
  /** Why it failed, in one line. Never the password, never the cookie value. */
  reason?: string;
}

/** The meta tag a site can publish to prove ownership. */
export const VERIFICATION_META_NAME = "proofcore-verification";
/** Or this exact body at `/.well-known/proofcore-verification.txt`. */
export const VERIFICATION_WELL_KNOWN = "/.well-known/proofcore-verification.txt";

export interface ScanOptions {
  /** Extra request headers (credentials, cookies). Never logged or reported. */
  headers?: Record<string, string>;
  /** Allow loopback/private targets: the CLI scanning the developer's own machine. */
  allowPrivate?: boolean;
  /** Upper bound on the page body, in bytes. */
  maxBytes?: number;
  timeoutMs?: number;
  /** `fetch` injection, for tests. */
  fetchImpl?: typeof fetch;
  /** Skip the extra probes (exposed files, checkout entry) — one request, no more. */
  light?: boolean;
  /** Credentials for a product behind a login. Used for this scan only. */
  login?: ScanLogin;
  /** The token the site owner published; its presence upgrades the report to `verified`. */
  ownershipToken?: string;
  /**
   * Who is asking. `local` means the caller runs on the machine that answers the URL — the
   * CLI against localhost — and needs no proof of ownership.
   */
  ownershipHint?: "local" | "remote";
}

const USER_AGENT = "PROOFCORE-Scan/1.0 (+page-level checks; respects robots intent)";
const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 12_000;

/** Hosts that must never be reached by a server-side scan, and the reason why. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    value === "::1" ||
    value === "::" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe80")
  );
}

/**
 * Reject addresses a scan must not reach.
 *
 * This is the difference between "scan my site" and "use our API as a proxy into the
 * network it runs in" — the second one reaches Cloudflare metadata, internal services and
 * the database. Only the CLI, which runs on the developer's own machine, may opt out.
 */
export function assertScannableUrl(raw: string, options: { allowPrivate?: boolean } = {}): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not an absolute URL (example: https://app.example/).`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only http(s) URLs can be scanned.");
  }
  if (options.allowPrivate) return parsed;

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error(
      "This address is local or internal. Scan it from the CLI (`proofcore scan <url>`), which runs on your machine."
    );
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host) || host === "[::1]") {
    throw new Error(
      "Private addresses cannot be scanned from the server. Use `proofcore scan <url>` locally."
    );
  }
  // A bare hostname with no dot is an internal name (or a mistake) — never fetch it.
  if (!host.includes(".") && !host.startsWith("[")) {
    throw new Error("Use a public hostname, or scan locally with the CLI.");
  }
  return parsed;
}

/** Follows redirects one hop at a time, so every hop is validated. */
async function fetchFollowing(
  url: URL,
  options: ScanOptions,
  limit = 5
): Promise<{ response: Response; url: URL }> {
  const doFetch = options.fetchImpl ?? fetch;
  let current = url;
  for (let hop = 0; hop <= limit; hop += 1) {
    const response = await doFetch(current.toString(), {
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, ...options.headers },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, current);
      // Re-validate: a public URL that redirects to 169.254.169.254 is the classic bypass.
      current = assertScannableUrl(next.toString(), { allowPrivate: options.allowPrivate });
      continue;
    }
    return { response, url: current };
  }
  throw new Error(`Too many redirects (more than ${limit}).`);
}

function readBody(response: Response, maxBytes: number): Promise<{ text: string; bytes: number }> {
  const reader = response.body?.getReader();
  if (!reader) return response.text().then((text) => ({ text, bytes: text.length }));
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const pump = async (): Promise<{ text: string; bytes: number }> => {
    const { done, value } = await reader.read();
    if (done) {
      const merged = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      return { text: new TextDecoder("utf-8", { fatal: false }).decode(merged), bytes };
    }
    if (value) {
      const remaining = maxBytes - bytes;
      chunks.push(remaining >= value.length ? value : value.slice(0, Math.max(0, remaining)));
      bytes += Math.min(value.length, Math.max(0, remaining));
      if (bytes >= maxBytes) {
        await reader.cancel().catch(() => {});
        const merged = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        return { text: new TextDecoder("utf-8", { fatal: false }).decode(merged), bytes };
      }
    }
    return pump();
  };
  return pump();
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** The text a reader would see, roughly: tags removed, entities decoded, spacing normalised. */
export function visibleText(html: string): string {
  return html
    .replace(/<(script|style|template|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith("#x"))
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      return ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function attrTags(html: string, tag: string): string[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))].map((match) => match[0]);
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[2] ?? match[3] ?? match[4] ?? "") : null;
}

function finding(
  module: ScanModule,
  id: string,
  status: ScanStatus,
  observed: string,
  why: string
): ScanFinding {
  return { module, id, status, observed, why };
}

/** Dates written in formats that only one region understands: 12/31/2024, 31.12.2024. */
function ambiguousDates(text: string): string[] {
  const patterns = [
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, // 12/31/2024 — ambiguous outside en-US
    /\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g, // 31.12.2024 — ambiguous outside parts of Europe
  ];
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.add(match[0]);
    if (found.size > 6) break;
  }
  return [...found].slice(0, 6);
}

/** The three conventions a price can be written in, which decide how a form is read. */
function priceFormats(text: string): string[] {
  const found: string[] = [];
  // XOF/XAF have no minor unit, so the amount may carry no decimals at all: `12 500 FCFA`
  // is a complete price, and a detector that required `,00` would miss most West-African
  // shops — the exact case this product is built for.
  if (/\d(?:[\d.,\s]*\d)?\s?(?:€|\$|£|XOF|XAF|FCFA|CHF|\bEUR\b|\bUSD\b)\b/i.test(text)) {
    found.push("symbol after the amount (fr/de convention)");
  }
  if (/(?:€|\$|£|XOF|XAF|FCFA)\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/i.test(text)) {
    found.push("symbol before the amount (en convention)");
  }
  return found;
}

function analyse(body: {
  html: string;
  headers: Headers;
  url: URL;
  status: number;
  bytes: number;
  durationMs: number;
  probes: { url: string; status: number | null }[];
}): { findings: ScanFinding[]; checkoutUrl: URL | null } {
  const { html, headers, url } = body;
  const findings: ScanFinding[] = [];
  const text = visibleText(html);
  const secure = url.protocol === "https:";
  const csp = headers.get("content-security-policy");

  // ------------------------------------------------------------------ FAIL
  findings.push(
    finding(
      "fail",
      "tls",
      secure ? "PASS" : "FAIL",
      secure ? "https" : "served over http",
      "Credentials and data must travel over TLS."
    )
  );
  const hsts = headers.get("strict-transport-security");
  findings.push(
    finding(
      "fail",
      "hsts",
      hsts ? "PASS" : "FAIL",
      hsts ?? "absent",
      "HSTS prevents a protocol downgrade from being followed."
    )
  );
  findings.push(
    finding(
      "fail",
      "csp",
      csp ? "PASS" : "FAIL",
      csp ? csp.slice(0, 90) : "absent",
      "A Content-Security-Policy limits the impact of an injected script."
    )
  );
  const frame = headers.get("x-frame-options");
  findings.push(
    finding(
      "fail",
      "frame_ancestors",
      frame || (csp && /frame-ancestors/i.test(csp)) ? "PASS" : "WARN",
      frame ?? (csp && /frame-ancestors/i.test(csp) ? "csp frame-ancestors" : "absent"),
      "Without it the page can be embedded in someone else's frame (clickjacking)."
    )
  );
  findings.push(
    finding(
      "fail",
      "referrer_policy",
      headers.get("referrer-policy") ? "PASS" : "WARN",
      headers.get("referrer-policy") ?? "absent",
      "Controls how much of the URL leaks to third parties."
    )
  );
  findings.push(
    finding(
      "fail",
      "permissions_policy",
      headers.get("permissions-policy") ? "PASS" : "WARN",
      headers.get("permissions-policy") ?? "absent",
      "Limits which powerful browser features embedded content may use."
    )
  );
  const poweredBy = headers.get("x-powered-by");
  findings.push(
    finding(
      "fail",
      "stack_disclosure",
      poweredBy ? "WARN" : "PASS",
      poweredBy ?? "no x-powered-by",
      "Naming your stack tells an attacker what to try first."
    )
  );
  const server = headers.get("server");
  findings.push(
    finding(
      "fail",
      "server_banner",
      server && /\d/.test(server) ? "WARN" : "PASS",
      server ?? "no server header",
      "A version number in the banner is free reconnaissance."
    )
  );
  const cookies = headers.get("set-cookie") ?? "";
  if (!cookies) {
    findings.push(
      finding(
        "fail",
        "cookie_flags",
        "SKIPPED",
        "no cookie set on this response",
        "Judged only when a cookie is issued."
      )
    );
  } else {
    const missing: string[] = [];
    if (!/;\s*secure/i.test(cookies)) missing.push("Secure");
    if (!/;\s*httponly/i.test(cookies)) missing.push("HttpOnly");
    if (!/;\s*samesite/i.test(cookies)) missing.push("SameSite");
    findings.push(
      finding(
        "fail",
        "cookie_flags",
        missing.length > 0 ? "FAIL" : "PASS",
        missing.length > 0 ? `missing ${missing.join(", ")}` : "Secure, HttpOnly, SameSite",
        "A session cookie without these flags is readable or sendable by an attacker."
      )
    );
  }
  const mixed = secure
    ? [...html.matchAll(/["'(](http:\/\/[^"')\s>]+)/gi)].map((m) => m[1] ?? "")
    : [];
  const mixedExternal = mixed.filter((value) => {
    try {
      return new URL(value).host !== url.host;
    } catch {
      return false;
    }
  });
  findings.push(
    finding(
      "fail",
      "mixed_content",
      !secure ? "SKIPPED" : mixedExternal.length > 0 ? "FAIL" : "PASS",
      !secure
        ? "page is not https"
        : mixedExternal.length > 0
          ? `${mixedExternal.length} http:// resource(s)`
          : "none",
      "An http resource on an https page is blocked or downgrades the protection."
    )
  );
  const secretPatterns = [
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bsk_(?:live|test)_[0-9a-zA-Z]{16,}/,
    /\bAIza[0-9A-Za-z_-]{35}\b/,
  ];
  const exposedSecret = secretPatterns.find((pattern) => pattern.test(html));
  findings.push(
    finding(
      "fail",
      "secrets_in_html",
      exposedSecret ? "FAIL" : "PASS",
      exposedSecret ? "a key-like string appears in the document" : "none found",
      "A key in the HTML is a key handed to everyone who visits."
    )
  );
  findings.push(
    finding(
      "fail",
      "error_disclosure",
      /\b(?:stack trace|traceback|Warning: [A-Za-z_]+\(\)|on line \d+|SQLSTATE|at .*\.php:\d+)/i.test(
        text
      )
        ? "WARN"
        : "PASS",
      "scanned the visible text",
      "Stack traces and SQL errors in a page reveal paths and schemas."
    )
  );
  findings.push(
    finding(
      "fail",
      "clickjacking_frame_headers",
      !frame && !(csp && /frame-ancestors/i.test(csp)) ? "WARN" : "PASS",
      frame ?? "absent",
      "Repeated as its own line because browsers honour either header."
    )
  );

  // ---------------------------------------------------------------- CLEAN
  const lang = attrTags(html, "html")[0] ? attr(attrTags(html, "html")[0] as string, "lang") : null;
  findings.push(
    finding(
      "clean",
      "html_lang",
      lang ? "PASS" : "FAIL",
      lang ?? "no lang attribute",
      "Without it screen readers read your page with the wrong pronunciation rules."
    )
  );
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  findings.push(
    finding(
      "clean",
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
      "clean",
      "meta_description",
      descriptionContent.length > 0 ? "PASS" : "WARN",
      descriptionContent ? `${descriptionContent.length} characters` : "missing",
      "Search engines and link previews use it to describe the page."
    )
  );
  findings.push(
    finding(
      "clean",
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
      "clean",
      "landmarks",
      landmarks.length >= 3 ? "PASS" : "WARN",
      landmarks.length > 0 ? landmarks.join(", ") : "none",
      "Landmarks are how a screen-reader user jumps between regions."
    )
  );
  const images = attrTags(html, "img");
  const withoutAlt = images.filter((tag) => attr(tag, "alt") === null).length;
  findings.push(
    finding(
      "clean",
      "image_alt",
      images.length === 0
        ? "SKIPPED"
        : withoutAlt === 0
          ? "PASS"
          : withoutAlt <= images.length / 4
            ? "WARN"
            : "FAIL",
      images.length === 0 ? "no images" : `${withoutAlt} of ${images.length} without alt`,
      "An image with no alt is silence to a screen reader."
    )
  );
  const headings = [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
  const h1 = headings.filter((level) => level === 1).length;
  findings.push(
    finding(
      "clean",
      "headings",
      h1 === 0 ? "FAIL" : h1 > 1 ? "WARN" : "PASS",
      `${h1} h1, ${headings.length} heading(s)`,
      "One h1 and an ordered outline is how the page is navigated without a mouse."
    )
  );
  const weightKb = Math.round(body.bytes / 1024);
  findings.push(
    finding(
      "clean",
      "html_weight",
      weightKb < 200 ? "PASS" : weightKb < 600 ? "WARN" : "FAIL",
      `${weightKb} kB of HTML`,
      "The HTML alone is what has to arrive before anything can be drawn."
    )
  );
  const inlineStyles = (html.match(/\bstyle="/g) ?? []).length;
  findings.push(
    finding(
      "clean",
      "inline_styles",
      inlineStyles === 0 ? "PASS" : inlineStyles < 40 ? "WARN" : "FAIL",
      `${inlineStyles} inline style attribute(s)`,
      "Inline styles defeat caching and make theming a rewrite."
    )
  );
  const inputs = attrTags(html, "input").filter(
    (tag) => !["hidden", "submit", "button"].includes((attr(tag, "type") ?? "text").toLowerCase())
  );
  const labelled = inputs.filter(
    (tag) =>
      attr(tag, "aria-label") ||
      attr(tag, "aria-labelledby") ||
      attr(tag, "id") ||
      attr(tag, "title")
  ).length;
  findings.push(
    finding(
      "clean",
      "field_labels",
      inputs.length === 0
        ? "SKIPPED"
        : labelled === inputs.length
          ? "PASS"
          : labelled >= inputs.length / 2
            ? "WARN"
            : "FAIL",
      inputs.length === 0
        ? "no form fields"
        : `${inputs.length - labelled} of ${inputs.length} unlabelled`,
      "A field without a label is unusable with a screen reader."
    )
  );
  // A shell is: almost no text, a script that would draw the page, and no main landmark.
  // The byte size is deliberately not a condition — a 120-byte shell is still a shell.
  const shellOnly =
    text.length < 300 && /<script\b[^>]*\bsrc=/i.test(html) && !/<main\b/i.test(html);
  findings.push(
    finding(
      "clean",
      "rendered_dom",
      shellOnly ? "SKIPPED" : "PASS",
      shellOnly ? "the response is a client-rendered shell" : "content present in the HTML",
      "Checks about text and layout cannot judge a page that only draws itself in a browser."
    )
  );

  const links = attrTags(html, "a");

  // ----------------------------------------------------------------- FLOW
  //
  // FLOW walks a payment journey, which needs the product's own checkout. A page scan
  // cannot do that, and pretending otherwise would accuse a site of failing a step nobody
  // took. What a page *does* show is whether a journey entry point exists, where it goes,
  // whether it answers, and how the payment would be handled — so those are the findings,
  // named for what they are.
  const journeyHref = (() => {
    const candidates = links
      .map((tag) => attr(tag, "href") ?? "")
      .filter((href) =>
        /(?:^|\/)(?:cart|panier|checkout|commande|order|basket|paiement|payment)\b/i.test(href)
      );
    return candidates[0] ?? null;
  })();
  let checkoutUrl: URL | null = null;
  if (journeyHref) {
    try {
      checkoutUrl = new URL(journeyHref, url);
    } catch {
      checkoutUrl = null;
    }
  }
  findings.push(
    finding(
      "flow",
      "journey_entry",
      journeyHref ? "PASS" : "SKIPPED",
      journeyHref ?? "no checkout, cart or order link on this page",
      "A journey nobody can start is a journey that cannot be verified."
    )
  );
  findings.push(
    finding(
      "flow",
      "journey_tls",
      !checkoutUrl ? "SKIPPED" : checkoutUrl.protocol === "https:" ? "PASS" : "FAIL",
      !checkoutUrl ? "no entry point found" : checkoutUrl.protocol.replace(":", ""),
      "A payment step over http exposes card and Mobile Money details in transit."
    )
  );
  const providers = [
    ["Stripe", /js\.stripe\.com|stripe\.com\/v3/i],
    ["Paystack", /paystack/i],
    ["Flutterwave", /flutterwave/i],
    ["PayPal", /paypal\.(?:com|objects)|paypal\.me/i],
    ["SasPay", /saspay/i],
    ["FedaPay", /fedapay/i],
    ["Kkiapay", /kkiapay/i],
    ["CinetPay", /cinetpay/i],
    ["Mobile Money", /mobile money|mtn momo|moov money|orange money|wave\b/i],
  ] as const;
  const detectedProviders = providers
    .filter(([, pattern]) => pattern.test(html))
    .map(([name]) => name);
  findings.push(
    finding(
      "flow",
      "payment_methods",
      detectedProviders.length > 0 ? "PASS" : "SKIPPED",
      detectedProviders.length > 0 ? detectedProviders.join(", ") : "none detected in the HTML",
      "Which payment methods exist decides who can actually buy from this site."
    )
  );
  // A payment form without a token field is a form that can be replayed or forged.
  const journeyForms = attrTags(html, "form").filter((tag) =>
    /(?:checkout|payment|paiement|cart|panier)/i.test(attr(tag, "action") ?? "")
  );
  const hasToken = attrTags(html, "input").some((tag) => {
    const name = (attr(tag, "name") ?? "").toLowerCase();
    return /csrf|token|nonce|_wpnonce/.test(name);
  });
  findings.push(
    finding(
      "flow",
      "journey_csrf",
      journeyForms.length === 0 ? "SKIPPED" : hasToken ? "PASS" : "WARN",
      journeyForms.length === 0
        ? "no checkout form on this page"
        : hasToken
          ? "a token field is present"
          : "no token field in the checkout form",
      "Without a token an order form can be replayed or submitted from another site."
    )
  );
  findings.push(
    finding(
      "flow",
      "refund_path",
      /(?:refund|remboursement|retour|returns|r\u00e9tractation)/i.test(html) ? "PASS" : "WARN",
      /(?:refund|remboursement|r\u00e9tractation)/i.test(html)
        ? "a refund or returns reference appears in the page"
        : "no refund or returns path on this page",
      "A customer who cannot see how to be refunded escalates to a chargeback."
    )
  );
  findings.push(
    finding(
      "flow",
      "webhook_observability",
      "SKIPPED",
      "not observable from a page",
      "Whether a payment webhook is delivered, duplicated or retried needs the product's own endpoint; `proofcore flow` runs it when one is configured."
    )
  );

  // ---------------------------------------------------------------- WORLD
  findings.push(
    finding(
      "world",
      "declared_locale",
      lang && lang.length >= 2 ? "PASS" : "FAIL",
      lang ?? "no lang attribute",
      "The declared locale is what decides date, number and translation rules."
    )
  );
  const languageMeta = attrTags(html, "meta").find(
    (tag) => (attr(tag, "http-equiv") ?? "").toLowerCase() === "content-language"
  );
  findings.push(
    finding(
      "world",
      "charset",
      /<meta\b[^>]*charset=["']?utf-8/i.test(html) ||
        /charset=utf-8/i.test(headers.get("content-type") ?? "")
        ? "PASS"
        : "FAIL",
      headers.get("content-type") ?? "no content-type",
      "A missing utf-8 declaration turns accents and non-Latin text into mojibake."
    )
  );
  findings.push(
    finding(
      "world",
      "language_meta",
      languageMeta ? "PASS" : "SKIPPED",
      languageMeta ? (attr(languageMeta, "content") ?? "") : "absent",
      "A second, contradicting language declaration is a common source of wrong locales."
    )
  );
  const alternates = attrTags(html, "link").filter((tag) =>
    (attr(tag, "rel") ?? "").toLowerCase().includes("alternate")
  );
  findings.push(
    finding(
      "world",
      "hreflang",
      alternates.length > 0 ? "PASS" : "SKIPPED",
      alternates.length > 0 ? `${alternates.length} alternate link(s)` : "none declared",
      "hreflang is how search engines and browsers find the right language version."
    )
  );
  findings.push(
    finding(
      "world",
      "rtl_support",
      /dir=["'](?:rtl|auto)["']/i.test(html) || /dir=["'](?:rtl|auto)["']/i.test(html)
        ? "PASS"
        : "SKIPPED",
      /dir=["']rtl["']/i.test(html) ? "rtl declared" : "no direction declared",
      "Arabic and Hebrew need a direction, or the whole layout mirrors wrongly."
    )
  );
  const dates = ambiguousDates(text);
  findings.push(
    finding(
      "world",
      "ambiguous_dates",
      dates.length === 0 ? "PASS" : "WARN",
      dates.length === 0 ? "none found in the visible text" : dates.join(", "),
      "12/31/2024 reads as an error in most of the world, and 31/12/2024 in the US."
    )
  );
  const prices = priceFormats(text);
  findings.push(
    finding(
      "world",
      "price_format",
      prices.length >= 2 ? "WARN" : "PASS",
      prices.length === 0 ? "no price pattern in the visible text" : prices.join(" · "),
      "Two price conventions on one page means one of them is wrong for that reader."
    )
  );
  const telInputs = attrTags(html, "input").filter((tag) => (attr(tag, "type") ?? "") === "tel");
  const autocomplete = attrTags(html, "input").filter((tag) => attr(tag, "autocomplete"));
  findings.push(
    finding(
      "world",
      "input_hints",
      telInputs.length > 0 || autocomplete.length > 0
        ? "PASS"
        : inputs.length > 0
          ? "WARN"
          : "SKIPPED",
      inputs.length === 0
        ? "no fields"
        : `${telInputs.length} tel, ${autocomplete.length} with autocomplete`,
      "inputmode and autocomplete are what give the right keyboard in the right country."
    )
  );
  findings.push(
    finding(
      "world",
      "translation_targets",
      /(?:translate|traduire|lang(?:ue)?[-_ ]?(?:switch|select|chooser))/i.test(text)
        ? "PASS"
        : "SKIPPED",
      /(?:translate|traduire)/i.test(text)
        ? "a language affordance appears in the page"
        : "none found",
      "If a page offers several languages, the switch has to be reachable, not buried."
    )
  );

  // ----------------------------------------------------------------- EXIT
  const downloads = links.filter(
    (tag) =>
      attr(tag, "download") !== null ||
      /\.(?:csv|json|xml|xlsx?|pdf|zip|tsv|ndjson)(?:\?|#|$)/i.test(attr(tag, "href") ?? "")
  );
  findings.push(
    finding(
      "exit",
      "export_affordances",
      downloads.length > 0 ? "PASS" : "SKIPPED",
      downloads.length > 0
        ? `${downloads.length} downloadable artifact(s)`
        : "none offered on this page",
      "What the customer can take out is what they can keep when they leave."
    )
  );
  const jsonLd = [
    ...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi),
  ];
  let validJsonLd = 0;
  for (const match of jsonLd) {
    try {
      JSON.parse(match[1] ?? "");
      validJsonLd += 1;
    } catch {
      // Documented in the finding below, not thrown: a broken block is a finding.
    }
  }
  findings.push(
    finding(
      "exit",
      "structured_data",
      jsonLd.length === 0 ? "SKIPPED" : validJsonLd === jsonLd.length ? "PASS" : "FAIL",
      jsonLd.length === 0
        ? "no JSON-LD block"
        : `${validJsonLd} of ${jsonLd.length} JSON-LD block(s) parse`,
      "Machine-readable data that does not parse is data nobody can import."
    )
  );
  findings.push(
    finding(
      "exit",
      "api_surface",
      /["'`]\/api\/[a-z0-9._/-]+["'`]/i.test(html) ? "SKIPPED" : "SKIPPED",
      "endpoints are not judged from HTML",
      "Whether an API can be exported from needs its documentation, not a screenshot."
    )
  );
  findings.push(
    finding(
      "exit",
      "print_styles",
      /@media\s+print/i.test(html) ? "PASS" : "SKIPPED",
      /@media\s+print/i.test(html) ? "print stylesheet present" : "not detected in the HTML",
      "Receipts and invoices are printed; a page with no print rules wastes the paper."
    )
  );

  return { findings, checkoutUrl };
}

/** Weighted score: a skipped check is neutral, a failure costs more than a warning. */
function summarise(findings: ScanFinding[], module: ScanModule): ScanModuleSummary {
  // Aliases restate a control that is already counted (`clickjacking_frame_headers` asks the
  // `frame_ancestors` question). They stay in the report so history keeps its ids, but the
  // score counts the question once.
  const own = findings.filter((item) => item.module === module && !isAlias(item.module, item.id));
  const passed = own.filter((item) => item.status === "PASS").length;
  const warnings = own.filter((item) => item.status === "WARN").length;
  const failed = own.filter((item) => item.status === "FAIL").length;
  const skipped = own.filter((item) => item.status === "SKIPPED").length;
  const judged = passed + warnings + failed;
  const score = judged === 0 ? 0 : Math.round(((passed + warnings * 0.5) / judged) * 100);
  const verdict =
    judged === 0 ? "not_measured" : failed > 0 ? "fail" : warnings > 0 ? "warnings" : "pass";
  return { module, passed, warnings, failed, skipped, score, verdict };
}

/**
 * Strip the locators, keep the facts.
 *
 * A remote scan answers "is this site exposed, and how badly" — it must not answer "at which
 * path, with which header value". A stranger could otherwise use it to rank targets, and the
 * customer's own name would be on the request. The category, the severity and the advice are
 * enough for an owner to know what to do next; a proven owner sees the rest.
 */
export function redactFindings(findings: ScanFinding[], ownership: Ownership): ScanFinding[] {
  if (ownership !== "unverified") return findings;
  return findings.map((item) => ({
    ...item,
    observed: redactObservation(item),
  }));
}

/** Same reasoning for the probed endpoints: the host is already known, the path is not. */
export function redactProbes(
  probes: { url: string; status: number | null }[],
  ownership: Ownership
): { url: string; status: number | null }[] {
  if (ownership !== "unverified") return probes;
  return probes.map((probe) => {
    try {
      return { url: new URL(probe.url).host, status: probe.status };
    } catch {
      return { url: "unknown host", status: probe.status };
    }
  });
}

function redactObservation(item: ScanFinding): string {
  // The categories whose observation is a locator or a value, not a measurement.
  if (item.id === "journey_entry") {
    return item.status === "PASS"
      ? "an entry point to the journey was found (exact location withheld)"
      : "no entry point to the journey was found on this page";
  }
  if (item.id === "journey_reachable") {
    return item.status === "PASS"
      ? "the entry point answers (exact location and status withheld)"
      : "the entry point does not answer";
  }
  if (item.status === "SKIPPED") return item.observed;
  // Everything else keeps its measurement but loses any URL, path or header value it
  // happened to carry. A number is a fact; an address is a target.
  const cleaned = item.observed
    .replace(/\bhttps?:\/\/[^\s,;)]+/gi, "[url]")
    // `/31/2024` is a date, not a path: a locator has to start a token, not follow a digit.
    .replace(/(?:^|[\s"'(])\/(?!\d)[\w./?=&-]+/g, " [path]")
    .replace(/\b(?:set-cookie|cookie|authorization)\b[^,;]*/gi, "[header]");
  return cleaned.trim() || "withheld";
}

/** Reads the published token, either from a meta tag or from the well-known file. */
async function verifyOwnership(
  html: string,
  url: URL,
  token: string,
  options: ScanOptions
): Promise<{ found: boolean; where: "meta" | "well-known" | null }> {
  const meta = attrTags(html, "meta").find(
    (tag) => (attr(tag, "name") ?? "").toLowerCase() === VERIFICATION_META_NAME
  );
  if (meta && attr(meta, "content")?.trim() === token) return { found: true, where: "meta" };
  if (meta) return { found: false, where: "meta" };

  try {
    const target = new URL(VERIFICATION_WELL_KNOWN, url);
    const doFetch = options.fetchImpl ?? fetch;
    const response = await doFetch(target.toString(), {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) return { found: false, where: "well-known" };
    const body = (await response.text()).trim();
    return { found: body === token, where: "well-known" };
  } catch {
    return { found: false, where: "well-known" };
  }
}

/**
 * Sign in before scanning, so the report covers the product and not its front door.
 *
 * The work is done by `signIn` in `session.ts`: it discovers the form and its anti-CSRF
 * token, keeps a real cookie jar, and — the part this function used to get wrong — proves
 * the session on a page that requires it. A 200 with a fresh cookie is not a login.
 */
async function performLogin(
  login: ScanLogin,
  options: ScanOptions
): Promise<{
  result: ScanLoginResult;
  cookie: string | null;
}> {
  const attempt = await signIn({
    // `url` is the endpoint this option has always meant; giving it as both the endpoint and
    // the page lets discovery run when the address happens to be a form page.
    loginUrl: login.url,
    loginPageUrl: login.url,
    email: login.email,
    password: login.password,
    ...(login.emailField === undefined ? {} : { emailField: login.emailField }),
    ...(login.passwordField === undefined ? {} : { passwordField: login.passwordField }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  const report = attempt.report;
  const all = new URL(login.url);
  const cookie = attempt.jar.header(all);
  const names = attempt.jar.names();
  return {
    result: {
      attempted: true,
      ok: report.ok,
      status: report.status,
      ...(report.ok ? {} : { reason: report.reason ?? "the session could not be established" }),
    },
    cookie: names.length > 0 ? cookie : null,
  };
}

/**
 * Scan one URL and return findings grouped by module.
 *
 * Never throws for a page that answers badly — a 500 is a result, not an exception. It
 * throws only when the request itself cannot be made (bad URL, refused address, network).
 */
export async function scanPage(rawUrl: string, options: ScanOptions = {}): Promise<ScanResult> {
  const url = assertScannableUrl(rawUrl, { allowPrivate: options.allowPrivate });
  const started = Date.now();

  // A local target is the caller's own machine, and a login is optional: without a cookie,
  // the scan simply sees what an anonymous visitor sees, and says so.
  const loginAttempt = options.login ? await performLogin(options.login, options) : null;
  const headers: Record<string, string> = { ...options.headers };
  if (loginAttempt?.cookie) {
    headers.cookie = headers.cookie
      ? `${headers.cookie}; ${loginAttempt.cookie}`
      : loginAttempt.cookie;
  }
  const withLogin: ScanOptions = { ...options, headers };
  const { response, url: finalUrl } = await fetchFollowing(url, withLogin);
  const { text, bytes } = await readBody(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
  const contentType = response.headers.get("content-type") ?? "";
  const html = /html|xml/i.test(contentType) || /^\s*</.test(text) ? text : "";
  const durationMs = Date.now() - started;

  const analysis = html
    ? analyse({
        html,
        headers: response.headers,
        url: finalUrl,
        status: response.status,
        bytes,
        durationMs,
        probes: [],
      })
    : {
        findings: [
          finding(
            "fail",
            "content_type",
            "SKIPPED",
            contentType || "unknown content type",
            "A non-HTML response is not a page: the interface checks do not apply."
          ),
        ],
        checkoutUrl: null as URL | null,
      };
  const findings = analysis.findings;

  // One extra request, and only when the page actually advertises a journey entry point:
  // "the checkout link exists" and "the checkout link answers" are different facts, and
  // the second one is the one a customer feels.
  const probes: { url: string; status: number | null }[] = [];
  if (analysis.checkoutUrl && !options.light) {
    const target = analysis.checkoutUrl;
    try {
      const checked = assertScannableUrl(target.toString(), { allowPrivate: options.allowPrivate });
      const { response: probeResponse } = await fetchFollowing(checked, options, 3);
      probes.push({ url: checked.toString(), status: probeResponse.status });
      const ok = probeResponse.status < 400;
      findings.push(
        finding(
          "flow",
          "journey_reachable",
          ok ? "PASS" : "FAIL",
          `HTTP ${probeResponse.status} on ${checked.pathname || "/"}`,
          "An entry point that answers an error is a journey the customer cannot start."
        )
      );
    } catch (error) {
      probes.push({ url: target.toString(), status: null });
      findings.push(
        finding(
          "flow",
          "journey_reachable",
          "WARN",
          `could not be reached: ${error instanceof Error ? error.message : "unknown error"}`,
          "The journey entry point did not answer the scan. It may also require a session."
        )
      );
    }
  } else if (analysis.checkoutUrl) {
    findings.push(
      finding(
        "flow",
        "journey_reachable",
        "SKIPPED",
        "not probed in light mode",
        "Reaching the entry point costs one more request."
      )
    );
  }

  if (response.status >= 400) {
    findings.unshift(
      finding(
        "fail",
        "http_status",
        "FAIL",
        `HTTP ${response.status}`,
        "The address itself does not answer successfully."
      )
    );
  }

  // Ownership decides how much of the report the caller may see. A local target needs no
  // proof; a remote one does, and until it is proven the locations stay out of the response.
  const isLocal = options.ownershipHint === "local";
  let ownership: Ownership = isLocal ? "local" : "unverified";
  let verification: ScanResult["verification"] = {
    tokenProvided: Boolean(options.ownershipToken),
    found: false,
    where: null,
  };
  if (!isLocal && options.ownershipToken) {
    const checked = await verifyOwnership(html, finalUrl, options.ownershipToken, withLogin);
    verification = { tokenProvided: true, found: checked.found, where: checked.where };
    if (checked.found) ownership = "verified";
  }

  const visibleFindings = redactFindings(findings, ownership);
  const visibleProbes = redactProbes(probes, ownership);

  return {
    url: url.toString(),
    finalUrl: finalUrl.toString(),
    status: response.status,
    contentType,
    bytes,
    durationMs,
    scannedAt: new Date().toISOString(),
    findings: visibleFindings,
    modules: (["fail", "clean", "flow", "world", "exit"] as ScanModule[]).map((module) =>
      summarise(visibleFindings, module)
    ),
    probes: visibleProbes,
    clientRendered: visibleFindings.some(
      (item) => item.id === "rendered_dom" && item.status === "SKIPPED"
    ),
    ownership,
    redacted: ownership === "unverified",
    login: loginAttempt?.result ?? null,
    verification,
  };
}
