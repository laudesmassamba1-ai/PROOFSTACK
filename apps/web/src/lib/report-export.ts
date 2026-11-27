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
          const fix = copy?.fix
            ? `<div class="fix">${escapeHtml(copy.fix.slice(0, 220))}</div>`
            : "";
          return `<tr><td class="mono">${escapeHtml(f.id)}</td><td>${title}${fix}</td><td>${statusChip(f.status, fr)}</td><td>${escapeHtml(f.observed.slice(0, 140))}</td></tr>`;
        })
        .join("");
      return `<h3>${escapeHtml(t(module))} <span class="count">${findings.length}</span></h3><table><thead><tr><th>${fr ? "Contrôle" : "Control"}</th><th>${fr ? "Objet" : "Subject"}</th><th>${fr ? "Statut" : "Status"}</th><th>${fr ? "Observé" : "Observed"}</th></tr></thead><tbody>${rows}</tbody></table>`;
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

  <h2>${fr ? "4. Constats par module" : "4. Findings by module"}</h2>
  ${findingsTables || `<p class="note">${fr ? "Aucun constat enregistré." : "No findings recorded."}</p>`}

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
