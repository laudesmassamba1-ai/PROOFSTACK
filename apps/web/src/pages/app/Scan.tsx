import {
  AlertTriangle,
  ArrowRight,
  Check,
  Eye,
  Loader2,
  RefreshCw,
  ScanLine,
  Sparkles,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Card, ErrorState } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { useSession } from "../../lib/session.js";

/**
 * Scanning a URL from the app.
 *
 * The five families, on one address, without configuration. FLOW is a page-level reading of
 * the journey (does an entry point exist, does it answer, how would it be paid) — not the
 * engine's full checkout walk, and the findings say so.
 *
 * "Interpréter avec l'IA" sends the report to the account's own model: the findings are
 * facts, but what they *mean for this site* is a judgement, and that is what the AI is for.
 * It is the same chat endpoint the AI page uses, so there is one place where a key lives.
 */

type ScanStatus = "PASS" | "WARN" | "FAIL" | "SKIPPED";

interface ScanFinding {
  module: "fail" | "clean" | "flow" | "world" | "exit";
  id: string;
  status: ScanStatus;
  observed: string;
  why: string;
}

interface ScanModuleSummary {
  module: "fail" | "clean" | "flow" | "world" | "exit";
  passed: number;
  warnings: number;
  failed: number;
  skipped: number;
  score: number;
  verdict: "pass" | "warnings" | "fail" | "not_measured";
}

interface ScanResult {
  url: string;
  finalUrl: string;
  status: number;
  bytes: number;
  durationMs: number;
  scannedAt: string;
  findings: ScanFinding[];
  modules: ScanModuleSummary[];
  clientRendered: boolean;
}

interface AuditSummary {
  id: string;
  url: string;
  worstVerdict: string;
  failed: number;
  warnings: number;
  createdAt: string;
}

const MODULE_LABELS: Record<string, { fr: string; en: string }> = {
  fail: { fr: "Sécurité", en: "Security" },
  clean: { fr: "Interface", en: "Interface" },
  flow: { fr: "Parcours", en: "Journey" },
  world: { fr: "International", en: "Global" },
  exit: { fr: "Données", en: "Data" },
};

const STATUS_STYLE: Record<ScanStatus, string> = {
  PASS: "is-pass",
  WARN: "is-warn",
  FAIL: "is-fail",
  SKIPPED: "is-skip",
};

function statusIcon(status: ScanStatus) {
  if (status === "PASS") return <Check size={12} aria-hidden />;
  if (status === "WARN") return <AlertTriangle size={12} aria-hidden />;
  if (status === "FAIL") return <X size={12} aria-hidden />;
  return <Eye size={12} aria-hidden />;
}

