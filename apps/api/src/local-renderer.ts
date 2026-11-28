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
          return { frames: frames.length, filled: filled.length };
        })()`
      )
      .catch(() => null)) as { frames?: number; filled?: number } | null;
    if (!state || state.frames === 0 || state.filled === state.frames) return;
    await delay(POLL_MS);
  }
}

/**
 * One tab kept open for the length of an audit.
 *
 * A JavaScript auth provider (Firebase, Supabase) keeps its session in the page's own
 * storage, not in a cookie. Opening a fresh tab per page therefore loses the session and
 * every private page silently falls back to the login screen — which is exactly how 23
 * pages ended up measured as 23 copies of `/login`. Reusing one tab keeps the session and
 * makes each page the page it claims to be.
 */
interface SharedTab {
  id: string;
  page: Awaited<ReturnType<typeof browsers.open>>["page"];
  lastUsed: number;
}

let shared: SharedTab | null = null;
const SHARED_IDLE_MS = 5 * 60_000;

async function tab(): Promise<SharedTab> {
  if (shared && Date.now() - shared.lastUsed < SHARED_IDLE_MS) {
    shared.lastUsed = Date.now();
    return shared;
  }
  if (shared) await browsers.close(shared.id).catch(() => undefined);
  const opened = await browsers.open({ url: "about:blank", headless: true, timeoutMs: 25_000 });
  shared = { id: opened.id, page: opened.page, lastUsed: Date.now() };
  return shared;
}

/** Releases the shared tab once the audit is over. */
export async function closeRendererTab(): Promise<void> {
  if (!shared) return;
  const id = shared.id;
  shared = null;
  await browsers.close(id).catch(() => undefined);
}

/** The renderer injected into the scanner by the local Node server. */
export const localRenderer: PageRenderer = {
  async render(input) {
    const current = await tab();
    const state = await current.page.navigate(input.url, {
      timeoutMs: input.timeoutMs ?? 20_000,
      settle: true,
    });
    await settle(current.page);
    const raw = (await current.page.evaluateScript(RENDERED_DOM_SCRIPT)) as {
      html?: string;
      url?: string;
    };
    const html = typeof raw.html === "string" ? raw.html : "";
    if (!html) return null;
    return {
      html,
      finalUrl: typeof raw.url === "string" && raw.url ? raw.url : (state.url ?? input.url),
      status: state.status ?? 200,
      basis: "rendered_dom",
    };
  },

  async signIn(input) {
    const current = await tab();
    await current.page.navigate(input.url, {
      timeoutMs: input.timeoutMs ?? 20_000,
      settle: true,
    });
    await settle(current.page);
    const snapshot = (await current.page.snapshot({ maxElements: 200 })) as {
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
        landedOn: current.page.url,
        cookie: null,
        reason: "no email/password field in the rendered form",
      };
    }
    await current.page.evaluateScript(
      buildSetValueExpression({ selector: email.selector, value: input.email })
    );
    await current.page.evaluateScript(
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
        landedOn: current.page.url,
        cookie: null,
        reason: "no submit button in the rendered form",
      };
    }
    await current.page.click({ selector: submit.selector });
    await delay(3_000);
    const landedOn = current.page.url;
    const cookies = await current.page.cookies().catch(() => []);
    const cookie = cookies
      .filter((item) => !/^_ga|^_gid|^_fbp/i.test(item.name))
      .map((item) => `${item.name}=${item.value}`)
      .join("; ");
    const after = (await current.page.evaluateScript(
      `(() => ({
        hasPassword: !!document.querySelector('input[type=password]'),
        text: (document.body ? document.body.innerText : '').slice(0, 4000),
        storage: (() => {
          const out = [];
          try { for (let i = 0; i < localStorage.length; i += 1) out.push(localStorage.key(i) ?? ''); } catch {}
          try { for (let i = 0; i < sessionStorage.length; i += 1) out.push(sessionStorage.key(i) ?? ''); } catch {}
          return out;
        })(),
      }))()`
    )) as { hasPassword: boolean; text: string; storage: string[] };
    // Firebase and other JavaScript auth providers keep the session in browser storage,
    // not in an HTTP cookie. A cookie is one proof among three, not a requirement: a
    // password form that disappeared, a dashboard that appeared, or an auth token in
    // storage each proves the visitor is signed in.
    const leftLogin = !/\/login|\/signin|\/connexion/i.test(new URL(landedOn).pathname);
    const dashboard = /dashboard|mon profil|d\u00e9connexion|sign out|logout/i.test(after.text);
    const authStorage = after.storage.some((key) => /firebase|auth|token|session|user/i.test(key));
    const ok = !after.hasPassword && (leftLogin || dashboard || authStorage || cookies.length > 0);
    return {
      ok,
      landedOn,
      cookie: cookie || null,
      reason: ok
        ? null
        : after.hasPassword
          ? "the page still shows a password form after submitting: credentials refused or JavaScript auth did not complete"
          : "no proof of a session: no cookie, no auth storage and the login page did not change",
    };
  },
};
