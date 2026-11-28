import type { AnalysisTargetType } from "./analysis.js";
import type { ScanModule } from "./page-scan.js";

/**
 * The Capability Registry.
 *
 * A module name ("WORLD") is an internal grouping; it is not something a person can ask
 * for. What a person asks for is a capability: "est-ce que cette page s'affiche pour un
 * humain ?", "est-ce qu'un paiement aboutit ?". Each entry below states the goal, what it
 * needs, what it is allowed to touch, where it applies, what it returns as proof, and what
 * it cannot do. The engine planner, the UI forms, the AI tools and the docs all read this
 * one list, so a capability that is not here cannot be offered anywhere — the same rule
 * that makes the control registry trustworthy.
 *
 * `limits` is the field that keeps the product honest: it is where a capability says what
 * it will never conclude, and the report prints it next to the result.
 */

export const CAPABILITY_VERSION = "1";

export type CapabilitySurface = "WEB" | "CLI" | "AI" | "DESKTOP" | "API";
export type ExecutionMode = "http" | "browser" | "crawl" | "repository" | "local" | "workflow";
/**
 * Permission classes, ordered from least to most invasive.
 *
 * `read` fetches a public resource; `analysis` runs our own checks against it; `write`
 * changes something we own (a stored state); `sensitive` touches credentials or another
 * party's system in a way that needs an explicit decision from the person.
 */
export type PermissionClass = "read" | "analysis" | "write" | "sensitive";

export interface CapabilityInput {
  name: string;
  type: "url" | "string" | "number" | "boolean" | "credentials" | "scenario" | "repository";
  required: boolean;
  description: string;
}

export interface Capability {
  id: string;
  module: ScanModule;
  /** Developer-facing one-liner, used in logs and by the planner. */
  goal: string;
  fr: { title: string; description: string };
  en: { title: string; description: string };
  inputs: CapabilityInput[];
  prerequisites: string[];
  permissions: PermissionClass[];
  execution: { mode: ExecutionMode; timeoutMs: number };
  /** Capability ids that must have run first for this one to mean anything. */
  dependencies: string[];
  compatibility: { targetTypes: AnalysisTargetType[]; surfaces: CapabilitySurface[] };
  expectedResult: string;
  proof: {
    format: "verdict" | "evidence" | "screenshot" | "diff" | "report";
    description: string;
  };
  /** What this capability will never conclude, and what it needs to be worth running. */
  limits: string[];
  /** Control ids this capability can report. Empty means it reports no control. */
  controls: string[];
  version: string;
}

const ALL_SURFACES: CapabilitySurface[] = ["WEB", "CLI", "AI", "DESKTOP", "API"];

