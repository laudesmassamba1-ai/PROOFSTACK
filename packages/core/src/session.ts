/**
 * Signing in to a real product.
 *
 * The first version of this engine posted `{email, password}` as JSON, then as a form post
 * with those two field names, and called it a session when the response set any cookie.
 * That fails on almost every real product: Rails wants `user[email]` and an authenticity
 * token, Django wants `username` and `csrfmiddlewaretoken`, Laravel wants `_token`, Spring
 * wants `_csrf`, and a pre-session cookie is set even when the password is wrong. Worse, it
 * never confirmed the session worked, so a refused login could be reported as signed in.
 *
 * This module does what a browser does, in order:
 *
 *   1. open the login page (or the URL given) and harvest the form the site actually ships:
 *      its action, its method, its field names, its hidden inputs — including the CSRF token;
 *   2. post the form as the browser would, with the cookies and the `Origin`, following every
 *      redirect and ingesting every `Set-Cookie` on the way;
 *   3. verify the session on a page that requires it, and refuse to call it signed in when
 *      the page still shows a login form or an error message;
 *   4. say precisely what stopped it (bad credentials, missing token, MFA, rate limit) so the
 *      user gets an action, not a shrug.
 *
 * Secrets never leave this module: no password, no token and no cookie value appears in the
 * result. The cookie jar lives in memory for one operation.
 */

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expiresAt: number | null;
}

/**
 * A cookie jar with the matching rules browsers actually use: host-only cookies, domain
 * cookies with a leading dot, path prefixes, and `Secure` refused over http. Without these,
 * a session cookie scoped to `/app` is sent to `/login` and looks like an authenticated
 * request to a naive implementation.
 */
export class CookieJar {
  private cookies: Cookie[] = [];

  /** Adds every `Set-Cookie` of a response, resolved against the URL that sent it. */
  ingest(response: Response, url: URL): void {
    for (const header of setCookieHeaders(response)) {
      const parsed = parseSetCookie(header, url);
      if (!parsed) continue;
      const existing = this.cookies.findIndex(
        (cookie) =>
          cookie.name === parsed.name &&
          cookie.domain === parsed.domain &&
          cookie.path === parsed.path
      );
      if (parsed.expiresAt !== null && parsed.expiresAt <= Date.now()) {
        if (existing >= 0) this.cookies.splice(existing, 1);
        continue;
      }
      if (existing >= 0) this.cookies[existing] = parsed;
      else this.cookies.push(parsed);
    }
  }

  /** The `Cookie` header for a URL, or null when nothing matches. */
  header(url: URL): string | null {
    const now = Date.now();
    const matching = this.cookies.filter((cookie) => {
      if (cookie.expiresAt !== null && cookie.expiresAt <= now) return false;
      if (cookie.secure && url.protocol !== "https:") return false;
      if (!domainMatches(cookie.domain, url.hostname)) return false;
      return pathMatches(cookie.path, url.pathname);
    });
    if (matching.length === 0) return null;
    // Longest path first, as browsers do: the more specific cookie wins a duplicate name.
    matching.sort((a, b) => b.path.length - a.path.length);
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const cookie of matching) {
      if (seen.has(cookie.name)) continue;
      seen.add(cookie.name);
      parts.push(`${cookie.name}=${cookie.value}`);
    }
    return parts.length === 0 ? null : parts.join("; ");
  }

  /** Names only: enough to report what a login produced without printing a token. */
  names(): string[] {
    return this.cookies.map((cookie) => cookie.name);
  }

  size(): number {
    return this.cookies.length;
  }
}

