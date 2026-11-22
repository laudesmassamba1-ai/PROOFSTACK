import type { ScanModule } from "./page-scan.js";

/**
 * The control registry.
 *
 * Every control a scan can report on lives here exactly once, with what it establishes,
 * what happens if it fails, the smallest change that fixes it, and how to confirm the fix
 * from outside. This is what lets PROOFCORE explain a finding without calling a model:
 * the text below is the explanation, in both languages, written and reviewed once.
 *
 * Four rules keep the registry honest:
 *
 * 1. A control that is not here cannot be reported. `assertKnownControls` fails the scan
 *    rather than ship a finding nobody can explain.
 * 2. `objective` states a fact the control can return, never a promise. "Établit si…",
 *    not "garantit que…".
 * 3. `consequence` says what *can* happen, not what will. A missing CSP does not mean the
 *    site is compromised; it means an injected script would run with no ceiling.
 * 4. `risk` is the exposure when the control is missing, `complexity` is the work of
 *    fixing it. A high-risk, low-complexity control (HSTS) and a low-risk, high-complexity
 *    one (a print stylesheet) must not be ranked by the same number.
 */

export type ControlComplexity = "low" | "medium" | "high";
export type ControlRisk = "low" | "medium" | "high";

export interface ControlCopy {
  /** Short, human name of the control. */
  title: string;
  /** The fact the control establishes. */
  objective: string;
  /** What can happen to the product when it fails. */
  consequence: string;
  /** The smallest change that fixes it. */
  fix: string;
  /** How to confirm the fix from outside, without trusting us. */
  verify: string;
}

export interface ControlFixExample {
  /** Server, framework or platform the snippet belongs to. */
  stack: string;
  code: string;
}

export interface Control {
  id: string;
  module: ScanModule;
  fr: ControlCopy;
  en: ControlCopy;
  /** Work required to fix, not severity. */
  complexity: ControlComplexity;
  /** Exposure when the control is missing, not severity of a particular site. */
  risk: ControlRisk;
  /** What the scan reads to decide. */
  method: string;
  /** The shape of what comes back: a header, a count, a raw value. */
  result: string;
  fixes: ControlFixExample[];
  /**
   * Set when another control already answers the same question, so the score counts the
   * pair once instead of twice. The finding is still reported: history and comparison
   * refer to these ids.
   */
  aliasOf?: string;
}