const capabilities: Capability[] = [
  // ------------------------------------------------------------------ PAGE
  {
    id: "page.world",
    module: "world",
    goal: "Establish how the page renders and whether its declared internationalisation matches its content.",
    fr: {
      title: "Affichage et internationalisation",
      description:
        "Vérifie que la page se charge, que la langue, l'encodage, les formats de date et de prix et les textes traduits correspondent à ce qu'elle annonce.",
    },
    en: {
      title: "Rendering and internationalisation",
      description:
        "Checks that the page loads and that its declared language, encoding, date and price formats and translations match what it announces.",
    },
    inputs: [{ name: "url", type: "url", required: true, description: "The address to read." }],
    prerequisites: ["The address answers over HTTP and is publicly reachable."],
    permissions: ["read", "analysis"],
    execution: { mode: "browser", timeoutMs: 30_000 },
    dependencies: [],
    compatibility: { targetTypes: ["PAGE", "SITE"], surfaces: ALL_SURFACES },
    expectedResult: "A verdict per control, with the observed value quoted.",
    proof: {
      format: "evidence",
      description: "The rendered page and the value each control read.",
    },
    limits: [
      "Ne vérifie pas qu'une traduction est juste, seulement qu'elle est présente et cohérente.",
      "Sans navigateur, le rendu est le HTML servi : une page construite côté client peut être mal jugée.",
    ],
    controls: [
      "declared_locale",
      "charset",
      "language_meta",
      "hreflang",
      "rtl_support",
      "ambiguous_dates",
      "price_format",
      "input_hints",
      "translation_targets",
    ],
    version: CAPABILITY_VERSION,
  },
  {
    id: "page.flow",
    module: "flow",
    goal: "Establish whether the forms on the page can be completed by a person.",
    fr: {
      title: "Parcours et formulaires",
      description:
        "Regarde les formulaires réellement servis : champs, libellés, protection CSRF, bouton de soumission, moyens de paiement annoncés, chemin de remboursement.",
    },
    en: {
      title: "Journeys and forms",
      description:
        "Reads the forms actually served: fields, labels, CSRF protection, submit button, announced payment methods and refund path.",
    },
    inputs: [
      { name: "url", type: "url", required: true, description: "The page holding the form." },
    ],
    prerequisites: [
      "The page is reachable and is not behind a login, or credentials were supplied.",
    ],
    permissions: ["read", "analysis"],
    execution: { mode: "http", timeoutMs: 30_000 },
    dependencies: ["page.world"],
    compatibility: { targetTypes: ["PAGE", "SITE"], surfaces: ALL_SURFACES },
    expectedResult: "A verdict per control plus the list of fields found.",
    proof: {
      format: "evidence",
      description: "The form markup and the attributes each control read.",
    },
    limits: [
      "Observe la présence d'un parcours, pas sa réussite : aucun paiement n'est déclenché.",
      "Un formulaire dans un iframe tiers n'est pas lu.",
    ],
    controls: [
      "journey_entry",
      "journey_tls",
      "payment_methods",
      "journey_csrf",
      "refund_path",
      "webhook_observability",
      "journey_reachable",
    ],
    version: CAPABILITY_VERSION,
  },
  {
    id: "page.exit",
    module: "exit",
    goal: "Establish whether the page can be found, shared and printed, and what API surface it exposes.",
    fr: {
      title: "Sortie, partage et surface d'API",
      description:
        "Vérifie les données structurées, les affordances d'export, la feuille d'impression et les points d'API visibles depuis la page.",
    },
    en: {
      title: "Exit, sharing and API surface",
      description:
        "Checks structured data, export affordances, the print stylesheet and the API endpoints visible from the page.",
    },
    inputs: [{ name: "url", type: "url", required: true, description: "The address to read." }],
    prerequisites: ["The address answers over HTTP."],
    permissions: ["read", "analysis"],
    execution: { mode: "http", timeoutMs: 30_000 },
    dependencies: [],
    compatibility: { targetTypes: ["PAGE", "SITE"], surfaces: ALL_SURFACES },
    expectedResult: "A verdict per control, with the discovered endpoints listed.",
    proof: {
      format: "evidence",
      description: "The JSON-LD block, the print rules and the endpoint list.",
    },
    limits: [
      "Ne teste pas les endpoints découverts, seulement leur présence dans la page.",
      "Un rendu client peut masquer les données structurées du HTML initial.",
    ],
    controls: ["export_affordances", "structured_data", "api_surface", "print_styles"],
    version: CAPABILITY_VERSION,
  },
  {
    id: "page.fail",
    module: "fail",
    goal: "Establish which transport-level protections the page's HTTP response carries.",
    fr: {
      title: "Protections HTTP",
      description:
        "Lit les en-têtes de sécurité, le certificat, les cookies, le statut HTTP et cherche des secrets dans le HTML servi.",
    },
    en: {
      title: "HTTP protections",
      description:
        "Reads security headers, the certificate, cookies, the HTTP status and looks for secrets in the served HTML.",
    },
    inputs: [{ name: "url", type: "url", required: true, description: "The address to read." }],
    prerequisites: ["The address answers over HTTP."],
    permissions: ["read", "analysis"],
    execution: { mode: "http", timeoutMs: 20_000 },
    dependencies: [],
    compatibility: { targetTypes: ["PAGE", "SITE", "API"], surfaces: ALL_SURFACES },
    expectedResult: "A verdict per control, with the exact header or value observed.",
    proof: {
      format: "evidence",
      description: "The response headers and the body excerpt the control read.",
    },
    limits: [
      "Ne teste aucune attaque : un en-tête absent est un risque, pas une faille exploitée.",
      "Ce que voit un CDN peut différer de ce que voit un navigateur.",
    ],
    controls: [
      "tls",
      "hsts",
      "csp",
      "frame_ancestors",
      "referrer_policy",
      "permissions_policy",
      "stack_disclosure",
      "server_banner",
      "cookie_flags",
      "mixed_content",
      "secrets_in_html",
      "error_disclosure",
      "clickjacking_frame_headers",
      "content_type",
      "http_status",
    ],
    version: CAPABILITY_VERSION,
  },
  {
    id: "page.clean",
    module: "clean",
    goal: "Establish whether a human can read and operate the page without assistive help.",
    fr: {
      title: "Lisibilité et bases d'accessibilité",
      description:
        "Vérifie langue du document, titre, description, viewport, repères, alternatives d'image, titres, libellés de champs et poids de la page.",
    },
    en: {
      title: "Readability and accessibility basics",
      description:
        "Checks document language, title, description, viewport, landmarks, image alternatives, headings, field labels and page weight.",
    },
    inputs: [{ name: "url", type: "url", required: true, description: "The address to read." }],
    prerequisites: ["The address answers over HTTP."],
    permissions: ["read", "analysis"],
    execution: { mode: "http", timeoutMs: 20_000 },
    dependencies: [],
    compatibility: { targetTypes: ["PAGE", "SITE"], surfaces: ALL_SURFACES },
    expectedResult: "A verdict per control.",
    proof: { format: "evidence", description: "The element and attribute each control read." },
    limits: [
      "Ne remplace pas un audit d'accessibilité complet (contrastes, navigation clavier, lecteur d'écran).",
      "Un DOM rendu par JavaScript n'est vu que si un navigateur a exécuté la page.",
    ],
    controls: [
      "html_lang",
      "title",
      "meta_description",
      "viewport",
      "landmarks",
      "image_alt",
      "image_alt_present",
      "image_alt_quality",
      "image_dimensions",
      "image_loading",
      "image_reachable",
      "image_not_empty",
      "image_tracking_pixels",
      "image_weight",
      "image_content_type",
      "headings",
      "html_weight",
      "inline_styles",
      "field_labels",
      "rendered_dom",
    ],
    version: CAPABILITY_VERSION,
  },
  // ------------------------------------------------------------------ SITE
  {
    id: "site.crawl",
    module: "clean",
    goal: "Read several pages of one site and establish which ones are reachable, duplicated or heavy.",
    fr: {
      title: "Lecture multi-pages",
      description:
        "Suit les liens internes jusqu'à une limite annoncée, puis vérifie redirections, titres dupliqués ou manquants, poids et lenteur des pages.",
    },
    en: {
      title: "Multi-page crawl",
      description:
        "Follows internal links up to an announced limit, then checks redirects, duplicated or missing titles, page weight and slowness.",
    },
    inputs: [
      { name: "url", type: "url", required: true, description: "The page to start from." },
      {
        name: "maxPages",
        type: "number",
        required: false,
        description: "How many pages to read, announced before the run.",
      },
    ],
    prerequisites: ["The start page is reachable and links to the rest of the site."],
    permissions: ["read", "analysis"],
    execution: { mode: "crawl", timeoutMs: 120_000 },
    dependencies: [],
    compatibility: { targetTypes: ["SITE"], surfaces: ["WEB", "CLI", "AI", "DESKTOP", "API"] },
    expectedResult: "A per-page result plus site-level findings.",
    proof: {
      format: "report",
      description: "The list of pages discovered, read and skipped, with the reason.",
    },
    limits: [
      "Ne lit que ce que le site lie : une page non liée n'est pas trouvée.",
      "Ne soumet aucun formulaire et n'ouvre aucun compte.",
    ],
    controls: [
      "redirects",
      "duplicate_titles",
      "missing_titles",
      "heavy_pages",
      "slow_pages",
      "crawl_coverage",
    ],
    version: CAPABILITY_VERSION,
  },
  {
    id: "site.security",
    module: "fail",
    goal: "Establish whether the site serves every page over TLS with the same protections.",
    fr: {
      title: "Cohérence des protections sur le site",
      description:
        "Compare les pages lues et signale celles qui sortent du périmètre protégé : sans TLS, sans HSTS, avec mixed content ou source maps exposées.",
    },
    en: {
      title: "Site-wide protection consistency",
      description:
        "Compares the pages read and reports those outside the protected perimeter: no TLS, no HSTS, mixed content or exposed source maps.",
    },
    inputs: [{ name: "url", type: "url", required: true, description: "The site to read." }],
    prerequisites: ["A crawl has read more than one page."],
    permissions: ["read", "analysis"],
    execution: { mode: "crawl", timeoutMs: 120_000 },
    dependencies: ["site.crawl"],
    compatibility: { targetTypes: ["SITE"], surfaces: ["WEB", "CLI", "AI", "DESKTOP", "API"] },
    expectedResult: "A list of offending pages per protection.",
    proof: { format: "evidence", description: "Each offending page with the header it served." },
    limits: [
      "Ne voit que les pages atteintes par le crawl.",
      "Ne teste pas les sous-domaines non liés.",
    ],
    controls: [
      "pages_without_tls",
      "pages_without_hsts",
      "source_maps_exposed",
      "mixed_content_site",
    ],
    version: CAPABILITY_VERSION,
  },
  {
    id: "site.indexing",
    module: "exit",
    goal: "Establish what the site tells crawlers they may index.",
    fr: {
      title: "Indexation et robots",
      description:
        "Lit robots.txt et le sitemap, et confronte ce qu'ils annoncent aux pages réellement atteignables.",
    },
    en: {
      title: "Indexing and robots",
      description:
        "Reads robots.txt and the sitemap, and confronts what they announce with the pages actually reachable.",
    },
    inputs: [{ name: "url", type: "url", required: true, description: "The site to read." }],
    prerequisites: ["The site answers over HTTP."],
    permissions: ["read", "analysis"],
    execution: { mode: "crawl", timeoutMs: 60_000 },
    dependencies: ["site.crawl"],
    compatibility: { targetTypes: ["SITE"], surfaces: ["WEB", "CLI", "AI", "DESKTOP", "API"] },
    expectedResult: "The declared rules and the discrepancies found.",
    proof: {
      format: "evidence",
      description: "The robots.txt and sitemap bodies, plus the page list they disagree with.",
    },
    limits: [
      "Ne vérifie pas l'indexation réelle dans un moteur de recherche.",
      "Un sitemap énorme est tronqué : la coupe est annoncée dans le rapport.",
    ],
    controls: ["sitemap", "robots"],
    version: CAPABILITY_VERSION,
  },
  {
    id: "site.flow",
    module: "flow",
    goal: "Establish whether the links that carry a journey still resolve across the site.",
    fr: {
      title: "Liens du parcours",
      description:
        "Suit les liens internes qui mènent à un formulaire ou à un paiement et signale ceux qui cassent.",
    },
    en: {
      title: "Journey links",
      description:
        "Follows the internal links leading to a form or a payment and reports the ones that break.",
    },
    inputs: [{ name: "url", type: "url", required: true, description: "The site to read." }],
    prerequisites: ["A crawl has read more than one page."],
    permissions: ["read", "analysis"],
    execution: { mode: "crawl", timeoutMs: 120_000 },
    dependencies: ["site.crawl"],
    compatibility: { targetTypes: ["SITE"], surfaces: ["WEB", "CLI", "AI", "DESKTOP", "API"] },
    expectedResult: "The broken links with the page that carries them.",
    proof: { format: "evidence", description: "The href and the status each link answered." },
    limits: ["Ne clique pas : vérifie la résolution du lien, pas le parcours qui suit."],
    controls: ["broken_links"],
    version: CAPABILITY_VERSION,
  },
  // -------------------------------------------------------------- WORKFLOW
  {
    id: "workflow.journey",
    module: "flow",
    goal: "Drive a declared browser scenario and report where it stops.",
    fr: {
      title: "Scénario de navigation réel",
      description:
        "Exécute un scénario déclaré dans un navigateur : chaque étape est jouée, la capture et l'URL d'arrêt sont conservées.",
    },
    en: {
      title: "Real browser scenario",
      description:
        "Runs a declared scenario in a browser: every step is played, the screenshot and the stopping URL are kept.",
    },
    inputs: [
      {
        name: "scenario",
        type: "scenario",
        required: true,
        description: "Ordered steps with a selector or a URL each.",
      },
      { name: "url", type: "url", required: true, description: "The entry point." },
    ],
    prerequisites: [
      "A browser is available in the execution environment.",
      "The scenario declares at most 40 steps.",
    ],
    permissions: ["read", "analysis", "sensitive"],
    execution: { mode: "workflow", timeoutMs: 180_000 },
    dependencies: ["page.world"],
    compatibility: { targetTypes: ["WORKFLOW", "PAGE"], surfaces: ["WEB", "AI", "DESKTOP"] },
    expectedResult: "The step reached, the failure, and a screenshot at the stop.",
    proof: {
      format: "screenshot",
      description: "One screenshot per failed step, with the DOM excerpt.",
    },
    limits: [
      "N'accomplit aucun paiement réel : un scénario de paiement s'arrête avant la confirmation.",
      "Un scénario qui dépend d'un e-mail ou d'un SMS ne peut pas aboutir seul.",
    ],
    controls: [],
    version: CAPABILITY_VERSION,
  },
  // ------------------------------------------------------------------- API
  {
    id: "api.probe",
    module: "fail",
    goal: "Establish what an HTTP API answers to a safe, read-only request.",
    fr: {
      title: "Surface d'API",
      description:
        "Interroge un endpoint en lecture seule et lit statut, en-têtes, format d'erreur et discipline de cache.",
    },
    en: {
      title: "API surface",
      description:
        "Calls an endpoint read-only and reads its status, headers, error format and cache behaviour.",
    },
    inputs: [{ name: "url", type: "url", required: true, description: "The endpoint to read." }],
    prerequisites: ["The endpoint accepts a GET without side effects."],
    permissions: ["read", "analysis"],
    execution: { mode: "http", timeoutMs: 20_000 },
    dependencies: [],
    compatibility: { targetTypes: ["API"], surfaces: ["WEB", "CLI", "AI", "API"] },
    expectedResult: "The status and the headers that matter for an API.",
    proof: { format: "evidence", description: "The status line and the response headers." },
    limits: [
      "N'envoie aucune requête d'écriture (POST, PUT, DELETE).",
      "Ne teste pas l'authentification : un 401 est rapporté, pas contourné.",
    ],
    controls: ["content_type", "http_status", "csp", "referrer_policy"],
    version: CAPABILITY_VERSION,
  },
  // --------------------------------------------------------------- PROJECT
  {
    id: "project.repository",
    module: "clean",
    goal: "Read a repository and establish what it declares about its own build and hygiene.",
    fr: {
      title: "Lecture du dépôt",
      description:
        "Lit les fichiers de configuration, les scripts et la documentation du dépôt pour vérifier ce qu'il annonce de lui-même.",
    },
    en: {
      title: "Repository reading",
      description:
        "Reads the repository's configuration, scripts and documentation to check what it claims about itself.",
    },
    inputs: [
      {
        name: "repository",
        type: "repository",
        required: true,
        description: "The repository to read.",
      },
    ],
    prerequisites: ["The repository is linked to the project and readable."],
    permissions: ["read"],
    execution: { mode: "repository", timeoutMs: 60_000 },
    dependencies: [],
    compatibility: { targetTypes: ["PROJECT"], surfaces: ["WEB", "CLI", "AI", "DESKTOP", "API"] },
    expectedResult: "Facts about the repository, each with the file and line it came from.",
    proof: { format: "evidence", description: "File path and excerpt for every claim." },
    limits: [
      "Ne lit pas l'historique Git au-delà du dernier commit.",
      "N'exécute aucun script du dépôt.",
    ],
    controls: [],
    version: CAPABILITY_VERSION,
  },
  {
    id: "project.intelligence",
    module: "clean",
    goal: "Confront a project's declared configuration with what its code and its live site actually do.",
    fr: {
      title: "Cohérence du projet",
      description:
        "Compare la configuration déclarée du projet, son code et son site en ligne, et signale les contradictions.",
    },
    en: {
      title: "Project coherence",
      description:
        "Compares the project's declared configuration, its code and its live site, and reports contradictions.",
    },
    inputs: [
      { name: "project", type: "string", required: true, description: "The project to read." },
    ],
    prerequisites: ["The project has a repository or a URL, and a configuration."],
    permissions: ["read", "analysis"],
    execution: { mode: "repository", timeoutMs: 90_000 },
    dependencies: ["project.repository"],
    compatibility: { targetTypes: ["PROJECT"], surfaces: ["WEB", "CLI", "AI", "DESKTOP", "API"] },
    expectedResult: "Contradictions, each naming the two sources that disagree.",
    proof: { format: "report", description: "Both sides of every contradiction, quoted." },
    limits: [
      "Ne devine pas une intention : une divergence est signalée, pas interprétée comme un bug.",
      "Ne lit que ce que le projet a lié.",
    ],
    controls: [],
    version: CAPABILITY_VERSION,
  },
  // ------------------------------------------------------- LOCAL ENVIRONMENT
  {
    id: "environment.local",
    module: "clean",
    goal: "Read a local working environment and report what it can and cannot run.",
    fr: {
      title: "Environnement local",
      description:
        "Lit la machine ou l'agent local : version de Node, présence d'un navigateur, accès réseau, et en déduit ce qui peut être mesuré localement.",
    },
    en: {
      title: "Local environment",
      description:
        "Reads the machine or local agent: Node version, browser availability, network access, and derives what can be measured locally.",
    },
    inputs: [],
    prerequisites: ["The local agent is running with the permissions it was granted."],
    permissions: ["read"],
    execution: { mode: "local", timeoutMs: 15_000 },
    dependencies: [],
    compatibility: { targetTypes: ["LOCAL_ENVIRONMENT"], surfaces: ["CLI", "DESKTOP", "WEB"] },
    expectedResult: "What is available, what is missing, and which capabilities that enables.",
    proof: { format: "evidence", description: "The detected values, never credentials." },
    limits: [
      "Ne lit aucun secret : variables sensibles, clés et jetons sont masqués.",
      "Ne dit pas si le projet est correct, seulement ce que la machine permet.",
    ],
    controls: [],
    version: CAPABILITY_VERSION,
  },
  // ------------------------------------------------------------ REMEDIATION
  {
    id: "remediation.verify",
    module: "clean",
    goal: "Re-run exactly one control after a fix and compare it with the earlier result.",
    fr: {
      title: "Vérification d'une correction",
      description:
        "Rejoue le contrôle visé par une correction et compare le résultat avant/après, sans relancer tout l'audit.",
    },
    en: {
      title: "Fix verification",
      description:
        "Re-runs the control a fix targeted and compares the before/after result without running the whole audit again.",
    },
    inputs: [
      { name: "controlId", type: "string", required: true, description: "The control to re-run." },
      { name: "url", type: "url", required: true, description: "Where to re-run it." },
    ],
    prerequisites: ["The control was measured before, so there is something to compare."],
    permissions: ["read", "analysis"],
    execution: { mode: "http", timeoutMs: 30_000 },
    dependencies: [],
    compatibility: { targetTypes: ["PAGE", "SITE", "API", "WORKFLOW"], surfaces: ALL_SURFACES },
    expectedResult: "The new verdict and the delta from the previous one.",
    proof: { format: "diff", description: "The observed value before and after." },
    limits: [
      "Ne vérifie qu'un contrôle : une correction qui en touche plusieurs demande plusieurs vérifications.",
      "Un cache de CDN peut servir l'ancienne valeur : le rapport affiche l'âge de la réponse.",
    ],
    controls: [],
    version: CAPABILITY_VERSION,
  },
];