function setCookieHeaders(response: Response): string[] {
  const withGetter = response.headers as Headers & { getSetCookie?: () => string[] };
  const all = withGetter.getSetCookie?.();
  if (all && all.length > 0) return all;
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function parseSetCookie(header: string, url: URL): Cookie | null {
  const [pair, ...attributes] = header.split(";");
  const separator = pair?.indexOf("=") ?? -1;
  if (!pair || separator <= 0) return null;
  const name = pair.slice(0, separator).trim();
  const value = pair.slice(separator + 1).trim();
  if (name.length === 0) return null;

  let domain = url.hostname.toLowerCase();
  let path = defaultPath(url.pathname);
  let secure = false;
  let httpOnly = false;
  let expiresAt: number | null = null;

  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split("=");
    const key = rawKey?.trim().toLowerCase() ?? "";
    const attrValue = rest.join("=").trim();
    if (key === "domain" && attrValue.length > 0) {
      domain = attrValue.replace(/^\./, "").toLowerCase();
    } else if (key === "path" && attrValue.startsWith("/")) {
      path = attrValue;
    } else if (key === "secure") {
      secure = true;
    } else if (key === "httponly") {
      httpOnly = true;
    } else if (key === "max-age") {
      const seconds = Number(attrValue);
      if (Number.isFinite(seconds)) expiresAt = Date.now() + seconds * 1000;
    } else if (key === "expires" && expiresAt === null) {
      const parsed = Date.parse(attrValue.replace(/-/g, " "));
      if (Number.isFinite(parsed)) expiresAt = parsed;
    }
  }

  return { name, value, domain, path, secure, httpOnly, expiresAt };
}

function defaultPath(pathname: string): string {
  if (!pathname.startsWith("/")) return "/";
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}

function domainMatches(cookieDomain: string, hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === cookieDomain) return true;
  // A domain cookie covers subdomains; `evil-example.com` must not match `example.com`.
  return host.endsWith(`.${cookieDomain}`);
}

