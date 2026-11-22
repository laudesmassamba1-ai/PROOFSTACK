import { CircleAlert, CircleCheck, Terminal } from "lucide-react";
import { Link } from "react-router";
import { useI18n } from "../i18n/index.js";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";

export type ModuleName = "world" | "flow" | "exit" | "fail" | "clean";

export interface ModuleContent {
  name: ModuleName;
  tag: string;
  headline: string;
  lede: string;
  checks: { label: string; detail: string }[];
  implemented: string[];
  pending: string[];
  sample: string;
  command: string;
}

export const CONTENT: Record<ModuleName, ModuleContent> = {
  world: {
    name: "world",
    tag: "Global compatibility",
    headline: "Reach every user, not every ASCII table",
    lede: "WORLD generates international synthetic fixtures, submits them to your product, and compares what came back. It separates two failures people usually merge: refusing a valid value, and accepting an invalid one.",
    checks: [
      {
        label: "Identity data",
        detail:
          "Accented names, multiple surnames, 200-character names, non-Latin scripts, combining sequences, RTL display names, bidi-control and homoglyph spoofing.",
      },
      {
        label: "Phone numbers",
        detail:
          "Per-country validity from libphonenumber metadata, E.164 normalisation, national leading zeros, and the Benin 8→10 digit plan change.",
      },
      {
        label: "Addresses",
        detail:
          "Country-specific line counts, alphanumeric postcodes, and the countries that have no postcode system at all — where requiring one is a defect.",
      },
      {
        label: "Currency",
        detail:
          "ISO 4217 exponents (XOF has no subunit, JOD has three decimals), locale separators including U+202F and Arabic-Indic digits, precision loss, and values beyond Number.MAX_SAFE_INTEGER.",
      },
      {
        label: "Dates and time",
        detail:
          "Declared input formats, calendar-impossible dates (30 February), leap years, spring-forward gaps, fall-back ambiguity, and zone-correct instants.",
      },
      {
        label: "Sorting",
        detail:
          "Collation expectations per locale, asserted against the product's own ordered output when it exposes one.",
      },
    ],
    implemented: [
      "8 versioned locale profiles: en-US, en-GB, fr-FR, fr-BJ, fr-CG, ar-EG, ja-JP, pt-BR",
      "Fixture expansion with accept/reject expectations and canonical values",
      "HTTP target driver (submit + readback) and a synthetic driver for self-tests",
      "Storage-integrity comparison with exact / NFC / digit tolerances",
    ],
    pending: [
      "Browser form driver (Playwright) for apps without a record endpoint",
      "Profile packs beyond the shipped eight",
    ],
    sample: `fr-BJ/identity/Sossou-14  FAILED  corrupted_transformation
  expected  "Kòfí Sossou"
  actual    "Kof? Sossou"
  column    full_name  (utf8mb3 truncation at byte 5)
  reproduce proofcore test --module world --only fr-BJ/identity/Sossou-14`,
    command: "proofcore test --module world --profiles fr-BJ,ar-EG,ja-JP",
  },
  flow: {
    name: "flow",
    tag: "Transaction reliability",
    headline: "Prove the money path, including its worst days",
    lede: "FLOW drives a journey — cart, checkout, payment selection, confirmation — and then attacks it: declined, cancelled, timed-out, duplicated, delayed, out-of-order and forged webhooks. It reports the state the transaction actually reached, never the state the browser was redirected to.",
    checks: [
      {
        label: "Journeys",
        detail:
          "Navigation, form submission, product selection, cart, checkout, payment selection, confirmation, cancellation, refund workflow.",
      },
      {
        label: "Payment scenarios",
        detail:
          "Sandbox success and decline, cancellation, timeout, missing confirmation, duplicate order, refund, inconsistent state.",
      },
      {
        label: "Webhook hardening",
        detail:
          "Signature verification, timestamp age, duplicate delivery, idempotency, ordering, invalid payload, retry behaviour.",
      },
      {
        label: "State truth",
        detail:
          "The provider's verified transaction status is authoritative. A redirect, a delay or a query parameter can never activate anything.",
      },
    ],
    implemented: [
      "Provider-independent PaymentProvider contract",
      "Sandbox provider with deterministic outcomes",
      "Payment and subscription state machines with legal transitions only",
    ],
    pending: [
      "Playwright journey execution in the CLI",
      "SasPay adapter wired to real credentials (spec verified, no key present)",
    ],
    sample: `flow/webhook/duplicate  PASSED   idempotent: 2 deliveries, 1 entitlement change
flow/webhook/forged     PASSED   signature mismatch rejected (401)
flow/checkout/declined  FAILED   subscription activated on PENDING`,
    command: "proofcore test --module flow --payment-mode sandbox",
  },
  exit: {
    name: "exit",
    tag: "Data portability",
    headline: "An export is a promise until it round-trips",
    lede: "EXIT reads an export as a customer would: CSV, JSON, or a ZIP with a manifest. It validates schema, relationships, encodings, precision and file integrity, then imports the data back and diffs the result against the synthetic original.",
    checks: [
      {
        label: "Schema",
        detail:
          "Missing fields, invalid types, null handling, encoding, numeric precision, date transformations, ids, unique constraints.",
      },
      {
        label: "Relationships",
        detail:
          "Parent-child integrity, missing references, duplicates, orphans, referential consistency.",
      },
      {
        label: "File integrity",
        detail: "Presence, count, size, SHA-256 checksums, manifest references.",
      },
      {
        label: "Round trip",
        detail:
          "Original → export → re-import, with field-level diffs for missing records, changed values, altered dates, broken references and missing attachments.",
      },
    ],
    implemented: [
      "RFC 4180 CSV reader/writer with formula-injection guard",
      "ZIP manifest verification with SHA-256 digests",
      "Round-trip differ with record-level alignment",
    ],
    pending: [
      "Dataset connectors beyond HTTP and local files",
      "Schema inference from a live database",
    ],
    sample: `exit/roundtrip/orders  FAILED   2 of 500 records differ
  order_118  total: 1234.56 -> 1234.5599999999999 (float coercion)
  order_402  customer_id: "c_9" -> null (orphan dropped by LEFT JOIN)`,
    command: "proofcore test --module exit --formats json,csv,zip",
  },
  fail: {
    name: "fail",
    tag: "Security & defect audit",
    headline: "Find the holes before someone else does",
    lede: "FAIL audits a deployed URL over real HTTP — security headers, cookie flags, mixed content, server leaks, verbose errors. Every check records what was actually observed, then a score and an ordered issue list. No invention: a header that is absent is reported absent.",
    checks: [
      {
        label: "Security headers",
        detail:
          "Content-Security-Policy, Strict-Transport-Security, X-Frame-Options / frame-ancestors, Referrer-Policy, Permissions-Policy. Each absent header is a finding with the reason it matters.",
      },
      {
        label: "Cookies",
        detail:
          "Secure and HttpOnly flags on every Set-Cookie. A session cookie without them is script-stealable or downgradeable.",
      },
      {
        label: "Transport",
        detail:
          "HTTPS enforcement and mixed-content detection: http:// subresources referenced from an https page break TLS guarantees.",
      },
      {
        label: "Leaks",
        detail:
          "Server and X-Powered-By banners, stack traces and framework exception dumps in the response body — the fingerprints attackers enumerate first.",
      },
    ],
    implemented: [
      "Real HTTP fetch against the target, headers and body observed",
      "Header, cookie, mixed-content and error-disclosure checks with PASS / WARN / FAIL",
      "Score and ordered findings, each with what was observed and why it matters",
      "Tenant guard: the URL must belong to a project of the workspace",
    ],
    pending: [
      "Deeper checks: authentication flows, rate limiting, TLS configuration grading",
      "JavaScript bundle analysis for dangerous patterns",
    ],
    sample: `fail/csp           FAILED   absent   a Content-Security-Policy limits XSS impact
fail/hsts          FAILED   absent   HSTS prevents protocol downgrade
fail/cookie_secure FAILED   missing Secure   session cookies need Secure
fail/server_banner WARN     nginx/1.24.0     version banners help attackers
score 61/100  ·  4 fail · 2 warn · 5 pass
  reproduce proofcore audit fail https://app.example.com`,
    command: "proofcore audit fail https://app.example.com",
  },
  clean: {
    name: "clean",
    tag: "UI quality · score /100",
    headline: "A score you can argue with, because you can see the checks",
    lede: "CLEAN measures a page the way a careful reviewer would: viewport, language, semantic structure, heading order, alt coverage, form labels, page weight. Nothing is subjective — each check shows what was observed and why it matters, and the 0–100 score is just the sum.",
    checks: [
      {
        label: "Document basics",
        detail:
          "Viewport meta, html lang attribute, title length, meta description. Without them mobile rendering, translation, bookmarks and search results degrade.",
      },
      {
        label: "Accessibility",
        detail:
          "Alt-text coverage on every image, accessible labels on every form, heading levels that never skip. The three checks screen readers fail on first.",
      },
      {
        label: "Structure",
        detail:
          "Semantic landmarks (main, header, nav, footer, article) and the count of inline styles — the two signals of a page built on purpose or patched in a hurry.",
      },
      {
        label: "Weight & delivery",
        detail:
          "HTML size against a 150 KB budget, script count, and caching hints. Heavy pages are slow pages, and slow pages lose users.",
      },
    ],
    implemented: [
      "Measured DOM checks over real HTTP — no screenshots, no guessing",
      "Heading-order and alt-coverage maths with PASS / WARN / FAIL detail",
      "One 0–100 score that sums the checks honestly",
      "Tenant guard: the URL must belong to a project of the workspace",
    ],
    pending: [
      "Visual regression snapshots between releases",
      "Performance budget beyond page weight (LCP, CLS via real rendering)",
    ],
    sample: `clean/a11y/img_alt     PASSED   14/14 images with alt
  clean/a11y/form_labels FAILED   0/2 forms labelled   inputs need accessible names
  clean/doc/html_lang    PASSED   present
  clean/weight/html      WARN     188 KB of 150 KB budget
  score 84/100  ·  1 fail · 1 warn · 8 pass
    reproduce proofcore audit clean https://app.example.com`,
    command: "proofcore audit clean https://app.example.com",
  },
};

