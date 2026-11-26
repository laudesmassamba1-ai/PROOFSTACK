/**
 * The words the remediation screens use.
 *
 * Shared by the finding panel and the remediation queue so a status never reads
 * "applied" in one place and "appliquée" in the other.
 */

export interface BilingualLabel {
  fr: string;
  en: string;
}

export const REMEDIATION_STATUS_LABEL: Record<string, BilingualLabel> = {
  proposed: { fr: "proposée", en: "proposed" },
  approved: { fr: "approuvée", en: "approved" },
  applied: { fr: "appliquée, à vérifier", en: "applied, to verify" },
  verified: { fr: "vérifiée par une analyse", en: "verified by an analysis" },
  failed: { fr: "échec de vérification", en: "verification failed" },
  dismissed: { fr: "écartée", en: "dismissed" },
};

export const REMEDIATION_OUTCOME_LABEL: Record<string, BilingualLabel> = {
  verified: { fr: "vérifiée par mesure", en: "verified by measurement" },
  still_failing: { fr: "toujours en échec", en: "still failing" },
  inconclusive: { fr: "non concluant", en: "inconclusive" },
};

/** The order a queue should read in: what needs a decision first, then what is done. */
export const REMEDIATION_STATUS_ORDER = [
  "proposed",
  "approved",
  "applied",
  "failed",
  "verified",
  "dismissed",
] as const;