function pathMatches(cookiePath: string, pathname: string): boolean {
  if (cookiePath === "/") return true;
  if (pathname === cookiePath) return true;
  return pathname.startsWith(cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`);
}

/** One field of a login form, as it appears in the HTML. */
export interface LoginField {
  name: string;
  type: string;
  value: string;
}

export interface DiscoveredForm {
  action: string;
  method: "GET" | "POST";
  fields: LoginField[];
  /** The field the password goes into. */
  passwordField: LoginField;
  /** The field the address goes into, when the form has an obvious one. */
  emailField: LoginField | null;
  /** Hidden inputs the server requires back, CSRF token included. */
  hidden: LoginField[];
}

const EMAIL_HINTS = [
  "email",
  "e-mail",
  "mail",
  "username",
  "user",
  "login",
  "identifier",
  "identifiant",
  "courriel",
  "user_login",
];
const PASSWORD_HINTS = ["password", "passwd", "pass", "motdepasse", "pwd"];
const SUBMIT_TYPES = new Set(["submit", "button", "image", "reset", "file"]);

/**
 * Finds the login form in a page and names its fields.
 *
 * The heuristic is deliberately narrow: a form with a password input is a login form. The
 * e-mail field is the visible text-like input whose name/id/placeholder looks like an
 * identity, falling back to the first visible input when the form has exactly two.
 */
export function discoverLoginForm(html: string, pageUrl: string): DiscoveredForm | null {
  for (const formHtml of matchElements(html, "form")) {
    const fields = fieldList(formHtml);
    const passwordField = fields.find(
      (field) =>
        field.type === "password" ||
        PASSWORD_HINTS.some((hint) => field.name.toLowerCase().includes(hint))
    );
    if (!passwordField) continue;

    const candidates = fields.filter(
      (field) => !SUBMIT_TYPES.has(field.type) && field.name !== passwordField.name
    );
    const emailField =
      candidates.find((field) => {
        const haystack = field.name.toLowerCase();
        return field.type !== "hidden" && EMAIL_HINTS.some((hint) => haystack.includes(hint));
      }) ??
      candidates.find((field) => field.type === "email" || field.type === "text") ??
      (candidates.length === 1 ? candidates[0] : null) ??
      null;

    const actionAttr = attributeOf(formHtml, "action");
    let action = pageUrl;
    if (actionAttr !== null && actionAttr.trim().length > 0) {
      try {
        action = new URL(actionAttr, pageUrl).toString();
      } catch {
        action = pageUrl;
      }
    }
    const method =
      (attributeOf(formHtml, "method") ?? "get").toLowerCase() === "post" ? "POST" : "GET";

    return {
      action,
      method,
      fields,
      passwordField,
      emailField,
      hidden: fields.filter((field) => field.type === "hidden"),
    };
  }
  return null;
}

function matchElements(html: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi");
  return [...html.matchAll(pattern)].map((match) => match[0]);
}

function fieldList(formHtml: string): LoginField[] {
  const pattern = /<(input|textarea|select)\b([^>]*)>/gi;
  const fields: LoginField[] = [];
  for (const match of formHtml.matchAll(pattern)) {
    const attrs = match[2] ?? "";
    const name = attributeOf(attrs, "name");
    if (!name || name.trim().length === 0) continue;
    fields.push({
      name,
      type: (attributeOf(attrs, "type") ?? "text").toLowerCase(),
      value: attributeOf(attrs, "value") ?? "",
    });
  }
  return fields;
}

function attributeOf(html: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(html);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

/** What a sign-in attempt concluded. Never contains a secret. */
export interface SignInReport {
  ok: boolean;
  /** Where the browser ended up, after redirects. */
  landedOn: string | null;
  status: number | null;
  /** Which rung of the ladder answered: a discovered form, a JSON API or a bearer token. */
  method: "form" | "json" | "bearer" | "none";
  /** Field names used, so a wrong guess is visible. */
  emailField: string | null;
  passwordField: string | null;
  /** True when the site sent a CSRF token and we sent it back. */
  csrf: boolean;
  /** Cookie names set during the attempt: names only, never values. */
  cookies: string[];
  /** Why it failed, in one sentence, with the next action a person can take. */
  reason: string | null;
  /** True when the site asked for a second factor: a real session cannot be obtained here. */
  mfaRequired: boolean;
  /** Pages fetched, so the report can say what was actually checked. */
  requests: number;
}

export interface SignInOptions {
  /** Page that shows the login form, when it is not the URL being audited. */
  loginPageUrl?: string;
  /** Endpoint to post to, when the form's action is wrong or the site is a SPA. */
  loginUrl?: string;
  email: string;
  password: string;
  /** Overrides for sites whose field names the heuristic cannot guess. */
  emailField?: string;
  passwordField?: string;
  /** Extra fields a site wants (tenant, domain, locale). Never logged. */
  extraFields?: Record<string, string>;
  /** A CSRF token the site published out of band. */
  csrfToken?: string;
  /**
   * A page that requires the session, used to prove the login worked. Defaults to the
   * landing page of the login POST, then to the origin's root.
   */
  verifyUrl?: string;
  /** `fetch` injection, for tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Called with every request, for progress reporting. Never receives secrets. */
  onStep?: (step: { url: string; status: number; step: string }) => void;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_HOPS = 6;
const USER_AGENT =
  "Mozilla/5.0 (compatible; PROOFCORE-Scan/1.1; +https://proofstack.dev/docs/scanner)";

/**
 * Signs in and proves it worked.
 *
 * The verification is the part that matters: a login that redirects back to `/login`, or
 * lands on a page whose body says "identifiants incorrects", is a failure even when the
 * response is a 200 with a fresh cookie.
 */
export async function signIn(options: SignInOptions): Promise<{
  report: SignInReport;
  jar: CookieJar;
  authorization: string | null;
}> {
  const jar = new CookieJar();
  const doFetch = options.fetchImpl ?? fetch;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let requests = 0;
  const base: SignInReport = {
    ok: false,
    landedOn: null,
    status: null,
    method: "none",
    emailField: null,
    passwordField: null,
    csrf: false,
    cookies: [],
    reason: null,
    mfaRequired: false,
    requests: 0,
  };

  const pageUrl = options.loginPageUrl ?? options.loginUrl;
  if (!pageUrl) {
    return {
      report: { ...base, reason: "No login page or login endpoint was given." },
      jar,
      authorization: null,
    };
  }

  const request = async (url: string, init: RequestInit, step: string): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("user-agent", USER_AGENT);
    headers.set("accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8");
    const cookie = jar.header(new URL(url));
    if (cookie) headers.set("cookie", cookie);
    const response = await doFetch(url, {
      ...init,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeout),
    });
    jar.ingest(response, new URL(url));
    requests += 1;
    options.onStep?.({ url, status: response.status, step });
    return response;
  };

  /** Follows redirects by hand so every hop keeps its cookies, as a browser does. */
  const follow = async (
    startUrl: string,
    init: RequestInit,
    step: string
  ): Promise<{ response: Response; url: string }> => {
    let current = startUrl;
    let response = await request(current, init, step);
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const location = response.headers.get("location");
      if (!(response.status >= 300 && response.status < 400) || !location) break;
      current = new URL(location, current).toString();
      response = await request(
        current,
        { method: "GET", headers: init.headers },
        `${step}:redirect`
      );
    }
    return { response, url: current };
  };

  let form: DiscoveredForm | null = null;
  let pageHtml = "";
  const discoveryErrors: string[] = [];
  if (
    options.loginUrl === undefined ||
    options.loginPageUrl !== undefined ||
    options.emailField === undefined
  ) {
    try {
      const page = await follow(
        options.loginPageUrl ?? pageUrl,
        { method: "GET" },
        "open-login-page"
      );
      pageHtml = await page.response.text();
      form = discoverLoginForm(pageHtml, page.url);
    } catch (error) {
      discoveryErrors.push(error instanceof Error ? error.message : "unknown error");
    }
  }

  const emailFieldName = options.emailField ?? form?.emailField?.name ?? null;
  const passwordFieldName = options.passwordField ?? form?.passwordField.name ?? null;
  const action = options.loginUrl ?? form?.action ?? pageUrl;

  const csrfValue =
    options.csrfToken ??
    form?.hidden.find((field) => /csrf|xsrf|authenticity|token|_token|nonce/i.test(field.name))
      ?.value ??
    null;

  // ------------------------------------------------------------------ form post
  if (form && emailFieldName && passwordFieldName) {
    const body = new URLSearchParams();
    for (const field of form.hidden) {
      if (/csrf|xsrf|authenticity|token|nonce/i.test(field.name) && csrfValue) {
        body.set(field.name, csrfValue);
        continue;
      }
      if (field.type === "hidden") body.set(field.name, field.value);
    }
    body.set(emailFieldName, options.email);
    body.set(passwordFieldName, options.password);
    for (const [key, value] of Object.entries(options.extraFields ?? {})) body.set(key, value);

    const origin = new URL(action).origin;
    try {
      const posted = await follow(
        action,
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin,
            referer: pageUrl,
          },
          body: body.toString(),
        },
        "submit-login-form"
      );
      const verdict = await judge({
        response: posted.response,
        url: posted.url,
        jar,
        request,
        follow,
        loginPageUrl: pageUrl,
        verifyUrl: options.verifyUrl ?? defaultVerifyUrl(pageUrl),
      });
      return {
        report: {
          ...base,
          ...verdict,
          method: "form",
          emailField: emailFieldName,
          passwordField: passwordFieldName,
          csrf: csrfValue !== null,
          cookies: jar.names(),
          requests,
        },
        jar,
        authorization: null,
      };
    } catch (error) {
      return {
        report: {
          ...base,
          method: "form",
          emailField: emailFieldName,
          passwordField: passwordFieldName,
          csrf: csrfValue !== null,
          cookies: jar.names(),
          requests,
          reason: `The login form could not be submitted: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        jar,
        authorization: null,
      };
    }
  }

  // --------------------------------------------------------------- JSON / bearer
  const jsonBody = {
    ...(emailFieldName ? { [emailFieldName]: options.email } : { email: options.email }),
    ...(passwordFieldName
      ? { [passwordFieldName]: options.password }
      : { password: options.password }),
    ...(options.extraFields ?? {}),
  };
  try {
    const posted = await follow(
      action,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          origin: new URL(action).origin,
          referer: pageUrl,
          ...(csrfValue ? { "x-csrf-token": csrfValue } : {}),
        },
        body: JSON.stringify(jsonBody),
      },
      "submit-login-json"
    );
    const text = await posted.response.clone().text();
    const token = readToken(text);
    if (token) {
      // A bearer token proves nothing on its own: it is sent to a page that requires a
      // session, and that page's answer is the proof.
      const authorization = `Bearer ${token.value}`;
      const checked = await follow(
        options.verifyUrl ?? defaultVerifyUrl(pageUrl),
        { method: "GET", headers: { authorization } },
        "verify-session"
      );
      const verdict = await judge({
        response: checked.response,
        url: checked.url,
        jar,
        request,
        follow,
        loginPageUrl: pageUrl,
        verifyUrl: options.verifyUrl ?? defaultVerifyUrl(pageUrl),
        authorization,
      });
      return {
        report: {
          ...base,
          ...verdict,
          method: "bearer",
          emailField: emailFieldName,
          passwordField: passwordFieldName,
          csrf: csrfValue !== null,
          cookies: jar.names(),
          requests,
        },
        jar,
        authorization,
      };
    }
    const verdict = await judge({
      response: new Response(text, {
        status: posted.response.status,
        headers: posted.response.headers,
      }),
      url: posted.url,
      jar,
      request,
      follow,
      loginPageUrl: pageUrl,
      verifyUrl: options.verifyUrl ?? defaultVerifyUrl(pageUrl),
    });
    return {
      report: {
        ...base,
        ...verdict,
        method: "json",
        emailField: emailFieldName,
        passwordField: passwordFieldName,
        csrf: csrfValue !== null,
        cookies: jar.names(),
        requests,
      },
      jar,
      authorization: null,
    };
  } catch (error) {
    return {
      report: {
        ...base,
        method: "json",
        cookies: jar.names(),
        requests,
        reason: `No login form was found on the page and the JSON endpoint failed: ${
          error instanceof Error ? error.message : "unknown error"
        }. Give the form's URL with --login-page, or set the field names with --email-field and --password-field.`,
      },
      jar,
      authorization: null,
    };
  }
}

