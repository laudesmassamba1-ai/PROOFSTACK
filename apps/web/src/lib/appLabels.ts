/**
 * Labels that come from the API or from persisted records.
 *
 * The API keeps stable English identifiers (plan keys, environments, usage keys,
 * subscription states) because the CLI and webhooks read them. The interface must not
 * print those identifiers to a French reader. These helpers translate at the display
 * boundary only; an unknown value keeps its original text instead of being invented.
 */

const PLAN_NAMES_FR: Record<string, string> = {
  free: "Gratuit",
};

export function planLabel(key: string, fallback: string, fr: boolean): string {
  if (!fr) return fallback;
  return PLAN_NAMES_FR[key] ?? fallback;
}

const ENVIRONMENTS_FR: Record<string, string> = {
  local: "local",
  staging: "préproduction",
  ci: "CI",
  production: "production",
};

export function environmentLabel(value: string, fr: boolean): string {
  if (!fr) return value;
  return ENVIRONMENTS_FR[value] ?? value;
}

const USAGE_FR: Record<string, string> = {
  monthly_test_runs: "Tests exécutés cette période",
  monthly_ai_audits: "Audits IA cette période",
  project_limit: "Projets",
};

export function usageLabel(key: string, fallback: string, fr: boolean): string {
  if (!fr) return fallback;
  return USAGE_FR[key] ?? fallback;
}

const PERIODS_FR: Record<string, string> = {
  monthly: "mensuel",
  yearly: "annuel",
};

export function periodLabel(value: string, fr: boolean): string {
  if (!fr) return value;
  return PERIODS_FR[value] ?? value;
}

const SEVERITIES_FR: Record<string, string> = {
  critical: "critique",
  high: "élevée",
  medium: "moyenne",
  low: "faible",
  info: "information",
};

export function severityLabel(value: string, fr: boolean): string {
  if (!fr) return value;
  return SEVERITIES_FR[value.toLowerCase()] ?? value;
}

const SANDBOX_OUTCOMES_FR: Record<string, string> = {
  success: "réussi",
  declined: "refusé",
  cancelled: "annulé",
  expired: "expiré",
};

export function sandboxOutcomeLabel(value: string, fr: boolean): string {
  if (!fr) return value;
  return SANDBOX_OUTCOMES_FR[value] ?? value;
}

const STATUSES_FR: Record<string, string> = {
  ACTIVE: "actif",
  CANCELLED: "annulé",
  CANCEL_AT_PERIOD_END: "annulation en fin de période",
  COMPLETED: "terminé",
  EXPIRED: "expiré",
  FAILED: "échec",
  FREE: "gratuit",
  GRACE_PERIOD: "délai de grâce",
  NONE: "aucun",
  PAID: "payé",
  PAST_DUE: "en retard",
  PENDING: "en attente",
  PROCESSING: "traitement",
  RUNNING: "en cours",
  SUCCEEDED: "réussi",
  WARNING: "avertissement",
};

export function statusLabel(value: string, fr: boolean): string {
  if (!fr) return value;
  return STATUSES_FR[value.toUpperCase()] ?? value;
}

const PROVIDER_NOTES_FR: Record<string, string> = {
  "No network, no money. Outcomes are scripted by the caller or by the `x-proofcore-outcome` metadata.":
    "Aucun réseau, aucun argent réel. Les résultats sont scénarisés par l'appelant ou par les métadonnées `x-proofcore-outcome`.",
  "Refunds are supported here so the refund state machine is testable; that does NOT mean the production provider supports refunds.":
    "Les remboursements existent ici pour rendre la machine à états testable ; cela ne signifie PAS que le fournisseur de production les prend en charge.",
  "No refund endpoint exists in the OpenAPI spec: refunds must be handled administratively, never claimed as API-driven.":
    "Aucun endpoint de remboursement n'existe dans la spécification OpenAPI : les remboursements doivent être traités administrativement, jamais présentés comme pilotés par l'API.",
  "No recurring/subscription endpoint exists: paid periods are prepaid and renewed manually.":
    "Aucun endpoint de récurrence ou d'abonnement n'existe : les périodes payées sont prépayées et renouvelées manuellement.",
  "GET /networks/ and GET /pricing/my-rates/ need authentication (verified 401 without a key), so the network list is empty until a key is present.":
    "GET /networks/ et GET /pricing/my-rates/ exigent une authentification (401 vérifié sans clé) : la liste des réseaux reste vide tant qu'aucune clé n'est présente.",
  "Payouts require the server IP to be whitelisted, otherwise 403 ip_not_whitelisted.":
    "Les retraits exigent l'ajout de l'IP du serveur à la liste blanche ; sinon l'API répond 403 ip_not_whitelisted.",
};

export function providerNote(note: string, fr: boolean): string {
  if (!fr) return note;
  return PROVIDER_NOTES_FR[note] ?? note;
}
