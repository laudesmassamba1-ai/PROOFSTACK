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
  /** Per-page findings are stored by the engine; older scans simply lack them. */
  findings?: ScanFinding[];
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

/** Findings carry the scanner's uppercase statuses; the report speaks lowercase. */
function normStatus(status: string): string {
  return status.toLowerCase();
}

function statusCount(result: ScanResultLike, status: string): number {
  return result.findings.filter((f) => normStatus(f.status) === status).length;
}

/** French and English both inflect after one; a report that says "1 contrôles" looks broken. */
function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** The registry entry for a finding, wherever the map was keyed. */
function controlFor(
  controls: Record<string, ControlCopy>,
  module: string,
  id: string
): ControlCopy | undefined {
  return controls[`${module}:${id}`] ?? controls[id];
}

/** A Markdown table cell: one line, pipes escaped, bounded. */
const MD_PIPE = `${String.fromCharCode(92)}|`;
function mdCell(value: string, max = Number.POSITIVE_INFINITY): string {
  return value.split("|").join(MD_PIPE).replace(/\r?\n/g, " ").slice(0, max);
}

/** A Markdown code span, built without nesting template literals. */
function mdCode(value: string): string {
  return `\`${value}\``;
}

const MODULE_ORDER = ["fail", "clean", "flow", "world", "exit"];

interface CoverageEntry {
  module: string;
  id: string;
  copy?: ControlCopy;
  finding?: ScanFinding;
  /** Lowercase status, or "absent" when the scan returned nothing for this control. */
  status: string;
}

interface ControlCoverage {
  total: number;
  executed: number;
  skipped: number;
  absent: number;
  entries: CoverageEntry[];
  byModule: {
    module: string;
    entries: CoverageEntry[];
    total: number;
    executed: number;
    skipped: number;
    absent: number;
  }[];
}

/**
 * The catalogue against the result: which controls ran, which were skipped and why, and
 * which are in the registry but produced no finding at all. This is the section that lets
 * a reader answer "what did it check, what did it find, what is missing?" without guessing.
 */
function controlCoverage(
  result: ScanResultLike,
  controls: Record<string, ControlCopy>
): ControlCoverage {
  const unique = new Map<string, CoverageEntry>();
  for (const [key, copy] of Object.entries(controls)) {
    if (!copy || typeof copy.title !== "string") continue;
    const [keyModule, ...rest] = key.split(":");
    const module = copy.module ?? keyModule ?? "";
    const id = copy.id ?? rest.join(":");
    if (!module || !id) continue;
    unique.set(`${module}:${id}`, { module, id, copy, status: "absent" });
  }

  const rank = (status: string): number =>
    status === "fail"
      ? 4
      : status === "warn"
        ? 3
        : status === "pass"
          ? 2
          : status === "absent"
            ? 0
            : 1;
  const pageFindings = (result.site?.pages ?? []).flatMap((page) => page.findings ?? []);
  for (const finding of [...result.findings, ...pageFindings]) {
    const entry = unique.get(`${finding.module}:${finding.id}`);
    if (!entry) continue;
    const status = normStatus(finding.status);
    // The worst verdict wins: a failing page must not be hidden by a passing site-level finding.
    if (rank(status) > rank(entry.status)) {
      entry.finding = finding;
      entry.status = status;
    }
  }

  const entries = [...unique.values()];
  const modules = [...new Set([...MODULE_ORDER, ...entries.map((entry) => entry.module)])];
  const byModule = modules
    .map((module) => {
      const moduleEntries = entries.filter((entry) => entry.module === module);
      return {
        module,
        entries: moduleEntries,
        total: moduleEntries.length,
        executed: moduleEntries.filter((entry) => ["pass", "warn", "fail"].includes(entry.status))
          .length,
        skipped: moduleEntries.filter((entry) =>
          ["skipped", "pending", "not_measured"].includes(entry.status)
        ).length,
        absent: moduleEntries.filter((entry) => entry.status === "absent").length,
      };
    })
    .filter((group) => group.total > 0);

  return {
    total: entries.length,
    executed: entries.filter((entry) => ["pass", "warn", "fail"].includes(entry.status)).length,
    skipped: entries.filter((entry) =>
      ["skipped", "pending", "not_measured"].includes(entry.status)
    ).length,
    absent: entries.filter((entry) => entry.status === "absent").length,
    entries,
    byModule,
  };
}

function pageCounts(page: ScanPageRow): {
  pass: number;
  warn: number;
  fail: number;
  skipped: number;
} {
  const findings = page.findings ?? [];
  return {
    pass: findings.filter((f) => normStatus(f.status) === "pass").length,
    warn: findings.filter((f) => normStatus(f.status) === "warn").length,
    fail: findings.filter((f) => normStatus(f.status) === "fail").length,
    skipped: findings.filter((f) => normStatus(f.status) === "skipped").length,
  };
}

/** The analysis's headline: the overall score, when the run produced one. */
function overallScore(result: ScanResultLike): number | null {
  return result.score?.score ?? null;
}

/* ------------------------------------------------------------------ */
/* JSON                                                                */
/* ------------------------------------------------------------------ */