const byId = new Map(capabilities.map((entry) => [entry.id, entry]));

export const CAPABILITIES: readonly Capability[] = Object.freeze(capabilities);

export function capabilityById(id: string): Capability | undefined {
  return byId.get(id);
}

export function capabilitiesForModule(module: ScanModule): Capability[] {
  return capabilities.filter((entry) => entry.module === module);
}

/** A module is offered for a target type only if one of its capabilities applies there. */
export function modulesForTargetType(targetType: AnalysisTargetType): ScanModule[] {
  const modules = new Set<ScanModule>();
  for (const entry of capabilities) {
    if (entry.compatibility.targetTypes.includes(targetType)) modules.add(entry.module);
  }
  return [...modules];
}

export interface AnalysisPlan {
  targetType: AnalysisTargetType;
  requestedModules: string[];
  applicableModules: string[];
  capabilities: string[];
  /** Requested modules that cannot run here, each with the reason shown to the person. */
  unavailable: { module: string; reason: string }[];
}

/**
 * Decide what can actually run, before anything runs.
 *
 * The alternative — accepting the request, running what happens to work and calling the
 * rest "no findings" — is how a partial analysis gets read as a clean bill of health.
 * A module that cannot apply here is refused with a reason, and the caller records it.
 */
export function planAnalysis(input: {
  targetType: AnalysisTargetType;
  requestedModules: readonly string[];
  surface?: CapabilitySurface;
}): AnalysisPlan {
  const applicableModules: string[] = [];
  const plannedCapabilities: string[] = [];
  const unavailable: { module: string; reason: string }[] = [];

  for (const module of [...new Set(input.requestedModules)]) {
    const candidates = capabilities.filter((entry) => entry.module === module);
    if (candidates.length === 0) {
      unavailable.push({ module, reason: "Ce module n'existe pas dans le registre." });
      continue;
    }
    const usable = candidates.filter(
      (entry) =>
        entry.compatibility.targetTypes.includes(input.targetType) &&
        (input.surface === undefined || entry.compatibility.surfaces.includes(input.surface))
    );
    if (usable.length === 0) {
      const nearest = candidates[0] as Capability;
      unavailable.push({
        module,
        reason:
          `Le module ${module.toUpperCase()} ne s'applique pas à une analyse ${input.targetType}. ` +
          (nearest.limits[0] ?? "Il demande une cible joignable."),
      });
      continue;
    }
    applicableModules.push(module);
    for (const entry of usable) plannedCapabilities.push(entry.id);
  }

  return {
    targetType: input.targetType,
    requestedModules: [...input.requestedModules],
    applicableModules,
    capabilities: plannedCapabilities,
    unavailable,
  };
}

