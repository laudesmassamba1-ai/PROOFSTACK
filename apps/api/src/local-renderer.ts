/**
 * A browser renderer for the scanner, on the Node server only.
 *
 * The Worker has Cloudflare's Browser Rendering binding; this server has the machine's
 * Chromium. A page scan that only reads the HTTP response sees an empty shell for every
 * single-page application, finds no link, and reports a "site" of one page. This renderer
 * drives the same Chromium the interactive browser uses, waits for the application to draw
 * itself, and returns the real DOM — same-origin iframes included, because that is where
 * some sites put their entire interface.
 *
 * Node-only on purpose: it imports the CDP adapter through `node:child_process`. The Worker
 * entry never imports this file; `node.ts` injects it into the services, exactly like the
 * local scenario runner. A deployment without a renderer keeps measuring server HTML and
 * says so — nothing is faked.
 */
import { browsers, buildSetValueExpression } from "@proofcore/adapter-browser";
import type { PageRenderer } from "@proofcore/core";

/** Collect the top document and every same-origin iframe into one HTML string. */
const RENDERED_DOM_SCRIPT = `(() => {
  // outerHTML never includes the doctype (it sits outside the root element), and a page
  // measured without it would be reported as quirks-mode. Rebuild the real document.
  const doctype = document.doctype
    ? '<!DOCTYPE ' + document.doctype.name + (document.doctype.publicId ? ' PUBLIC "' + document.doctype.publicId + '"' : '') + (document.doctype.systemId ? ' "' + document.doctype.systemId + '"' : '') + '>'
    : '';
  const parts = [doctype + document.documentElement.outerHTML];
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    try {
      const doc = frame.contentDocument;
      if (doc && doc.documentElement) parts.push(doc.documentElement.outerHTML);
    } catch {
      // A cross-origin frame is not ours to read; the report must not claim it.
    }
  }
  return {
    html: parts.join('\\n'),
    url: location.href,
    readyState: document.readyState,
  };
})()`;

const SETTLE_MS = 1_200;
/** A page that mounts an iframe can take seconds to fill it; never wait without a bound. */
const MAX_SETTLE_MS = 6_000;
const POLL_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until the document has real content, including same-origin iframes.
 *
 * A fixed 1.2 s wait is not enough for a page whose interface is an iframe: the element
 * exists before its document is parsed, and reading it early yields an empty shell. We poll
 * for the iframe's body instead, with a hard ceiling so a slow site cannot stall a crawl.
 */
async function settle(page: {
  evaluateScript(expression: string): Promise<unknown>;
}): Promise<void> {
  await delay(SETTLE_MS);
  const deadline = Date.now() + MAX_SETTLE_MS;
  while (Date.now() < deadline) {
    const state = (await page
      .evaluateScript(
        `(() => {
          const frames = Array.from(document.querySelectorAll('iframe'));
          const filled = frames.filter((f) => {
            try { const d = f.contentDocument; return !!d && !!d.body && d.body.children.length > 0; }
            catch { return false; }
          });
          return { frames: frames.length, filled: filled.length, main: !!document.body && document.body.children.length > 0 };
        })()`
      )
      .catch(() => null)) as { frames?: number; filled?: number; main?: boolean } | null;
    if (!state || state.frames === 0 || state.filled === state.frames) return;
    await delay(POLL_MS);
  }
}

/** The renderer injected into the scanner by the local Node server. */
export const localRenderer: PageRenderer = {
  async render(input) {
    const opened = await browsers.open({
      url: input.url,
      headless: true,
      timeoutMs: input.timeoutMs ?? 20_000,
    });
    try {
      // Give the application time to mount, and its iframes time to fill. Bounded on
      // purpose: a site that never finishes still gets measured, with what was observed.
      await settle(opened.page);
      const raw = (await opened.page.evaluateScript(RENDERED_DOM_SCRIPT)) as {
        html?: string;
        url?: string;
        readyState?: string;
      };
      const html = typeof raw.html === "string" ? raw.html : "";
      if (!html) return null;
      return {
        html,
        finalUrl: typeof raw.url === "string" && raw.url ? raw.url : input.url,
        status: 200,
        basis: "rendered_dom",
      };
    } finally {
      // A tab per page: leaving it open would leak sessions across crawled pages.
      await browsers.close(opened.id).catch(() => undefined);
    }
  },

  async signIn(input) {
    const opened = await browsers.open({
      url: input.url,
      headless: true,
      timeoutMs: input.timeoutMs ?? 20_000,
    });
    try {
      await settle(opened.page);
      const snapshot = (await opened.page.snapshot({ maxElements: 200 })) as {
        elements?: { selector: string; type?: string; name: string; role: string }[];
      };
      const elements = snapshot.elements ?? [];
      const email =
        elements.find((field) => field.type === "email") ??
        elements.find((field) => /email|identifiant|mail/i.test(field.name));
      const password =
        elements.find((field) => field.type === "password") ??
        elements.find((field) => /mot de passe|password/i.test(field.name));
      if (!email || !password) {
        return {
          ok: false,
          landedOn: opened.page.url,
          cookie: null,
          reason: "no email/password field in the rendered form",
        };
      }
      await opened.page.evaluateScript(
        buildSetValueExpression({ selector: email.selector, value: input.email })
      );
      await opened.page.evaluateScript(
        buildSetValueExpression({ selector: password.selector, value: input.password })
      );
      const submit =
        elements.find(
          (element) =>
            element.role === "button" && /se connecter|sign in|login|connexion/i.test(element.name)
        ) ?? elements.find((element) => element.role === "button");
      if (!submit) {
        return {
          ok: false,
          landedOn: opened.page.url,
          cookie: null,
          reason: "no submit button in the rendered form",
        };
      }
      await opened.page.click({ selector: submit.selector });
      await delay(2_000);
      const landedOn = opened.page.url;
      const cookies = await opened.page.cookies().catch(() => []);
      const cookie = cookies
        .filter((item) => !/^_ga|^_gid|^_fbp/i.test(item.name))
        .map((item) => `${item.name}=${item.value}`)
        .join("; ");
      const stillForm = (await opened.page.evaluateScript(
        `!!document.querySelector('input[type=password]')
      `
      )) as boolean;
      const ok = !stillForm && cookies.length > 0;
      return {
        ok,
        landedOn,
        cookie: cookie || null,
        reason: ok
          ? null
          : stillForm
            ? "the page still shows a password form after submitting: credentials refused or JavaScript auth did not complete"
            : "no session cookie was set after submitting",
      };
    } finally {
      await browsers.close(opened.id).catch(() => undefined);
    }
  },
};
