/**
 * The account gate.
 *
 * The rule from the product side: the app is unusable without a valid account, but an
 * account that was valid when the network went away keeps working for a while. So this
 * module answers one question - "may this machine run the tools right now, and why" - from
 * three facts: the stored session, the clock, and whether the site answered.
 *
 * It is deliberately a pure function of those facts. The desktop shell collects the facts
 * (keyring, clock, one HTTP call) and draws the result; every decision is testable without a
 * window, which is the only way to be sure a lockout is not a bug in the UI.
 *
 * Note on the token: this deployment issues an opaque session cookie (`ps_session=…`), not a
 * JWT, so there is no `exp` claim to read. A JWT is handled when present; otherwise the
 * grace window starts at the last time the site confirmed the session. Both paths end at the
 * same place: a deadline after which the app locks instead of pretending.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Reads the `exp` claim of a JWT. Returns null for an opaque token or anything malformed. */
function parseJwtExpiry(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Pulls the token out of the stored session, whichever shape it has. */
function sessionToken(session) {
  if (!session || typeof session !== "object") return null;
  if (typeof session.token === "string" && session.token) return session.token;
  if (typeof session.cookie === "string" && session.cookie) {
    // `ps_session=abc; other=1` -> `abc`, which is what is sent as a cookie value.
    const match = /(?:^|;\s*)ps_session=([^;]+)/.exec(session.cookie);
    return match?.[1] ?? session.cookie;
  }
  return null;
}

/**
 * @param {object} input
 * @param {object|null} input.session  the stored session ({cookie|token, savedAt, email, apiUrl})
 * @param {number} input.now           milliseconds
 * @param {boolean|null} input.online  true: the site answered 2xx; false: network error;
 *                                     null: not checked (offline-first start)
 * @param {number} [input.graceDays]   how long a confirmed session stays usable offline
 * @param {boolean} [input.revoked]    the site said the account is invalid (401/403)
 */
function evaluateAccess(input) {
  const { session, now, online, graceDays = 7, revoked = false } = input;
  const token = sessionToken(session);

  if (!session || !token) {
    return {
      allowed: false,
      status: "locked",
      reason: "no-session",
      detail: "Aucune session sur cette machine : connectez-vous avec votre compte PROOFCORE.",
      account: null,
      expiresAt: null,
      daysLeft: null,
    };
  }

  const account = typeof session.email === "string" ? session.email : null;

  if (revoked) {
    return {
      allowed: false,
      status: "locked",
      reason: "revoked",
      detail:
        "Le site refuse cette session (compte désactivé, abonnement terminé ou session révoquée).",
      account,
      expiresAt: null,
      daysLeft: null,
    };
  }

  const savedAt = typeof session.savedAt === "string" ? Date.parse(session.savedAt) : Number.NaN;
  const jwtExpiry = parseJwtExpiry(token);
  const expiresAt =
    jwtExpiry ??
    (Number.isFinite(savedAt) ? savedAt + graceDays * DAY_MS : now + graceDays * DAY_MS);

  if (now >= expiresAt) {
    return {
      allowed: false,
      status: "locked",
      reason: "expired",
      detail:
        online === false
          ? "La session a expiré et le site est injoignable : reconnectez-vous pour déverrouiller."
          : "La session a expiré : reconnectez-vous.",
      account,
      expiresAt,
      daysLeft: 0,
    };
  }

  const daysLeft = Math.max(1, Math.ceil((expiresAt - now) / DAY_MS));
  return {
    allowed: true,
    status: online === false ? "offline" : "online",
    reason: online === false ? "offline-grace" : "verified",
    detail:
      online === false
        ? `Hors ligne : les outils locaux restent disponibles ${daysLeft} jour(s), jusqu'à revalidation.`
        : `Compte vérifié${account ? ` : ${account}` : ""}.`,
    account,
    expiresAt,
    daysLeft,
  };
}

/** "3 j 4 h" - short enough for a status line, precise enough to be useful. */
function formatRemaining(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "expiré";
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / (60 * 60 * 1000));
  if (days > 0) return `${days} j ${hours} h`;
  const minutes = Math.max(1, Math.floor(ms / 60000));
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

module.exports = { DAY_MS, evaluateAccess, formatRemaining, parseJwtExpiry, sessionToken };
