/**
 * Report exports — the analysis as documents the visitor keeps.
 *
 * Three formats, one source: the ScanResult the workspace already holds.
 *
 *  JSON      — the machine-readable truth: the run verbatim plus derived counts.
 *  Markdown  — the complete document for a repository or a ticket: inventory,
 *              score tables, findings grouped by module, methodology.
 *  PDF/print — an HTML document built for paper: cover, stat cards, SVG charts,
 *              color-coded tables; the browser's print dialog produces the PDF.
 *
 * Nothing is invented here: every number comes from the stored result, and a
 * field the scan did not measure is written as such.
 */
import type { ControlCopy } from "../pages/app/Scan.js";

interface ScanFinding {
  module: string;
  id: string;
  status: string;
  observed: string;
  why: string;
}

interface ScanPageRow {
  url: string;
  finalUrl: string;
  status: number;
  title: string | null;
  bytes: number;
  durationMs: number;
  depth: number;
  measured: boolean;
  error: string | null;
}

interface ScanSite {
  pages: ScanPageRow[];
  skipped: { url: string; reason: string }[];
  robots: { found: boolean } | null;
  sitemap: { found: boolean } | null;
  truncated: boolean;
  truncatedBy: string | null;
  requests: number;
  durationMs: number;
  findings: {
    module: string;
    id: string;
    status: string;
    observed: string;
    why: string;
    pages: string[];
  }[];
}

interface ScanResultLike {
  id?: string;
  projectId?: string | null;
  ownership?: string;
  url: string;
  finalUrl: string;
  status: number;
  bytes: number;
  durationMs: number;
  scannedAt: string;
  findings: ScanFinding[];
  modules: {
    module: string;
    passed: number;
    warnings: number;
    failed: number;
    skipped: number;
    score: number;
    verdict: string;
  }[];
  clientRendered: boolean;
  site?: ScanSite;
  scores?: { module: string; score: number; verdict: string; coverage: number }[];
  score?: { score: number; coverage: number; provisional: boolean };
}

export const STATUS_LABELS: Record<string, { fr: string; en: string }> = {
  pass: { fr: "Réussi", en: "Pass" },
  warn: { fr: "Avertissement", en: "Warning" },
  fail: { fr: "Échec", en: "Fail" },
  skipped: { fr: "Ignoré", en: "Skipped" },
  pending: { fr: "En attente", en: "Pending" },
  not_measured: { fr: "Non mesuré", en: "Not measured" },
};

export const STATUS_COLORS: Record<string, string> = {
  pass: "#0d9f6e",
  warn: "#b45309",
  fail: "#dc2626",
  skipped: "#6b7280",
  pending: "#9ca3af",
  not_measured: "#9ca3af",
};

const MODULE_TITLES: Record<string, { fr: string; en: string }> = {
  world: { fr: "WORLD — Compatibilité mondiale", en: "WORLD — Global compatibility" },
  flow: { fr: "FLOW — Fiabilité des transactions", en: "FLOW — Transaction reliability" },
  exit: { fr: "EXIT — Portabilité des données", en: "EXIT — Data portability" },
  fail: { fr: "FAIL — Audit sécurité & défauts", en: "FAIL — Security & defect audit" },
  clean: { fr: "CLEAN — Qualité UI", en: "CLEAN — UI quality" },
};

export function fmtKb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

