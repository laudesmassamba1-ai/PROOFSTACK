/**
 * The export row on a scan result: PDF (the print document), Markdown (for the
 * repository or the ticket) and JSON (the machine truth). Every format is built
 * from the same stored result — no number is recomputed or invented.
 */
import { Download, FileJson, FileText, Printer } from "lucide-react";
import { useState } from "react";
import {
  buildReportJson,
  buildReportMarkdown,
  downloadText,
  openPrintReport,
  reportFileStem,
} from "../../lib/report-export.js";
import type { ControlCopy } from "../../pages/app/Scan.js";

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
  findings: { module: string; id: string; status: string; observed: string; why: string }[];
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
  site?: {
    pages: {
      url: string;
      finalUrl: string;
      status: number;
      title: string | null;
      bytes: number;
      durationMs: number;
      depth: number;
      measured: boolean;
      error: string | null;
    }[];
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
  };
  score?: { score: number; coverage: number; provisional: boolean };
}

export function ReportExport({
  scan,
  controls,
  fr,
}: {
  scan: ScanResultLike & { id?: string; projectId?: string | null };
  controls: Record<string, ControlCopy>;
  fr: boolean;
}) {
  const [done, setDone] = useState<string | null>(null);
  const stem = reportFileStem(scan);
  const flash = (what: string): void => {
    setDone(what);
    window.setTimeout(() => setDone(null), 2200);
  };

  return (
    <fieldset className="scan-export" aria-label={fr ? "Exporter le rapport" : "Export report"}>
      <button
        type="button"
        className="app-btn app-btn-ghost"
        onClick={() => {
          openPrintReport(scan, controls, fr);
          flash("pdf");
        }}
      >
        <Printer size={13} aria-hidden /> {fr ? "Rapport complet HTML" : "Full HTML report"}
      </button>
      <button
        type="button"
        className="app-btn app-btn-ghost"
        onClick={() => {
          downloadText(
            `${stem}.md`,
            buildReportMarkdown(scan, controls, fr),
            "text/markdown;charset=utf-8"
          );
          flash("md");
        }}
      >
        <FileText size={13} aria-hidden /> Markdown
      </button>
      <button
        type="button"
        className="app-btn app-btn-ghost"
        onClick={() => {
          downloadText(
            `${stem}.json`,
            buildReportJson(scan, controls),
            "application/json;charset=utf-8"
          );
          flash("json");
        }}
      >
        <FileJson size={13} aria-hidden /> JSON
      </button>
      <span className="scan-export-hint" aria-live="polite">
        {done ? (
          <>
            <Download size={12} aria-hidden />{" "}
            {done === "pdf"
              ? fr
                ? "rapport HTML téléchargé · Imprimer → PDF"
                : "HTML report downloaded · Print → PDF"
              : `${stem}.${done}`}
          </>
        ) : fr ? (
          "Rapport complet : synthèse, 5 modules, graphes, couleurs, tableaux, pages, constats, glossaire"
        ) : (
          "Full report: summary, 5 modules, charts, colors, tables, pages, findings, glossary"
        )}
      </span>
    </fieldset>
  );
}