export interface AnalysisProfile {
  id: string;
  fr: { name: string; description: string };
  en: { name: string; description: string };
  targetType: AnalysisTargetType;
  modules: ScanModule[];
  capabilities: string[];
}

/**
 * Combined profiles.
 *
 * A profile is a named intent ("je veux savoir si un client peut payer"), not a module
 * checklist. Simple mode offers these; Studio mode lets the person open one and change
 * exactly what it contains — same list, no second source of truth.
 */
export const ANALYSIS_PROFILES: readonly AnalysisProfile[] = Object.freeze([
  {
    id: "quick",
    fr: {
      name: "Vérification rapide",
      description: "La page se charge-t-elle, et est-elle protégée ?",
    },
    en: { name: "Quick check", description: "Does the page load, and is it protected?" },
    targetType: "PAGE",
    modules: ["world", "fail"],
    capabilities: ["page.world", "page.fail"],
  },
  {
    id: "conversion",
    fr: {
      name: "Parcours d'achat",
      description: "Un client peut-il trouver, remplir et terminer le parcours ?",
    },
    en: {
      name: "Purchase journey",
      description: "Can a customer find, fill and finish the journey?",
    },
    targetType: "PAGE",
    modules: ["world", "flow", "exit"],
    capabilities: ["page.world", "page.flow", "page.exit"],
  },
  {
    id: "seo",
    fr: { name: "Indexation", description: "Le site dit-il aux moteurs ce qu'ils peuvent lire ?" },
    en: { name: "Indexing", description: "Does the site tell search engines what they may read?" },
    targetType: "SITE",
    modules: ["exit", "clean"],
    capabilities: ["site.indexing", "site.crawl"],
  },
  {
    id: "security",
    fr: { name: "Protections", description: "Quelles protections HTTP manquent, page par page ?" },
    en: { name: "Protections", description: "Which HTTP protections are missing, page by page?" },
    targetType: "SITE",
    modules: ["fail"],
    capabilities: ["site.security"],
  },
  {
    id: "full",
    fr: {
      name: "Analyse complète",
      description: "Les cinq familles, sur tout le site atteignable.",
    },
    en: { name: "Full analysis", description: "All five families, across the reachable site." },
    targetType: "SITE",
    modules: ["world", "flow", "exit", "fail", "clean"],
    capabilities: [
      "page.world",
      "page.flow",
      "page.exit",
      "page.fail",
      "page.clean",
      "site.crawl",
      "site.security",
      "site.indexing",
      "site.flow",
    ],
  },
  {
    id: "project",
    fr: {
      name: "Cohérence du projet",
      description: "Ce que le dépôt annonce correspond-il au site ?",
    },
    en: {
      name: "Project coherence",
      description: "Does what the repository claims match the site?",
    },
    targetType: "PROJECT",
    modules: ["clean"],
    capabilities: ["project.repository", "project.intelligence"],
  },
]);

export function profileById(id: string): AnalysisProfile | undefined {
  return ANALYSIS_PROFILES.find((profile) => profile.id === id);
}