export const CONTENT_FR: Record<ModuleName, ModuleContent> = {
  world: {
    name: "world",
    tag: "Compatibilité mondiale",
    headline: "Joindre chaque utilisateur, pas seulement la table ASCII",
    lede: "WORLD génère des données synthétiques internationales, les soumet à votre produit et compare ce qui revient. Il distingue deux échecs que l'on confond d'habitude : refuser une valeur valide, et accepter une valeur invalide.",
    checks: [
      {
        label: "Données d'identité",
        detail:
          "Noms accentués, noms composés, noms de 200 caractères, écritures non latines, séquences combinantes, noms RTL, contrôles bidi et usurpation par homoglyphes.",
      },
      {
        label: "Numéros de téléphone",
        detail:
          "Validité par pays d'après les métadonnées libphonenumber, normalisation E.164, zéros nationaux, passage béninois 8→10 chiffres.",
      },
      {
        label: "Adresses",
        detail:
          "Nombre de lignes par pays, codes postaux alphanumériques, et les pays sans code postal — l'exiger y est un défaut.",
      },
      {
        label: "Monnaie",
        detail:
          "Exposants ISO 4217 (le XOF n'a pas de sous-unité, le JOD trois décimales), séparateurs locaux dont U+202F et chiffres arabo-indiens, perte de précision, valeurs au-delà de Number.MAX_SAFE_INTEGER.",
      },
      {
        label: "Dates et heures",
        detail:
          "Formats d'entrée déclarés, dates impossibles au calendrier (30 février), années bissextiles, trous de passage à l'heure d'été, ambiguïtés de retour, instants corrects par fuseau.",
      },
      {
        label: "Tri",
        detail:
          "Attentes de collation par locale, vérifiées contre la sortie ordonnée du produit quand il en expose une.",
      },
    ],
    implemented: [
      "8 profils de locales versionnés : en-US, en-GB, fr-FR, fr-BJ, fr-CG, ar-EG, ja-JP, pt-BR",
      "Expansion des cas avec attentes accepter/rejeter et valeurs canoniques",
      "Pilote HTTP (soumission + relecture) et pilote synthétique pour l'auto-test",
      "Comparaison d'intégrité de stockage avec tolérances exacte / NFC / chiffres",
    ],
    pending: [
      "Pilote de formulaires navigateur (Playwright) pour les apps sans endpoint d'écriture",
      "Packs de profils au-delà des huit livrés",
    ],
    sample: `fr-BJ/identity/Sossou-14  FAILED  corrupted_transformation
  expected  "Kòfí Sossou"
  actual    "Kof? Sossou"
  column    full_name  (utf8mb3 troncature à l'octet 5)
  reproduce proofcore test --module world --only fr-BJ/identity/Sossou-14`,
    command: "proofcore test --module world --profiles fr-BJ,ar-EG,ja-JP",
  },
  flow: {
    name: "flow",
    tag: "Fiabilité des transactions",
    headline: "Prouver le chemin de l'argent, y compris ses pires jours",
    lede: "FLOW déroule un parcours — panier, paiement, choix du mode, confirmation — puis l'attaque : refusé, annulé, expiré, dupliqué, retardé, hors-ordre et webhooks forgés. Il rapporte l'état que la transaction a réellement atteint, jamais celui vers lequel le navigateur a été redirigé.",
    checks: [
      {
        label: "Parcours",
        detail:
          "Navigation, soumission de formulaires, sélection produit, panier, paiement, choix du mode, confirmation, annulation, remboursement.",
      },
      {
        label: "Scénarios de paiement",
        detail:
          "Succès et refus sandbox, annulation, expiration, confirmation manquante, commande dupliquée, remboursement, état incohérent.",
      },
      {
        label: "Durcissement des webhooks",
        detail:
          "Vérification de signature, âge de l'horodatage, livraison dupliquée, idempotence, ordre, charge utile invalide, comportement de retry.",
      },
      {
        label: "Vérité d'état",
        detail:
          "Le statut vérifié par le fournisseur fait foi. Une redirection, un délai ou un paramètre d'URL n'active jamais rien.",
      },
    ],
    implemented: [
      "Contrat PaymentProvider indépendant du fournisseur",
      "Fournisseur sandbox aux issues déterministes",
      "Machines à états paiement et abonnement, transitions légales uniquement",
    ],
    pending: [
      "Exécution des parcours Playwright dans le CLI",
      "Adaptateur SasPay relié à de vraies identifiants (spécification vérifiée, aucune clé présente)",
    ],
    sample: `flow/webhook/duplicate  PASSED   idempotent: 2 livraisons, 1 changement de droit
flow/webhook/forged     PASSED   signature invalide rejetée (401)
flow/checkout/declined  FAILED   abonnement activé sur PENDING`,
    command: "proofcore test --module flow --payment-mode sandbox",
  },
  exit: {
    name: "exit",
    tag: "Portabilité des données",
    headline: "Un export est une promesse tant qu'il ne repasse pas par le retour",
    lede: "EXIT lit un export comme un client : CSV, JSON, ou ZIP avec manifeste. Il valide le schéma, les relations, les encodages, la précision et l'intégrité des fichiers, puis réimporte les données et compare le résultat au jeu synthétique d'origine.",
    checks: [
      {
        label: "Schéma",
        detail:
          "Champs manquants, types invalides, gestion du null, encodage, précision numérique, transformations de dates, identifiants, contraintes d'unicité.",
      },
      {
        label: "Relations",
        detail:
          "Intégrité parent-enfant, références manquantes, doublons, orphelins, cohérence référentielle.",
      },
      {
        label: "Intégrité des fichiers",
        detail: "Présence, nombre, taille, empreintes SHA-256, références du manifeste.",
      },
      {
        label: "Aller-retour",
        detail:
          "Original → export → réimport, avec diffs au niveau des champs pour les enregistrements manquants, valeurs modifiées, dates altérées, références cassées et pièces jointes perdues.",
      },
    ],
    implemented: [
      "Lecteur/rédacteur CSV RFC 4180 avec garde anti-injection de formules",
      "Vérification de manifeste ZIP avec empreintes SHA-256",
      "Comparateur aller-retour avec alignement par enregistrement",
    ],
    pending: [
      "Connecteurs de jeux de données au-delà de HTTP et des fichiers locaux",
      "Inférence de schéma depuis une base en ligne",
    ],
    sample: `exit/roundtrip/orders  FAILED   2 des 500 enregistrements diffèrent
  order_118  total: 1234.56 -> 1234.5599999999999 (coercition flottant)
  order_402  customer_id: "c_9" -> null (orphelin perdu par LEFT JOIN)`,
    command: "proofcore test --module exit --formats json,csv,zip",
  },
  fail: {
    name: "fail",
    tag: "Audit sécurité et défauts",
    headline: "Trouver les failles avant quelqu'un d'autre",
    lede: "FAIL audite une URL déployée par HTTP réel — en-têtes de sécurité, drapeaux des cookies, contenu mixte, fuites serveur, erreurs bavardes. Chaque vérification enregistre ce qui a été réellement observé, puis un score et une liste ordonnée. Aucune invention : un en-tête absent est signalé absent.",
    checks: [
      {
        label: "En-têtes de sécurité",
        detail:
          "Content-Security-Policy, Strict-Transport-Security, X-Frame-Options / frame-ancestors, Referrer-Policy, Permissions-Policy. Chaque en-tête absent est une constatation avec la raison qui compte.",
      },
      {
        label: "Cookies",
        detail:
          "Drapeaux Secure et HttpOnly sur chaque Set-Cookie. Un cookie de session sans eux est volable par script ou dégradable.",
      },
      {
        label: "Transport",
        detail:
          "Application de HTTPS et détection de contenu mixte : des sous-ressources http:// référencées depuis une page https cassent les garanties TLS.",
      },
      {
        label: "Fuites",
        detail:
          "Bannières Server et X-Powered-By, traces de pile, dumps d'exceptions dans le corps de la réponse — les empreintes que les attaquants énumèrent d'abord.",
      },
    ],
    implemented: [
      "Requête HTTP réelle vers la cible, en-têtes et corps observés",
      "Vérifications en-têtes, cookies, contenu mixte et divulgation d'erreurs avec PASS / WARN / FAIL",
      "Score et constatations ordonnées, chacune avec l'observation et ce qui compte",
      "Garde de locataire : l'URL doit appartenir à un projet de l'espace de travail",
    ],
    pending: [
      "Vérifications plus profondes : flux d'authentification, limitation de débit, notation TLS",
      "Analyse des bundles JavaScript pour les motifs dangereux",
    ],
    sample: `fail/csp           FAILED   absent   une Content-Security-Policy limite l'impact XSS
fail/hsts           FAILED   absent   HSTS empêche la rétrogradation du protocole
fail/cookie_secure  FAILED   Secure manquant   les cookies de session exigent Secure
fail/server_banner  WARN     nginx/1.24.0     les bannières de version aident les attaquants
score 61/100  ·  4 fail · 2 warn · 5 pass
  reproduce proofcore audit fail https://app.example.com`,
    command: "proofcore audit fail https://app.example.com",
  },
  clean: {
    name: "clean",
    tag: "Qualité UI · score /100",
    headline: "Un score auquel on peut répondre, parce qu'on voit les vérifications",
    lede: "CLEAN mesure une page comme un relecteur minutieux : viewport, langue, structure sémantique, ordre des titres, couverture alt, libellés de formulaires, poids. Rien de subjectif — chaque vérification montre ce qui a été observé et pourquoi cela compte, et le score 0–100 n'est que la somme.",
    checks: [
      {
        label: "Bases du document",
        detail:
          "Meta viewport, attribut html lang, longueur du titre, meta description. Sans eux, le rendu mobile, la traduction, les favoris et le référencement se dégradent.",
      },
      {
        label: "Accessibilité",
        detail:
          "Couverture alt de chaque image, libellés accessibles de chaque formulaire, niveaux de titres sans saut. Les trois vérifications que les lecteurs d'écran échouent d'abord.",
      },
      {
        label: "Structure",
        detail:
          "Repères sémantiques (main, header, nav, footer, article) et nombre de styles en ligne — les deux signaux d'une page construite avec intention ou rafistolée à la hâte.",
      },
      {
        label: "Poids et livraison",
        detail:
          "Taille du HTML contre un budget de 150 Ko, nombre de scripts, indices de cache. Les pages lourdes sont lentes, et les pages lentes perdent des utilisateurs.",
      },
    ],
    implemented: [
      "Vérifications DOM mesurées par HTTP réel — pas de captures, pas de suppositions",
      "Calculs d'ordre des titres et de couverture alt avec détail PASS / WARN / FAIL",
      "Un score 0–100 qui additionne les vérifications honnêtement",
      "Garde de locataire : l'URL doit appartenir à un projet de l'espace de travail",
    ],
    pending: [
      "Instantanés de régression visuelle entre versions",
      "Budget de performance au-delà du poids (LCP, CLS via rendu réel)",
    ],
    sample: `clean/a11y/img_alt     PASSED   14/14 images avec alt
  clean/a11y/form_labels FAILED   0/2 formulaires libellés   les inputs exigent un nom accessible
  clean/doc/html_lang    PASSED   présent
  clean/weight/html      WARN     188 KB sur un budget de 150 KB
  score 84/100  ·  1 fail · 1 warn · 8 pass
    reproduce proofcore audit clean https://app.example.com`,
    command: "proofcore audit clean https://app.example.com",
  },
};