export function buildReportJson(
  result: ScanResultLike,
  controls?: Record<string, ControlCopy>
): string {
  const coverage = controls ? controlCoverage(result, controls) : null;
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
      controls: coverage
        ? {
            total: coverage.total,
            executed: coverage.executed,
            skipped: coverage.skipped,
            absent: coverage.absent,
            byModule: coverage.byModule.map((group) => ({
              module: group.module,
              total: group.total,
              executed: group.executed,
              skipped: group.skipped,
              absent: group.absent,
            })),
          }
        : null,
    },
    modules: (result.modules ?? []).map((m) => ({
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
    diagnostics: coverage
      ? coverage.entries.map((entry) => ({
          module: entry.module,
          id: entry.id,
          title: entry.copy?.title ?? entry.id,
          objective: entry.copy?.objective ?? null,
          status: entry.status,
          observed: entry.finding?.observed ?? null,
          reason: entry.finding?.why ?? null,
        }))
      : null,
  };
  return JSON.stringify(doc, null, 2);
}

export function buildReportMarkdown(
  result: ScanResultLike,
  controls: Record<string, ControlCopy>,
  fr: boolean
): string {
  const labelFor = (key: string) => STATUS_LABELS[normStatus(key)]?.[fr ? "fr" : "en"] ?? key;
  const t = (m: string) => MODULE_TITLES[m]?.[fr ? "fr" : "en"] ?? m;
  const site = result.site;
  const coverage = controlCoverage(result, controls);
  const out: string[] = [];

  out.push(
    `# ${fr ? "Rapport de vérification" : "Verification report"} — ${pagePath(result.finalUrl) || result.finalUrl}`
  );
  out.push("");
  const auditLabel = result.id ? ` · audit ${result.id}` : "";
  out.push(
    `> ${fr ? "Généré par PROOFCORE" : "Generated by PROOFCORE"} · ${dateLabel(result.scannedAt, fr)}${auditLabel}`
  );
  out.push("");
  out.push("## Sommaire");
  out.push("");
  const toc = [
    fr ? "Cible et exécution" : "Target and run",
    fr ? "Verdict par module" : "Verdict by module",
    fr ? "Structure du site" : "Site structure",
    fr ? "Ce que mesure chaque module" : "What each module measures",
    fr ? "Contrôles : ce qui a été vérifié" : "Controls: what was checked",
    fr ? "Constats par module" : "Findings by module",
    fr ? "Résultats page par page" : "Page-by-page results",
    fr ? "Ce qui n'a pas pu être vérifié" : "What could not be verified",
    fr ? "Méthode et périmètre" : "Method and scope",
    fr ? "Glossaire" : "Glossary",
  ];
  toc.forEach((label, index) => {
    out.push(
      `${index + 1}. [${label}](#${index + 1}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")})`
    );
  });
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
  if (coverage.total > 0) {
    out.push(
      `| ${fr ? "Contrôles au catalogue" : "Controls in catalogue"} | **${coverage.total}** (${coverage.executed} ${fr ? "exécutés" : "executed"} · ${coverage.skipped} ${fr ? "ignorés" : "skipped"} · ${coverage.absent} ${fr ? "sans résultat" : "no result"}) |`
    );
  }
  if (overallScore(result) !== null) {
    out.push(
      `| ${fr ? "Score global" : "Overall score"} | **${overallScore(result)}/100** (${fr ? "couverture" : "coverage"} ${result.score?.coverage}%) |`
    );
  }
  out.push(
    `| ${fr ? "Constats" : "Findings"} | ${result.findings.length} (${labelFor("pass")}: ${statusCount(result, "pass")} · ${labelFor("warn")}: ${statusCount(result, "warn")} · ${labelFor("fail")}: ${statusCount(result, "fail")} · ${labelFor("skipped")}: ${statusCount(result, "skipped")}) |`
  );
  out.push("");

  out.push(`## 2. ${fr ? "Verdict par module" : "Verdict by module"}`);
  out.push("");
  out.push(
    `| Module | ${fr ? "Réussis" : "Pass"} | ${fr ? "Avert." : "Warn"} | ${fr ? "Échecs" : "Fail"} | ${fr ? "Ignorés" : "Skipped"} | Score | Verdict |`
  );
  out.push("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const m of result.modules ?? []) {
    out.push(
      `| ${t(m.module)} | ${m.passed} | ${m.warnings} | ${m.failed} | ${m.skipped} | ${m.score}/100 | ${labelFor(m.verdict)} |`
    );
  }
  out.push("");
  out.push(
    fr
      ? "> Ces compteurs viennent du moteur : ce sont les cas exécutés par module, pas le nombre de lignes de constats. Le chapitre 5 donne le verdict de chaque contrôle du catalogue ; le chapitre 6 détaille les constats."
      : "> These counters come from the engine: they are the cases executed per module, not the number of finding rows. Chapter 5 gives every catalogue control's verdict; chapter 6 details the findings.",
    ""
  );

  out.push(`## 3. ${fr ? "Structure du site" : "Site structure"}`);
  out.push("");
  if (site) {
    const measured = site.pages.filter((p) => p.measured).length;
    const errors = site.pages.filter((p) => p.error);
    out.push(
      `- ${fr ? "Pages découvertes" : "Pages discovered"} : **${site.pages.length}** · ${fr ? "pages mesurées" : "pages measured"} : **${measured}** · ${fr ? "pages non mesurées" : "pages not measured"} : **${site.pages.length - measured}**`
    );
    out.push(
      coverage.total > 0
        ? `- ${fr ? "Contrôles exécutés" : "Controls executed"} : **${coverage.executed}/${coverage.total}** · ${fr ? "ignorés" : "skipped"} : **${coverage.skipped}** · ${fr ? "sans résultat" : "no result"} : **${coverage.absent}**`
        : `- ${fr ? "Catalogue indisponible : impossible de confirmer quels contrôles ont été exécutés." : "Catalogue unavailable: cannot confirm which controls ran."}`
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
    out.push(`### ${fr ? "Inventaire des pages" : "Page inventory"}`);
    out.push("");
    out.push(
      `| # | ${fr ? "Chemin" : "Path"} | ${fr ? "Titre" : "Title"} | HTTP | ${fr ? "Mesure" : "Measured"} | ${fr ? "Contrôles" : "Controls"} | ${fr ? "Poids" : "Size"} | ${fr ? "Prof." : "Depth"} |`
    );
    out.push("| ---: | --- | --- | ---: | --- | --- | ---: | ---: |");
    site.pages.forEach((p, i) => {
      const counts = pageCounts(p);
      const title = p.title ? p.title.slice(0, 48) : p.error ? `⚠ ${p.error}` : "—";
      const measuredLabel = !p.measured
        ? fr
          ? "non mesurée"
          : "not measured"
        : p.findings === undefined
          ? fr
            ? "sans détail"
            : "no detail"
          : fr
            ? "mesurée"
            : "measured";
      const controlsCell = p.findings
        ? `✓${counts.pass} ⚠${counts.warn} ✕${counts.fail} –${counts.skipped}`
        : "—";
      out.push(
        `| ${i + 1} | ${mdCode(pagePath(p.finalUrl))} | ${mdCell(title, 60)} | ${p.status} | ${measuredLabel} | ${controlsCell} | ${fmtKb(p.bytes)} | ${p.depth} |`
      );
    });
    out.push("");
    if (site.skipped.length) {
      out.push(`### ${fr ? "Pages ignorées" : "Skipped pages"}`);
      out.push("");
      out.push(`| URL | ${fr ? "Raison" : "Reason"} |`);
      out.push("| --- | --- |");
      for (const sk of site.skipped) out.push(`| ${mdCell(sk.url, 100)} | ${mdCell(sk.reason)} |`);
      out.push("");
    }
    if (site.findings.length) {
      out.push(`### ${fr ? "Constats au niveau du site" : "Site-level findings"}`);
      out.push("");
      for (const f of site.findings) {
        out.push(
          `- **[${normStatus(f.status).toUpperCase()}]** ${t(f.module)} — ${f.id} : ${mdCell(f.observed)} — ${mdCell(f.why)}${f.pages.length ? ` (${f.pages.length} ${fr ? "pages" : "pages"})` : ""}`
        );
      }
      out.push("");
    }
  } else {
    out.push(
      fr
        ? "Lecture du site non demandée pour ce scan : le rapport couvre la page nommée uniquement."
        : "Site reading was not requested for this scan: the report covers the named page only."
    );
    out.push("");
  }

  out.push(`## 4. ${fr ? "Ce que mesure chaque module" : "What each module measures"}`);
  out.push("");
  for (const m of result.modules ?? []) {
    const raw = MODULE_NOTES[m.module]?.[fr ? "fr" : "en"];
    if (!raw) continue;
    const acronym = `${m.module.toUpperCase()} `;
    const note = raw.startsWith(acronym) ? raw.slice(acronym.length) : raw;
    out.push(`> **${t(m.module)}** — ${note}`);
  }
  out.push("");

  out.push(`## 5. ${fr ? "Contrôles : ce qui a été vérifié" : "Controls: what was checked"}`);
  out.push("");
  if (coverage.total === 0) {
    out.push(
      fr
        ? "Catalogue indisponible : les constats restent lisibles par leur identifiant, mais les contrôles absents ne peuvent pas être nommés."
        : "Catalogue unavailable: findings remain readable by id, but absent controls cannot be named."
    );
    out.push("");
  } else {
    out.push(
      fr
        ? "Chaque contrôle du catalogue est listé ci-dessous, module par module, avec son statut dans ce scan, la mesure réellement observée et ce qu'il établit. Un contrôle sans résultat n'est pas un contrôle réussi : il est nommé comme non exécuté."
        : "Every control in the catalogue is listed below, module by module, with its status in this scan, the measurement actually observed and what it establishes. A control with no result is not a passing control: it is named as not run."
    );
    out.push("");
    for (const group of coverage.byModule) {
      out.push(`### ${t(group.module)}`, "");
      out.push(
        `| ${fr ? "Contrôle" : "Control"} | ${fr ? "Statut" : "Status"} | ${fr ? "Résultat mesuré" : "Measured result"} | ${fr ? "Ce qu'il établit" : "What it establishes"} |`
      );
      out.push("| --- | --- | --- | --- |");
      for (const entry of group.entries) {
        const label =
          entry.status === "absent" ? (fr ? "non exécuté" : "not run") : labelFor(entry.status);
        const observed =
          entry.finding?.observed ??
          (fr ? "Aucun résultat dans ce scan." : "No result in this scan.");
        out.push(
          `| ${entry.id} — ${mdCell(entry.copy?.title ?? entry.id, 100)} | ${label} | ${mdCell(observed, 200)} | ${mdCell(entry.copy?.objective ?? "", 240)} |`
        );
      }
      out.push("");
    }
  }

  const groups = new Map<string, ScanFinding[]>();
  for (const f of result.findings) {
    const list = groups.get(f.module);
    if (list) list.push(f);
    else groups.set(f.module, [f]);
  }
  out.push(`## 6. ${fr ? "Constats par module" : "Findings by module"}`);
  out.push("");
  out.push(
    fr
      ? "> Ces constats sont ceux de la page nommée et du site. Les constats de chaque page découverte sont au chapitre 7."
      : "> These are the findings from the named page and the site. Each discovered page's findings are in chapter 7.",
    ""
  );
  for (const [module, findings] of groups) {
    out.push(`### ${t(module)}`, "");
    out.push(
      `| ${fr ? "Contrôle" : "Control"} | ${fr ? "Statut" : "Status"} | ${fr ? "Observé" : "Observed"} | ${fr ? "Pourquoi" : "Why"} |`
    );
    out.push("| --- | --- | --- | --- |");
    for (const f of findings) {
      const copy = controlFor(controls, f.module, f.id);
      const title = copy?.title ? copy.title : f.id;
      const fix = copy?.fix ? ` <br>_${fr ? "Solution" : "Fix"} : ${mdCell(copy.fix, 220)}_` : "";
      const cons = copy?.consequence
        ? ` <br>_${fr ? "Impact" : "Impact"} : ${mdCell(copy.consequence, 180)}_`
        : "";
      const verify = copy?.verify
        ? ` <br>_${fr ? "Vérification" : "Verification"} : ${mdCell(copy.verify, 160)}_`
        : "";
      out.push(
        `| ${f.id} — ${mdCell(title, 100)} | ${labelFor(f.status)} | ${mdCell(f.observed)} | ${mdCell(copy?.objective ?? f.why)}${cons}${fix}${verify} |`
      );
    }
    out.push("");
  }

  out.push(`## 7. ${fr ? "Résultats page par page" : "Page-by-page results"}`);
  out.push("");
  if (!site || site.pages.length === 0) {
    out.push(
      fr
        ? "Aucune lecture de site pour ce scan : le rapport couvre la page nommée."
        : "No site reading for this scan: the report covers the named page."
    );
    out.push("");
  } else {
    out.push(
      fr
        ? "Une page découverte a été lue. Une page mesurée est passée au jeu de contrôles. Pour chaque page, les contrôles non réussis sont détaillés ; les contrôles réussis sont comptés."
        : "A discovered page was read. A measured page was run through the control set. For each page, controls that did not pass are detailed; passing controls are counted."
    );
    out.push("");
    site.pages.forEach((page, index) => {
      const counts = pageCounts(page);
      out.push(`### ${index + 1}. ${mdCode(pagePath(page.finalUrl))} — HTTP ${page.status}`, "");
      if (!page.measured) {
        out.push(
          `- ${fr ? "Non mesurée" : "Not measured"} : ${mdCell(page.error ?? (fr ? "raison inconnue" : "unknown reason"), 240)}`,
          ""
        );
        return;
      }
      out.push(
        `- ${fr ? "Contrôles" : "Controls"} : **${(page.findings ?? []).length}** — ${counts.pass} ${fr ? "réussis" : "passed"} · ${counts.warn} ${fr ? "avertissements" : "warnings"} · ${counts.fail} ${fr ? "échecs" : "failed"} · ${counts.skipped} ${fr ? "ignorés" : "skipped"}`
      );
      if (!page.findings) {
        out.push(
          `- ${fr ? "Le détail des contrôles n'a pas été enregistré pour cette page (scan antérieur)." : "The per-control detail was not stored for this page (older scan)."}`,
          ""
        );
        return;
      }
      const nonPass = page.findings.filter((f) => normStatus(f.status) !== "pass");
      if (nonPass.length === 0) {
        out.push(
          `- ${fr ? "Tous les contrôles mesurés sur cette page ont réussi." : "Every control measured on this page passed."}`,
          ""
        );
        return;
      }
      out.push(
        `| ${fr ? "Contrôle" : "Control"} | ${fr ? "Statut" : "Status"} | ${fr ? "Observé" : "Observed"} | ${fr ? "Ce qu'il établit" : "What it establishes"} |`
      );
      out.push("| --- | --- | --- | --- |");
      for (const f of nonPass) {
        const copy = controlFor(controls, f.module, f.id);
        out.push(
          `| ${f.id} — ${mdCell(copy?.title ?? f.id, 100)} | ${labelFor(f.status)} | ${mdCell(f.observed)} | ${mdCell(copy?.objective ?? f.why)} |`
        );
      }
      out.push("");
    });
  }

  out.push(...gapsSection(result, controls, fr, 8).md);

  out.push(`## 9. ${fr ? "Méthode et périmètre" : "Method and scope"}`);
  out.push("");
  out.push(
    fr
      ? "Cinq lectures indépendantes sur un seul moteur : WORLD (locales, RTL, formats), FLOW (parcours critiques), EXIT (exports et portabilité), FAIL (en-têtes de sécurité et défauts), CLEAN (qualité de l'interface). Le crawl lit les pages, puis chaque page répondue est mesurée à partir du document déjà lu : une requête par page, pas deux. Tout s'exécute sur la machine de l'opérateur ; rien n'est envoyé à un service tiers. Les contrôles ignorés sont nommés ; un contrôle non exécuté n'est jamais présenté comme réussi."
      : "Five independent readings on one engine: WORLD (locales, RTL, formats), FLOW (critical journeys), EXIT (exports and portability), FAIL (security headers and defects), CLEAN (interface quality). The crawl reads the pages, then every answered page is measured from the document already read: one request per page, not two. Everything runs on the operator's machine; nothing is sent to a third party. Skipped controls are named; a control that did not run is never presented as passed."
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

  const haystack = JSON.stringify({
    findings: result.findings,
    modules: result.modules ?? [],
    site: result.site,
  }).toLowerCase();
  const glossaryItems = GLOSSARY.filter((g) => haystack.includes(g.term.toLowerCase()));
  if (glossaryItems.length) {
    out.push(`## 10. ${fr ? "Glossaire" : "Glossary"}`, "");
    for (const g of glossaryItems) out.push(`- **${g.term}** — ${fr ? g.fr : g.en}`);
    out.push("");
  }
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
  const key = normStatus(status);
  const label = STATUS_LABELS[key]?.[fr ? "fr" : "en"] ?? status;
  const color = STATUS_COLORS[key] ?? "#6b7280";
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

function moduleName(module: string, fr: boolean): string {
  return MODULE_TITLES[module]?.[fr ? "fr" : "en"] ?? module;
}

function coverageCard(n: number, label: string): string {
  return (
    '<div class="card"><p class="card-n">' +
    n +
    '</p><p class="card-l">' +
    escapeHtml(label) +
    "</p></div>"
  );
}

function coverageSummaryHtml(coverage: ControlCoverage, fr: boolean): string {
  return (
    '<div class="cards">' +
    coverageCard(
      coverage.total,
      fr
        ? plural(coverage.total, "contrôle au catalogue", "contrôles au catalogue")
        : plural(coverage.total, "control in catalogue", "controls in catalogue")
    ) +
    coverageCard(
      coverage.executed,
      fr
        ? plural(coverage.executed, "exécuté avec un verdict", "exécutés avec un verdict")
        : plural(coverage.executed, "executed with a verdict", "executed with a verdict")
    ) +
    coverageCard(
      coverage.skipped,
      fr
        ? plural(coverage.skipped, "ignoré (raison donnée)", "ignorés (raison donnée)")
        : plural(coverage.skipped, "skipped (reason given)", "skipped (reason given)")
    ) +
    coverageCard(
      coverage.absent,
      fr
        ? plural(coverage.absent, "sans résultat", "sans résultat")
        : plural(coverage.absent, "no result", "no result")
    ) +
    "</div>"
  );
}

/** Every control in the catalogue, with the result this scan produced for it. */
function controlInventoryHtml(
  result: ScanResultLike,
  controls: Record<string, ControlCopy>,
  fr: boolean
): string {
  const coverage = controlCoverage(result, controls);
  if (coverage.total === 0) {
    return (
      '<p class="note">' +
      (fr
        ? "Le catalogue des contrôles n'a pas pu être chargé : les constats restent lisibles par leur identifiant, mais ce rapport ne peut pas nommer les contrôles absents."
        : "The control catalogue could not be loaded: findings remain readable by id, but this report cannot name the missing controls.") +
      "</p>"
    );
  }
  const intro =
    '<p class="note">' +
    (fr
      ? "Chaque contrôle du catalogue est listé ci-dessous, module par module, avec son statut dans ce scan, la mesure réellement observée et ce qu'il établit. Un contrôle sans résultat n'est pas un contrôle réussi : il est nommé comme non exécuté."
      : "Every control in the catalogue is listed below, module by module, with its status in this scan, the measurement actually observed and what it establishes. A control with no result is not a passing control: it is named as not run.") +
    "</p>";
  const groups = coverage.byModule
    .map((group) => {
      const rows = group.entries
        .map((entry) => {
          const copy = entry.copy;
          const finding = entry.finding;
          const chip =
            entry.status === "absent"
              ? `<span class="chip chip-absent">${fr ? "non exécuté" : "not run"}</span>`
              : statusChip(entry.status, fr);
          const observed = finding
            ? escapeHtml(finding.observed.slice(0, 190))
            : '<span class="muted">' +
              (fr ? "Aucun résultat dans ce scan." : "No result in this scan.") +
              "</span>";
          const method =
            fr && copy?.method
              ? `<br><span class="fix">Lit : ${escapeHtml(copy.method)}</span>`
              : "";
          return (
            '<tr><td><span class="mono">' +
            escapeHtml(entry.id) +
            "</span><br><b>" +
            escapeHtml(copy?.title ?? entry.id) +
            "</b></td><td>" +
            chip +
            "</td><td>" +
            observed +
            method +
            "</td><td>" +
            escapeHtml((copy?.objective ?? finding?.why ?? "").slice(0, 240)) +
            "</td></tr>"
          );
        })
        .join("");
      const line =
        group.executed +
        "/" +
        group.total +
        " " +
        (fr ? "exécutés" : "executed") +
        (group.skipped ? ` · ${group.skipped} ${fr ? "ignorés" : "skipped"}` : "") +
        (group.absent ? ` · ${group.absent} ${fr ? "sans résultat" : "no result"}` : "");
      return (
        "<h3>" +
        escapeHtml(moduleName(group.module, fr)) +
        ' <span class="count">' +
        line +
        "</span></h3><table><thead><tr><th>" +
        (fr ? "Contrôle" : "Control") +
        "</th><th>" +
        (fr ? "Statut" : "Status") +
        "</th><th>" +
        (fr ? "Résultat mesuré" : "Measured result") +
        "</th><th>" +
        (fr ? "Ce qu'il établit" : "What it establishes") +
        "</th></tr></thead><tbody>" +
        rows +
        "</tbody></table>"
      );
    })
    .join("");
  return intro + coverageSummaryHtml(coverage, fr) + groups;
}

/** The result of each discovered page, with the controls that did not pass. */
function pageDetailsHtml(
  result: ScanResultLike,
  controls: Record<string, ControlCopy>,
  fr: boolean
): string {
  const site = result.site;
  if (!site || site.pages.length === 0) return "";
  const blocks = site.pages
    .map((page, index) => {
      const counts = pageCounts(page);
      const findings = page.findings ?? [];
      const verdict =
        counts.fail > 0
          ? "fail"
          : counts.warn > 0
            ? "warn"
            : findings.length > 0
              ? "pass"
              : "not_measured";
      const state = !page.measured
        ? `<span class="chip chip-absent">${fr ? "non mesurée" : "not measured"}</span>`
        : page.findings === undefined
          ? `<span class="chip chip-absent">${fr ? "sans détail" : "no detail"}</span>`
          : statusChip(verdict, fr);
      const detailCount =
        page.findings === undefined
          ? fr
            ? "détail non enregistré"
            : "detail not stored"
          : [
              plural(findings.length, fr ? "contrôle" : "control", fr ? "contrôles" : "controls"),
              plural(counts.pass, fr ? "réussi" : "passed", fr ? "réussis" : "passed"),
              plural(
                counts.warn,
                fr ? "avertissement" : "warning",
                fr ? "avertissements" : "warnings"
              ),
              plural(counts.fail, fr ? "échec" : "failed", fr ? "échecs" : "failed"),
              plural(counts.skipped, fr ? "ignoré" : "skipped", fr ? "ignorés" : "skipped"),
            ].join(" · ");
      const header =
        "<h3>" +
        (index + 1) +
        '. <span class="mono">' +
        escapeHtml(pagePath(page.finalUrl)) +
        "</span> " +
        state +
        ' <span class="count">HTTP ' +
        page.status +
        " · " +
        detailCount +
        "</span></h3>";
      if (!page.measured) {
        return (
          '<div class="page-block">' +
          header +
          '<p class="f-row"><b>' +
          (fr ? "Raison" : "Reason") +
          "</b> " +
          escapeHtml(page.error ?? (fr ? "non mesurée" : "not measured")) +
          "</p></div>"
        );
      }
      if (!page.findings) {
        return (
          '<div class="page-block">' +
          header +
          '<p class="note">' +
          (fr
            ? "Le détail des contrôles n'a pas été enregistré pour cette page (scan antérieur)."
            : "The per-control detail was not stored for this page (older scan).") +
          "</p></div>"
        );
      }
      const nonPass = findings.filter((f) => normStatus(f.status) !== "pass");
      const rows = nonPass
        .map((f) => {
          const copy = controlFor(controls, f.module, f.id);
          return (
            '<tr><td><span class="mono">' +
            escapeHtml(f.id) +
            "</span></td><td>" +
            escapeHtml(copy?.title ?? f.id) +
            "</td><td>" +
            statusChip(f.status, fr) +
            "</td><td>" +
            escapeHtml(f.observed) +
            "</td><td>" +
            escapeHtml(copy?.objective ?? f.why) +
            "</td></tr>"
          );
        })
        .join("");
      const detail = rows
        ? "<table><thead><tr><th>" +
          (fr ? "Contrôle" : "Control") +
          "</th><th>" +
          (fr ? "Nom" : "Name") +
          "</th><th>" +
          (fr ? "Statut" : "Status") +
          "</th><th>" +
          (fr ? "Observé" : "Observed") +
          "</th><th>" +
          (fr ? "Ce qu'il établit" : "What it establishes") +
          "</th></tr></thead><tbody>" +
          rows +
          "</tbody></table>"
        : '<p class="note">' +
          (fr
            ? "Tous les contrôles mesurés sur cette page ont réussi."
            : "Every control measured on this page passed.") +
          "</p>";
      return `<div class="page-block">${header}${detail}</div>`;
    })
    .join("");
  return (
    '<p class="note">' +
    (fr
      ? "Une page découverte est une page lue. Une page mesurée est une page passée au jeu de contrôles. Le tableau ci-dessous donne, pour chacune, le nombre de contrôles exécutés et le détail de ceux qui n'ont pas réussi."
      : "A discovered page is a page read. A measured page is a page run through the control set. The table below gives, for each, the number of controls executed and the detail of those that did not pass.") +
    "</p>" +
    blocks
  );
}

/** "What could not be verified" — the report's honesty section. Absent controls,
 * skipped controls, unmeasured pages and missing site declarations each get a reason. */
function gapsSection(
  result: ScanResultLike,
  controls: Record<string, ControlCopy>,
  fr: boolean,
  section: number
): { html: string; md: string[] } {
  const coverage = controlCoverage(result, controls);
  const skipped = coverage.entries.filter(
    (entry) =>
      entry.finding !== undefined && ["skipped", "pending", "not_measured"].includes(entry.status)
  );
  const absent = coverage.entries.filter((entry) => entry.status === "absent");
  const unmeasured = result.site?.pages.filter((page) => !page.measured) ?? [];
  const siteSkipped = result.findings.filter(
    (finding) =>
      !["skipped", "pending", "not_measured"].includes(normStatus(finding.status)) &&
      (finding.observed ?? "").toLowerCase().includes("client-rendered")
  );
  const decl: string[] = [];
  if (result.site?.robots && !result.site.robots.found)
    decl.push(
      fr
        ? "robots.txt absent — les robots appliquent leur politique par défaut"
        : "robots.txt missing — robots apply their default policy"
    );
  if (result.site?.sitemap && !result.site.sitemap.found)
    decl.push(
      fr
        ? "sitemap absent — l'indexation des moteurs est plus lente"
        : "sitemap missing — search-engine indexing is slower"
    );
  if (result.site?.truncated)
    decl.push(
      fr
        ? "exploration tronquée (" +
            (result.site.truncatedBy ?? "budget") +
            ") — des pages au-delà du budget existent peut-être"
        : "crawl truncated (" +
            (result.site.truncatedBy ?? "budget") +
            ") — pages beyond the budget may exist"
    );
  const htmlParts: string[] = [];
  const mdParts: string[] = [];
  const pipe = `${String.fromCharCode(92)}|`;
  const mdCell = (value: string): string =>
    value.split("|").join(pipe).replace(/\n/g, " ").replace(/\r/g, " ").slice(0, 190);

  htmlParts.push(
    "<h2>" +
      section +
      ". " +
      (fr ? "Ce qui n'a pas pu être vérifié" : "What could not be verified") +
      "</h2>"
  );
  htmlParts.push(
    '<p class="note">' +
      (fr
        ? "Un rapport qui ne dit pas ce qu'il n'a pas mesuré n'est pas honnête. Chaque ligne ci-dessous est un angle mort de ce scan, avec sa raison : un contrôle du catalogue sans résultat, un contrôle ignoré, une page non mesurée."
        : "A report that hides what it did not measure is not honest. Each line below is this scan's blind spot, with its reason: a catalogue control with no result, a skipped control, an unmeasured page.") +
      "</p>"
  );
  mdParts.push(
    `## ${section}. ${fr ? "Ce qui n'a pas pu être vérifié" : "What could not be verified"}`,
    ""
  );
  mdParts.push(
    fr
      ? "> Un rapport qui ne dit pas ce qu'il n'a pas mesuré n'est pas honnête. Chaque ligne ci-dessous est un angle mort de ce scan, avec sa raison : un contrôle du catalogue sans résultat, un contrôle ignoré, une page non mesurée."
      : "> A report that hides what it did not measure is not honest. Each line below is this scan's blind spot, with its reason: a catalogue control with no result, a skipped control, an unmeasured page.",
    ""
  );

  if (coverage.total === 0) {
    htmlParts.push(
      '<p class="note">' +
        (fr
          ? "Catalogue indisponible : ce rapport ne peut pas nommer les contrôles absents."
          : "Catalogue unavailable: this report cannot name the absent controls.") +
        "</p>"
    );
    mdParts.push(
      fr
        ? "Catalogue indisponible : ce rapport ne peut pas nommer les contrôles absents."
        : "Catalogue unavailable: this report cannot name the absent controls.",
      ""
    );
  }

  if (absent.length) {
    htmlParts.push(
      "<h3>" +
        (fr ? "Contrôles au catalogue sans résultat" : "Catalogue controls with no result") +
        " (" +
        absent.length +
        ")</h3>"
    );
    htmlParts.push(
      '<p class="note">' +
        (fr
          ? "Ces contrôles existent dans le catalogue mais ce scan n'a produit aucun résultat pour eux. Ce n'est pas un échec et ce n'est pas une réussite : c'est une absence, à corriger en relançant le scan avec la version courante du moteur."
          : "These controls exist in the catalogue but this scan produced no result for them. This is neither a failure nor a pass: it is an absence, fixed by re-running the scan with the current engine.") +
        "</p>"
    );
    htmlParts.push(
      "<table><thead><tr><th>" +
        (fr ? "Contrôle" : "Control") +
        "</th><th>" +
        (fr ? "Ce qu'il établit" : "What it establishes") +
        "</th><th>" +
        (fr ? "Pourquoi il manque" : "Why it is missing") +
        "</th></tr></thead><tbody>" +
        absent
          .map((entry) => {
            const copy = entry.copy;
            return (
              '<tr><td><span class="mono">' +
              escapeHtml(`${entry.module} · ${entry.id}`) +
              "</span><br><b>" +
              escapeHtml(copy?.title ?? entry.id) +
              "</b></td><td>" +
              escapeHtml((copy?.objective ?? "").slice(0, 220)) +
              "</td><td>" +
              (fr ? "Aucun résultat dans ce scan." : "No result in this scan.") +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table>"
    );
    mdParts.push(
      "### " +
        (fr ? "Contrôles au catalogue sans résultat" : "Catalogue controls with no result") +
        " (" +
        absent.length +
        ")",
      ""
    );
    mdParts.push(
      "| " +
        (fr ? "Contrôle" : "Control") +
        " | " +
        (fr ? "Ce qu'il établit" : "What it establishes") +
        " | " +
        (fr ? "Pourquoi" : "Why") +
        " |",
      "| --- | --- | --- |"
    );
    for (const entry of absent) {
      mdParts.push(
        "| `" +
          entry.module +
          ":" +
          entry.id +
          "` — " +
          mdCell(entry.copy?.title ?? entry.id) +
          " | " +
          mdCell(entry.copy?.objective ?? "") +
          " | " +
          (fr ? "Aucun résultat dans ce scan." : "No result in this scan.") +
          " |"
      );
    }
    mdParts.push("");
  }

  if (skipped.length) {
    htmlParts.push(`<h3>${fr ? "Contrôles ignorés" : "Skipped controls"} (${skipped.length})</h3>`);
    htmlParts.push(
      "<table><thead><tr><th>" +
        (fr ? "Contrôle" : "Control") +
        "</th><th>" +
        (fr ? "Il aurait vérifié" : "It would have checked") +
        "</th><th>" +
        (fr ? "Pourquoi ce n'est pas fait" : "Why not") +
        "</th></tr></thead><tbody>" +
        skipped
          .map((entry) => {
            const finding = entry.finding;
            const copy = entry.copy;
            if (!finding) return "";
            return (
              '<tr><td><span class="mono">' +
              escapeHtml(entry.id) +
              "</span><br><b>" +
              escapeHtml(copy?.title ?? entry.id) +
              "</b></td><td>" +
              escapeHtml((copy?.objective ?? finding.why).slice(0, 220)) +
              "</td><td>" +
              escapeHtml(finding.observed.slice(0, 220)) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table>"
    );
    mdParts.push(`### ${fr ? "Contrôles ignorés" : "Skipped controls"} (${skipped.length})`, "");
    mdParts.push(
      "| " +
        (fr ? "Contrôle" : "Control") +
        " | " +
        (fr ? "Il aurait vérifié" : "It would have checked") +
        " | " +
        (fr ? "Pourquoi ce n'est pas fait" : "Why not") +
        " |",
      "| --- | --- | --- |"
    );
    for (const entry of skipped) {
      const finding = entry.finding;
      if (!finding) continue;
      mdParts.push(
        "| `" +
          entry.id +
          "`" +
          (entry.copy?.title ? ` — ${mdCell(entry.copy.title)}` : "") +
          " | " +
          mdCell(entry.copy?.objective ?? finding.why) +
          " | " +
          mdCell(finding.observed) +
          " |"
      );
    }
    mdParts.push("");
  }

  if (unmeasured.length) {
    htmlParts.push(
      "<h3>" +
        (fr ? "Pages non mesurées" : "Unmeasured pages") +
        " (" +
        unmeasured.length +
        ")</h3>"
    );
    htmlParts.push(
      "<table><thead><tr><th>" +
        (fr ? "Chemin" : "Path") +
        "</th><th>" +
        (fr ? "Raison" : "Reason") +
        "</th></tr></thead><tbody>" +
        unmeasured
          .map(
            (page) =>
              '<tr><td class="mono">' +
              escapeHtml(pagePath(page.finalUrl).slice(0, 80)) +
              "</td><td>" +
              escapeHtml(page.error ?? (fr ? "non mesurée" : "not measured")) +
              "</td></tr>"
          )
          .join("") +
        "</tbody></table>"
    );
    mdParts.push(
      `### ${fr ? "Pages non mesurées" : "Unmeasured pages"} (${unmeasured.length})`,
      ""
    );
    mdParts.push(`| ${fr ? "Chemin" : "Path"} | ${fr ? "Raison" : "Reason"} |`, "| --- | --- |");
    for (const page of unmeasured) {
      mdParts.push(
        "| `" +
          pagePath(page.finalUrl) +
          "` | " +
          mdCell(page.error ?? (fr ? "non mesurée" : "not measured")) +
          " |"
      );
    }
    mdParts.push("");
  }

  if (siteSkipped.length) {
    htmlParts.push(
      '<p class="note">' +
        (fr
          ? siteSkipped.length +
            " constat(s) portent sur des pages rendues par JavaScript : la mesure HTML seule ne peut pas les conclure. Utilisez le scan complet (navigateur) ou le CLI, qui exécute les pages."
          : siteSkipped.length +
            " finding(s) concern JavaScript-rendered pages: an HTML-only measurement cannot conclude them. Use the full browser scan or the CLI, which executes pages.") +
        "</p>"
    );
    mdParts.push(
      fr
        ? "> " +
            siteSkipped.length +
            " constat(s) portent sur des pages rendues par JavaScript : la mesure HTML seule ne peut pas les conclure. Utilisez le scan complet (navigateur) ou le CLI, qui exécute les pages."
        : "> " +
            siteSkipped.length +
            " finding(s) concern JavaScript-rendered pages: an HTML-only measurement cannot conclude them. Use the full browser scan or the CLI, which executes pages.",
      ""
    );
  }

  if (decl.length) {
    htmlParts.push(
      "<h3>" +
        (fr ? "Déclarations du site manquantes" : "Missing site declarations") +
        "</h3><ul>" +
        decl.map((item) => `<li>${escapeHtml(item)}</li>`).join("") +
        "</ul>"
    );
    mdParts.push(
      `### ${fr ? "Déclarations du site manquantes" : "Missing site declarations"}`,
      ...decl.map((item) => `- ${item}`),
      ""
    );
  }

  if (
    !skipped.length &&
    !absent.length &&
    !unmeasured.length &&
    !siteSkipped.length &&
    !decl.length
  ) {
    htmlParts.push(
      '<p class="note">' +
        (fr
          ? "Rien à signaler : tous les contrôles du catalogue ont produit un verdict et toutes les pages découvertes ont été mesurées."
          : "Nothing to report: every catalogue control produced a verdict and every discovered page was measured.") +
        "</p>"
    );
    mdParts.push(
      fr
        ? "Rien à signaler : tous les contrôles du catalogue ont produit un verdict et toutes les pages découvertes ont été mesurées."
        : "Nothing to report: every catalogue control produced a verdict and every discovered page was measured.",
      ""
    );
  }

  return { html: htmlParts.join("\n"), md: mdParts };
}

/** Glossary filtered to the terms this report actually uses. */
function glossaryFor(result: ScanResultLike, fr: boolean, section: number): string {
  const haystack = JSON.stringify({
    findings: result.findings,
    modules: result.modules ?? [],
    site: result.site,
  }).toLowerCase();
  const items = GLOSSARY.filter((g) => haystack.includes(g.term.toLowerCase()));
  if (items.length === 0) return "";
  return `<h2>${section}. ${fr ? "Glossaire" : "Glossary"}</h2><div class="glossary">${items
    .map((g) => `<p><b>${escapeHtml(g.term)}</b> — ${escapeHtml(fr ? g.fr : g.en)}</p>`)
    .join("")}</div>`;
}

function moduleNotesFor(result: ScanResultLike, fr: boolean): string {
  const title = (m: string): string => MODULE_TITLES[m]?.[fr ? "fr" : "en"] ?? m;
  return (result.modules ?? [])
    .map((m) => {
      const raw = MODULE_NOTES[m.module]?.[fr ? "fr" : "en"];
      if (!raw) return "";
      // The note starts with the module acronym, which the heading already gives.
      const acronym = `${m.module.toUpperCase()} `;
      const note = raw.startsWith(acronym) ? raw.slice(acronym.length) : raw;
      const ids = [
        ...new Set(result.findings.filter((f) => f.module === m.module).map((f) => f.id)),
      ];
      const typical = ids.length
        ? `<p class="f-tag">${fr ? "Contrôles de ce module dans ce rapport" : "Controls of this module in this report"} : ${escapeHtml(ids.join(" · "))}</p>`
        : "";
      return `<div class="module-note"><b>${escapeHtml(title(m.module))}</b>${escapeHtml(note)}${typical}</div>`;
    })
    .join("");
}

export function buildReportHtml(
  result: ScanResultLike,
  controls: Record<string, ControlCopy>,
  fr: boolean
): string {
  const t = (m: string) => MODULE_TITLES[m]?.[fr ? "fr" : "en"] ?? m;
  const labelFor = (key: string) => STATUS_LABELS[normStatus(key)]?.[fr ? "fr" : "en"] ?? key;
  const site = result.site;
  const pass = statusCount(result, "pass");
  const warn = statusCount(result, "warn");
  const fail = statusCount(result, "fail");
  const skipped = statusCount(result, "skipped");
  const score = overallScore(result);
  const coverage = controlCoverage(result, controls);

  const moduleRows = (result.modules ?? [])
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

  const stackedRows = (result.modules ?? [])
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

  const siteCoverageCards =
    coverage.total > 0
      ? `<div class="card"><p class="card-n">${coverage.executed}/${coverage.total}</p><p class="card-l">${fr ? "contrôles exécutés" : "controls executed"}</p></div>
      <div class="card"><p class="card-n">${coverage.absent}</p><p class="card-l">${fr ? plural(coverage.absent, "contrôle sans résultat", "contrôles sans résultat") : plural(coverage.absent, "control with no result", "controls with no result")}</p></div>`
      : `<div class="card"><p class="card-n">—</p><p class="card-l">${fr ? "catalogue indisponible" : "catalogue unavailable"}</p></div>`;

  const groups = new Map<string, ScanFinding[]>();
  for (const f of result.findings) {
    const list = groups.get(f.module);
    if (list) list.push(f);
    else groups.set(f.module, [f]);
  }
  const findingsTables = [...groups.entries()]
    .map(([module, findings]) => {
      const rows = findings
        .map((f) => {
          const copy = controlFor(controls, f.module, f.id);
          const title = copy?.title ? escapeHtml(copy.title) : escapeHtml(f.id);
          const lines = [
            `<p class="f-head"><span class="mono">${escapeHtml(f.id)}</span> ${title} ${statusChip(f.status, fr)}</p>`,
            `<p class="f-row"><b>${fr ? "Observé" : "Seen"}</b> ${escapeHtml(f.observed)}</p>`,
            copy?.objective
              ? `<p class="f-row"><b>${fr ? "Ce que ça veut dire" : "What it means"}</b> ${escapeHtml(copy.objective)}</p>`
              : f.why
                ? `<p class="f-row"><b>${fr ? "Ce que ça veut dire" : "What it means"}</b> ${escapeHtml(f.why)}</p>`
                : "",
            copy?.consequence
              ? `<p class="f-row"><b>${fr ? "Conséquence" : "Consequence"}</b> ${escapeHtml(copy.consequence)}</p>`
              : "",
            copy?.fix
              ? `<p class="f-row f-fix"><b>${fr ? "✎ Solution" : "✎ Fix"}</b> ${escapeHtml(copy.fix)}</p>`
              : "",
            copy?.fixes && copy.fixes.length > 0 && copy.fixes[0]
              ? `<p class="f-row"><b>${fr ? "Exemple de code" : "Code example"}</b></p><pre class="f-code">${escapeHtml(copy.fixes[0].code ?? "")}</pre><p class="f-tag">${escapeHtml(copy.fixes[0].stack ?? "")}</p>`
              : "",
            copy?.verify
              ? `<p class="f-row"><b>${fr ? "Comment vérifier" : "How to verify"}</b> ${escapeHtml(copy.verify)}</p>`
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
    ? `<table><thead><tr><th>#</th><th>${fr ? "Chemin" : "Path"}</th><th>HTTP</th><th>${fr ? "Mesure" : "Measured"}</th><th>${fr ? "Contrôles" : "Controls"}</th><th>${fr ? "Poids" : "Size"}</th><th>${fr ? "Prof." : "Depth"}</th></tr></thead><tbody>${site.pages
        .map((p, i) => {
          const counts = pageCounts(p);
          const parts = [
            counts.pass ? `<span style="color:${STATUS_COLORS.pass}">✓${counts.pass}</span>` : "",
            counts.warn ? `<span style="color:${STATUS_COLORS.warn}">⚠${counts.warn}</span>` : "",
            counts.fail ? `<span style="color:${STATUS_COLORS.fail}">✕${counts.fail}</span>` : "",
            counts.skipped
              ? `<span style="color:${STATUS_COLORS.skipped}">–${counts.skipped}</span>`
              : "",
          ].filter(Boolean);
          const measured = !p.measured
            ? statusChip("not_measured", fr)
            : p.findings === undefined
              ? `<span class="chip chip-absent">${fr ? "sans détail" : "no detail"}</span>`
              : statusChip(counts.fail > 0 ? "fail" : counts.warn > 0 ? "warn" : "pass", fr);
          const title = p.error
            ? `<br><span style="color:${STATUS_COLORS.fail}">⚠ ${escapeHtml(p.error.slice(0, 50))}</span>`
            : p.title
              ? `<br><span class="fix">${escapeHtml(p.title.slice(0, 60))}</span>`
              : "";
          return `<tr><td class="n">${i + 1}</td><td class="mono">${escapeHtml(pagePath(p.finalUrl).slice(0, 65))}${title}</td><td class="n">${p.status}</td><td>${measured}</td><td class="n">${parts.join(" · ") || "—"}</td><td class="n">${fmtKb(p.bytes)}</td><td class="n">${p.depth}</td></tr>`;
        })
        .join("")}</tbody></table>`
    : "";

  const siteSection = site
    ? `<h2>${fr ? "3. Structure du site" : "3. Site structure"}</h2>
    <div class="cards">
      <div class="card"><p class="card-n">${site.pages.length}</p><p class="card-l">${fr ? plural(site.pages.length, "page découverte", "pages découvertes") : plural(site.pages.length, "page discovered", "pages discovered")}</p></div>
      <div class="card"><p class="card-n">${site.pages.filter((p) => p.measured).length}</p><p class="card-l">${fr ? plural(site.pages.filter((p) => p.measured).length, "page mesurée", "pages mesurées") : plural(site.pages.filter((p) => p.measured).length, "page measured", "pages measured")}</p></div>
      ${siteCoverageCards}
      <div class="card"><p class="card-n">${site.requests}</p><p class="card-l">${fr ? plural(site.requests, "requête d'exploration", "requêtes d'exploration") : plural(site.requests, "crawl request", "crawl requests")}</p></div>
      <div class="card"><p class="card-n">${site.robots?.found ? "✓" : "—"}</p><p class="card-l">robots.txt</p></div>
      <div class="card"><p class="card-n">${site.sitemap?.found ? "✓" : "—"}</p><p class="card-l">sitemap</p></div>
      ${pageSlices.length ? `<div class="card donut-card">${donut(pageSlices as { label: string; n: number; color: string }[])}<p class="card-l">${fr ? "statuts HTTP" : "HTTP statuses"}</p></div>` : ""}
    </div>
    <p class="note">${fr ? "Une page découverte a été lue. Une page mesurée est passée au jeu de contrôles. La colonne Contrôles donne, pour chaque page, le nombre de réussites, d'avertissements, d'échecs et de contrôles ignorés." : "A discovered page was read. A measured page was run through the control set. The Controls column gives, for each page, the number of passes, warnings, failures and skipped controls."}</p>
    ${pagesTable}
    ${
      site.skipped.length
        ? `<h3>${fr ? "Pages ignorées" : "Skipped pages"}</h3><table><thead><tr><th>URL</th><th>${fr ? "Raison" : "Reason"}</th></tr></thead><tbody>${site.skipped
            .map(
              (sk) =>
                `<tr><td class="mono">${escapeHtml(sk.url.slice(0, 70))}</td><td>${escapeHtml(sk.reason)}</td></tr>`
            )
            .join("")}</tbody></table>`
        : ""
    }`
    : `<p class="note">${fr ? "Lecture du site non demandée pour ce scan : le rapport couvre la page nommée uniquement." : "Site reading was not requested for this scan: the report covers the named page only."}</p>`;

  const coverageCards =
    coverage.total > 0
      ? `<div class="cards">
      <div class="card"><p class="card-n">${coverage.executed}/${coverage.total}</p><p class="card-l">${fr ? "contrôles exécutés" : "controls executed"}</p></div>
      <div class="card"><p class="card-n" style="color:${STATUS_COLORS.skipped}">${coverage.skipped}</p><p class="card-l">${fr ? plural(coverage.skipped, "contrôle ignoré", "contrôles ignorés") : plural(coverage.skipped, "control skipped", "controls skipped")}</p></div>
      <div class="card"><p class="card-n" style="color:#6b7280">${coverage.absent}</p><p class="card-l">${fr ? plural(coverage.absent, "contrôle sans résultat", "contrôles sans résultat") : plural(coverage.absent, "control with no result", "controls with no result")}</p></div>
    </div>
    <p class="note">${fr ? "Les cartes Réussi / Avertissement / Échec / Ignoré comptent les constats de la page nommée et du site. Les trois suivantes comptent les contrôles uniques du catalogue, sur toutes les pages mesurées : un contrôle réussi sur une page et ignoré sur une autre est compté une fois, avec son pire verdict." : "The Pass / Warning / Fail / Skipped cards count findings from the named page and the site. The next three count unique catalogue controls across all measured pages: a control that passes on one page and is skipped on another is counted once, with its worst verdict."}</p>`
      : `<p class="note">${fr ? "Catalogue indisponible : ce rapport ne peut pas confirmer quels contrôles ont été exécutés." : "Catalogue unavailable: this report cannot confirm which controls ran."}</p>`;
  const scoreCards = `<div class="cards">
      <div class="card card-hero"><p class="card-n big">${score !== null ? score : "—"}</p><p class="card-l">score /100</p></div>
      <div class="card"><p class="card-n" style="color:${STATUS_COLORS.pass}">${pass}</p><p class="card-l">${labelFor("pass")}</p></div>
      <div class="card"><p class="card-n" style="color:${STATUS_COLORS.warn}">${warn}</p><p class="card-l">${labelFor("warn")}</p></div>
      <div class="card"><p class="card-n" style="color:${STATUS_COLORS.fail}">${fail}</p><p class="card-l">${labelFor("fail")}</p></div>
      <div class="card"><p class="card-n" style="color:${STATUS_COLORS.skipped}">${skipped}</p><p class="card-l">${labelFor("skipped")}</p></div>
    </div>${coverageCards}`;

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
  .chip-absent { color: #6b7280; border-color: #6b728055; background: #6b728014; }
  .muted { color: #8a9299; }
  .page-block { border-top: 1px solid #e3e6e4; padding-top: 12px; margin-top: 16px; }
  .page-block h3 { margin-top: 0; }
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
    ${fr ? "Constats" : "Findings"} : ${result.findings.length} — ${pass} ${labelFor("pass").toLowerCase()} · ${warn} ${labelFor("warn").toLowerCase()} · ${fail} ${labelFor("fail").toLowerCase()} · ${skipped} ${labelFor("skipped").toLowerCase()}</p>
  </div>

  <h2>${fr ? "1. Synthèse" : "1. Summary"}</h2>
  ${scoreCards}

  <h2>${fr ? "2. Verdict par module" : "2. Verdict by module"}</h2>
  <table><thead><tr><th>${fr ? "Module" : "Module"}</th><th>${labelFor("pass")}</th><th>${labelFor("warn")}</th><th>${labelFor("fail")}</th><th>${labelFor("skipped")}</th><th>Score</th><th>${fr ? "Verdict" : "Verdict"}</th></tr></thead><tbody>${moduleRows}</tbody></table>
  <p class="note">${fr ? "Ces compteurs viennent du moteur : ce sont les cas exécutés par module, pas le nombre de lignes de constats. Le chapitre 5 donne le verdict de chaque contrôle du catalogue ; le chapitre 6 détaille les constats." : "These counters come from the engine: they are the cases executed per module, not the number of finding rows. Chapter 5 gives every catalogue control's verdict; chapter 6 details the findings."}</p>
  <h3>${fr ? "Répartition des constats" : "Findings distribution"}</h3>
  ${stackedRows}

  ${siteSection}

  <h2>${fr ? "4. Ce que mesure chaque module" : "4. What each module measures"}</h2>
  ${moduleNotesFor(result, fr)}

  <h2>${fr ? "5. Contrôles : ce qui a été vérifié" : "5. Controls: what was checked"}</h2>
  ${controlInventoryHtml(result, controls, fr)}

  <h2>${fr ? "6. Constats par module" : "6. Findings by module"}</h2>
  <p class="note">${fr ? "Ces constats sont ceux de la page nommée et du site. Les constats de chaque page découverte sont au chapitre 7." : "These are the findings from the named page and the site. Each discovered page's findings are in chapter 7."}</p>
  ${findingsTables || `<p class="note">${fr ? "Aucun constat enregistré." : "No findings recorded."}</p>`}

  <h2>${fr ? "7. Résultats page par page" : "7. Page-by-page results"}</h2>
  ${site ? pageDetailsHtml(result, controls, fr) : `<p class="note">${fr ? "Aucune lecture de site pour ce scan : le rapport couvre la page nommée." : "No site reading for this scan: the report covers the named page."}</p>`}

  ${gapsSection(result, controls, fr, 8).html}
  ${glossaryFor(result, fr, 9)}

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
  // The complete document is downloaded first: a print dialog is not a deliverable,
  // and a blocked popup used to leave the visitor with nothing at all.
  downloadText(`${reportFileStem(result)}-full.html`, html, "text/html;charset=utf-8");
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