const controls: Control[] = [
  // ------------------------------------------------------------------- FAIL
  {
    id: "tls",
    module: "fail",
    fr: {
      title: "HTTPS / TLS",
      objective:
        "Établit si la page et les ressources qu'elle référence sont servies sur une connexion chiffrée.",
      consequence:
        "Sur http, mots de passe, jetons de session et données de paiement traversent le réseau en clair ; un Wi-Fi public suffit à les lire.",
      fix: "Servir le site en https et rediriger tout http vers https en 301, sous-domaines compris.",
      verify: "`curl -sI http://votre-site` répond 301 vers l'URL https, et le cadenas apparaît.",
    },
    en: {
      title: "HTTPS / TLS",
      objective:
        "Establishes whether the page and the resources it references are served over an encrypted connection.",
      consequence:
        "Over http, passwords, session tokens and payment data cross the network in clear text; a public Wi-Fi is enough to read them.",
      fix: "Serve the site over https and redirect every http request to https with a 301, subdomains included.",
      verify: "`curl -sI http://your-site` answers 301 to the https URL, and the padlock appears.",
    },
    complexity: "low",
    risk: "high",
    method: "Schéma de l'URL finale et des ressources qu'elle charge.",
    result: "https ou http",
    fixes: [
      {
        stack: "Nginx",
        code: "server {\n  listen 80;\n  server_name example.com;\n  return 301 https://$host$request_uri;\n}",
      },
      { stack: "Apache", code: "Redirect permanent / https://example.com/" },
      { stack: "Cloudflare", code: "SSL/TLS → Edge Certificates → Always Use HTTPS: On" },
    ],
  },
  {
    id: "hsts",
    module: "fail",
    fr: {
      title: "HSTS",
      objective:
        "Établit si le navigateur est tenu de revenir en https pendant une durée déclarée.",
      consequence:
        "Sans HSTS, la première requête peut partir en http et être interceptée avant la redirection.",
      fix: "Envoyer `Strict-Transport-Security: max-age=31536000; includeSubDomains` sur les réponses https, une fois tous les sous-domaines passés en https.",
      verify: "`curl -sI https://votre-site` renvoie l'en-tête avec un max-age non nul.",
    },
    en: {
      title: "HSTS",
      objective: "Establishes whether the browser is bound to use https for a declared period.",
      consequence:
        "Without HSTS the first request can leave over http and be intercepted before the redirect.",
      fix: "Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` on https responses, once every subdomain is on https.",
      verify: "`curl -sI https://your-site` returns the header with a non-zero max-age.",
    },
    complexity: "low",
    risk: "medium",
    method: "En-tête `strict-transport-security` de la réponse.",
    result: "Valeur de l'en-tête, ou « absent »",
    fixes: [
      {
        stack: "Nginx",
        code: 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
      },
      {
        stack: "Apache",
        code: 'Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"',
      },
      {
        stack: "Node.js (helmet)",
        code: 'import helmet from "helmet";\napp.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true }));',
      },
    ],
  },
  {
    id: "csp",
    module: "fail",
    fr: {
      title: "Content-Security-Policy",
      objective:
        "Établit si une politique limite les sources depuis lesquelles un script peut s'exécuter.",
      consequence:
        "Sans CSP, un script injecté — par un champ mal filtré, une dépendance compromise ou une extension — s'exécute avec tous les droits de la page.",
      fix: "Publier une politique qui n'autorise que vos propres origines et celles que vous avez choisies, en commençant par `default-src 'self'` puis en ouvrant au strict nécessaire.",
      verify:
        "`curl -sI https://votre-site` renvoie un `content-security-policy`, et la console du navigateur ne signale plus de blocage inattendu.",
    },
    en: {
      title: "Content-Security-Policy",
      objective: "Establishes whether a policy limits where an executing script may come from.",
      consequence:
        "Without a CSP, an injected script — through an unfiltered field, a compromised dependency or an extension — runs with every right the page has.",
      fix: "Publish a policy that allows only your own origins and the ones you chose: start from `default-src 'self'`, then open exactly what breaks.",
      verify:
        "`curl -sI https://your-site` returns a `content-security-policy`, and the browser console shows no unexpected block.",
    },
    complexity: "medium",
    risk: "high",
    method: "En-tête `content-security-policy` de la réponse.",
    result: "Politique tronquée à 90 caractères, ou « absent »",
    fixes: [
      {
        stack: "Nginx",
        code: "add_header Content-Security-Policy \"default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'\" always;",
      },
      {
        stack: "Node.js (helmet)",
        code: 'app.use(helmet.contentSecurityPolicy({ directives: { "default-src": ["\'self\'"], "object-src": ["\'none\'"] } }));',
      },
      {
        stack: "Next.js",
        code: "// next.config.js — headers() adds the same header to every route\n{ key: \"Content-Security-Policy\", value: \"default-src 'self'; object-src 'none'\" }",
      },
    ],
  },
  {
    id: "frame_ancestors",
    module: "fail",
    fr: {
      title: "Encadrement (X-Frame-Options)",
      objective: "Établit si la page peut être affichée dans le cadre d'un autre site.",
      consequence:
        "Sans cet en-tête, un site tiers peut afficher votre page dans une iframe invisible et faire cliquer vos utilisateurs à leur place (clickjacking).",
      fix: "Envoyer `X-Frame-Options: DENY`, ou `SAMEORIGIN` si vous encadrez vos propres pages, ou `frame-ancestors 'none'` dans la CSP.",
      verify: "`curl -sI https://votre-site` renvoie l'un des deux en-têtes.",
    },
    en: {
      title: "Framing (X-Frame-Options)",
      objective: "Establishes whether the page may be displayed inside another site's frame.",
      consequence:
        "Without this header a third-party site can display your page in an invisible iframe and make your users click on its behalf (clickjacking).",
      fix: "Send `X-Frame-Options: DENY`, or `SAMEORIGIN` if you frame your own pages, or `frame-ancestors 'none'` in the CSP.",
      verify: "`curl -sI https://your-site` returns one of the two headers.",
    },
    complexity: "low",
    risk: "medium",
    method: "En-tête `x-frame-options`, ou directive `frame-ancestors` dans la CSP.",
    result: "Valeur de l'en-tête, « csp frame-ancestors » ou « absent »",
    fixes: [
      { stack: "Nginx", code: 'add_header X-Frame-Options "SAMEORIGIN" always;' },
      { stack: "Apache", code: 'Header always set X-Frame-Options "SAMEORIGIN"' },
      { stack: "Node.js (helmet)", code: 'app.use(helmet.frameguard({ action: "sameorigin" }));' },
    ],
  },
  {
    id: "referrer_policy",
    module: "fail",
    fr: {
      title: "Referrer-Policy",
      objective: "Établit quelle partie de l'URL de départ est transmise aux sites tiers.",
      consequence:
        "Sans politique, l'URL complète peut fuiter vers un site tiers : un jeton de réinitialisation ou un identifiant de commande se retrouve dans leurs journaux.",
      fix: "Envoyer `Referrer-Policy: strict-origin-when-cross-origin`, ou `no-referrer` si vous n'avez besoin d'aucune attribution sortante.",
      verify:
        "`curl -sI https://votre-site` renvoie l'en-tête, et l'onglet Réseau montre l'origine seule vers un domaine tiers.",
    },
    en: {
      title: "Referrer-Policy",
      objective: "Establishes how much of the originating URL is sent to third-party sites.",
      consequence:
        "Without a policy the full URL can leak to a third party: a reset token or an order id ends up in their logs.",
      fix: "Send `Referrer-Policy: strict-origin-when-cross-origin`, or `no-referrer` if you need no outbound attribution.",
      verify:
        "`curl -sI https://your-site` returns the header, and the Network tab shows the origin alone towards a third-party domain.",
    },
    complexity: "low",
    risk: "low",
    method: "En-tête `referrer-policy` de la réponse.",
    result: "Valeur de l'en-tête, ou « absent »",
    fixes: [
      {
        stack: "Nginx",
        code: 'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
      },
      {
        stack: "Apache",
        code: 'Header always set Referrer-Policy "strict-origin-when-cross-origin"',
      },
      {
        stack: "HTML",
        code: '<meta name="referrer" content="strict-origin-when-cross-origin" />',
      },
    ],
  },
  {
    id: "permissions_policy",
    module: "fail",
    fr: {
      title: "Permissions-Policy",
      objective:
        "Établit quelles capacités du navigateur (caméra, micro, géolocalisation, paiement) restent disponibles.",
      consequence:
        "Sans politique, un script tiers embarqué peut demander la caméra ou la position sans que la page l'ait décidé.",
      fix: "Envoyer `Permissions-Policy: camera=(), microphone=(), geolocation=()` puis réouvrir seulement ce dont la page a besoin.",
      verify: "`curl -sI https://votre-site` renvoie l'en-tête avec les capacités fermées.",
    },
    en: {
      title: "Permissions-Policy",
      objective:
        "Establishes which browser capabilities (camera, microphone, geolocation, payment) stay available.",
      consequence:
        "Without a policy an embedded third-party script can ask for the camera or the position without the page deciding so.",
      fix: "Send `Permissions-Policy: camera=(), microphone=(), geolocation=()` and reopen only what the page needs.",
      verify: "`curl -sI https://your-site` returns the header with the capabilities closed.",
    },
    complexity: "low",
    risk: "low",
    method: "En-tête `permissions-policy` de la réponse.",
    result: "Valeur de l'en-tête, ou « absent »",
    fixes: [
      {
        stack: "Nginx",
        code: 'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;',
      },
      {
        stack: "Node.js (helmet)",
        code: 'app.use(helmet.permittedCrossDomainPolicies({ permittedPolicies: "none" }));\n// ou, pour Permissions-Policy :\nres.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");',
      },
    ],
  },
  {
    id: "stack_disclosure",
    module: "fail",
    fr: {
      title: "Divulgation de la pile",
      objective: "Établit si la réponse annonce la technologie qui sert le site.",
      consequence:
        "Chaque nom et version publiés réduisent le travail de reconnaissance : l'attaquant sait quoi tenter en premier.",
      fix: "Retirer `X-Powered-By` et les en-têtes équivalents (`X-AspNet-Version`, `X-Generator`).",
      verify: "`curl -sI https://votre-site` ne contient plus ces en-têtes.",
    },
    en: {
      title: "Stack disclosure",
      objective: "Establishes whether the response announces the technology serving the site.",
      consequence:
        "Every published name and version shortens reconnaissance: the attacker knows what to try first.",
      fix: "Remove `X-Powered-By` and its equivalents (`X-AspNet-Version`, `X-Generator`).",
      verify: "`curl -sI https://your-site` no longer contains those headers.",
    },
    complexity: "low",
    risk: "low",
    method: "En-tête `x-powered-by` de la réponse.",
    result: "Valeur de l'en-tête, ou « no x-powered-by »",
    fixes: [
      { stack: "Node.js / Express", code: 'app.disable("x-powered-by");' },
      { stack: "PHP", code: "; php.ini\nexpose_php = Off" },
      { stack: "Nginx", code: "more_clear_headers X-Powered-By;" },
    ],
  },
  {
    id: "server_banner",
    module: "fail",
    fr: {
      title: "Bannière serveur",
      objective: "Établit si l'en-tête `Server` publie un nom et une version.",
      consequence:
        "Une version précise indique quelles vulnérabilités connues s'appliquent ; un nom seul est déjà un indice.",
      fix: "Masquer la version dans la bannière, ou retirer l'en-tête.",
      verify: "`curl -sI https://votre-site` montre un `Server` sans numéro de version.",
    },
    en: {
      title: "Server banner",
      objective: "Establishes whether the `Server` header publishes a name and a version.",
      consequence:
        "A precise version tells which known vulnerabilities apply; a bare name is already a hint.",
      fix: "Hide the version in the banner, or remove the header.",
      verify: "`curl -sI https://your-site` shows a `Server` header with no version number.",
    },
    complexity: "low",
    risk: "low",
    method: "En-tête `server` de la réponse.",
    result: "Valeur de l'en-tête, ou « no server header »",
    fixes: [
      { stack: "Nginx", code: "server_tokens off;" },
      { stack: "Apache", code: "ServerTokens Prod\nServerSignature Off" },
    ],
  },
  {
    id: "cookie_flags",
    module: "fail",
    fr: {
      title: "Attributs de cookie",
      objective: "Établit si les cookies émis portent `Secure`, `HttpOnly` et `SameSite`.",
      consequence:
        "Un cookie de session sans ces attributs est lisible par un script injecté, ou envoyé depuis un autre site.",
      fix: "Ajouter `Secure; HttpOnly; SameSite=Lax` à chaque cookie de session, et `SameSite=None; Secure` seulement pour ceux qu'un site tiers doit recevoir.",
      verify:
        "`curl -sI https://votre-site` montre les trois attributs sur le `Set-Cookie`, ou l'onglet Application du navigateur.",
    },
    en: {
      title: "Cookie attributes",
      objective: "Establishes whether emitted cookies carry `Secure`, `HttpOnly` and `SameSite`.",
      consequence:
        "A session cookie without these attributes can be read by an injected script, or sent from another site.",
      fix: "Add `Secure; HttpOnly; SameSite=Lax` to every session cookie, and `SameSite=None; Secure` only for the ones a third party must receive.",
      verify:
        "`curl -sI https://your-site` shows all three attributes on `Set-Cookie`, or the browser's Application tab does.",
    },
    complexity: "low",
    risk: "high",
    method: "En-têtes `set-cookie` de la réponse, quand la réponse en émet.",
    result: "Attributs manquants, ou « Secure, HttpOnly, SameSite »",
    fixes: [
      {
        stack: "Node.js / Express",
        code: 'res.cookie("session", value, { secure: true, httpOnly: true, sameSite: "lax" });',
      },
      {
        stack: "PHP",
        code: 'session_set_cookie_params(["secure" => true, "httponly" => true, "samesite" => "Lax"]);',
      },
      {
        stack: "Laravel",
        code: "// config/session.php\n'secure' => true, 'http_only' => true, 'same_site' => 'lax',",
      },
    ],
  },
  {
    id: "mixed_content",
    module: "fail",
    fr: {
      title: "Contenu mixte",
      objective: "Établit si une page https charge des ressources en http.",
      consequence:
        "Le navigateur bloque ces ressources ou dégrade la protection : une image ou un script peut venir d'un canal que personne ne protège.",
      fix: "Référencer chaque ressource en https, y compris les polices, les images de fond et les scripts tiers.",
      verify:
        "La console du navigateur ne signale plus de contenu mixte, et le scan ne trouve plus de ressource `http://` externe.",
    },
    en: {
      title: "Mixed content",
      objective: "Establishes whether an https page loads resources over http.",
      consequence:
        "The browser blocks those resources or downgrades the protection: an image or a script can arrive over a channel nobody protects.",
      fix: "Reference every resource over https, including fonts, background images and third-party scripts.",
      verify:
        "The browser console no longer reports mixed content, and the scan finds no external `http://` resource.",
    },
    complexity: "low",
    risk: "medium",
    method: "Recherche des URL `http://` externes référencées par le document.",
    result: "Nombre de ressources externes en http",
    fixes: [
      { stack: "HTML", code: '<script src="https://cdn.example.com/lib.js"></script>' },
      {
        stack: "Nginx",
        code: 'add_header Content-Security-Policy "upgrade-insecure-requests" always;',
      },
    ],
  },
  {
    id: "secrets_in_html",
    module: "fail",
    fr: {
      title: "Secret dans le document",
      objective: "Établit si une chaîne ressemblant à une clé apparaît dans le HTML livré.",
      consequence:
        "Une clé dans le HTML est une clé distribuée à chaque visiteur ; elle peut être lue sans aucune effraction.",
      fix: "Déplacer la clé côté serveur, la révoquer et en émettre une nouvelle ; le navigateur ne doit recevoir que des identifiants publics.",
      verify:
        "Le scan ne trouve plus de motif de clé, et la clé révoquée est refusée par le fournisseur.",
    },
    en: {
      title: "Secret in the document",
      objective: "Establishes whether a key-like string appears in the delivered HTML.",
      consequence:
        "A key in the HTML is a key handed to every visitor; it can be read without any break-in.",
      fix: "Move the key server-side, revoke it and issue a new one; the browser must only receive public identifiers.",
      verify: "The scan finds no key pattern, and the revoked key is refused by the provider.",
    },
    complexity: "medium",
    risk: "high",
    method: "Motifs de clés connues (AWS, Stripe, Google, clé privée PEM) dans le HTML.",
    result: "Présence d'un motif, jamais la valeur",
    fixes: [
      {
        stack: "Next.js",
        code: "// La variable n'est exposée au navigateur que si elle commence par NEXT_PUBLIC_\n// Garder la clé privée dans une route serveur :\n// app/api/charge/route.ts — process.env.STRIPE_SECRET_KEY",
      },
      {
        stack: "Vite",
        code: "// Seules les variables préfixées VITE_ arrivent dans le bundle.\n// Une clé privée doit rester dans un serveur, jamais dans import.meta.env.",
      },
      {
        stack: "WordPress",
        code: "// wp-config.php : ne jamais imprimer une clé dans un template\n// Utiliser wp_localize_script pour n'exposer qu'un nonce public",
      },
    ],
  },
  {
    id: "error_disclosure",
    module: "fail",
    fr: {
      title: "Divulgation d'erreur",
      objective: "Établit si la page affiche une trace, un message SQL ou un chemin de fichier.",
      consequence:
        "Une trace révèle des chemins, des noms de tables et des versions : de quoi préparer une attaque précise au lieu d'une au hasard.",
      fix: "Afficher un message neutre au visiteur et écrire la trace dans les journaux du serveur.",
      verify:
        "Provoquer une erreur (URL inexistante, paramètre invalide) ne montre plus de trace ni de chemin.",
    },
    en: {
      title: "Error disclosure",
      objective: "Establishes whether the page shows a stack trace, an SQL message or a file path.",
      consequence:
        "A trace reveals paths, table names and versions: enough to prepare a precise attack instead of a blind one.",
      fix: "Show a neutral message to the visitor and write the trace to the server logs.",
      verify:
        "Triggering an error (unknown URL, invalid parameter) no longer shows a trace or a path.",
    },
    complexity: "medium",
    risk: "medium",
    method: "Motifs de trace, d'erreur SQL et de chemin de fichier dans le texte visible.",
    result: "Présence d'un motif",
    fixes: [
      { stack: "PHP", code: "; php.ini en production\ndisplay_errors = Off\nlog_errors = On" },
      { stack: "Laravel", code: "// .env\nAPP_DEBUG=false\nAPP_ENV=production" },
      {
        stack: "Node.js / Express",
        code: 'app.use((err, req, res, next) => {\n  console.error(err);\n  res.status(500).json({ error: "internal_error" });\n});',
      },
    ],
  },
  {
    id: "clickjacking_frame_headers",
    module: "fail",
    aliasOf: "frame_ancestors",
    fr: {
      title: "Clickjacking (vérification croisée)",
      objective:
        "Reprend la question de `frame_ancestors` en acceptant indifféremment l'en-tête ou la directive CSP.",
      consequence:
        "Même conséquence que l'encadrement : un site tiers peut faire cliquer vos utilisateurs à leur place.",
      fix: "Un seul correctif suffit : `X-Frame-Options` ou `frame-ancestors` dans la CSP.",
      verify: "Voir `frame_ancestors` : la vérification est la même.",
    },
    en: {
      title: "Clickjacking (cross-check)",
      objective:
        "Asks the `frame_ancestors` question again, accepting either the header or the CSP directive.",
      consequence:
        "Same consequence as framing: a third-party site can make your users click on its behalf.",
      fix: "One fix covers both: `X-Frame-Options` or `frame-ancestors` in the CSP.",
      verify: "See `frame_ancestors`: the verification is the same.",
    },
    complexity: "low",
    risk: "medium",
    method: "Union de l'en-tête `x-frame-options` et de la directive `frame-ancestors`.",
    result: "Valeur de l'en-tête, ou « absent »",
    fixes: [],
  },
  {
    id: "content_type",
    module: "fail",
    fr: {
      title: "Type de contenu",
      objective: "Établit si la réponse déclare un type MIME explicite et un charset.",
      consequence:
        "Sans type déclaré, le navigateur devine : un fichier téléversé peut être interprété comme du HTML et exécuter du script.",
      fix: "Envoyer `Content-Type` avec le type exact et `charset=utf-8`, et `X-Content-Type-Options: nosniff`.",
      verify: "`curl -sI https://votre-site` montre les deux en-têtes.",
    },
    en: {
      title: "Content type",
      objective: "Establishes whether the response declares an explicit MIME type and charset.",
      consequence:
        "With no declared type the browser guesses: an uploaded file can be interpreted as HTML and execute script.",
      fix: "Send `Content-Type` with the exact type and `charset=utf-8`, plus `X-Content-Type-Options: nosniff`.",
      verify: "`curl -sI https://your-site` shows both headers.",
    },
    complexity: "low",
    risk: "medium",
    method: "En-têtes `content-type` et `x-content-type-options`.",
    result: "Type déclaré, ou « absent »",
    fixes: [
      {
        stack: "Nginx",
        code: "default_type application/octet-stream;\nadd_header X-Content-Type-Options nosniff;",
      },
      { stack: "Apache", code: "Header always set X-Content-Type-Options nosniff" },
      { stack: "Node.js / Express", code: 'res.setHeader("X-Content-Type-Options", "nosniff");' },
    ],
  },
  {
    id: "http_status",
    module: "fail",
    fr: {
      title: "Statut HTTP",
      objective: "Établit le code de statut renvoyé par l'URL demandée.",
      consequence:
        "Un 200 sur une page d'erreur masque une panne aux robots d'indexation comme aux sondes de disponibilité.",
      fix: "Renvoyer le statut qui décrit la situation : 404 pour une page absente, 500 pour une erreur serveur, 301 pour une redirection permanente.",
      verify: "`curl -sI` sur une URL inexistante renvoie 404 et non 200.",
    },
    en: {
      title: "HTTP status",
      objective: "Establishes the status code returned by the requested URL.",
      consequence:
        "A 200 on an error page hides an outage from crawlers and from uptime probes alike.",
      fix: "Return the status that describes the situation: 404 for a missing page, 500 for a server error, 301 for a permanent redirect.",
      verify: "`curl -sI` on a missing URL returns 404, not 200.",
    },
    complexity: "low",
    risk: "medium",
    method: "Code de statut de la réponse principale.",
    result: "Code numérique",
    fixes: [
      { stack: "Nginx", code: "error_page 404 /404.html;\nlocation = /404.html { internal; }" },
      {
        stack: "Next.js",
        code: "// app/not-found.tsx rend la page, le statut 404 vient du routeur",
      },
      { stack: "Laravel", code: 'abort(404, "Page introuvable");' },
    ],
  },
  // ------------------------------------------------------------------ CLEAN
  {
    id: "html_lang",
    module: "clean",
    fr: {
      title: "Langue du document",
      objective: "Établit si l'élément racine déclare une langue.",
      consequence:
        "Sans `lang`, un lecteur d'écran prononce votre page avec les règles d'une autre langue ; la traduction automatique devine aussi.",
      fix: 'Ajouter `<html lang="fr">` avec la langue réellement servie par la page.',
      verify: "Le HTML servi commence par une balise `html` portant un attribut `lang`.",
    },
    en: {
      title: "Document language",
      objective: "Establishes whether the root element declares a language.",
      consequence:
        "Without `lang`, a screen reader pronounces your page with another language's rules, and automatic translation guesses too.",
      fix: 'Add `<html lang="fr">` with the language the page actually serves.',
      verify: "The delivered HTML starts with an `html` tag carrying a `lang` attribute.",
    },
    complexity: "low",
    risk: "medium",
    method: "Attribut `lang` de l'élément `html`.",
    result: "Valeur de la langue, ou « no lang attribute »",
    fixes: [
      { stack: "HTML", code: '<html lang="fr">' },
      { stack: "Next.js", code: "// app/layout.tsx\n<html lang={locale}>" },
      {
        stack: "WordPress",
        code: "// Réglages → Général → Langue du site ; le thème pose language_attributes()",
      },
    ],
  },
  {
    id: "title",
    module: "clean",
    fr: {
      title: "Titre de la page",
      objective: "Établit la longueur du titre et sa présence.",
      consequence:
        "Le titre est ce qu'affichent un onglet, un favori et un résultat de recherche : absent, la page n'a pas de nom.",
      fix: "Écrire un titre unique par page, de 50 à 60 caractères, qui nomme la page et le produit.",
      verify:
        "`curl -s https://votre-site | grep -o '<title>[^<]*'` renvoie un titre non vide et mesuré.",
    },
    en: {
      title: "Page title",
      objective: "Establishes whether a title exists and how long it is.",
      consequence:
        "The title is what a tab, a bookmark and a search result show: with none, the page has no name.",
      fix: "Write one title per page, 50 to 60 characters, naming the page and the product.",
      verify:
        "`curl -s https://your-site | grep -o '<title>[^<]*'` returns a non-empty, measured title.",
    },
    complexity: "low",
    risk: "medium",
    method: "Contenu de l'élément `title`, mesuré en caractères.",
    result: "Nombre de caractères, ou « missing »",
    fixes: [
      { stack: "HTML", code: "<title>Facturation — Acme</title>" },
      { stack: "Next.js", code: 'export const metadata = { title: "Facturation — Acme" };' },
      { stack: "React", code: 'useEffect(() => { document.title = "Facturation — Acme"; }, []);' },
    ],
  },
  {
    id: "meta_description",
    module: "clean",
    fr: {
      title: "Méta-description",
      objective: "Établit si la page fournit une description rédigée.",
      consequence:
        "Sans description, le moteur de recherche et l'aperçu de lien composent eux-mêmes le texte, souvent mal.",
      fix: 'Ajouter `<meta name="description">` avec une phrase de 120 à 155 caractères propre à la page.',
      verify: "Le HTML servi contient une balise `description` non vide.",
    },
    en: {
      title: "Meta description",
      objective: "Establishes whether the page provides a written description.",
      consequence:
        "With no description, the search engine and the link preview compose the text themselves, often badly.",
      fix: 'Add `<meta name="description">` with a 120-to-155-character sentence specific to the page.',
      verify: "The delivered HTML contains a non-empty `description` tag.",
    },
    complexity: "low",
    risk: "low",
    method: "Attribut `content` de la balise `meta[name=description]`.",
    result: "Nombre de caractères, ou « missing »",
    fixes: [
      {
        stack: "HTML",
        code: '<meta name="description" content="Facturation, factures et moyens de paiement pour une équipe." />',
      },
      {
        stack: "Next.js",
        code: 'export const metadata = { description: "Facturation et factures pour une équipe." };',
      },
    ],
  },
  {
    id: "viewport",
    module: "clean",
    fr: {
      title: "Fenêtre mobile",
      objective: "Établit si la page demande au navigateur mobile de la dimensionner à l'écran.",
      consequence:
        "Sans `viewport`, un téléphone rend la page à la largeur d'un ordinateur et l'utilisateur doit zoomer pour lire.",
      fix: 'Ajouter `<meta name="viewport" content="width=device-width, initial-scale=1">` et ne jamais bloquer le zoom avec `user-scalable=no`.',
      verify:
        "Le HTML contient la balise `viewport` ; sur téléphone, la page occupe la largeur sans zoom.",
    },
    en: {
      title: "Mobile viewport",
      objective: "Establishes whether the page asks a mobile browser to size it to the screen.",
      consequence:
        "Without `viewport`, a phone renders the page at desktop width and the reader has to zoom.",
      fix: 'Add `<meta name="viewport" content="width=device-width, initial-scale=1">` and never block zoom with `user-scalable=no`.',
      verify:
        "The HTML contains the `viewport` tag; on a phone the page fills the width without zoom.",
    },
    complexity: "low",
    risk: "high",
    method: "Présence de la balise `meta[name=viewport]`.",
    result: "Présence, ou « meta viewport »",
    fixes: [
      {
        stack: "HTML",
        code: '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      },
      {
        stack: "Next.js",
        code: 'export const viewport = { width: "device-width", initialScale: 1 };',
      },
    ],
  },
  {
    id: "landmarks",
    module: "clean",
    fr: {
      title: "Régions de page",
      objective:
        "Établit combien de régions nommées (`main`, `nav`, `header`, `footer`) la page expose.",
      consequence:
        "Sans régions, un utilisateur de lecteur d'écran doit traverser la page linéairement pour atteindre le contenu.",
      fix: "Envelopper le contenu dans `<main>`, la navigation dans `<nav>`, l'en-tête et le pied de page dans leurs balises.",
      verify: "Le scan compte au moins trois régions, et le lecteur d'écran les annonce.",
    },
    en: {
      title: "Page regions",
      objective:
        "Establishes how many named regions (`main`, `nav`, `header`, `footer`) the page exposes.",
      consequence:
        "With no regions, a screen-reader user has to walk the page linearly to reach the content.",
      fix: "Wrap the content in `<main>`, the navigation in `<nav>`, and use the header and footer tags.",
      verify: "The scan counts at least three regions, and the screen reader announces them.",
    },
    complexity: "low",
    risk: "medium",
    method: "Compte des balises `main`, `nav`, `header`, `footer`.",
    result: "Liste des régions trouvées, ou « none »",
    fixes: [
      {
        stack: "HTML",
        code: "<header>…</header>\n<nav>…</nav>\n<main>…</main>\n<footer>…</footer>",
      },
      { stack: "React", code: "<main>{children}</main>" },
    ],
  },
  {
    id: "image_alt",
    module: "clean",
    fr: {
      title: "Texte alternatif des images",
      objective: "Établit combien d'images n'ont aucun attribut `alt`.",
      consequence:
        "Une image sans `alt` est un silence complet pour un lecteur d'écran, et invisible si l'image ne charge pas.",
      fix: 'Donner un `alt` qui décrit l\'information portée ; `alt=""` pour une image purement décorative.',
      verify: "Le scan ne trouve plus d'image sans attribut `alt`.",
    },
    en: {
      title: "Image alternative text",
      objective: "Establishes how many images carry no `alt` attribute at all.",
      consequence:
        "An image without `alt` is complete silence to a screen reader, and invisible if the image fails to load.",
      fix: 'Give an `alt` that describes the information carried; `alt=""` for a purely decorative image.',
      verify: "The scan no longer finds an image without an `alt` attribute.",
    },
    complexity: "low",
    risk: "medium",
    method: "Compte des balises `img` sans attribut `alt`.",
    result: "« n sur m sans alt », ou « no images »",
    fixes: [
      { stack: "HTML", code: '<img src="facture.png" alt="Facture 2026-014, total 240 €" />' },
      { stack: "React", code: '<img src={src} alt="" />  {/* décoratif assumé */}' },
    ],
  },
  {
    id: "headings",
    module: "clean",
    fr: {
      title: "Structure des titres",
      objective: "Établit combien de `h1` la page contient et combien de titres au total.",
      consequence:
        "Un `h1` unique et une hiérarchie ordonnée sont le plan de la page ; deux `h1` ou aucun rendent la navigation par titres inutilisable.",
      fix: "Garder un seul `h1` qui nomme la page, puis descendre `h2`, `h3` sans sauter de niveau.",
      verify: "Le scan compte exactement un `h1`.",
    },
    en: {
      title: "Heading structure",
      objective: "Establishes how many `h1` the page has, and how many headings in total.",
      consequence:
        "One `h1` and an ordered hierarchy are the page's outline; two `h1` or none make heading navigation useless.",
      fix: "Keep a single `h1` naming the page, then descend through `h2`, `h3` without skipping a level.",
      verify: "The scan counts exactly one `h1`.",
    },
    complexity: "low",
    risk: "medium",
    method: "Compte des balises `h1` à `h6`.",
    result: "« n h1, m heading(s) »",
    fixes: [
      { stack: "HTML", code: "<h1>Facturation</h1>\n<h2>Factures en attente</h2>" },
      { stack: "React", code: "<h1>{title}</h1>" },
    ],
  },
  {
    id: "html_weight",
    module: "clean",
    fr: {
      title: "Poids du HTML",
      objective: "Établit le poids du document HTML seul, avant images et scripts.",
      consequence:
        "Le HTML doit arriver avant que la page puisse être dessinée ; au-delà de plusieurs centaines de kilo-octets, l'attente se voit sur un réseau mobile.",
      fix: "Sortir le contenu répété du document, paginer les listes longues et servir le HTML compressé en gzip ou brotli.",
      verify:
        "`curl -s -o /dev/null -w '%{size_download}'` montre un document sous quelques centaines de kilo-octets.",
    },
    en: {
      title: "HTML weight",
      objective: "Establishes the weight of the HTML document alone, before images and scripts.",
      consequence:
        "The HTML must arrive before anything can be drawn; past a few hundred kilobytes the wait is visible on a mobile network.",
      fix: "Move repeated content out of the document, paginate long lists, and serve the HTML compressed with gzip or brotli.",
      verify:
        "`curl -s -o /dev/null -w '%{size_download}'` shows a document in the low hundreds of kilobytes.",
    },
    complexity: "medium",
    risk: "medium",
    method: "Taille du corps de la réponse, en kilo-octets.",
    result: "« n kB of HTML »",
    fixes: [
      { stack: "Nginx", code: "gzip on;\ngzip_types text/html text/css application/javascript;" },
      { stack: "Next.js", code: "// Paginer côté serveur : searchParams.page → LIMIT/OFFSET" },
    ],
  },
  {
    id: "inline_styles",
    module: "clean",
    fr: {
      title: "Styles en ligne",
      objective: "Établit combien d'attributs `style` figurent dans le document.",
      consequence:
        "Un style en ligne ne peut pas être mis en cache, ne se thème pas et se duplique à chaque rendu ; en grand nombre, changer de thème devient une réécriture.",
      fix: "Déplacer les styles vers une feuille ou un composant stylé, en gardant l'en-ligne pour les valeurs calculées par le serveur.",
      verify: "Le scan compte moins d'une dizaine d'attributs `style`.",
    },
    en: {
      title: "Inline styles",
      objective: "Establishes how many `style` attributes the document carries.",
      consequence:
        "An inline style cannot be cached, cannot be themed and is duplicated on every render; at scale, changing theme becomes a rewrite.",
      fix: "Move styles into a stylesheet or a styled component, keeping inline only for values computed server-side.",
      verify: "The scan counts fewer than ten `style` attributes.",
    },
    complexity: "medium",
    risk: "low",
    method: "Compte des attributs `style=`.",
    result: "« n inline style attribute(s) »",
    fixes: [
      { stack: "HTML", code: '<div class="card">  <!-- au lieu de style="padding:16px" -->' },
      { stack: "React", code: "<div className={styles.card}>" },
    ],
  },
  {
    id: "field_labels",
    module: "clean",
    fr: {
      title: "Étiquettes de champ",
      objective:
        "Établit combien de champs de formulaire n'ont ni `label`, ni `aria-label`, ni identifiant.",
      consequence:
        "Un champ sans étiquette est un champ sans nom : le lecteur d'écran annonce « zone de texte » et l'utilisateur ne sait pas quoi saisir.",
      fix: "Associer chaque champ à un `<label for>` ou, à défaut, un `aria-label` explicite.",
      verify: "Le scan ne trouve plus de champ sans étiquette.",
    },
    en: {
      title: "Field labels",
      objective: "Establishes how many form fields have no `label`, no `aria-label` and no id.",
      consequence:
        "An unlabelled field is a nameless field: the screen reader announces “text box” and the user does not know what to type.",
      fix: "Associate every field with a `<label for>` or, failing that, an explicit `aria-label`.",
      verify: "The scan no longer finds a field without a label.",
    },
    complexity: "low",
    risk: "high",
    method: "Compte des champs sans `label`, `aria-label`, `aria-labelledby`, `id` ni `title`.",
    result: "« n sur m sans étiquette », ou « no form fields »",
    fixes: [
      {
        stack: "HTML",
        code: '<label for="email">Adresse e-mail</label>\n<input id="email" name="email" type="email" />',
      },
      {
        stack: "React",
        code: '<label htmlFor="email">Adresse e-mail</label>\n<input id="email" />',
      },
      {
        stack: "Laravel Blade",
        code: '<label for="email">{{ __("Email") }}</label>\n<input id="email" name="email" />',
      },
    ],
  },
  {
    id: "rendered_dom",
    module: "clean",
    fr: {
      title: "DOM rendu",
      objective:
        "Établit si la réponse est une coquille que le navigateur doit remplir avant d'afficher quoi que ce soit.",
      consequence:
        "Les contrôles qui lisent du texte ou une structure ne peuvent pas juger une page qui n'existe qu'après exécution du JavaScript.",
      fix: "Rendre côté serveur le contenu de la page (SSR ou prérendu), pour que l'HTML livré contienne déjà le texte.",
      verify:
        "`curl -s https://votre-site | grep -c '<main'` renvoie au moins 1 et le texte principal est présent sans JavaScript.",
    },
    en: {
      title: "Rendered DOM",
      objective:
        "Establishes whether the response is a shell the browser must fill before anything can be displayed.",
      consequence:
        "Controls that read text or structure cannot judge a page that only exists once JavaScript has run.",
      fix: "Render the page content server-side (SSR or prerender) so the delivered HTML already carries the text.",
      verify:
        "`curl -s https://your-site | grep -c '<main'` returns at least 1 and the main text is present without JavaScript.",
    },
    complexity: "high",
    risk: "medium",
    method: "Texte visible, présence d'un script chargé et absence de `main`.",
    result: "« content present in the HTML » ou « the response is a client-rendered shell »",
    fixes: [
      {
        stack: "Next.js",
        code: "// App Router : composant serveur par défaut\n// Éviter 'use client' sur les pages qui portent le contenu",
      },
      {
        stack: "Vite / React",
        code: "// vite-plugin-ssr ou passage à Next.js / Remix pour le rendu serveur",
      },
      {
        stack: "WordPress",
        code: "// Le HTML est rendu par PHP : vérifier qu'aucun thème headless ne vide le body",
      },
    ],
  },

  // ------------------------------------------------------------------- FLOW
  {
    id: "journey_entry",
    module: "flow",
    fr: {
      title: "Point d'entrée du parcours",
      objective: "Établit si la page offre un lien vers un panier, une commande ou un paiement.",
      consequence:
        "Un parcours que personne ne peut commencer ne peut pas être vérifié : la vente dépend d'un lien que le visiteur doit deviner.",
      fix: "Exposer un lien visible vers le panier ou la commande depuis chaque page qui vend, avec un intitulé explicite.",
      verify: "Le scan trouve un lien dont l'URL contient cart, checkout, panier ou order.",
    },
    en: {
      title: "Journey entry point",
      objective: "Establishes whether the page offers a link to a cart, an order or a payment.",
      consequence:
        "A journey nobody can start cannot be verified: the sale depends on a link the visitor has to guess.",
      fix: "Expose a visible link to the cart or the order from every page that sells, with an explicit label.",
      verify: "The scan finds a link whose URL contains cart, checkout, panier or order.",
    },
    complexity: "low",
    risk: "high",
    method:
      "Recherche d'un lien `cart`, `panier`, `checkout`, `commande`, `order`, `basket`, `paiement`.",
    result: "URL du premier point d'entrée, ou « no checkout, cart or order link »",
    fixes: [
      { stack: "HTML", code: '<a href="/checkout">Finaliser la commande</a>' },
      { stack: "React", code: '<Link to="/cart">Voir le panier</Link>' },
    ],
  },
  {
    id: "journey_tls",
    module: "flow",
    fr: {
      title: "TLS du point d'entrée",
      objective: "Établit si l'URL du tunnel de commande est en https.",
      consequence:
        "Un paiement en http expose le numéro de carte ou de Mobile Money en transit, même si la page d'accueil est en https.",
      fix: "Servir le tunnel en https et faire pointer le lien de commande vers cette URL.",
      verify: "L'URL du point d'entrée commence par `https://`.",
    },
    en: {
      title: "Checkout TLS",
      objective: "Establishes whether the checkout URL is served over https.",
      consequence:
        "A payment over http exposes the card or Mobile Money number in transit, even when the landing page is https.",
      fix: "Serve the checkout over https and point the order link at that URL.",
      verify: "The entry-point URL starts with `https://`.",
    },
    complexity: "low",
    risk: "high",
    method: "Schéma de l'URL du point d'entrée détecté.",
    result: "https ou http, ou « no entry point found »",
    fixes: [
      {
        stack: "HTML",
        code: '<a href="https://shop.example.com/checkout">Finaliser la commande</a>',
      },
      { stack: "Nginx", code: "return 301 https://$host$request_uri;" },
    ],
  },
  {
    id: "payment_methods",
    module: "flow",
    fr: {
      title: "Moyens de paiement",
      objective: "Établit quels fournisseurs de paiement et quels moyens locaux la page référence.",
      consequence:
        "Les moyens proposés décident qui peut réellement acheter : une carte seule exclut une grande partie des acheteurs en Afrique de l'Ouest.",
      fix: "Ajouter le moyen local attendu par votre marché (Mobile Money, Wave, Orange Money) auprès du fournisseur déjà intégré.",
      verify: "Le scan nomme au moins un fournisseur ou un moyen local présent dans le HTML.",
    },
    en: {
      title: "Payment methods",
      objective: "Establishes which payment providers and local methods the page references.",
      consequence:
        "The methods offered decide who can actually buy: card-only checkout excludes much of West Africa's buyers.",
      fix: "Add the local method your market expects (Mobile Money, Wave, Orange Money) through the provider you already integrate.",
      verify: "The scan names at least one provider or local method found in the HTML.",
    },
    complexity: "high",
    risk: "medium",
    method: "Recherche des SDK et des mentions de fournisseurs dans le HTML.",
    result: "Liste des fournisseurs détectés, ou « none detected in the HTML »",
    fixes: [
      {
        stack: "Stripe",
        code: "stripe.confirmPayment({ elements, confirmParams: { return_url } })",
      },
      {
        stack: "Paystack",
        code: "const handler = PaystackPop.setup({ key: publicKey, email, amount });",
      },
      {
        stack: "FedaPay / Kkiapay",
        code: "// Widget hébergé : le montant et la devise viennent du serveur, jamais du client",
      },
    ],
  },
  {
    id: "journey_csrf",
    module: "flow",
    fr: {
      title: "Jeton de formulaire de commande",
      objective: "Établit si le formulaire de commande porte un jeton anti-rejeu.",
      consequence:
        "Sans jeton, un formulaire de commande peut être soumis depuis un autre site ou rejoué tel quel.",
      fix: "Ajouter un jeton CSRF au formulaire, vérifié côté serveur à chaque soumission.",
      verify:
        "Le HTML du formulaire de commande contient un champ `csrf`, `token`, `nonce` ou `_wpnonce`.",
    },
    en: {
      title: "Order form token",
      objective: "Establishes whether the order form carries an anti-replay token.",
      consequence:
        "Without a token, an order form can be submitted from another site, or replayed as is.",
      fix: "Add a CSRF token to the form and verify it server-side on every submission.",
      verify: "The checkout form's HTML contains a `csrf`, `token`, `nonce` or `_wpnonce` field.",
    },
    complexity: "medium",
    risk: "high",
    method: "Recherche d'un champ de jeton dans les formulaires de commande.",
    result: "Présence du jeton, ou « no token field in the checkout form »",
    fixes: [
      { stack: "Laravel", code: '@csrf\n<form method="POST" action="/checkout">' },
      { stack: "Django", code: '<form method="post">{% csrf_token %}</form>' },
      { stack: "PHP", code: '<input type="hidden" name="csrf" value="<?= $csrf ?>" />' },
      { stack: "WordPress", code: "<?php wp_nonce_field('checkout'); ?>" },
    ],
  },
  {
    id: "refund_path",
    module: "flow",
    fr: {
      title: "Chemin de remboursement",
      objective: "Établit si la page mentionne un remboursement, un retour ou une rétractation.",
      consequence:
        "Un client qui ne trouve pas comment être remboursé ouvre un litige, et un litige coûte plus cher qu'un remboursement.",
      fix: "Écrire la procédure de remboursement et de retour, et la rendre accessible depuis le tunnel et le pied de page.",
      verify: "Le scan trouve une mention de remboursement ou de retour dans la page.",
    },
    en: {
      title: "Refund path",
      objective: "Establishes whether the page mentions a refund, a return or a withdrawal.",
      consequence:
        "A customer who cannot find how to be refunded files a dispute, and a dispute costs more than a refund.",
      fix: "Write the refund and return procedure and make it reachable from the checkout and the footer.",
      verify: "The scan finds a refund or return mention on the page.",
    },
    complexity: "low",
    risk: "medium",
    method: "Recherche de `refund`, `remboursement`, `retour`, `returns`, `rétractation`.",
    result: "Mention trouvée, ou « no refund or returns path on this page »",
    fixes: [{ stack: "HTML", code: '<a href="/remboursements">Remboursements et retours</a>' }],
  },
  {
    id: "webhook_observability",
    module: "flow",
    fr: {
      title: "Webhooks de paiement",
      objective: "Établit si la livraison des webhooks est observable depuis l'extérieur.",
      consequence:
        "Un webhook non observé se perd en silence : la commande est payée chez le fournisseur et absente chez vous.",
      fix: "Exposer un point de réception qui journalise chaque notification, la signature reçue et le résultat du traitement.",
      verify:
        "Un webhook de test envoyé par le fournisseur apparaît dans les journaux avec son statut.",
    },
    en: {
      title: "Payment webhooks",
      objective: "Establishes whether webhook delivery is observable from outside.",
      consequence:
        "An unobserved webhook is lost silently: the order is paid at the provider and missing on your side.",
      fix: "Expose a receiving endpoint that logs each notification, the signature received and the processing result.",
      verify: "A test webhook sent by the provider appears in the logs with its status.",
    },
    complexity: "medium",
    risk: "high",
    method: "Non observable depuis une page : exige un point de terminaison côté produit.",
    result: "Toujours `SKIPPED` en scan de page, avec la raison",
    fixes: [
      {
        stack: "Stripe",
        code: "const event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);",
      },
      {
        stack: "Paystack",
        code: "if (!crypto.timingSafeEqual(hmac(body), header)) return res.sendStatus(401);",
      },
    ],
  },
  {
    id: "journey_reachable",
    module: "flow",
    fr: {
      title: "Joignabilité du tunnel",
      objective: "Établit si l'URL du tunnel de commande répond réellement, et avec quel statut.",
      consequence:
        "Un lien de paiement qui renvoie 404 ou 500 arrête la vente au moment où le client a décidé d'acheter.",
      fix: "Corriger l'URL ou la route du tunnel, et surveiller son statut en continu.",
      verify:
        "Une requête sur l'URL du tunnel renvoie 200, et le scan la rapporte comme joignable.",
    },
    en: {
      title: "Checkout reachability",
      objective: "Establishes whether the checkout URL actually answers, and with which status.",
      consequence:
        "A payment link returning 404 or 500 stops the sale exactly when the customer decided to buy.",
      fix: "Fix the checkout URL or route, and monitor its status continuously.",
      verify: "A request to the checkout URL returns 200, and the scan reports it as reachable.",
    },
    complexity: "low",
    risk: "high",
    method: "Requête sur l'URL du point d'entrée détecté.",
    result: "Code de statut obtenu",
    fixes: [
      { stack: "Nginx", code: "location /checkout { try_files $uri /index.html; }" },
      { stack: "Next.js", code: "// app/checkout/page.tsx doit exister pour la route /checkout" },
    ],
  },

  // ------------------------------------------------------------------ WORLD
  {
    id: "declared_locale",
    module: "world",
    fr: {
      title: "Locale déclarée",
      objective: "Établit la langue déclarée par la page et sa longueur.",
      consequence:
        "La locale déclarée décide des formats de date, de nombre et de la traduction appliquée par le navigateur.",
      fix: "Déclarer la langue réellement servie, avec un code complet (`fr-FR`, `pt-BR`) quand le pays change le format.",
      verify:
        "L'attribut `lang` vaut au moins deux caractères et correspond à la langue du contenu.",
    },
    en: {
      title: "Declared locale",
      objective: "Establishes the declared language of the page and its length.",
      consequence:
        "The declared locale decides date and number formats and the translation the browser applies.",
      fix: "Declare the language actually served, with a full code (`fr-FR`, `pt-BR`) when the country changes the format.",
      verify:
        "The `lang` attribute has at least two characters and matches the content's language.",
    },
    complexity: "low",
    risk: "medium",
    method: "Attribut `lang` de l'élément `html`.",
    result: "Code de langue, ou « no lang attribute »",
    fixes: [
      { stack: "HTML", code: '<html lang="fr-FR">' },
      { stack: "Next.js", code: "// app/[locale]/layout.tsx\n<html lang={locale}>" },
    ],
  },
  {
    id: "charset",
    module: "world",
    fr: {
      title: "Jeu de caractères",
      objective: "Établit si la page déclare utf-8, par balise ou par en-tête.",
      consequence:
        "Sans utf-8 déclaré, les accents et les écritures non latines deviennent des caractères de remplacement illisibles.",
      fix: 'Déclarer `charset=utf-8` dans le `Content-Type` et `<meta charset="utf-8">` en tête de document.',
      verify: "`curl -sI` montre `charset=utf-8`, et le HTML contient la balise `meta charset`.",
    },
    en: {
      title: "Character set",
      objective: "Establishes whether the page declares utf-8, by tag or by header.",
      consequence:
        "Without utf-8 declared, accents and non-Latin scripts turn into unreadable replacement characters.",
      fix: 'Declare `charset=utf-8` in `Content-Type` and `<meta charset="utf-8">` at the top of the document.',
      verify: "`curl -sI` shows `charset=utf-8`, and the HTML contains the `meta charset` tag.",
    },
    complexity: "low",
    risk: "high",
    method: "Balise `meta charset` et en-tête `content-type`.",
    result: "Valeur de l'en-tête `content-type`",
    fixes: [
      { stack: "HTML", code: '<meta charset="utf-8" />' },
      {
        stack: "Nginx",
        code: "charset utf-8;\ncharset_types text/html text/css application/javascript;",
      },
      { stack: "PHP", code: 'header("Content-Type: text/html; charset=utf-8");' },
    ],
  },
  {
    id: "language_meta",
    module: "world",
    fr: {
      title: "Déclaration de langue secondaire",
      objective: "Établit si une balise `content-language` contredit la langue déclarée.",
      consequence:
        "Deux déclarations qui se contredisent laissent le navigateur et le moteur de recherche choisir ; l'un des deux se trompe.",
      fix: "Supprimer `meta http-equiv=content-language`, obsolète, et garder le seul attribut `lang`.",
      verify: "Le HTML ne contient plus de balise `content-language`.",
    },
    en: {
      title: "Secondary language declaration",
      objective: "Establishes whether a `content-language` tag contradicts the declared language.",
      consequence:
        "Two contradicting declarations let the browser and the search engine choose; one of them gets it wrong.",
      fix: "Remove the obsolete `meta http-equiv=content-language` and keep the single `lang` attribute.",
      verify: "The HTML no longer contains a `content-language` tag.",
    },
    complexity: "low",
    risk: "low",
    method: "Balise `meta[http-equiv=content-language]`.",
    result: "Valeur de la balise, ou « absent »",
    fixes: [
      {
        stack: "HTML",
        code: '<html lang="fr">  <!-- supprimer <meta http-equiv="content-language" content="en"> -->',
      },
    ],
  },
  {
    id: "hreflang",
    module: "world",
    fr: {
      title: "Versions linguistiques (hreflang)",
      objective: "Établit si la page déclare ses versions en d'autres langues.",
      consequence:
        "Sans `hreflang`, un moteur de recherche envoie un visiteur de Montréal vers la version française de Paris, ou l'inverse.",
      fix: 'Déclarer chaque version avec `<link rel="alternate" hreflang="…">`, y compris une version `x-default`.',
      verify: "Le HTML contient un lien `alternate` par version linguistique.",
    },
    en: {
      title: "Language versions (hreflang)",
      objective: "Establishes whether the page declares its versions in other languages.",
      consequence:
        "Without `hreflang`, a search engine sends a Montréal visitor to the Paris French version, or the other way round.",
      fix: 'Declare each version with `<link rel="alternate" hreflang="…">`, including an `x-default` version.',
      verify: "The HTML contains one `alternate` link per language version.",
    },
    complexity: "medium",
    risk: "low",
    method: "Liens `rel=alternate` du document.",
    result: "Nombre de liens alternates, ou « none declared »",
    fixes: [
      {
        stack: "HTML",
        code: '<link rel="alternate" hreflang="fr-CA" href="https://example.com/fr-ca" />\n<link rel="alternate" hreflang="x-default" href="https://example.com/" />',
      },
      {
        stack: "Next.js",
        code: 'export const metadata = { alternates: { languages: { "fr-CA": "/fr-ca", "x-default": "/" } } };',
      },
    ],
  },
  {
    id: "rtl_support",
    module: "world",
    fr: {
      title: "Sens d'écriture",
      objective: "Établit si un sens de lecture (`dir`) est déclaré.",
      consequence:
        "L'arabe et l'hébreu se lisent de droite à gauche : sans `dir`, la mise en page entière est miroir à l'envers.",
      fix: 'Poser `dir="rtl"` sur l\'élément racine des pages en écriture droite-à-gauche, et `dir="auto"` sur les champs mixtes.',
      verify: 'Le HTML contient `dir="rtl"` ou `dir="auto"` sur les pages concernées.',
    },
    en: {
      title: "Text direction",
      objective: "Establishes whether a reading direction (`dir`) is declared.",
      consequence:
        "Arabic and Hebrew read right to left: without `dir`, the whole layout mirrors the wrong way.",
      fix: 'Set `dir="rtl"` on the root element of right-to-left pages, and `dir="auto"` on mixed-direction fields.',
      verify: 'The HTML contains `dir="rtl"` or `dir="auto"` on the pages concerned.',
    },
    complexity: "medium",
    risk: "medium",
    method: "Attribut `dir` de l'élément racine.",
    result: "« rtl declared » ou « no direction declared »",
    fixes: [
      { stack: "HTML", code: '<html lang="ar" dir="rtl">' },
      {
        stack: "CSS",
        code: "/* Utiliser les propriétés logiques : margin-inline-start, padding-inline-end */",
      },
    ],
  },
  {
    id: "ambiguous_dates",
    module: "world",
    fr: {
      title: "Dates ambiguës",
      objective: "Établit si le texte contient des dates au format numérique ambigu.",
      consequence:
        "`12/31/2024` est une erreur pour la plupart des lecteurs, et `31/12/2024` pour un lecteur américain ; une échéance mal lue est une échéance manquée.",
      fix: "Écrire le mois en lettres ou utiliser un format explicite (`2024-12-31`), et formater les dates avec l'API d'internationalisation.",
      verify: "Le scan ne trouve plus de motif `jj/mm/aaaa` ni `jj.mm.aaaa` dans le texte visible.",
    },
    en: {
      title: "Ambiguous dates",
      objective: "Establishes whether the text contains numerically ambiguous dates.",
      consequence:
        "`12/31/2024` reads as an error to most readers, and `31/12/2024` to an American one; a misread deadline is a missed deadline.",
      fix: "Write the month in letters or use an explicit format (`2024-12-31`), and format dates through the internationalisation API.",
      verify:
        "The scan no longer finds a `dd/mm/yyyy` or `dd.mm.yyyy` pattern in the visible text.",
    },
    complexity: "low",
    risk: "medium",
    method: "Motifs `jj/mm/aaaa` et `jj.mm.aaaa` dans le texte visible.",
    result: "Jusqu'à six dates trouvées, ou « none found »",
    fixes: [
      {
        stack: "JavaScript",
        code: 'new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(date);',
      },
      {
        stack: "PHP",
        code: "IntlDateFormatter::formatObject($date, IntlDateFormatter::LONG, 'fr_FR');",
      },
      {
        stack: "Python",
        code: "from babel.dates import format_date\nformat_date(date, format='long', locale='fr_FR')",
      },
    ],
  },
  {
    id: "price_format",
    module: "world",
    fr: {
      title: "Format des prix",
      objective: "Établit combien de conventions de prix différentes cohabitent dans le texte.",
      consequence:
        "Deux conventions sur une page (virgule et point décimal, devise avant et après) signifient qu'une des deux est fausse pour ce lecteur.",
      fix: "Formater chaque montant avec la locale de la page et une devise explicite, via une fonction unique.",
      verify: "Le scan ne trouve plus qu'une seule convention de prix sur la page.",
    },
    en: {
      title: "Price format",
      objective: "Establishes how many different price conventions coexist in the text.",
      consequence:
        "Two conventions on one page (comma and decimal point, currency before and after) means one of them is wrong for that reader.",
      fix: "Format every amount with the page's locale and an explicit currency, through a single function.",
      verify: "The scan finds only one price convention on the page.",
    },
    complexity: "low",
    risk: "medium",
    method: "Détection des conventions de prix (symbole, position, séparateur).",
    result: "Liste des conventions trouvées, ou « no price pattern »",
    fixes: [
      {
        stack: "JavaScript",
        code: 'new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(24.5);',
      },
      {
        stack: "PHP",
        code: "NumberFormatter::create('fr_FR', NumberFormatter::CURRENCY)->formatCurrency(24.5, 'EUR');",
      },
      {
        stack: "Laravel",
        code: "// Utiliser moneyphp/money et un formateur unique, pas number_format()",
      },
    ],
  },
  {
    id: "input_hints",
    module: "world",
    fr: {
      title: "Indications de saisie",
      objective: "Établit combien de champs déclarent un type `tel` ou un `autocomplete`.",
      consequence:
        "Sans `inputmode` ni `autocomplete`, un utilisateur ouest-africain reçoit un clavier alphabétique pour un numéro et doit tout taper.",
      fix: 'Déclarer `type="tel"` et `autocomplete="tel-national"` pour les numéros, `autocomplete="one-time-code"` pour les codes.',
      verify: "Le scan compte au moins un champ `tel` ou un champ avec `autocomplete`.",
    },
    en: {
      title: "Input hints",
      objective: "Establishes how many fields declare a `tel` type or an `autocomplete`.",
      consequence:
        "Without `inputmode` or `autocomplete`, a West African user gets a letter keyboard for a phone number and types it all.",
      fix: 'Declare `type="tel"` and `autocomplete="tel-national"` for numbers, `autocomplete="one-time-code"` for codes.',
      verify: "The scan counts at least one `tel` field or one field with `autocomplete`.",
    },
    complexity: "low",
    risk: "medium",
    method: "Compte des champs `type=tel` et des champs portant `autocomplete`.",
    result: "« n tel, m with autocomplete »",
    fixes: [
      {
        stack: "HTML",
        code: '<input type="tel" inputmode="tel" autocomplete="tel-national" name="phone" />',
      },
      { stack: "React", code: '<input type="tel" inputMode="tel" autoComplete="tel-national" />' },
    ],
  },
  {
    id: "translation_targets",
    module: "world",
    fr: {
      title: "Accès aux langues",
      objective:
        "Établit si une page qui existe en plusieurs langues rend le changement de langue visible.",
      consequence:
        "Un sélecteur de langue enfoui ou absent laisse un visiteur devant une page qu'il ne lit pas, et il repart.",
      fix: "Rendre le sélecteur de langue visible depuis l'en-tête de chaque page, avec le nom de chaque langue dans sa propre langue.",
      verify:
        "Le scan trouve une mention `translate`, `traduire` ou un `lang-switch` dans le texte.",
    },
    en: {
      title: "Language access",
      objective: "Establishes whether a multi-language page makes switching language visible.",
      consequence:
        "A buried or missing language selector leaves a visitor on a page they cannot read, and they leave.",
      fix: "Make the language selector visible in the header of every page, naming each language in its own language.",
      verify: "The scan finds a `translate`, `traduire` mention or a `lang-switch` in the text.",
    },
    complexity: "medium",
    risk: "low",
    method: "Recherche d'une affordance de changement de langue dans le texte.",
    result: "Affordance trouvée, ou « none found »",
    fixes: [
      {
        stack: "HTML",
        code: '<select aria-label="Langue" onchange="location=this.value"><option value="/fr">Français</option><option value="/en">English</option></select>',
      },
      { stack: "React", code: '<button onClick={() => setLocale("en")}>English</button>' },
    ],
  },

  // ------------------------------------------------------------------- EXIT
  {
    id: "export_affordances",
    module: "exit",
    fr: {
      title: "Ce que le client peut emporter",
      objective: "Établit si la page offre un fichier téléchargeable (CSV, JSON, PDF, ZIP).",
      consequence:
        "Ce qu'un client peut exporter est ce qu'il garde en quittant : sans export, il reste prisonnier de vos données.",
      fix: "Offrir un export complet du compte, au format ouvert, sans passer par le support.",
      verify: "Le scan trouve au moins un lien de téléchargement d'un format ouvert.",
    },
    en: {
      title: "What the customer can take",
      objective: "Establishes whether the page offers a downloadable file (CSV, JSON, PDF, ZIP).",
      consequence:
        "What a customer can export is what they keep when they leave: with no export, they are locked into your data.",
      fix: "Offer a complete export of the account, in an open format, without going through support.",
      verify: "The scan finds at least one download link to an open format.",
    },
    complexity: "medium",
    risk: "medium",
    method: "Liens portant `download` ou pointant vers un format de fichier.",
    result: "Nombre d'artefacts téléchargeables, ou « none offered on this page »",
    fixes: [
      { stack: "HTML", code: '<a href="/export.csv" download>Exporter mes données (CSV)</a>' },
      {
        stack: "Node.js / Express",
        code: 'res.setHeader("Content-Disposition", "attachment; filename=export.json");\nres.json(payload);',
      },
    ],
  },
  {
    id: "structured_data",
    module: "exit",
    fr: {
      title: "Données structurées",
      objective: "Établit combien de blocs JSON-LD parsent réellement.",
      consequence:
        "Une donnée structurée qui ne parse pas est une donnée que personne ne peut importer ni indexer.",
      fix: "Émettre un JSON-LD valide par page (produit, organisation, fil d'Ariane) et le valider avant mise en ligne.",
      verify:
        "Chaque bloc `application/ld+json` parse, et le validateur de schéma structuré ne signale plus d'erreur.",
    },
    en: {
      title: "Structured data",
      objective: "Establishes how many JSON-LD blocks actually parse.",
      consequence: "Structured data that does not parse is data nobody can import or index.",
      fix: "Emit valid JSON-LD per page (product, organisation, breadcrumb) and validate it before shipping.",
      verify:
        "Every `application/ld+json` block parses, and the structured-data validator reports no error.",
    },
    complexity: "medium",
    risk: "medium",
    method: "Parsing des blocs `application/ld+json`.",
    result: "« n of m JSON-LD block(s) parse », ou « no JSON-LD block »",
    fixes: [
      {
        stack: "HTML",
        code: '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme"}</script>',
      },
    ],
  },
  {
    id: "api_surface",
    module: "exit",
    fr: {
      title: "Surface d'API",
      objective: "Établit si une API exportable est documentée.",
      consequence:
        "Un produit exportable par API ne peut pas être jugé depuis un rendu HTML ; sans documentation, l'intégration se fait au hasard.",
      fix: "Publier la description des points d'accès (OpenAPI) et un exemple de récupération complète des données.",
      verify:
        "Une requête authentifiée sur le point d'accès de documentation renvoie une description lisible par machine.",
    },
    en: {
      title: "API surface",
      objective: "Establishes whether an exportable API is documented.",
      consequence:
        "A product exportable through an API cannot be judged from rendered HTML; with no documentation, integration happens by guesswork.",
      fix: "Publish the endpoint description (OpenAPI) and a complete data-retrieval example.",
      verify:
        "An authenticated request to the documentation endpoint returns a machine-readable description.",
    },
    complexity: "high",
    risk: "low",
    method: "Non jugée depuis le HTML : exige la documentation de l'API.",
    result: "Toujours `SKIPPED` en scan de page",
    fixes: [
      { stack: "OpenAPI", code: "openapi: 3.1.0\ninfo:\n  title: Acme API\n  version: 1.0.0" },
      { stack: "Express", code: 'app.get("/api-docs", swaggerUi.serve, swaggerUi.setup(spec));' },
    ],
  },
  {
    id: "print_styles",
    module: "exit",
    fr: {
      title: "Styles d'impression",
      objective: "Établit si une feuille ou une règle d'impression existe.",
      consequence:
        "Factures et reçus s'impriment : sans règle d'impression, la navigation et les boutons mangent la page et le papier.",
      fix: "Ajouter un bloc `@media print` qui masque la navigation et les actions, et garde le contenu utile lisible en noir.",
      verify: "L'aperçu d'impression du navigateur montre le contenu sans navigation.",
    },
    en: {
      title: "Print styles",
      objective: "Establishes whether a print stylesheet or rule exists.",
      consequence:
        "Invoices and receipts get printed: with no print rule, navigation and buttons eat the page and the paper.",
      fix: "Add an `@media print` block that hides navigation and actions, and keeps the useful content readable in black.",
      verify: "The browser's print preview shows the content without navigation.",
    },
    complexity: "low",
    risk: "low",
    method: "Recherche d'une règle `@media print`.",
    result: "« print stylesheet present » ou « not detected in the HTML »",
    fixes: [
      {
        stack: "CSS",
        code: "@media print {\n  nav, .actions { display: none; }\n  body { color: #000; background: #fff; }\n}",
      },
    ],
  },
  // ------------------------------------------------------- SITE-LEVEL CONTROLS
  //
  // These cannot be answered by one request: they compare pages with each other, or they
  // follow what the site declares. They are reported by a crawl, grouped in the module whose
  // question they answer, and explained like every other control.
  {
    id: "broken_links",
    module: "flow",
    fr: {
      title: "Liens cassés",
      objective: "Établit combien de pages atteintes depuis l'accueil répondent une erreur.",
      consequence:
        "Un lien en 404 ou 500 est un client qui repart, et un moteur de recherche qui cesse de suivre le reste du site.",
      fix: "Corriger ou retirer chaque lien listé : la page existe-t-elle encore, ou faut-il une redirection 301 vers son nouvel emplacement ?",
      verify:
        "Le crawl suivant ne trouve plus aucune page en erreur, et les liens listés répondent 200.",
    },
    en: {
      title: "Broken links",
      objective: "Establishes how many pages reached from the entry point answer an error.",
      consequence:
        "A 404 or 500 is a customer who leaves, and a crawler that stops following the rest of the site.",
      fix: "Fix or remove each listed link: does the page still exist, or does it need a 301 to its new location?",
      verify: "The next crawl finds no erroring page, and every listed link answers 200.",
    },
    complexity: "low",
    risk: "high",
    method: "Crawl des liens internes, statut de chaque page visitée.",
    result: "Nombre de pages en erreur, avec leurs URL",
    fixes: [
      { stack: "Nginx", code: "location /ancien-chemin { return 301 /nouveau-chemin; }" },
      {
        stack: "Next.js",
        code: '// next.config.js\nasync redirects() { return [{ source: "/ancien", destination: "/nouveau", permanent: true }]; }',
      },
      { stack: "HTML", code: '<a href="/nouveau-chemin">Intitulé exact de la destination</a>' },
    ],
  },
  {
    id: "redirects",
    module: "clean",
    fr: {
      title: "Redirections à l'arrivée",
      objective: "Établit combien de pages changent d'adresse avant de répondre.",
      consequence:
        "Chaque redirection coûte un aller-retour ; une chaîne en coûte plusieurs et masque l'adresse canonique d'une page.",
      fix: "Faire pointer les liens internes directement vers l'URL finale, et garder une seule redirection par ancienne adresse.",
      verify:
        "Le crawl ne rapporte plus qu'une minorité de pages redirigées, et les liens internes visent l'URL finale.",
    },
    en: {
      title: "Redirecting pages",
      objective: "Establishes how many pages change address before answering.",
      consequence:
        "Every redirect costs a round trip; a chain costs several and hides a page's canonical address.",
      fix: "Point internal links straight at the final URL, and keep one redirect per old address.",
      verify:
        "The crawl reports only a minority of redirected pages, and internal links target the final URL.",
    },
    complexity: "low",
    risk: "low",
    method: "Comparaison entre l'URL demandée et l'URL finale de chaque page.",
    result: "Nombre de pages redirigées, avec la cible",
    fixes: [
      { stack: "HTML", code: '<a href="https://site.example/nouvelle-url">…</a>' },
      { stack: "Nginx", code: "return 301 https://$host/nouvelle-url;" },
    ],
  },
  {
    id: "duplicate_titles",
    module: "clean",
    fr: {
      title: "Titres dupliqués",
      objective: "Établit combien de pages partagent le même titre.",
      consequence:
        "Deux pages au même titre sont deux pages que le client ne distingue pas dans ses onglets, et que le moteur de recherche confond.",
      fix: "Rendre chaque titre unique en y ajoutant ce que la page a de propre : la section, le produit, la ville.",
      verify: "Le crawl ne signale plus deux pages au même titre.",
    },
    en: {
      title: "Duplicate titles",
      objective: "Establishes how many pages share one title.",
      consequence:
        "Two pages with one title are two pages a customer cannot tell apart in tabs, and a search engine conflates.",
      fix: "Make each title unique by adding what the page is about: the section, the product, the city.",
      verify: "The crawl no longer reports two pages with one title.",
    },
    complexity: "low",
    risk: "medium",
    method: "Comparaison des balises `title` des pages lues.",
    result: "Titres en double, avec les pages concernées",
    fixes: [
      {
        stack: "Next.js",
        code: 'export const metadata = { title: "Facturation — " + customerName };',
      },
      { stack: "PHP", code: "$title = 'Commandes — ' . $customer['name'];" },
    ],
  },
  {
    id: "missing_titles",
    module: "clean",
    fr: {
      title: "Pages sans titre",
      objective: "Établit combien de pages n'ont aucune balise `title`.",
      consequence:
        "Une page sans titre n'a pas de nom : l'onglet affiche l'URL, le favori aussi, et le résultat de recherche est inventé.",
      fix: "Ajouter un `title` propre à chaque page, qui commence par ce que la page contient et finit par le nom du produit.",
      verify: "Chaque page lue porte une balise `title` non vide.",
    },
    en: {
      title: "Pages without a title",
      objective: "Establishes how many pages carry no `title` tag.",
      consequence:
        "A page with no title has no name: the tab shows the URL, so does the bookmark, and the search result is invented.",
      fix: "Add a title specific to each page, starting with what the page holds and ending with the product name.",
      verify: "Every page read carries a non-empty `title`.",
    },
    complexity: "low",
    risk: "medium",
    method: "Présence de `<title>` sur chaque page lue.",
    result: "Nombre de pages sans titre",
    fixes: [
      { stack: "HTML", code: "<title>Commandes — Acme</title>" },
      { stack: "Laravel", code: "@section('title', 'Commandes — Acme')" },
    ],
  },
  {
    id: "heavy_pages",
    module: "clean",
    fr: {
      title: "Pages lourdes",
      objective: "Établit combien de pages dépassent 400 ko de HTML seul.",
      consequence:
        "Le HTML doit arriver avant que quoi que ce soit s'affiche ; sur un réseau mobile, la page lourde est une page qu'on quitte.",
      fix: "Paginer les listes longues, sortir le contenu répété du document, et compresser la réponse en brotli ou gzip.",
      verify: "Le crawl ne trouve plus de page au-dessus du seuil.",
    },
    en: {
      title: "Heavy pages",
      objective: "Establishes how many pages exceed 400 kB of HTML alone.",
      consequence:
        "The HTML has to arrive before anything is drawn; on a mobile network a heavy page is a page people leave.",
      fix: "Paginate long lists, move repeated content out of the document, and compress the response with brotli or gzip.",
      verify: "The crawl finds no page above the threshold.",
    },
    complexity: "medium",
    risk: "medium",
    method: "Taille du corps HTML de chaque page lue.",
    result: "Nombre de pages au-dessus du seuil, avec la plus lourde",
    fixes: [
      {
        stack: "Nginx",
        code: "gzip on;\ngzip_types text/html application/json application/javascript;",
      },
      { stack: "Next.js", code: "// Pagination serveur : searchParams.page → LIMIT/OFFSET" },
    ],
  },
  {
    id: "slow_pages",
    module: "clean",
    fr: {
      title: "Pages lentes",
      objective: "Établit combien de pages mettent plus de 1,5 s à répondre.",
      consequence:
        "Le temps serveur est le plancher de la vitesse perçue : au-dessus, aucun raffinement côté navigateur ne compense.",
      fix: "Mesurer la requête lente dans les journaux, ajouter l'index qui manque, puis mettre en cache ce qui ne change pas par requête.",
      verify: "Le crawl suivant montre toutes les pages sous le seuil.",
    },
    en: {
      title: "Slow pages",
      objective: "Establishes how many pages take more than 1.5 s to answer.",
      consequence:
        "Server time is the floor of perceived speed: above it, no browser-side refinement compensates.",
      fix: "Find the slow query in the logs, add the missing index, then cache what does not change per request.",
      verify: "The next crawl shows every page under the threshold.",
    },
    complexity: "medium",
    risk: "medium",
    method: "Durée de chaque requête de page, mesurée par le crawl.",
    result: "Nombre de pages lentes, avec la plus lente",
    fixes: [
      {
        stack: "SQL",
        code: "EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20;\nCREATE INDEX ON orders (customer_id, created_at DESC);",
      },
      {
        stack: "Nginx",
        code: "proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=app:10m;\nproxy_cache app;",
      },
    ],
  },
  {
    id: "pages_without_tls",
    module: "fail",
    fr: {
      title: "Pages servies en http",
      objective: "Établit combien de pages lues ne sont pas en https.",
      consequence:
        "Une seule page en http suffit à exposer un cookie de session ou un mot de passe saisi dessus.",
      fix: "Rediriger tout http vers https en 301, pages internes comprises, sous-domaines inclus.",
      verify: "Aucune page du crawl ne répond en http.",
    },
    en: {
      title: "Pages served over http",
      objective: "Establishes how many pages read are not over https.",
      consequence:
        "One page over http is enough to expose a session cookie or a password typed on it.",
      fix: "Redirect every http request to https with a 301, internal pages and subdomains included.",
      verify: "No page of the crawl answers over http.",
    },
    complexity: "low",
    risk: "high",
    method: "Schéma de chaque URL de page lue et de son URL finale.",
    result: "Nombre de pages en http, avec leurs URL",
    fixes: [
      { stack: "Nginx", code: "server { listen 80; return 301 https://$host$request_uri; }" },
      { stack: "Apache", code: "Redirect permanent / https://site.example/" },
    ],
  },
  {
    id: "pages_without_hsts",
    module: "fail",
    fr: {
      title: "Pages sans HSTS",
      objective: "Établit combien de pages lues n'envoient pas `Strict-Transport-Security`.",
      consequence:
        "HSTS vaut par réponse : une page qui ne l'envoie pas rouvre la dégradation que les autres ont fermée.",
      fix: "Envoyer l'en-tête sur toutes les réponses https, au niveau du serveur et non d'une seule route.",
      verify: "Chaque page du crawl envoie HSTS avec un max-age non nul.",
    },
    en: {
      title: "Pages without HSTS",
      objective: "Establishes how many pages read do not send `Strict-Transport-Security`.",
      consequence:
        "HSTS is per response: one page that omits it reopens the downgrade the others closed.",
      fix: "Send the header on every https response, at the server level rather than in one route.",
      verify: "Every crawled page sends HSTS with a non-zero max-age.",
    },
    complexity: "low",
    risk: "medium",
    method: "En-tête `strict-transport-security` de chaque page lue.",
    result: "Nombre de pages sans HSTS",
    fixes: [
      {
        stack: "Nginx",
        code: 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
      },
      {
        stack: "Apache",
        code: 'Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"',
      },
    ],
  },
  {
    id: "source_maps_exposed",
    module: "fail",
    fr: {
      title: "Source maps publiés",
      objective: "Établit si les pages référencent des fichiers `.map`.",
      consequence:
        "Une source map publiée rend votre code d'origine à quiconque ouvre les outils du navigateur, commentaires compris.",
      fix: "Ne pas publier les `.map` en production, ou les servir derrière l'authentification et les retirer du build déployé.",
      verify:
        "Aucune page ne référence de `.map`, et une requête directe sur un `.map` répond 404.",
    },
    en: {
      title: "Published source maps",
      objective: "Establishes whether pages reference `.map` files.",
      consequence:
        "A published source map hands your original code, comments included, to anyone who opens devtools.",
      fix: "Do not ship `.map` files in production, or serve them behind authentication and strip them from the deployed build.",
      verify: "No page references a `.map`, and a direct request for one answers 404.",
    },
    complexity: "low",
    risk: "low",
    method: "Recherche de références `.map` dans les actifs des pages lues.",
    result: "Nombre de source maps référencées",
    fixes: [
      {
        stack: "Vite",
        code: "// vite.config.ts — jamais 'inline' ni 'hidden' en production\nexport default { build: { sourcemap: false } };",
      },
      { stack: "webpack", code: "module.exports = { devtool: false };" },
    ],
  },
  {
    id: "mixed_content_site",
    module: "fail",
    fr: {
      title: "Ressources en http sur le site",
      objective: "Établit combien d'actifs (scripts, styles, images) sont chargés en http.",
      consequence:
        "Un script servi en http est bloqué par le navigateur, ou exécuté sans la protection de la page : c'est une porte d'entrée.",
      fix: "Référencer chaque actif en https, y compris les polices et les bibliothèques tierces.",
      verify: "Aucune page du crawl ne référence d'actif en http.",
    },
    en: {
      title: "Assets loaded over http",
      objective: "Establishes how many assets (scripts, styles, images) load over http.",
      consequence:
        "A script served over http is blocked by the browser, or executed without the page's protection: an entry point.",
      fix: "Reference every asset over https, fonts and third-party libraries included.",
      verify: "No crawled page references an http asset.",
    },
    complexity: "low",
    risk: "high",
    method: "Schéma des actifs référencés par chaque page lue.",
    result: "Nombre d'actifs en http, avec leurs URL",
    fixes: [
      { stack: "HTML", code: '<script src="https://cdn.example.com/lib.js"></script>' },
      {
        stack: "Nginx",
        code: 'add_header Content-Security-Policy "upgrade-insecure-requests" always;',
      },
    ],
  },
  {
    id: "sitemap",
    module: "exit",
    fr: {
      title: "Sitemap",
      objective: "Établit si `sitemap.xml` existe à la racine et combien d'URL il déclare.",
      consequence:
        "Sans sitemap, les pages qu'aucun lien n'atteint restent invisibles pour un moteur de recherche comme pour un export.",
      fix: "Générer un `sitemap.xml` à jour et le déclarer dans `robots.txt` avec une ligne `Sitemap:`.",
      verify: "`/sitemap.xml` répond 200 et liste les pages publiées.",
    },
    en: {
      title: "Sitemap",
      objective:
        "Establishes whether `sitemap.xml` exists at the root, and how many URLs it declares.",
      consequence:
        "Without a sitemap, pages no link reaches stay invisible to a search engine and to an export.",
      fix: "Generate an up-to-date `sitemap.xml` and declare it in `robots.txt` with a `Sitemap:` line.",
      verify: "`/sitemap.xml` answers 200 and lists the published pages.",
    },
    complexity: "low",
    risk: "low",
    method: "Requête sur `/sitemap.xml` et comptage des `<loc>`.",
    result: "Présence et nombre d'URL déclarées",
    fixes: [
      { stack: "robots.txt", code: "Sitemap: https://site.example/sitemap.xml" },
      {
        stack: "Next.js",
        code: '// app/sitemap.ts\nexport default function sitemap() { return [{ url: "https://site.example/", lastModified: new Date() }]; }',
      },
    ],
  },
  {
    id: "robots",
    module: "exit",
    fr: {
      title: "robots.txt",
      objective: "Établit si `robots.txt` existe et quels chemins il interdit.",
      consequence:
        "Sans `robots.txt`, la politique de lecture est laissée à l'interprétation de chaque robot, y compris des indésirables.",
      fix: "Publier un `robots.txt` explicite : ce qui est ouvert, ce qui est fermé, et l'adresse du sitemap.",
      verify: "`/robots.txt` répond 200 et contient les règles attendues.",
    },
    en: {
      title: "robots.txt",
      objective: "Establishes whether `robots.txt` exists and which paths it disallows.",
      consequence:
        "Without `robots.txt`, the reading policy is left to each bot's interpretation, unwelcome ones included.",
      fix: "Publish an explicit `robots.txt`: what is open, what is closed, and where the sitemap lives.",
      verify: "`/robots.txt` answers 200 and carries the expected rules.",
    },
    complexity: "low",
    risk: "low",
    method: "Requête sur `/robots.txt` et lecture des directives.",
    result: "Présence et chemins interdits",
    fixes: [
      {
        stack: "robots.txt",
        code: "User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: https://site.example/sitemap.xml",
      },
    ],
  },
  {
    id: "crawl_coverage",
    module: "clean",
    fr: {
      title: "Couverture du crawl",
      objective: "Établit combien de pages ont été lues, et si une limite a arrêté le parcours.",
      consequence:
        "Un verdict sur un site ne vaut que les pages qu'il couvre ; le reste doit être annoncé comme non lu, jamais comme conforme.",
      fix: "Si la limite de pages est atteinte, relancer avec une limite plus haute ; si la profondeur bloque, l'augmenter aussi.",
      verify:
        "Le crawl se termine sans limite atteinte, et le rapport indique le nombre de pages lues.",
    },
    en: {
      title: "Crawl coverage",
      objective: "Establishes how many pages were read, and whether a limit stopped the walk.",
      consequence:
        "A verdict about a site is worth the pages it covers; the rest must be reported as not read, never as compliant.",
      fix: "If the page limit was hit, run again with a higher one; if depth stopped the walk, raise that too.",
      verify:
        "The crawl finishes with no limit reached, and the report states how many pages were read.",
    },
    complexity: "low",
    risk: "medium",
    method: "Comptage des pages lues et du motif d'arrêt du crawl.",
    result: "Nombre de pages lues et limite atteinte, le cas échéant",
    fixes: [
      {
        stack: "CLI",
        code: "proofcore scan https://site.example --crawl --max-pages 80 --max-depth 4",
      },
      {
        stack: "API",
        code: '{ "url": "https://site.example", "crawl": { "maxPages": 80, "maxDepth": 4 } }',
      },
    ],
  },
];

/** Grouped lookup, built once. */
const byModuleAndId = new Map(
  controls.map((control) => [`${control.module}:${control.id}`, control])
);

export const CONTROLS: readonly Control[] = controls;

export function allControls(): readonly Control[] {
  return CONTROLS;
}

export function controlsForModule(module: ScanModule): readonly Control[] {
  return CONTROLS.filter((control) => control.module === module);
}

export function controlFor(module: ScanModule, id: string): Control | undefined {
  return byModuleAndId.get(`${module}:${id}`);
}

/**
 * True when this control restates another one, so a score counts the pair once.
 * The finding is still emitted: history, comparison and remediation refer to its id.
 */
export function isAlias(module: ScanModule, id: string): boolean {
  return controlFor(module, id)?.aliasOf !== undefined;
}

/** Copy for a finding, in the reader's language, or `undefined` for an unknown id. */
export function explain(
  module: ScanModule,
  id: string,
  locale: "fr" | "en"
): { copy: ControlCopy; fixes: ControlFixExample[]; control: Control } | undefined {
  const control = controlFor(module, id);
  if (!control) return undefined;
  return { copy: locale === "en" ? control.en : control.fr, fixes: control.fixes, control };
}