export function ModulePage({ name }: { name: ModuleName }) {
  const { t, locale } = useI18n();
  const fr = locale === "fr";
  const content = (fr ? CONTENT_FR : CONTENT)[name];
  const label = name.toUpperCase();

  return (
    <>
      <Section>
        <p className="eyebrow">
          {label} · {content.tag}
        </p>
        <h1 className="mt-3 text-[2.2rem] leading-[1.1] tracking-tight sm:text-[3rem]">
          {content.headline}
        </h1>
        <p className="mt-5 max-w-[68ch] text-[1rem] leading-relaxed text-white/58">
          {content.lede}
        </p>
        <p className="mt-6 max-w-[60ch] text-[0.95rem] italic text-white/44">
          {t(`question.${name}` as const)}
        </p>
        <div className="brand-panel mt-8 inline-flex items-center gap-3 px-4 py-3">
          <Terminal size={15} className="text-brand-mint" />
          <code className="text-[0.8rem] text-white/78">{content.command}</code>
        </div>
      </Section>

      <Section tone="deeper">
        <SectionHeading
          eyebrow={fr ? "Ce qui est réellement vérifié" : "What it actually checks"}
          title={fr ? "Pas une liste d’intentions" : "Not a checklist of intentions"}
        />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {content.checks.map((check) => (
            <article key={check.label} className="brand-panel spot-card p-5" data-tilt data-reveal>
              <h3 className="text-[0.95rem] font-semibold">{check.label}</h3>
              <p className="mt-2 text-[0.86rem] leading-relaxed text-white/52">{check.detail}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section>
        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          <figure className="brand-panel spot-card overflow-hidden" data-reveal>
            <figcaption className="border-b border-white/8 px-4 py-3 font-mono text-[0.74rem] text-white/48">
              {fr ? "Sortie CLI" : "CLI output"}
            </figcaption>
            <pre className="overflow-x-auto px-4 py-4 font-mono text-[0.74rem] leading-relaxed text-white/76">
              {content.sample}
            </pre>
          </figure>

          <div>
            <h2 className="text-[1.3rem] font-semibold tracking-tight">
              {fr ? "État de construction du module" : "Build status of this module"}
            </h2>
            <ul className="mt-5 space-y-3">
              {content.implemented.map((item) => (
                <li key={item} className="flex gap-3 text-[0.88rem] text-white/70">
                  <CircleCheck size={17} className="mt-0.5 shrink-0 text-brand-emerald" />
                  <span>{item}</span>
                </li>
              ))}
              {content.pending.map((item) => (
                <li key={item} className="flex gap-3 text-[0.88rem] text-white/42">
                  <CircleAlert size={17} className="mt-0.5 shrink-0 text-[#e9b45a]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap gap-3">
              {(["world", "flow", "exit", "fail", "clean"] as ModuleName[])
                .filter((other) => other !== name)
                .map((other) => (
                  <Link key={other} to={`/${other}`} className="btn btn-ghost" data-magnet>
                    {other.toUpperCase()}
                  </Link>
                ))}
              <Link to="/pricing" className="btn btn-primary" data-magnet>
                {t("nav.pricing")}
              </Link>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