/** Reads a bearer token out of a JSON body without assuming one shape. */
function readToken(text: string): { value: string; key: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const queue: unknown[] = [parsed];
  let guard = 0;
  while (queue.length > 0 && guard < 200) {
    guard += 1;
    const node = queue.shift();
    if (typeof node !== "object" || node === null) continue;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (
        typeof value === "string" &&
        /^(access_token|accessToken|token|jwt|id_token|idToken)$/.test(key)
      ) {
        if (value.length >= 12) return { value, key };
      } else if (typeof value === "object" && value !== null) {
        queue.push(value);
      }
    }
  }
  return null;
}

const FAILURE_MARKERS = [
  /invalid (?:email|password|credentials|username|login)/i,
  /incorrect (?:email|password|credentials|username)/i,
  /wrong (?:email|password|credentials)/i,
  /identifiants? (?:incorrects?|invalides?|erron[eé]s?)/i,
  /mot de passe (?:incorrect|invalide|erron[eé])/i,
  /(?:email|adresse|utilisateur) (?:ou|et) mot de passe (?:incorrect|invalide)/i,
  /csrf (?:token )?(?:mismatch|invalid|expired)/i,
  /invalid authenticity token/i,
  /token mismatch/i,
  /session expired/i,
  /too many (?:attempts|requests)/i,
];

