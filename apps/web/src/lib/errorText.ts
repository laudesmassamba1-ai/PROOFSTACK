/**
 * Turning an API error code into a sentence.
 *
 * The API answers in English on purpose: its messages are read by CLI users, by the
 * engine's logs, and by whoever debugs a webhook, and a French sentence there would be a
 * worse product. The interface, however, is bilingual — and it used to surface
 * "The current password is incorrect." in the middle of a French settings page. Each
 * page that cared translated by hand; the rest did not.
 *
 * So translation happens once, at the presentation boundary, keyed by the stable `code`
 * the API already returns. Anything unknown falls back to the API's own message: a
 * precise English sentence beats a vague French one.
 */

interface ErrorLike {
  code?: string | null;
  message?: string;
  details?: unknown;
}

function retryMinutes(details: unknown): number | null {
  if (typeof details !== "object" || details === null) return null;
  const seconds = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.max(1, Math.ceil(seconds / 60));
}

export function errorText(error: unknown, fr: boolean): string {
  const candidate = error as ErrorLike | null | undefined;
  const fallback = candidate?.message ?? String(error ?? "");
  if (!fr) return fallback;
  const code = candidate?.code ?? "";
  const minutes = retryMinutes(candidate?.details);

  switch (code) {
    case "invalid_credentials":
      return "E-mail ou mot de passe incorrect.";
    case "invalid_password":
      return "Le mot de passe est incorrect.";
    case "password_unchanged":
      return "Le nouveau mot de passe doit être différent de l'actuel.";
    case "too_many_attempts":
      return minutes
        ? `Trop de tentatives. Réessaie dans ${minutes} min.`
        : "Trop de tentatives. Réessaie dans quelques minutes.";
    case "account_locked":
      return minutes
        ? `Compte temporairement verrouillé après plusieurs échecs. Réessaie dans ${minutes} min.`
        : "Compte temporairement verrouillé après plusieurs échecs.";
    case "not_authenticated":
      return "Connecte-toi pour continuer.";
    case "invalid_session":
    case "session_expired":
      return "Ta session n'est plus valide. Reconnecte-toi.";
    case "insufficient_role":
      return "Ton rôle dans cet espace ne permet pas cette action.";
    case "forbidden":
      return "Action réservée au propriétaire ou aux administrateurs.";
    case "user_not_found":
      return "Aucun compte PROOFCORE n'utilise cette adresse.";
    case "already_member":
      return "Cette personne fait déjà partie de l'espace.";
    case "last_owner":
      return "Un espace garde toujours au moins un propriétaire.";
    case "workspace_not_empty": {
      const detail = candidate?.details as
        | { workspaceName?: unknown; members?: unknown }
        | undefined;
      const name = typeof detail?.workspaceName === "string" ? detail.workspaceName : null;
      const members = typeof detail?.members === "number" ? detail.members : null;
      if (name && members) {
        return `Tu es encore propriétaire de « ${name} » avec ${members} autre(s) membre(s). Transfère la propriété ou retire-les d'abord.`;
      }
      return "Tu es encore propriétaire d'un espace partagé. Transfère la propriété ou retire les membres d'abord.";
    }
    case "workspace_not_found":
      return "Cet espace n'existe pas ou tu n'y as pas accès.";
    case "project_not_found":
      return "Ce projet n'existe pas ou tu n'y as pas accès.";
    case "workspace_limit_reached":
      return "Limite d'espaces atteinte pour ton offre.";
    case "already_subscribed":
      return "Cet espace est déjà sur cette offre.";
    case "plan_not_purchasable":
      return "Cette offre n'est pas disponible à l'achat direct.";
    case "no_chargeable_currency":
      return "Aucun tarif n'existe pour cette offre dans cette devise.";
    case "ai_not_configured":
      return "Connecte d'abord un fournisseur d'IA (clé enregistrée et chiffrée).";
    case "ai_rate_limited":
    case "provider_rate_limited":
      return minutes
        ? `Trop de requêtes vers le modèle. Réessaie dans ${minutes} min.`
        : "Trop de requêtes vers le modèle. Réessaie dans quelques minutes.";
    case "cross_origin_denied":
      return "Cette adresse n'est pas autorisée à appeler l'API. Ajoute-la à WEB_ORIGIN côté API.";
    case "payload_too_large":
      return "La requête est trop volumineuse.";
    case "invalid_body":
      return "Certains champs sont invalides.";
    case "network_error":
      return "API injoignable. Vérifie la connexion puis réessaie.";
    default:
      return fallback;
  }
}
