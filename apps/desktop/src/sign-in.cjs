/**
 * Direct sign-in against the site's own auth endpoint.
 *
 * The plan called for exactly this: the app posts the credentials to `/api/auth/sign-in/email`
 * — the same route the web app uses, same rate limiting, same cookie — and stores the session
 * it gets back. No browser round-trip, no second password manager entry.
 *
 * What this module is careful about:
 *
 * - **no account enumeration**: the API answers one message for "no such user" and "wrong
 *   password", and this module shows it verbatim rather than guessing harder;
 * - **the cookie is the session**: it is read from `Set-Cookie`, never from the body;
 * - **the server's expiry is the expiry**: `session.expiresAt` is stored, so the offline
 *   grace window is measured from what the server announced, not from a local guess;
 * - **credentials never touch disk**: they are used once, in memory.
 */

const SESSION_COOKIE = "ps_session";

/**
 * @param {object} input
 * @param {string} input.apiUrl     the site origin, e.g. https://proofcore-iota.vercel.app
 * @param {string} input.email
 * @param {string} input.password
 * @param {(url: string, init: object) => Promise<{status: number, headers: object, body: string}>} [input.post]
 *        injectable for tests; defaults to globalThis.fetch
 * @returns {Promise<{ok: true, session: object} | {ok: false, detail: string, code?: string}>}
 */
async function signInWithCredentials(input) {
  const post =
    input.post ??
    ((url, init) =>
      fetch(url, init).then(async (response) => ({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text(),
      })));
  const base = input.apiUrl.replace(/\/+$/, "");
  let response;
  try {
    response = await post(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: input.email, password: input.password }),
    });
  } catch (error) {
    return {
      ok: false,
      code: "network",
      detail: `Le site est injoignable (${error instanceof Error ? error.message : String(error)}). Vérifiez la connexion, ou réessayez plus tard.`,
    };
  }

  if (response.status === 429) {
    return {
      ok: false,
      code: "rate-limited",
      detail: "Trop de tentatives. Attendez quelques minutes avant de réessayer.",
    };
  }
  if (response.status >= 500) {
    return { ok: false, code: "server", detail: "Erreur du site. Réessayez dans un instant." };
  }
  if (response.status !== 200) {
    // The API's one-message rule: never distinguish "no account" from "wrong password".
    let detail = "Email ou mot de passe incorrect.";
    try {
      const parsed = JSON.parse(response.body);
      if (parsed?.message) detail = String(parsed.message);
      else if (parsed?.error?.message) detail = String(parsed.error.message);
    } catch {
      // keep the generic message
    }
    return { ok: false, code: "credentials", detail };
  }

  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    return { ok: false, code: "server", detail: "Réponse du site illisible." };
  }
  if (!payload?.user?.email) {
    return { ok: false, code: "credentials", detail: "Email ou mot de passe incorrect." };
  }

  const cookie = readSetCookie(response.headers, SESSION_COOKIE);
  if (!cookie) {
    return { ok: false, code: "server", detail: "Le site n'a pas renvoyé de session." };
  }

  return {
    ok: true,
    session: {
      apiUrl: base,
      cookie: `${SESSION_COOKIE}=${cookie}`,
      email: payload.user.email,
      savedAt: new Date().toISOString(),
      // The server decides how long this is good; the gate reads this first.
      ...(payload.session?.expiresAt ? { expiresAt: payload.session.expiresAt } : {}),
    },
  };
}

/** Pulls one cookie value out of a headers object that may hold several Set-Cookie lines. */
function readSetCookie(headers, name) {
  const raw = headers["set-cookie"];
  if (!raw) return null;
  for (const line of Array.isArray(raw) ? raw : String(raw).split(/,(?=[^;]+?=)/)) {
    const match = new RegExp(`(?:^|;\\s*)${name}=([^;\\s]+)`).exec(line);
    if (match) return match[1];
  }
  return null;
}

module.exports = { SESSION_COOKIE, readSetCookie, signInWithCredentials };