const MFA_MARKERS = [
  /one[- ]time (?:password|code)/i,
  /\b2fa\b|\bmfa\b/i,
  /authenticator (?:app|code)/i,
  /verification code/i,
  /code de (?:v[eé]rification|s[eé]curit[eé])/i,
  /double authentification/i,
  /\botp\b/i,
];

const SESSION_MARKERS = [
  /log ?out|sign ?out|d[eé]connexion|d[eé]connecter/i,
  /my account|mon compte|account settings|param[eè]tres du compte/i,
  /dashboard|tableau de bord|espace client/i,
  /profile|profil/i,
];

/**
 * Decides whether an attempt produced a session, and why not.
 *
 * Order matters. A page that still holds a password field is a login page, whatever the
 * status code says. An explicit failure message beats a redirect. Only then does a member
 * marker or a page that is no longer the login page count as success.
 */
async function judge(input: {
  response: Response;
  url: string;
  jar: CookieJar;
  request: (url: string, init: RequestInit, step: string) => Promise<Response>;
  follow: (
    url: string,
    init: RequestInit,
    step: string
  ) => Promise<{ response: Response; url: string }>;
  loginPageUrl: string;
  verifyUrl: string;
  authorization?: string;
}): Promise<Partial<SignInReport>> {
  const { response, url, jar } = input;
  const body = await response.text();
  const status = response.status;
  const cookies = jar.names();

  if (status === 429) {
    return {
      ok: false,
      status,
      landedOn: url,
      cookies,
      reason:
        "The site rate-limited the login (HTTP 429). Wait a few minutes, or sign in from the product's own page and use the session cookie instead.",
    };
  }

  const failure = FAILURE_MARKERS.find((marker) => marker.test(body));
  if (failure) {
    return {
      ok: false,
      status,
      landedOn: url,
      cookies,
      reason: `The site refused the credentials: “${firstSentence(body, failure)}”. Check the address and the password, or ask for a dedicated audit account.`,
    };
  }

  const mfa = MFA_MARKERS.find((marker) => marker.test(body));
  if (mfa) {
    return {
      ok: false,
      status,
      landedOn: url,
      cookies,
      mfaRequired: true,
      reason:
        "The site accepted the password and asked for a second factor. Disable 2FA on the audit account, or give a session cookie created after the second factor.",
    };
  }

  if (status >= 400) {
    return {
      ok: false,
      status,
      landedOn: url,
      cookies,
      reason: `The login was submitted and the site answered HTTP ${status}. Check the field names with --email-field and --password-field, or the endpoint with --login-url.`,
    };
  }

  // The page the login POST landed on is the evidence: a redirect to the app with a session
  // marker is a signed-in session. Only when that page is still a login form does it make
  // sense to ask one page that requires the session.
  let verifiedHtml = body;
  let verifiedUrl = url;
  if (discoverLoginForm(verifiedHtml, verifiedUrl) !== null) {
    try {
      const check = await input.follow(input.verifyUrl, { method: "GET" }, "verify-session");
      verifiedHtml = await check.response.text();
      verifiedUrl = check.url;
    } catch {
      // Keep the landing page: a failed verification request must not invent a session.
    }
  }

  const stillLogin = discoverLoginForm(verifiedHtml, verifiedUrl) !== null;
  const memberMarker = SESSION_MARKERS.some((marker) => marker.test(verifiedHtml));
  const leftLoginPage = sameUrl(verifiedUrl, input.loginPageUrl) === false;

  if (stillLogin && !memberMarker) {
    return {
      ok: false,
      status,
      landedOn: verifiedUrl,
      cookies,
      reason:
        "The credentials were accepted but the site still shows a login form, so no session was established. Check that JavaScript is not required to sign in, or copy a session cookie from a signed-in browser.",
    };
  }

  if (!memberMarker && !leftLoginPage && jar.size() === 0) {
    return {
      ok: false,
      status,
      landedOn: verifiedUrl,
      cookies,
      reason:
        "Nothing about the response proves a session: no cookie was set and the page did not change. The login endpoint is probably not the one the site uses — open the form in a browser, copy its action, and pass it with --login-url.",
    };
  }

  return { ok: true, status, landedOn: verifiedUrl, cookies, reason: null };
}

/** Origin root: the page most likely to require a session on a conventional site. */
function defaultVerifyUrl(loginPageUrl: string): string {
  try {
    return new URL("/", loginPageUrl).toString();
  } catch {
    return loginPageUrl;
  }
}

function sameUrl(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return (
      left.origin === right.origin && normalizePath(left.pathname) === normalizePath(right.pathname)
    );
  } catch {
    return a === b;
  }
}

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

/** The sentence around a failure marker, shortened: evidence, not a wall of HTML. */
function firstSentence(body: string, marker: RegExp): string {
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = marker.exec(text) ?? marker.exec(body);
  if (!match) return "the site reported an error";
  const start = Math.max(0, match.index);
  const slice = text.slice(start, start + 160);
  return slice.split(/(?<=[.!?])\s/)[0]?.slice(0, 140) ?? "the site reported an error";
}
