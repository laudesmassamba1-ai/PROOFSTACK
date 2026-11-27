import { type Control, type ControlRisk, controlFor } from "./controls.js";
import type { ScanModule, ScanStatus } from "./page-scan.js";

/**
 * The Findings Engine.
 *
 * A finding is not a string. It is a fact, a verdict, a severity, a priority, a cause, a
 * proof and seven levels of explanation — and two analyses must be able to say whether the
 * same finding got better or worse. That is what lives here, shared by the API, the CLI,
 * the AI and the report renderers, so no surface invents its own vocabulary.
 */

export const FINDING_STATUSES = [
  "PASSED",
  "FAILED",
  "WARNING",
  "SKIPPED",
  "BLOCKED",
  "ERROR",
  "NOT_APPLICABLE",
  "NOT_CONFIGURED",
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

/**
 * What each status claims.
 *
 * The distinctions matter more than the labels: SKIPPED means the check chose not to run,
 * BLOCKED means something external stopped it, ERROR means it ran and broke, and
 * NOT_CONFIGURED means the product cannot check this yet. Collapsing them into "no result"
 * is how a missing measurement gets read as a pass.
 */
export const FINDING_STATUS_LABELS: Record<
  FindingStatus,
  { fr: string; en: string; meaning: { fr: string; en: string } }
> = {
  PASSED: {
    fr: "Conforme",
    en: "Passed",
    meaning: {
      fr: "Le contrôle a mesuré et la valeur attendue est là.",
      en: "The check measured and the expected value is present.",
    },
  },
  FAILED: {
    fr: "Échec",
    en: "Failed",
    meaning: {
      fr: "Le contrôle a mesuré et la valeur attendue manque ou est fausse.",
      en: "The check measured and the expected value is missing or wrong.",
    },
  },
  WARNING: {
    fr: "Avertissement",
    en: "Warning",
    meaning: {
      fr: "Le contrôle a mesuré une faiblesse qui n'empêche pas l'usage.",
      en: "The check measured a weakness that does not prevent use.",
    },
  },
  SKIPPED: {
    fr: "Ignoré",
    en: "Skipped",
    meaning: {
      fr: "Le contrôle n'a pas été exécuté sur cette cible, et la raison est connue.",
      en: "The check did not run on this target, and the reason is known.",
    },
  },
  BLOCKED: {
    fr: "Bloqué",
    en: "Blocked",
    meaning: {
      fr: "Un tiers a empêché la mesure : mur d'authentification, robots, quota.",
      en: "A third party prevented the measurement: login wall, robots, quota.",
    },
  },
  ERROR: {
    fr: "Erreur",
    en: "Error",
    meaning: {
      fr: "Le contrôle a été exécuté et a échoué lui-même. Ce n'est pas un verdict sur le site.",
      en: "The check ran and failed itself. This is not a verdict about the site.",
    },
  },
  NOT_APPLICABLE: {
    fr: "Non applicable",
    en: "Not applicable",
    meaning: {
      fr: "La cible ne peut pas porter ce contrôle (une page sans formulaire n'a pas de parcours).",
      en: "The target cannot carry this check (a page with no form has no journey).",
    },
  },
  NOT_CONFIGURED: {
    fr: "Non configuré",
    en: "Not configured",
    meaning: {
      fr: "Ce contrôle existe mais n'est pas encore branché pour cette cible.",
      en: "This check exists but is not wired for this target yet.",
    },
  },
};

/** Which statuses mean "the check produced no verdict". They never count as a pass. */
export function isInconclusive(status: FindingStatus): boolean {
  return (
    status === "SKIPPED" ||
    status === "BLOCKED" ||
    status === "ERROR" ||
    status === "NOT_APPLICABLE" ||
    status === "NOT_CONFIGURED"
  );
}

/** The engine's four statuses, mapped once so every surface agrees. */
export function normalizeStatus(status: ScanStatus): FindingStatus {
  switch (status) {
    case "PASS":
      return "PASSED";
    case "WARN":
      return "WARNING";
    case "FAIL":
      return "FAILED";
    case "SKIPPED":
      return "SKIPPED";
  }
}

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export type Priority = "P0" | "P1" | "P2" | "P3";
export const PRIORITY_RANK: Record<Priority, number> = { P0: 3, P1: 2, P2: 1, P3: 0 };

const RISK_TO_SEVERITY: Record<ControlRisk, Severity> = {
  high: "high",
  medium: "medium",
  low: "low",
};

/**
 * Controls whose failure is not a risk but an exposure happening now.
 *
 * A secret in the served HTML is readable by anyone who loads the page; that is different
 * in kind from a header that would mitigate a future attack, so it is the only automatic
 * critical. Everything else keeps the registry's risk level, which is about exposure, not
 * about severity on this particular site.
 */
const CRITICAL_CONTROLS = new Set(["secrets_in_html"]);

export function severityOf(control: Control | undefined, module: string): Severity {
  if (!control) return module === "fail" ? "medium" : "info";
  if (CRITICAL_CONTROLS.has(control.id)) return "critical";
  return RISK_TO_SEVERITY[control.risk];
}

/**
 * Priority: what to fix first, not how bad it is.
 *
 * Severity is exposure; priority adds the cost of the fix and whether it blocks a journey.
 * A high-risk one-line header change outranks a high-risk refactor, and a critical exposure
 * outranks everything: that is P0, and the report says so.
 */
export function priorityOf(input: {
  severity: Severity;
  complexity?: Control["complexity"];
  blocksJourney?: boolean;
}): Priority {
  if (input.severity === "critical" || input.blocksJourney === true) return "P0";
  if (input.severity === "high") return input.complexity === "low" ? "P1" : "P2";
  if (input.severity === "medium") return input.complexity === "low" ? "P2" : "P3";
  return "P3";
}

export type CauseId =
  | "transport"
  | "headers"
  | "exposure"
  | "accessibility"
  | "content"
  | "performance"
  | "internationalisation"
  | "journey"
  | "indexing"
  | "crawl"
  | "repository";

export const CAUSE_LABELS: Record<CauseId, { fr: string; en: string }> = {
  transport: { fr: "Transport et certificat", en: "Transport and certificate" },
  headers: { fr: "En-têtes de sécurité", en: "Security headers" },
  exposure: { fr: "Exposition d'informations", en: "Information exposure" },
  accessibility: { fr: "Accessibilité", en: "Accessibility" },
  content: { fr: "Contenu et structure", en: "Content and structure" },
  performance: { fr: "Poids et vitesse", en: "Weight and speed" },
  internationalisation: { fr: "Internationalisation", en: "Internationalisation" },
  journey: { fr: "Parcours et formulaires", en: "Journey and forms" },
  indexing: { fr: "Indexation", en: "Indexing" },
  crawl: { fr: "Couverture du site", en: "Site coverage" },
  repository: { fr: "Dépôt et configuration", en: "Repository and configuration" },
};

const CONTROL_CAUSE: Record<string, CauseId> = {
  tls: "transport",
  hsts: "transport",
  mixed_content: "transport",
  journey_tls: "transport",
  pages_without_tls: "transport",
  pages_without_hsts: "transport",
  csp: "headers",
  frame_ancestors: "headers",
  clickjacking_frame_headers: "headers",
  referrer_policy: "headers",
  permissions_policy: "headers",
  content_type: "headers",
  http_status: "headers",
  cookie_flags: "headers",
  mixed_content_site: "headers",
  stack_disclosure: "exposure",
  server_banner: "exposure",
  secrets_in_html: "exposure",
  error_disclosure: "exposure",
  source_maps_exposed: "exposure",
  html_lang: "internationalisation",
  declared_locale: "internationalisation",
  language_meta: "internationalisation",
  hreflang: "internationalisation",
  rtl_support: "internationalisation",
  ambiguous_dates: "internationalisation",
  price_format: "internationalisation",
  translation_targets: "internationalisation",
  charset: "content",
  title: "content",
  meta_description: "content",
  viewport: "content",
  landmarks: "content",
  image_alt: "accessibility",
  headings: "content",
  field_labels: "accessibility",
  input_hints: "accessibility",
  rendered_dom: "content",
  inline_styles: "content",
  html_weight: "performance",
  heavy_pages: "performance",
  slow_pages: "performance",
  journey_entry: "journey",
  journey_reachable: "journey",
  journey_csrf: "journey",
  payment_methods: "journey",
  refund_path: "journey",
  webhook_observability: "journey",
  broken_links: "journey",
  export_affordances: "indexing",
  structured_data: "indexing",
  api_surface: "indexing",
  print_styles: "content",
  sitemap: "indexing",
  robots: "indexing",
  redirects: "crawl",
  duplicate_titles: "crawl",
  missing_titles: "crawl",
  crawl_coverage: "crawl",
};

const MODULE_CAUSE: Record<string, CauseId> = {
  world: "transport",
  flow: "journey",
  exit: "journey",
  fail: "headers",
  clean: "content",
};

/**
 * The cause a finding belongs to.
 *
 * A control the registry knows wins. Otherwise the module gives a valid fallback: a
 * payload written before a control existed still lands in a real group instead of an
 * impossible `CauseId` ("fail", "flow") that has no label and no owner.
 */
export function causeOf(module: string, controlId: string): CauseId {
  return CONTROL_CAUSE[controlId] ?? MODULE_CAUSE[module] ?? "content";
}

export type Confidence = "measured" | "inferred" | "declared";

export interface FindingEvidence {
  /** How it was measured: a header, a DOM query, a crawl aggregate. */
  method: string;
  /** The value read, verbatim. */
  observed: string;
  /** What the control expected, when it is a known shape. */
  expected: string | null;
  /** Where it was read, when the finding is about one page. */
  url: string | null;
}

/**
 * Seven levels, from the fact to the fix.
 *
 * The order is the order a person reads them: what did you see, what does it mean, why
 * does it matter, who does it touch, how do I check your claim, how do I fix it, and how
 * sure are you. A screen that shows only the fact and the fix is still honest; one that
 * shows the conclusion without the fact is not.
 */
export interface FindingExplanation {
  fact: string;
  meaning: string;
  impact: string;
  scope: string;
  verification: string;
  fix: string;
  confidence: string;
}

export interface Finding {
  /** Stable key inside one analysis: module + control + page. */
  key: string;
  analysisId: string;
  module: string;
  controlId: string;
  title: string;
  status: FindingStatus;
  /** Exposure when the control is missing. */
  severity: Severity;
  /** What to fix first, given severity and cost. */
  priority: Priority;
  cause: CauseId;
  confidence: Confidence;
  explanation: FindingExplanation;
  evidence: FindingEvidence;
  url: string | null;
  detectedAt: string;
}

const SCOPE_BY_MODULE: Record<string, { fr: string; en: string }> = {
  world: { fr: "Toute personne qui ouvre cette page.", en: "Anyone who opens this page." },
  flow: {
    fr: "Les personnes qui tentent le parcours d'achat.",
    en: "The people attempting the purchase journey.",
  },
  exit: {
    fr: "Les moteurs de recherche, les aperçus de partage et les intégrations qui lisent la page.",
    en: "Search engines, share previews and integrations that read the page.",
  },
  fail: {
    fr: "Tous les visiteurs de cette page, sur le réseau.",
    en: "Every visitor of this page, over the network.",
  },
  clean: {
    fr: "Les personnes qui lisent ou opèrent la page, y compris avec une aide technique.",
    en: "The people reading or operating the page, including with assistive technology.",
  },
};

const MODULE_FR: Record<string, string> = {
  world: "affichage",
  flow: "parcours",
  exit: "sortie",
  fail: "protections",
  clean: "lisibilité",
};

/** The module label a summary may print, in the caller's language. */
export function moduleLabel(module: string, locale: "fr" | "en" = "fr"): string {
  return locale === "fr" ? (MODULE_FR[module] ?? module) : module.toUpperCase();
}

export interface BuildFindingInput {
  analysisId: string;
  module: string;
  controlId: string;
  status: ScanStatus | FindingStatus;
  observed: string;
  /** Free-text reason from the engine, used when the registry has no entry. */
  why?: string;
  url?: string | null;
  detectedAt: string;
  /** Set for site-level findings, which aggregate several pages. */
  pages?: readonly string[];
  locale?: "fr" | "en";
}

function isFindingStatus(value: string): value is FindingStatus {
  return (FINDING_STATUSES as readonly string[]).includes(value);
}

/**
 * The identity used to compare two analyses.
 *
 * Site-level findings have no page, so they key on module + control; page findings add the
 * URL. Two analyses that read different pages cannot declare a page finding "fixed".
 */
export function findingKey(module: string, controlId: string, url: string | null): string {
  return url ? `${module}:${controlId}@${url}` : `${module}:${controlId}`;
}

/**
 * Build one finding, enriched from the control registry.
 *
 * The registry is the explanation; this function only chooses the words for the status
 * and the confidence, so a finding can never claim more than the control behind it.
 */
export function buildFinding(input: BuildFindingInput): Finding {
  const locale = input.locale ?? "fr";
  const status: FindingStatus = isFindingStatus(input.status)
    ? input.status
    : normalizeStatus(input.status as ScanStatus);
  const control = controlFor(input.module as ScanModule, input.controlId);
  const copy = control ? control[locale] : null;
  const severity = severityOf(control, input.module);
  const blocksJourney = input.module === "flow" && (status === "FAILED" || status === "WARNING");
  const priority = priorityOf({
    severity,
    ...(control ? { complexity: control.complexity } : {}),
    blocksJourney,
  });
  const siteWide = (input.pages?.length ?? 0) > 0;
  const confidence: Confidence = siteWide ? "inferred" : "measured";
  const scope = SCOPE_BY_MODULE[input.module] ?? {
    fr: "La cible de cette analyse.",
    en: "The target of this analysis.",
  };
  const confidenceText = siteWide
    ? locale === "fr"
      ? "Déduit de " +
        String(input.pages?.length ?? 0) +
        " page(s) lues par le crawl : une page non atteinte n'est pas couverte."
      : "Inferred from " +
        String(input.pages?.length ?? 0) +
        " page(s) read by the crawl: a page not reached is not covered."
    : locale === "fr"
      ? "Mesuré à l'instant de l'analyse sur la réponse réelle ; un cache de CDN peut différer."
      : "Measured at analysis time on the real response; a CDN cache may differ.";

  return {
    key: findingKey(input.module, input.controlId, siteWide ? null : (input.url ?? null)),
    analysisId: input.analysisId,
    module: input.module,
    controlId: input.controlId,
    title: copy?.title ?? input.controlId,
    status,
    severity,
    priority,
    cause: causeOf(input.module, input.controlId),
    confidence,
    explanation: {
      fact: input.observed,
      meaning: copy?.objective ?? input.why ?? "",
      impact: copy?.consequence ?? "",
      scope: locale === "fr" ? scope.fr : scope.en,
      verification: copy?.verify ?? "",
      fix: copy?.fix ?? "",
      confidence: confidenceText,
    },
    evidence: {
      method: control?.method ?? `module ${input.module}`,
      observed: input.observed,
      expected: control?.result ?? null,
      url: input.url ?? null,
    },
    url: input.url ?? null,
    detectedAt: input.detectedAt,
  };
}

const STATUS_ORDER: Record<FindingStatus, number> = {
  FAILED: 0,
  WARNING: 1,
  BLOCKED: 2,
  ERROR: 3,
  NOT_CONFIGURED: 4,
  SKIPPED: 5,
  NOT_APPLICABLE: 6,
  PASSED: 7,
};

/** Highest-priority first: what to read, then what to fix. */
export function compareFindingsForDisplay(a: Finding, b: Finding): number {
  const severity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (severity !== 0) return severity;
  const priority = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
  if (priority !== 0) return priority;
  const status = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (status !== 0) return status;
  return a.key.localeCompare(b.key);
}

export interface CauseGroup {
  cause: CauseId;
  label: { fr: string; en: string };
  findings: Finding[];
  counts: Record<FindingStatus, number>;
  worstSeverity: Severity;
  priority: Priority;
}

function emptyStatusCounts(): Record<FindingStatus, number> {
  return {
    PASSED: 0,
    FAILED: 0,
    WARNING: 0,
    SKIPPED: 0,
    BLOCKED: 0,
    ERROR: 0,
    NOT_APPLICABLE: 0,
    NOT_CONFIGURED: 0,
  };
}

/**
 * Group by cause, not by module.
 *
 * A missing HSTS and a missing CSP are two headers, but the person fixing them has one
 * task at the edge; a broken journey link and a missing form are two journey facts but one
 * investigation. The group is the unit of work, so its worst severity is what ranks it.
 */
export function groupByCause(findings: readonly Finding[]): CauseGroup[] {
  const groups = new Map<CauseId, Finding[]>();
  for (const finding of findings) {
    const bucket = groups.get(finding.cause);
    if (bucket) bucket.push(finding);
    else groups.set(finding.cause, [finding]);
  }
  const out: CauseGroup[] = [];
  for (const [cause, items] of groups) {
    const counts = emptyStatusCounts();
    let worstSeverity: Severity = "info";
    let priority: Priority = "P3";
    for (const item of items) {
      counts[item.status] += 1;
      if (SEVERITY_RANK[item.severity] > SEVERITY_RANK[worstSeverity]) {
        worstSeverity = item.severity;
      }
      if (PRIORITY_RANK[item.priority] > PRIORITY_RANK[priority]) priority = item.priority;
    }
    out.push({
      cause,
      label: CAUSE_LABELS[cause],
      findings: items.sort(compareFindingsForDisplay),
      counts,
      worstSeverity,
      priority,
    });
  }
  return out.sort((a, b) => {
    const severity = SEVERITY_RANK[b.worstSeverity] - SEVERITY_RANK[a.worstSeverity];
    if (severity !== 0) return severity;
    return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
  });
}

export type FindingChange = "appeared" | "resolved" | "persisting" | "worsened" | "improved";

export interface FindingComparison {
  /** False when the two analyses did not measure the same thing; the UI must say so. */
  comparable: boolean;
  reasons: string[];
  appeared: Finding[];
  resolved: Finding[];
  persisting: Finding[];
  worsened: Finding[];
  improved: Finding[];
  /**
   * Problems from the reference whose page the target never read.
   *
   * They are not "resolved": the page left the crawl, the URL changed, or the module
   * stopped covering it. Reporting them as fixed is the one comparison mistake that
   * makes a product look better while a real problem stays open.
   */
  unmeasured: Finding[];
  counts: Record<FindingChange, number> & { total: number; unmeasured: number };
  /** Measured modules on each side, so "nothing changed" can be read with its scope. */
  measured: { before: string[]; after: string[] };
}

function failing(finding: Finding): boolean {
  return finding.status === "FAILED" || finding.status === "WARNING";
}

function byKey(findings: readonly Finding[]): Map<string, Finding> {
  const map = new Map<string, Finding>();
  for (const finding of findings) {
    const existing = map.get(finding.key);
    // When a control is reported twice for the same page, keep the worse verdict: a
    // comparison must not be improved by which duplicate happened to be read last.
    if (
      !existing ||
      isInconclusive(existing.status) ||
      SEVERITY_RANK[finding.severity] > SEVERITY_RANK[existing.severity]
    ) {
      map.set(finding.key, finding);
    }
  }
  return map;
}

/**
 * Compare two analyses finding by finding.
 *
 * Only the same key can be compared: a page finding that moved to another URL is a new
 * finding, not a fix. And when either side measured nothing for a module, the comparison
 * is declared non-comparable instead of reporting a wall of "resolved".
 */
export function compareFindings(
  before: readonly Finding[],
  after: readonly Finding[],
  measured: { before: readonly string[]; after: readonly string[] }
): FindingComparison {
  const beforeByKey = byKey(before);
  const afterByKey = byKey(after);
  const appeared: Finding[] = [];
  const resolved: Finding[] = [];
  const persisting: Finding[] = [];
  const worsened: Finding[] = [];
  const improved: Finding[] = [];
  const unmeasured: Finding[] = [];
  const reasons: string[] = [];

  const comparable = measured.before.length > 0 && measured.after.length > 0;
  if (measured.before.length === 0) {
    reasons.push("L'analyse de référence n'a mesuré aucun module.");
  }
  if (measured.after.length === 0) reasons.push("L'analyse cible n'a mesuré aucun module.");

  for (const [key, current] of afterByKey) {
    const previous = beforeByKey.get(key);
    if (!previous) {
      if (failing(current)) appeared.push(current);
      continue;
    }
    if (!failing(previous) && !failing(current)) continue;
    if (!failing(previous) && failing(current)) {
      appeared.push(current);
      continue;
    }
    if (failing(previous) && !failing(current)) {
      resolved.push(previous);
      continue;
    }
    const delta = SEVERITY_RANK[current.severity] - SEVERITY_RANK[previous.severity];
    if (delta > 0) worsened.push(current);
    else if (delta < 0) improved.push(current);
    else if (current.status !== previous.status) {
      if (current.status === "FAILED") worsened.push(current);
      else improved.push(current);
    } else persisting.push(current);
  }
  // A page counts as re-read when the target still carries a finding for that URL, or
  // when the finding is site-level (no URL) and the module ran again.
  const afterUrls = new Set(
    after.map((finding) => finding.url).filter((url): url is string => url !== null)
  );
  for (const [key, previous] of beforeByKey) {
    if (afterByKey.has(key)) continue;
    if (!failing(previous)) continue;
    if (previous.url === null || afterUrls.has(previous.url)) resolved.push(previous);
    else unmeasured.push(previous);
  }
  if (unmeasured.length > 0) {
    reasons.push(
      unmeasured.length +
        " constat(s) de la référence portent sur des pages que l'analyse cible n'a pas relues ; ils ne sont pas comptés comme corrigés."
    );
  }

  const sortFindings = (items: Finding[]) => items.sort(compareFindingsForDisplay);
  sortFindings(appeared);
  sortFindings(resolved);
  sortFindings(persisting);
  sortFindings(worsened);
  sortFindings(improved);
  sortFindings(unmeasured);

  return {
    comparable,
    reasons,
    appeared,
    resolved,
    persisting,
    worsened,
    improved,
    unmeasured,
    counts: {
      appeared: appeared.length,
      resolved: resolved.length,
      persisting: persisting.length,
      worsened: worsened.length,
      improved: improved.length,
      unmeasured: unmeasured.length,
      total:
        appeared.length + resolved.length + persisting.length + worsened.length + improved.length,
    },
    measured: { before: [...measured.before], after: [...measured.after] },
  };
}

/** Counts a summary header can print without re-deriving the taxonomy. */
export function summarizeFindings(findings: readonly Finding[]): {
  total: number;
  byStatus: Record<FindingStatus, number>;
  bySeverity: Record<Severity, number>;
  byPriority: Record<Priority, number>;
  conclusive: number;
  inconclusive: number;
} {
  const byStatus = emptyStatusCounts();
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const byPriority: Record<Priority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  let conclusive = 0;
  let inconclusive = 0;
  for (const finding of findings) {
    byStatus[finding.status] += 1;
    bySeverity[finding.severity] += 1;
    byPriority[finding.priority] += 1;
    if (isInconclusive(finding.status)) inconclusive += 1;
    else conclusive += 1;
  }
  return {
    total: findings.length,
    byStatus,
    bySeverity,
    byPriority,
    conclusive,
    inconclusive,
  };
}