function dateLabel(iso: string, fr: boolean): string {
  try {
    return new Date(iso).toLocaleString(fr ? "fr-FR" : "en-US", {
      dateStyle: "long",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function statusCount(result: ScanResultLike, status: string): number {
  return result.findings.filter((f) => f.status === status).length;
}

/** The analysis's headline: the overall score, when the run produced one. */
function overallScore(result: ScanResultLike): number | null {
  return result.score?.score ?? null;
}

/* ------------------------------------------------------------------ */
/* JSON                                                                */
/* ------------------------------------------------------------------ */

export function buildReportJson(result: ScanResultLike): string {
  const doc = {
    $schema: "proofcore/report@1",
    generatedAt: new Date().toISOString(),
    audit: {
      id: result.id ?? null,
      projectId: result.projectId ?? null,
      ownership: result.ownership ?? "unverified",
    },
    target: {
      url: result.url,
      finalUrl: result.finalUrl,
      httpStatus: result.status,
      bytes: result.bytes,
      durationMs: result.durationMs,
      clientRendered: result.clientRendered,
    },
    run: {
      scannedAt: result.scannedAt,
      totalChecks: result.findings.length,
      byStatus: {
        pass: statusCount(result, "pass"),
        warn: statusCount(result, "warn"),
        fail: statusCount(result, "fail"),
        skipped: statusCount(result, "skipped"),
        pending: statusCount(result, "pending"),
      },
      overallScore: overallScore(result),
      overallCoverage: result.score?.coverage ?? null,
      provisional: result.score?.provisional ?? null,
    },
    modules: result.modules.map((m) => ({
      ...m,
      title: MODULE_TITLES[m.module]?.en ?? m.module,
    })),
    site: result.site
      ? {
          pages: result.site.pages,
          pageCount: result.site.pages.length,
          measuredPages: result.site.pages.filter((p) => p.measured).length,
          skipped: result.site.skipped,
          robotsFound: result.site.robots?.found ?? null,
          sitemapFound: result.site.sitemap?.found ?? null,
          truncated: result.site.truncated,
          truncatedBy: result.site.truncatedBy,
          requests: result.site.requests,
          crawlDurationMs: result.site.durationMs,
          findings: result.site.findings,
        }
      : null,
    findings: result.findings,
  };
  return JSON.stringify(doc, null, 2);
}

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

export function buildReportMarkdown(
  result: ScanResultLike,
  controls: Record<string, ControlCopy>,
  fr: boolean
): string {
  const L = (key: string) => STATUS_LABELS[key]?.[fr ? "fr" : "en"] ?? key;
  const t = (m: string) => MODULE_TITLES[m]?.[fr ? "fr" : "en"] ?? m;
  const site = result.site;
  const out: string[] = [];

  out.push(
    `# ${fr ? "Rapport de vérification" : "Verification report"} — ${pagePath(result.finalUrl) || result.finalUrl}`
  );
  out.push("");
  out.push(
    `> ${fr ? "Généré par PROOFCORE" : "Generated by PROOFCORE"} · ${dateLabel(result.scannedAt, fr)}${result.id ? ` · audit \`${result.id}\`` : ""}`
  );
  out.push("");
  out.push("## Sommaire");
  out.push("");
  out.push("1. [Cible et exécution](#1-cible-et-exécution)");
  out.push("2. [Verdict par module](#2-verdict-par-module)");
  if (site) out.push("3. [Structure du site](#3-structure-du-site)");
  const structIndex = site ? 3 : null;
  const findIndex = site ? 4 : 3;
  out.push(
    `${findIndex}. [Constats par module](#4-constats-par-module${site ? "" : ""})`.replace(
      "4.",
      `${findIndex}.`
    )
  );
  out.push(`${findIndex + 1}. [Méthode et périmètre](#5-méthode-et-périmètre)`);
  out.push("");

  out.push(`## 1. ${fr ? "Cible et exécution" : "Target and run"}`);
  out.push("");
  out.push(`| ${fr ? "Champ" : "Field"} | ${fr ? "Valeur" : "Value"} |`);
  out.push("| --- | --- |");
  out.push(`| ${fr ? "URL demandée" : "Requested URL"} | ${result.url} |`);
  out.push(`| ${fr ? "URL finale" : "Final URL"} | ${result.finalUrl} |`);
  out.push(`| HTTP | ${result.status} |`);
  out.push(`| ${fr ? "Poids" : "Size"} | ${fmtKb(result.bytes)} |`);
  out.push(`| ${fr ? "Durée" : "Duration"} | ${result.durationMs} ms |`);
  out.push(`| ${fr ? "Date" : "Date"} | ${dateLabel(result.scannedAt, fr)} |`);
  if (overallScore(result) !== null) {
    out.push(
      `| ${fr ? "Score global" : "Overall score"} | **${overallScore(result)}/100** (${fr ? "couverture" : "coverage"} ${result.score?.coverage}%) |`
    );
  }
  out.push(
    `| ${fr ? "Constats" : "Findings"} | ${result.findings.length} (${L("pass")}: ${statusCount(result, "pass")} · ${L("warn")}: ${statusCount(result, "warn")} · ${L("fail")}: ${statusCount(result, "fail")} · ${L("skipped")}: ${statusCount(result, "skipped")}) |`
  );
  out.push("");

  out.push(`## 2. ${fr ? "Verdict par module" : "Verdict by module"}`);
  out.push("");
  out.push(
    `| Module | ${fr ? "Réussis" : "Pass"} | ${fr ? "Avert." : "Warn"} | ${fr ? "Échecs" : "Fail"} | ${fr ? "Ignorés" : "Skipped"} | Score | Verdict |`
  );
  out.push("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const m of result.modules) {
    out.push(
      `| ${t(m.module)} | ${m.passed} | ${m.warnings} | ${m.failed} | ${m.skipped} | ${m.score}/100 | ${L(m.verdict)} |`
    );
  }
  out.push("");

  if (site) {
    const measured = site.pages.filter((p) => p.measured).length;
    const errors = site.pages.filter((p) => p.error);
    out.push(`## 3. ${fr ? "Structure du site" : "Site structure"}`);
    out.push("");
    out.push(
      `- ${fr ? "Pages découvertes" : "Pages discovered"} : **${site.pages.length}** (${measured} ${fr ? "mesurées" : "measured"})`
    );
    out.push(
      `- robots.txt : ${site.robots?.found ? (fr ? "trouvé" : "found") : fr ? "absent" : "not found"} · sitemap : ${site.sitemap?.found ? (fr ? "trouvé" : "found") : fr ? "absent" : "not found"}`
    );
    out.push(
      `- ${fr ? "Requêtes d'exploration" : "Crawl requests"} : ${site.requests} (${result.durationMs} ms)`
    );
    if (site.truncated)
      out.push(`- ${fr ? "Exploration tronquée" : "Crawl truncated"} (${site.truncatedBy})`);
    if (site.skipped.length) out.push(`- ${fr ? "Ignorées" : "Skipped"} : ${site.skipped.length}`);
    if (errors.length) out.push(`- ${fr ? "En erreur" : "In error"} : ${errors.length}`);
    out.push("");
    out.push(`### Inventaire des pages`);
    out.push("");
    out.push(
      `| # | ${fr ? "Chemin" : "Path"} | ${fr ? "Titre" : "Title"} | HTTP | ${fr ? "Poids" : "Size"} | ${fr ? "Prof." : "Depth"} |`
    );
    out.push("| ---: | --- | --- | ---: | ---: | ---: |");
    site.pages.forEach((p, i) => {
      const title = p.title ? p.title.slice(0, 48) : p.error ? `⚠ ${p.error}` : "—";
      out.push(
        `| ${i + 1} | \`${pagePath(p.finalUrl)}\` | ${title} | ${p.status} | ${fmtKb(p.bytes)} | ${p.depth} |`
      );
    });
    out.push("");
    if (site.skipped.length) {
      out.push(`### ${fr ? "Pages ignorées" : "Skipped pages"}`);
      out.push("");
      out.push(`| URL | ${fr ? "Raison" : "Reason"} |`);
      out.push("| --- | --- |");
      for (const sk of site.skipped.slice(0, 40)) out.push(`| ${sk.url} | ${sk.reason} |`);
      out.push("");
    }
    if (site.findings.length) {
      out.push(`### ${fr ? "Constats au niveau du site" : "Site-level findings"}`);
      out.push("");
      for (const f of site.findings) {
        out.push(
          `- **[${f.status.toUpperCase()}]** ${t(f.module)} — ${f.id} : ${f.observed} — ${f.why}${f.pages.length ? ` (${f.pages.length} ${fr ? "pages" : "pages"})` : ""}`
        );
      }
      out.push("");
    }
  }

  const groups = new Map<string, ScanFinding[]>();
  for (const f of result.findings) {
    if (!groups.has(f.module)) groups.set(f.module, []);
    groups.get(f.module)!.push(f);
  }
  out.push(`## ${findIndex}. ${fr ? "Constats par module" : "Findings by module"}`);
  out.push("");
  for (const m of result.modules) {
    const note = MODULE_NOTES[m.module]?.[fr ? "fr" : "en"];
    if (note) out.push(`> **${t(m.module)}** — ${note}`);
  }
  out.push("");
  for (const [module, findings] of groups) {
    out.push(`### ${t(module)}`);
    out.push("");
    out.push(
      `| ${fr ? "Contrôle" : "Control"} | ${fr ? "Statut" : "Status"} | ${fr ? "Observé" : "Observed"} | ${fr ? "Pourquoi" : "Why"} |`
    );
    out.push("| --- | --- | --- | --- |");
    for (const f of findings) {
      const copy = controls[f.id];
      const title = copy?.title ? `${copy.title}` : f.id;
      const fix = copy?.fix ? ` <br>_Fix : ${copy.fix.slice(0, 160)}_` : "";
      out.push(
        `| ${f.id} — ${title} | ${L(f.status)} | ${f.observed.replace(/\|/g, "\\|").slice(0, 120)} | ${f.why.replace(/\|/g, "\\|").slice(0, 160)}${fix} |`
      );
    }
    out.push("");
  }

  out.push(`## ${findIndex + 1}. ${fr ? "Méthode et périmètre" : "Method and scope"}`);
  out.push("");
  out.push(
    fr
      ? "Cinq lectures indépendantes sur un seul moteur : WORLD (locales, RTL, formats), FLOW (parcours critiques), EXIT (exports et portabilité), FAIL (en-têtes de sécurité et défauts), CLEAN (qualité de l'interface). Tout s'exécute sur la machine de l'opérateur ; rien n'est envoyé à un service tiers. Les contrôles ignorés sont nommés ; un contrôle non exécuté n'est jamais présenté comme réussi."
      : "Five independent readings on one engine: WORLD (locales, RTL, formats), FLOW (critical journeys), EXIT (exports and portability), FAIL (security headers and defects), CLEAN (interface quality). Everything runs on the operator's machine; nothing is sent to a third party. Skipped controls are named; a control that did not run is never presented as passed."
  );
  if (result.ownership === "unverified") {
    out.push("");
    out.push(
      fr
        ? "> ⚠ Site distant non vérifié : le scan n'a pas prouvé la propriété de la cible."
        : "> ⚠ Remote, unverified: the scan did not prove ownership of the target."
    );
  }
  out.push("");
  return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* Print / PDF                                                         */
/* ------------------------------------------------------------------ */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusChip(status: string, fr: boolean): string {
  const label = STATUS_LABELS[status]?.[fr ? "fr" : "en"] ?? status;
  const color = STATUS_COLORS[status] ?? "#6b7280";
  return `<span class="chip" style="color:${color};border-color:${color}55;background:${color}14">${escapeHtml(label)}</span>`;
}

/** Horizontal SVG bar: one row, colored by verdict. */
function scoreBar(label: string, score: number, color: string | null): string {
  const w = Math.max(2, Math.min(100, score));
  return `<div class="bar-row"><span class="bar-label">${escapeHtml(label)}</span><svg viewBox="0 0 200 10" preserveAspectRatio="none" class="bar-svg" aria-hidden="true"><rect x="0" y="0" width="200" height="10" rx="5" fill="#eef1f0"/><rect x="0" y="0" width="${w * 2}" height="10" rx="5" fill="${color ?? "#6b7280"}"/></svg><span class="bar-value">${score}/100</span></div>`;
}

/** Stacked bar of finding statuses for one module. */
function stackedBar(counts: { pass: number; warn: number; fail: number; skipped: number }): string {
  const total = Math.max(1, counts.pass + counts.warn + counts.fail + counts.skipped);
  const seg = (n: number, color: string) =>
    n > 0 ? `<rect x="0" width="${(n / total) * 200}" height="10" fill="${color}"/>` : "";
  const segs = [
    seg(counts.pass, STATUS_COLORS.pass ?? "#0d9f6e"),
    seg(counts.warn, STATUS_COLORS.warn ?? "#b45309"),
    seg(counts.fail, STATUS_COLORS.fail ?? "#dc2626"),
    seg(counts.skipped, STATUS_COLORS.skipped ?? "#6b7280"),
  ];
  let x = 0;
  const positioned = segs
    .map((s) => {
      if (!s) return "";
      const html = `<g transform="translate(${x},0)">${s}</g>`;
      const match = /width="([\d.]+)"/.exec(s);
      x += match ? Number(match[1]) : 0;
      return html;
    })
    .join("");
  return `<svg viewBox="0 0 200 10" preserveAspectRatio="none" class="bar-svg" aria-hidden="true"><rect x="0" y="0" width="200" height="10" rx="5" fill="#eef1f0"/>${positioned}</svg>`;
}

function donut(slices: readonly { label: string; n: number; color: string }[]): string {
  const total = slices.reduce((a, s) => a + s.n, 0) || 1;
  let angle = -90;
  const cx = 60;
  const cy = 60;
  const r = 44;
  const inner = 30;
  const arcs = slices
    .filter((s) => s.n > 0)
    .map((s) => {
      const a0 = (angle * Math.PI) / 180;
      angle += (s.n / total) * 360;
      const a1 = (angle * Math.PI) / 180;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (radius: number, a: number) =>
        `${cx + radius * Math.cos(a)} ${cy + radius * Math.sin(a)}`;
      const d = `M ${p(r, a0)} A ${r} ${r} 0 ${large} 1 ${p(r, a1)} L ${p(inner, a1)} A ${inner} ${inner} 0 ${large} 0 ${p(inner, a0)} Z`;
      return `<path d="${d}" fill="${s.color}"/>`;
    })
    .join("");
  return `<svg viewBox="0 0 120 120" class="donut" aria-hidden="true">${arcs}<text x="60" y="58" text-anchor="middle" class="donut-n">${total}</text><text x="60" y="74" text-anchor="middle" class="donut-t">${fr0("constats")}</text></svg>`;
}

function fr0(s: string): string {
  return s;
}

/* ------------------------------------------------------------------ */
/* Glossary and module explanations                                    */
/* ------------------------------------------------------------------ */

/** Technical terms the report may use, explained in one sentence. Only the
 * terms that actually appear in this report are printed. */
const GLOSSARY: { term: string; fr: string; en: string }[] = [
  {
    term: "CSP",
    fr: "Content-Security-Policy — un en-tête HTTP qui liste ce qu'une page a le droit de charger (scripts, images, iframes) ; il bloque les scripts injectés.",
    en: "Content-Security-Policy — an HTTP header listing what a page may load (scripts, images, frames); it blocks injected scripts.",
  },
  {
    term: "HSTS",
    fr: "Strict-Transport-Security — l'en-tête qui force le navigateur à n'utiliser que HTTPS pour ce domaine, même sur une simple frappe d'URL.",
    en: "Strict-Transport-Security — the header that forces the browser to use HTTPS only for this domain, even on a typed URL.",
  },
  {
    term: "X-Frame-Options",
    fr: "L'en-tête qui interdit d'embarquer la page dans une iframe d'un autre site — la base de la défense contre le clickjacking.",
    en: "The header that forbids embedding the page in another site's iframe — the base of clickjacking defense.",
  },
  {
    term: "clickjacking",
    fr: "Une attaque où la vraie page est cachée sous un calque : le visiteur croit cliquer ailleurs. Les en-têtes frame_* la bloquent.",
    en: "An attack where the real page is hidden under a layer: the visitor believes they click elsewhere. The frame_* headers block it.",
  },
  {
    term: "cache-control",
    fr: "L'en-tête qui décide combien de temps une réponse peut être conservée ; mal réglé, il sert des données privées au mauvais visiteur.",
    en: "The header deciding how long a response may be kept; misconfigured, it serves private data to the wrong visitor.",
  },
  {
    term: "permissions-policy",
    fr: "L'en-tête qui retire à la page des capacités du navigateur (caméra, micro, géolocalisation) quand elle n'en a pas besoin.",
    en: "The header that removes browser capabilities (camera, microphone, geolocation) the page does not need.",
  },
  {
    term: "TLS",
    fr: "Le chiffrement de la connexion HTTPS. Un certificat expiré, une version ancienne ou un renouvellement manqué fait échouer tout le site.",
    en: "The encryption behind HTTPS. An expired certificate, an old version or a missed renewal fails the whole site.",
  },
  {
    term: "cookie flags",
    fr: "Secure, HttpOnly et SameSite : trois attributs d'un cookie qui l'empêchent de circuler en clair, d'être lu en JS ou d'être envoyé par un site tiers.",
    en: "Secure, HttpOnly and SameSite: three cookie attributes keeping it off clear text, JS reads and cross-site sends.",
  },
  {
    term: "locale",
    fr: "Le couple langue + région d'un visiteur (fr-FR, en-US). Elle change dates, monnaies, tri du texte et sens de lecture.",
    en: "A visitor's language + region pair (fr-FR, en-US). It changes dates, currencies, text sorting and reading direction.",
  },
  {
    term: "RTL",
    fr: "Right-To-Left — les écritures qui se lisent de droite à gauche (arabe, hébreu) ; l'interface entière doit se retourner avec elles.",
    en: "Right-To-Left — scripts read right to left (Arabic, Hebrew); the whole interface must flip with them.",
  },
  {
    term: "i18n / l10n",
    fr: "Internationalisation (rendre le code capable d'autres langues) et localisation (le faire pour une langue précise).",
    en: "Internationalization (making the code able to hold other languages) and localization (doing it for one language).",
  },
  {
    term: "idempotence",
    fr: "Rejouer la même requête ne change rien une seconde fois : la propriété qui rend un paiement ou une création de compte sûr quand le réseau répète l'envoi.",
    en: "Replaying the same request changes nothing the second time: the property that makes a payment or signup safe when the network resends.",
  },
  {
    term: "retry / backoff",
    fr: "Réessayer une requête en échec, en espaçant les tentatives ; sans limite ni espacement, le client déborde le serveur au lieu de l'aider.",
    en: "Retrying a failed request with growing spacing; without limits, the client floods the server instead of helping.",
  },
  {
    term: "timeout",
    fr: "La durée après laquelle on abandonne une requête ; sans lui, une page reste bloquée indéfiniment sur un service en panne.",
    en: "How long a request may run before giving up; without it, a page hangs forever on a dead service.",
  },
  {
    term: "checksum",
    fr: "Une empreinte calculée sur un fichier pour prouver qu'il n'a pas été altéré entre l'export et la lecture.",
    en: "A fingerprint computed over a file proving it was not altered between export and read.",
  },
  {
    term: "sitemap",
    fr: "Le fichier XML qui liste les pages d'un site pour les moteurs de recherche ; son absence ralentit l'indexation.",
    en: "The XML file listing a site's pages for search engines; without it indexing is slower.",
  },
  {
    term: "robots.txt",
    fr: "Le fichier qui dit aux robots ce qu'ils peuvent explorer ; son absence n'interdit pas le crawl mais laisse la politique implicite.",
    en: "The file telling robots what they may crawl; absent, the implicit policy applies.",
  },
  {
    term: "client-rendered",
    fr: "Une page dont le contenu est construit par JavaScript dans le navigateur ; un scan qui ne lit que le HTML n'en voit qu'une coquille vide.",
    en: "A page whose content is built by JavaScript in the browser; a scan reading only the HTML sees an empty shell.",
  },
  {
    term: "viewport",
    fr: "La balise qui adapte la page à l'écran du téléphone ; sans elle, le mobile zoome sur une version bureautique.",
    en: "The tag that adapts the page to a phone screen; without it, mobile zooms into a desktop layout.",
  },
  {
    term: "alt-text",
    fr: "Le texte alternatif d'une image, lu par les lecteurs d'écran et affiché si l'image ne charge pas.",
    en: "An image's alternative text, read by screen readers and shown if the image fails.",
  },
  {
    term: "heading structure",
    fr: "La hiérarchie h1→h2→h3 : le plan du document, lu à voix haute par les aides techniques et utilisé par le référencement.",
    en: "The h1→h2→h3 hierarchy: the document's outline, read aloud by assistive tech and used by SEO.",
  },
  {
    term: "secrets in HTML",
    fr: "Une clé API, un token ou un mot de passe laissé dans le code source de la page — visible par quiconque ouvre « voir la source ».",
    en: "An API key, token or password left in the page's source — visible to anyone opening view-source.",
  },
];

/** What each module measures, and the failures it looks for. */
const MODULE_NOTES: Record<string, { fr: string; en: string }> = {
  world: {
    fr: "WORLD lit la page comme un visiteur d'un autre pays : balise de langue, gestion de l'écriture de droite à gauche, formats de dates et de monnaies, détection des textes non traduits. Les échecs typiques : un site en anglais servi à un visiteur français, une interface qui casse en arabe, un montant affiché sans devise.",
    en: "WORLD reads the page as a visitor from another country: language tag, right-to-left handling, date and currency formats, untranslated strings. Typical failures: an English-only site served to a French visitor, an interface breaking in Arabic, an amount printed without a currency.",
  },
  flow: {
    fr: "FLOW rejoue les parcours critiques — inscription, connexion, paiement, remboursement — et vérifie qu'ils survivent aux accidents du réseau : timeout, retry, webhook. Les échecs typiques : un panier perdu au rechargement, un paiement rejoué deux fois, un formulaire qui ne dit jamais qu'il a échoué.",
    en: "FLOW replays the critical journeys — signup, login, payment, refund — and checks they survive network accidents: timeouts, retries, webhooks. Typical failures: a cart lost on reload, a payment charged twice, a form that never says it failed.",
  },
  exit: {
    fr: "EXIT vérifie que vos données sont portables : exports réels, données structurées (JSON-LD), métadonnées de partage, surface d'API documentée, styles d'impression. Les échecs typiques : un export qui ne sort que le HTML de la page, un aperçu de partage sans image, des données coincées dans un format propriétaire.",
    en: "EXIT verifies your data is portable: real exports, structured data (JSON-LD), share metadata, a documented API surface, print styles. Typical failures: an export that only yields page HTML, a share preview with no image, data stuck in a proprietary format.",
  },
  fail: {
    fr: "FAIL audite la sécurité et les défauts : en-têtes CSP et HSTS, protection contre le clickjacking, secrets dans le HTML, cookies mal protégés, contenu mixte, révocation de secrets. Les échecs typiques : une clé API dans le code source, un cookie de session sans SameSite, un site en HTTP derrière un formulaire.",
    en: "FAIL audits security and defects: CSP and HSTS headers, clickjacking protection, secrets in HTML, unprotected cookies, mixed content, secret revocation. Typical failures: an API key in the source, a session cookie without SameSite, a form posting over HTTP.",
  },
  clean: {
    fr: "CLEAN note la qualité de l'interface : hiérarchie des titres, textes alternatifs, étiquettes de champs, adaptation au viewport, poids du HTML. Les échecs typiques : trois h1 sur une page, une image sans description, un champ sans étiquette lu à voix haute comme « zone éditable ».",
    en: "CLEAN grades interface quality: heading hierarchy, alternative texts, field labels, viewport fit, HTML weight. Typical failures: three h1 on a page, an image with no description, a field read aloud as an unnamed edit box.",
  },
};

/** Glossary filtered to the terms this report actually uses. */
function glossaryFor(result: ScanResultLike, fr: boolean): string {
  const haystack = JSON.stringify({
    findings: result.findings,
    modules: result.modules,
    site: result.site,
  }).toLowerCase();
  const items = GLOSSARY.filter((g) => haystack.includes(g.term.toLowerCase()));
  if (items.length === 0) return "";
  return `<h2>${fr ? "6. Glossaire" : "6. Glossary"}</h2><div class="glossary">${items
    .map((g) => `<p><b>${escapeHtml(g.term)}</b> — ${escapeHtml(fr ? g.fr : g.en)}</p>`)
    .join("")}</div>`;
}

function moduleNotesFor(result: ScanResultLike, fr: boolean): string {
  const title = (m: string): string => MODULE_TITLES[m]?.[fr ? "fr" : "en"] ?? m;
  return result.modules
    .map((m) => {
      const note = MODULE_NOTES[m.module]?.[fr ? "fr" : "en"];
      if (!note) return "";
      const copy = controlsOfModule(m.module);
      const typical = copy.length
        ? `<p class="f-tag">${fr ? "Contrôles de ce module dans ce rapport" : "Controls of this module in this report"} : ${escapeHtml(copy.join(" · "))}</p>`
        : "";
      return `<div class="module-note"><b>${escapeHtml(title(m.module))}</b>${escapeHtml(note)}${typical}</div>`;
    })
    .join("");
}

function controlsOfModule(module: string): string[] {
  return moduleControlIds.get(module) ?? [];
}

const moduleControlIds = new Map<string, string[]>();
function indexModuleControls(result: ScanResultLike): void {
  moduleControlIds.clear();
  for (const f of result.findings) {
    const list = moduleControlIds.get(f.module) ?? [];
    if (!list.includes(f.id)) list.push(f.id);
    moduleControlIds.set(f.module, list);
  }
}

export function buildReportHtml(
  result: ScanResultLike,
  controls: Record<string, ControlCopy>,
  fr: boolean
): string {
  const t = (m: string) => MODULE_TITLES[m]?.[fr ? "fr" : "en"] ?? m;
  const L = (key: string) => STATUS_LABELS[key]?.[fr ? "fr" : "en"] ?? key;
  const site = result.site;
  const pass = statusCount(result, "pass");
  const warn = statusCount(result, "warn");
  const fail = statusCount(result, "fail");
  const skipped = statusCount(result, "skipped");
  const score = overallScore(result);

  const moduleRows = result.modules
    .map((m) => {
      const color: string | null =
        m.verdict === "pass"
          ? (STATUS_COLORS.pass ?? null)
          : m.verdict === "warnings"
            ? (STATUS_COLORS.warn ?? null)
            : m.verdict === "fail"
              ? (STATUS_COLORS.fail ?? null)
              : (STATUS_COLORS.skipped ?? null);
      return `<tr><td class="mono">${escapeHtml(t(m.module))}</td><td class="n">${m.passed}</td><td class="n">${m.warnings}</td><td class="n">${m.failed}</td><td class="n">${m.skipped}</td><td style="min-width:150px">${scoreBar("", m.score, color)}</td><td>${statusChip(m.verdict === "not_measured" ? "not_measured" : m.verdict === "warnings" ? "warn" : m.verdict, fr)}</td></tr>`;
    })
    .join("");

  const stackedRows = result.modules
    .map((m) => {
      const c = { pass: m.passed, warn: m.warnings, fail: m.failed, skipped: m.skipped };
      return `<div class="bar-row"><span class="bar-label">${escapeHtml(t(m.module))}</span>${stackedBar(c)}<span class="bar-value">${m.passed + m.warnings + m.failed + m.skipped}</span></div>`;
    })
    .join("");

  const pageSlices = site
    ? [
        {
          label: "200",
          n: site.pages.filter((p) => p.status >= 200 && p.status < 300 && !p.error).length,
          color: STATUS_COLORS.pass,
        },
        {
          label: "3xx",
          n: site.pages.filter((p) => p.status >= 300 && p.status < 400).length,
          color: "#2563eb",
        },
        {
          label: "4xx/5xx",
          n: site.pages.filter((p) => p.status >= 400).length,
          color: STATUS_COLORS.fail,
        },
        {
          label: fr ? "erreur" : "error",
          n: site.pages.filter((p) => p.error).length,
          color: STATUS_COLORS.warn,
        },
      ]
    : [];

  const groups = new Map<string, ScanFinding[]>();
  for (const f of result.findings) {
    if (!groups.has(f.module)) groups.set(f.module, []);
    groups.get(f.module)!.push(f);
  }
  const findingsTables = [...groups.entries()]
    .map(([module, findings]) => {
      const rows = findings
        .map((f) => {
          const copy = controls[f.id];
          const title = copy?.title ? escapeHtml(copy.title) : escapeHtml(f.id);
          const lines = [
            `<p class="f-head"><span class="mono">${escapeHtml(f.id)}</span> ${title} ${statusChip(f.status, fr)}</p>`,
            `<p class="f-row"><b>${fr ? "Observé" : "Seen"}</b> ${escapeHtml(f.observed.slice(0, 220))}</p>`,
            copy?.objective
              ? `<p class="f-row"><b>${fr ? "Ce que ça veut dire" : "What it means"}</b> ${escapeHtml(copy.objective.slice(0, 260))}</p>`
              : f.why
                ? `<p class="f-row"><b>${fr ? "Ce que ça veut dire" : "What it means"}</b> ${escapeHtml(f.why.slice(0, 260))}</p>`
                : "",
            copy?.consequence
              ? `<p class="f-row"><b>${fr ? "Conséquence" : "Consequence"}</b> ${escapeHtml(copy.consequence.slice(0, 260))}</p>`
              : "",
            copy?.fix
              ? `<p class="f-row f-fix"><b>${fr ? "✎ Solution" : "✎ Fix"}</b> ${escapeHtml(copy.fix.slice(0, 400))}</p>`
              : "",
            copy?.fixes && copy.fixes.length > 0 && copy.fixes[0]
              ? `<p class="f-row"><b>${fr ? "Exemple de code" : "Code example"}</b></p><pre class="f-code">${escapeHtml((copy.fixes[0].code ?? "").slice(0, 300))}</pre><p class="f-tag">${escapeHtml(copy.fixes[0].stack ?? "")}</p>`
              : "",
            copy?.verify
              ? `<p class="f-row"><b>${fr ? "Comment vérifier" : "How to verify"}</b> ${escapeHtml(copy.verify.slice(0, 220))}</p>`
              : "",
            copy
              ? `<p class="f-tag">${fr ? "Complexité" : "Complexity"} ${escapeHtml(String(copy.complexity ?? ""))} · ${fr ? "Risque" : "Risk"} ${escapeHtml(String(copy.risk ?? ""))}</p>`
              : "",
          ];
          return `<div class="finding ${f.status}">${lines.filter(Boolean).join("")}</div>`;
        })
        .join("");
      return `<h3>${escapeHtml(t(module))} <span class="count">${findings.length}</span></h3>${rows}`;
    })
    .join("");

  const pagesTable = site
    ? `<table><thead><tr><th>#</th><th>${fr ? "Chemin" : "Path"}</th><th>${fr ? "Titre" : "Title"}</th><th>HTTP</th><th>${fr ? "Poids" : "Size"}</th><th>${fr ? "Prof." : "Depth"}</th></tr></thead><tbody>${site.pages
        .map(
          (p, i) =>
            `<tr><td class="n">${i + 1}</td><td class="mono">${escapeHtml(pagePath(p.finalUrl).slice(0, 60))}</td><td>${p.error ? `<span style="color:${STATUS_COLORS.fail}">⚠ ${escapeHtml(p.error.slice(0, 40))}</span>` : escapeHtml((p.title ?? "—").slice(0, 52))}</td><td class="n">${p.status}</td><td class="n">${fmtKb(p.bytes)}</td><td class="n">${p.depth}</td></tr>`
        )
        .join("")}</tbody></table>`
    : "";

  const siteSection = site
    ? `<h2>${fr ? "3. Structure du site" : "3. Site structure"}</h2>
    <div class="cards">
      <div class="card"><p class="card-n">${site.pages.length}</p><p class="card-l">${fr ? "pages découvertes" : "pages discovered"}</p></div>
      <div class="card"><p class="card-n">${site.pages.filter((p) => p.measured).length}</p><p class="card-l">${fr ? "mesurées" : "measured"}</p></div>
      <div class="card"><p class="card-n">${site.requests}</p><p class="card-l">${fr ? "requêtes" : "requests"}</p></div>
      <div class="card"><p class="card-n">${site.robots?.found ? "✓" : "—"}</p><p class="card-l">robots.txt</p></div>
      <div class="card"><p class="card-n">${site.sitemap?.found ? "✓" : "—"}</p><p class="card-l">sitemap</p></div>
      ${pageSlices.length ? `<div class="card donut-card">${donut(pageSlices as { label: string; n: number; color: string }[])}<p class="card-l">${fr ? "statuts HTTP" : "HTTP statuses"}</p></div>` : ""}
    </div>
    ${pagesTable}
    ${
      site.skipped.length
        ? `<h3>${fr ? "Pages ignorées" : "Skipped pages"}</h3><table><thead><tr><th>URL</th><th>${fr ? "Raison" : "Reason"}</th></tr></thead><tbody>${site.skipped
            .slice(0, 30)
            .map(
              (sk) =>
                `<tr><td class="mono">${escapeHtml(sk.url.slice(0, 70))}</td><td>${escapeHtml(sk.reason)}</td></tr>`
            )
            .join("")}</tbody></table>`
        : ""
    }`
    : `<p class="note">${fr ? "Lecture du site non demandée pour ce scan : le rapport couvre la page nommée uniquement." : "Site reading was not requested for this scan: the report covers the named page only."}</p>`;

  const scoreCards = `<div class="cards">
      <div class="card card-hero"><p class="card-n big">${score !== null ? score : "—"}</p><p class="card-l">score /100</p></div>
      <div class="card"><p class="card-n" style="color:${STATUS_COLORS.pass}">${pass}</p><p class="card-l">${L("pass")}</p></div>
      <div class="card"><p class="card-n" style="color:${STATUS_COLORS.warn}">${warn}</p><p class="card-l">${L("warn")}</p></div>
      <div class="card"><p class="card-n" style="color:${STATUS_COLORS.fail}">${fail}</p><p class="card-l">${L("fail")}</p></div>
      <div class="card"><p class="card-n" style="color:${STATUS_COLORS.skipped}">${skipped}</p><p class="card-l">${L("skipped")}</p></div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="${fr ? "fr" : "en"}">
<head>
<meta charset="utf-8">
<title>PROOFCORE — ${escapeHtml(result.finalUrl)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.55 -apple-system, "Segoe UI", sans-serif; color: #17161a; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { max-width: 900px; margin: 0 auto; padding: 0 36px 48px; }
  .cover { background: #050708; color: #f3f6f5; margin: 0 -36px 28px; padding: 34px 36px 26px; }
  .cover .brand { font: 800 20px/1 -apple-system, "Segoe UI", sans-serif; letter-spacing: 0.14em; }
  .cover .brand i { color: #78e3cb; font-style: normal; }
  .cover h1 { margin: 14px 0 6px; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
  .cover .meta { font: 11px/1.7 ui-monospace, Menlo, monospace; color: rgba(243,246,245,0.72); }
  .cover .score-badge { float: right; border: 1px solid rgba(120,227,203,0.5); border-radius: 12px; padding: 12px 20px; text-align: center; }
  .cover .score-badge b { display: block; font-size: 30px; color: #78e3cb; }
  .cover .score-badge span { font: 10px ui-monospace, monospace; letter-spacing: 0.16em; text-transform: uppercase; }
  h2 { font-size: 16px; margin: 30px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #050708; }
  h3 { font-size: 13.5px; margin: 20px 0 8px; }
  .count { color: #6b7280; font-weight: 500; }
  .cards { display: flex; gap: 10px; flex-wrap: wrap; margin: 14px 0; }
  .card { flex: 1 1 90px; border: 1px solid #e3e6e4; border-radius: 10px; padding: 10px 12px; background: #fafbfa; }
  .card-hero { background: #050708; color: #fff; border-color: #050708; }
  .card-n { margin: 0; font-size: 22px; font-weight: 750; }
  .card-n.big { font-size: 30px; color: #78e3cb; }
  .card-l { margin: 2px 0 0; font-size: 10.5px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; }
  .card-hero .card-l { color: rgba(255,255,255,0.6); }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 6px; font-size: 11.5px; }
  th { text-align: left; font: 600 10px/1.4 -apple-system, sans-serif; text-transform: uppercase; letter-spacing: 0.07em; color: #5b6470; border-bottom: 1.5px solid #17161a; padding: 6px 8px; }
  td { border-bottom: 1px solid #edf0ee; padding: 6px 8px; vertical-align: top; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, Menlo, monospace; font-size: 10.5px; }
  .chip { display: inline-block; padding: 1px 8px; border: 1px solid; border-radius: 999px; font: 600 10px/1.5 -apple-system, sans-serif; }
  .fix { color: #5b6470; font-size: 10.5px; margin-top: 3px; }
  .finding { border: 1px solid #e3e6e4; border-left: 3px solid #cbd2d0; border-radius: 8px; padding: 10px 12px; margin: 8px 0; background: #fff; page-break-inside: avoid; }
  .finding.FAIL, .finding.fail { border-left-color: #dc2626; background: #fdf7f6; }
  .finding.WARN, .finding.warn { border-left-color: #b45309; background: #fdfbf5; }
  .finding.PASS, .finding.pass { border-left-color: #0d9f6e; background: #f7fcfa; }
  .finding.SKIPPED, .finding.skipped, .finding.pending, .finding.PENDING { border-left-color: #9ca3af; background: #fafafa; }
  .f-head { margin: 0 0 6px; font-weight: 650; }
  .f-head .mono { color: #6b7280; font-weight: 500; margin-right: 6px; }
  .f-row { margin: 3px 0; font-size: 11.5px; }
  .f-row b { display: inline-block; min-width: 118px; color: #5b6470; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
  .f-fix { background: rgba(13, 159, 110, 0.08); border-radius: 6px; padding: 6px 8px; }
  .f-fix b { color: #0d9f6e; }
  .f-code { margin: 4px 0 2px; padding: 7px 9px; background: #f4f6f5; border: 1px solid #e3e6e4; border-radius: 6px; font: 10px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; }
  .f-tag { margin: 3px 0 0; font: 500 9.5px ui-monospace, monospace; color: #8a9299; text-transform: uppercase; letter-spacing: 0.07em; }
  .glossary { columns: 2; column-gap: 24px; font-size: 10.5px; }
  .glossary p { break-inside: avoid; margin: 0 0 6px; }
  .glossary b { color: #17161a; }
  .module-note { border: 1px solid #e3e6e4; border-radius: 8px; background: #fafbfa; padding: 10px 12px; margin: 8px 0; font-size: 11.5px; }
  .module-note b { display: block; margin-bottom: 3px; }
  .bar-row { display: flex; align-items: center; gap: 10px; margin: 5px 0; }
  .bar-label { flex: 0 0 210px; font-size: 11px; }
  .bar-svg { flex: 1; height: 10px; }
  .bar-value { flex: 0 0 52px; text-align: right; font: 600 11px ui-monospace, monospace; }
  .donut { width: 92px; height: 92px; }
  .donut-card { text-align: center; }
  .donut-n { font: 700 20px -apple-system, sans-serif; fill: #17161a; }
  .donut-t { font: 9px ui-monospace, monospace; fill: #6b7280; letter-spacing: 0.1em; }
  .note { color: #5b6470; font-style: italic; }
  footer { margin-top: 34px; padding-top: 12px; border-top: 1px solid #e3e6e4; font-size: 10.5px; color: #6b7280; }
  @page { margin: 14mm 12mm; }
  @media print { .page { max-width: none; padding: 0; } .cover { margin: 0 0 24px; } }
</style>
</head>
<body>
<div class="page">
  <div class="cover">
    <div class="score-badge"><b>${score !== null ? score : "—"}</b><span>${fr ? "score global" : "overall score"}</span></div>
    <p class="brand">P<i>●</i> ROOFCORE</p>
    <h1>${fr ? "Rapport de vérification" : "Verification report"} — ${escapeHtml(pagePath(result.finalUrl) || result.finalUrl)}</h1>
    <p class="meta">${escapeHtml(result.finalUrl)}<br>
    HTTP ${result.status} · ${fmtKb(result.bytes)} · ${result.durationMs} ms<br>
    ${fr ? "Scanné" : "Scanned"} ${dateLabel(result.scannedAt, fr)}${result.id ? ` · audit ${escapeHtml(result.id)}` : ""}<br>
    ${fr ? "Constats" : "Findings"} : ${result.findings.length} — ${pass} ${L("pass").toLowerCase()} · ${warn} ${L("warn").toLowerCase()} · ${fail} ${L("fail").toLowerCase()} · ${skipped} ${L("skipped").toLowerCase()}</p>
  </div>

  <h2>${fr ? "1. Synthèse" : "1. Summary"}</h2>
  ${scoreCards}

  <h2>${fr ? "2. Verdict par module" : "2. Verdict by module"}</h2>
  <table><thead><tr><th>${fr ? "Module" : "Module"}</th><th>${L("pass")}</th><th>${L("warn")}</th><th>${L("fail")}</th><th>${L("skipped")}</th><th>Score</th><th>${fr ? "Verdict" : "Verdict"}</th></tr></thead><tbody>${moduleRows}</tbody></table>
  <h3>${fr ? "Répartition des constats" : "Findings distribution"}</h3>
  ${stackedRows}

  ${siteSection}

  <h2>${fr ? "4. Ce que mesure chaque module" : "4. What each module measures"}</h2>
  ${moduleNotesFor(result, fr)}

  <h2>${fr ? "5. Constats par module" : "5. Findings by module"}</h2>
  ${findingsTables || `<p class="note">${fr ? "Aucun constat enregistré." : "No findings recorded."}</p>`}
  ${glossaryFor(result, fr)}

  <footer>
    ${fr ? "Méthode — cinq lectures indépendantes sur un seul moteur : WORLD (locales, RTL, formats), FLOW (parcours critiques), EXIT (exports), FAIL (en-têtes de sécurité), CLEAN (qualité de l'interface). Exécution locale ; les contrôles ignorés sont nommés ; un contrôle non exécuté n'est jamais présenté comme réussi." : "Method — five independent readings on one engine: WORLD, FLOW, EXIT, FAIL, CLEAN. Local execution; skipped controls are named; a control that did not run is never presented as passed."}
    ${result.ownership === "unverified" ? (fr ? " · ⚠ Site distant non vérifié." : " · ⚠ Remote, unverified.") : ""}
    <br>${fr ? "Document généré par PROOFCORE" : "Document generated by PROOFCORE"} — ${dateLabel(new Date().toISOString(), fr)}
  </footer>
</div>
</body>
</html>`;
}

export function openPrintReport(
  result: ScanResultLike,
  controls: Record<string, ControlCopy>,
  fr: boolean
): void {
  const html = buildReportHtml(result, controls, fr);
  const win = window.open("", "_blank");
  if (!win) {
    window.alert(
      fr
        ? "Autorisez les fenêtres surgissantes pour générer le PDF."
        : "Allow pop-ups to generate the PDF."
    );
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  // give the browser a beat to lay the document out, then open the print dialog
  window.setTimeout(() => {
    try {
      win.print();
    } catch {
      /* the visitor prints from the menu */
    }
  }, 450);
}

export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function reportFileStem(result: ScanResultLike): string {
  try {
    const host = new URL(result.finalUrl).host.replace(/^www\./, "").replace(/[^a-z0-9.-]/gi, "-");
    return `proofcore-${host}-${(result.id ?? result.scannedAt).slice(0, 12)}`;
  } catch {
    return `proofcore-report-${(result.id ?? result.scannedAt).slice(0, 12)}`;
  }
}