export function ScanPage(): React.ReactElement {
  const { locale } = useI18n();
  const fr = locale === "fr";
  const session = useSession();
  const [url, setUrl] = useState("https://");
  const [cookie, setCookie] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [auditId, setAuditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [history, setHistory] = useState<AuditSummary[]>([]);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!session.workspaceId) return;
    try {
      const body = await apiFetch<{ items: AuditSummary[] }>(
        `/api/v1/audits?workspaceId=${session.workspaceId}&limit=10`
      );
      setHistory(body.items);
    } catch {
      // History is a convenience; a failure here must not block scanning.
    }
  }, [session.workspaceId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const run = async () => {
    if (!session.workspaceId || busy) return;
    const target = url.trim();
    if (!/^https?:\/\/\S+/i.test(target)) {
      setError(
        new Error(
          fr ? "Une adresse http(s) complète est nécessaire." : "A full http(s) address is needed."
        )
      );
      return;
    }
    setBusy(true);
    setError(null);
    setScan(null);
    setExplanation(null);
    setExplainError(null);
    try {
      const body = await apiFetch<{ audit: ScanResult & { id: string } }>("/api/v1/audits", {
        method: "POST",
        body: {
          workspaceId: session.workspaceId,
          url: target,
          ...(cookie.trim() ? { headers: { cookie: cookie.trim() } } : {}),
        },
      });
      setScan(body.audit);
      setAuditId(body.audit.id);
      await loadHistory();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const openPast = async (id: string) => {
    if (!session.workspaceId) return;
    setBusy(true);
    setError(null);
    setExplanation(null);
    try {
      const body = await apiFetch<{ id: string; result: ScanResult }>(
        `/api/v1/audits/${id}?workspaceId=${session.workspaceId}`
      );
      setScan(body.result);
      setAuditId(body.id);
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  /** The report the model reads: facts, counts, and what could not be measured. */
  const reportForModel = (): string => {
    if (!scan) return "";
    const lines = [
      `Scan de ${scan.finalUrl} (HTTP ${scan.status}, ${Math.round(scan.bytes / 1024)} kB, ${scan.durationMs} ms).`,
      "",
      "Résumé par famille :",
      ...scan.modules.map(
        (item) =>
          `- ${item.module.toUpperCase()}: ${item.verdict} — ${item.passed} pass, ${item.warnings} warn, ${item.failed} fail, ${item.skipped} skipped (score ${item.score}/100)`
      ),
      "",
      "Constats :",
      ...scan.findings.map(
        (item) =>
          `- [${item.module.toUpperCase()}][${item.status}] ${item.id}: ${item.observed} — ${item.why}`
      ),
      "",
      scan.clientRendered
        ? "Attention : la page est rendue côté client, donc les constats sur le contenu et la mise en page ne portent que sur le HTML initial."
        : "",
    ];
    return lines.join("\n");
  };

  const explain = async () => {
    if (!session.workspaceId || !scan || explaining) return;
    setExplaining(true);
    setExplainError(null);
    setExplanation(null);
    try {
      const body = await apiFetch<{ message: string }>("/api/v1/ai/chat", {
        method: "POST",
        body: {
          workspaceId: session.workspaceId,
          effort: "standard",
          message: fr
            ? `Voici le résultat brut d'un scan PROOFCORE. Interprète-le pour quelqu'un qui n'est pas expert : quels sont les trois problèmes les plus coûteux, pourquoi ils comptent pour ce site précis, et dans quel ordre les corriger. Sois concret, cite les constats par leur identifiant, et dis clairement ce que le scan n'a pas pu mesurer.\n\n${reportForModel()}`
            : `Here is the raw result of a PROOFCORE scan. Interpret it for someone who is not an expert: which three problems cost the most, why they matter for this site, and in what order to fix them. Be concrete, cite findings by their id, and state clearly what the scan could not measure.\n\n${reportForModel()}`,
        },
      });
      setExplanation(body.message);
    } catch (caught) {
      const apiError = caught as ApiError;
      setExplainError(
        apiError.code === "ai_not_configured"
          ? fr
            ? "Aucun fournisseur d'IA n'est connecté. Ajoute une clé dans la page IA, puis reviens ici."
            : "No AI provider is connected. Add a key on the AI page, then come back."
          : apiError.message || (fr ? "L'IA n'a pas répondu." : "The AI did not answer.")
      );
    } finally {
      setExplaining(false);
    }
  };

  const grouped = (module: string) =>
    (scan?.findings ?? []).filter((item) => item.module === module);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow={fr ? "SCAN / SANS CONFIGURATION" : "SCAN / NO SETUP"}
        title={fr ? "UNE ADRESSE, CINQ MODULES." : "ONE ADDRESS, FIVE MODULES."}
        description={
          fr
            ? "FAIL, CLEAN, FLOW, WORLD et EXIT sur une adresse, sans configuration. Pour tester localhost, lance la même chose depuis le CLI : proofcore scan http://localhost:3000"
            : "FAIL, CLEAN, FLOW, WORLD and EXIT on one address, with no setup. To test localhost, run the same thing from the CLI: proofcore scan http://localhost:3000"
        }
      />

      <Card className="scan-bar">
        <ScanLine size={17} aria-hidden className="scan-bar-icon" />
        <label className="sr-only" htmlFor="scan-url">
          {fr ? "Adresse à scanner" : "Address to scan"}
        </label>
        <input
          id="scan-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void run();
          }}
          placeholder="https://ton-site.com"
          className="app-input scan-input"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          className="app-btn app-btn-primary"
          onClick={() => void run()}
          disabled={busy}
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <ScanLine size={14} aria-hidden />
          )}
          {fr ? "Scanner" : "Scan"}
        </button>
        <button
          type="button"
          className="app-btn app-btn-sm"
          onClick={() => setShowAuth((value) => !value)}
          aria-expanded={showAuth}
        >
          {fr ? "Page protégée" : "Page behind a login"}
        </button>
      </Card>

      {showAuth ? (
        <Card className="scan-auth">
          <p className="scan-auth-hint">
            {fr
              ? "Colle l'en-tête Cookie de ton navigateur pour scanner une page derrière un login. Il sert à la requête, n'est pas stocké et n'apparaît pas dans l'historique."
              : "Paste your browser's Cookie header to scan a page behind a login. It is used for the request, not stored, and not shown in history."}
          </p>
          <label className="sr-only" htmlFor="scan-cookie">
            {fr ? "Cookie de session" : "Session cookie"}
          </label>
          <input
            id="scan-cookie"
            type="text"
            value={cookie}
            onChange={(event) => setCookie(event.target.value)}
            placeholder="session=…; other=…"
            className="app-input"
            spellCheck={false}
            autoComplete="off"
          />
        </Card>
      ) : null}

      {error ? <ErrorState error={error} onRetry={() => void run()} /> : null}

      {scan ? (
        <>
          <div className="scan-verdict-row">
            <div>
              <p className="app-eyebrow">{new URL(scan.finalUrl).host}</p>
              <p className="scan-meta">
                HTTP {scan.status} · {Math.round(scan.bytes / 1024)} kB · {scan.durationMs} ms ·{" "}
                {scan.findings.length} {fr ? "constats" : "findings"}
              </p>
            </div>
            <button
              type="button"
              className="app-btn app-btn-primary"
              onClick={() => void explain()}
              disabled={explaining}
            >
              {explaining ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : (
                <Sparkles size={13} aria-hidden />
              )}
              {fr ? "Interpréter avec l'IA" : "Interpret with AI"}
            </button>
          </div>

          {scan.clientRendered ? (
            <p className="scan-notice">
              <Eye size={13} aria-hidden />
              {fr
                ? "Cette page se dessine dans le navigateur : les constats sur le contenu ne portent que sur le HTML initial."
                : "This page draws itself in the browser: content findings only cover the initial HTML."}
            </p>
          ) : null}

          <div className="scan-modules">
            {scan.modules.map((item) => (
              <div key={item.module} className={`scan-module is-${item.verdict}`}>
                <span className="scan-module-name">{item.module.toUpperCase()}</span>
                <span className="scan-module-label">
                  {MODULE_LABELS[item.module]?.[fr ? "fr" : "en"]}
                </span>
                <span className="scan-module-score">
                  {item.verdict === "not_measured" ? "—" : `${item.score}`}
                </span>
                <span className="scan-module-counts">
                  {item.passed} · {item.warnings} · {item.failed} · {item.skipped}
                </span>
              </div>
            ))}
          </div>

          {explanation || explainError ? (
            <Card className="scan-ai">
              <p className="scan-ai-head">
                <Sparkles size={14} aria-hidden />
                {fr ? "Lecture de l'IA" : "AI reading"}
              </p>
              {explanation ? <p className="scan-ai-body">{explanation}</p> : null}
              {explainError ? (
                <p className="scan-ai-error">
                  {explainError}{" "}
                  {explainError.includes("clé") || explainError.includes("provider") ? (
                    <Link to="/app/ai" className="app-text-link">
                      {fr ? "Configurer l'IA" : "Set up the AI"}{" "}
                      <ArrowRight size={12} aria-hidden />
                    </Link>
                  ) : null}
                </p>
              ) : null}
            </Card>
          ) : null}

          {(["fail", "clean", "flow", "world", "exit"] as const).map((module) => {
            const items = grouped(module);
            if (items.length === 0) return null;
            return (
              <Card key={module} className="scan-findings">
                <p className="scan-findings-head">
                  {module.toUpperCase()} <span>{MODULE_LABELS[module]?.[fr ? "fr" : "en"]}</span>
                </p>
                <ul>
                  {items.map((item) => (
                    <li key={item.id} className={STATUS_STYLE[item.status]}>
                      <span className="scan-finding-status">
                        {statusIcon(item.status)}
                        {item.status}
                      </span>
                      <div className="scan-finding-body">
                        <p className="scan-finding-id">{item.id}</p>
                        <p className="scan-finding-observed">{item.observed}</p>
                        <p className="scan-finding-why">{item.why}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}

          {auditId ? (
            <p className="scan-saved">
              {fr ? "Scan enregistré dans l'espace de travail." : "Scan saved to the workspace."}
            </p>
          ) : null}
        </>
      ) : null}

      {history.length > 0 ? (
        <Card className="scan-history">
          <p className="scan-findings-head">
            {fr ? "Scans précédents" : "Previous scans"} <RefreshCw size={12} aria-hidden />
          </p>
          <ul>
            {history.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="scan-history-row"
                  onClick={() => void openPast(item.id)}
                >
                  <span className={`scan-history-dot is-${item.worstVerdict}`} aria-hidden />
                  <span className="scan-history-url">{item.url}</span>
                  <span className="scan-history-counts">
                    {item.failed} fail · {item.warnings} warn
                  </span>
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleDateString(fr ? "fr-FR" : "en-GB")}
                  </time>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
