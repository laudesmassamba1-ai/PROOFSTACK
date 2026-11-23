import { ArrowRight, Info, Loader2, ScanLine } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import { Link } from "react-router";
import { Card, ErrorState } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { useSession } from "../../lib/session.js";

/**
 * The first run, for someone who has nothing set up.
 *
 * One field: the address of their site. No project, no token, no install. The scan runs
 * server-side and the result is read on this same screen — counts, the three findings that
 * cost the most, and the AI reading, which is requested automatically because asking
 * someone to click "interpret" after clicking "scan" is one click too many.
 *
 * The full report stays one link away: this screen answers "is my site okay?", it does not
 * replace the scan page where login, verification and history live.
 */

type ScanStatus = "PASS" | "WARN" | "FAIL" | "SKIPPED";

interface GuidedFinding {
  module: string;
  id: string;
  status: ScanStatus;
  observed: string;
  why: string;
}

interface GuidedModule {
  module: string;
  passed: number;
  warnings: number;
  failed: number;
  skipped: number;
  score: number;
  verdict: string;
}

interface ScanPreview {
  sharePercent: number;
  shownCount: number;
  totalCount: number;
  locked: { module: string; id: string }[];
}

interface GuidedScan {
  url: string;
  finalUrl: string;
  status: number;
  bytes: number;
  durationMs: number;
  findings: GuidedFinding[];
  /** Absent on a free analysis: module scores would reveal the withheld 40 %. */
  modules?: GuidedModule[];
  clientRendered: boolean;
}

const LABELS: Record<string, { fr: string; en: string }> = {
  fail: { fr: "Sécurité", en: "Security" },
  clean: { fr: "Interface", en: "Interface" },
  flow: { fr: "Parcours", en: "Journey" },
  world: { fr: "International", en: "Global" },
  exit: { fr: "Données", en: "Data" },
};

/** The facts the model reads. Same shape as the scan page, kept short on purpose. */
function report(scan: GuidedScan): string {
  return [
    `Scan de ${scan.finalUrl} (HTTP ${scan.status}, ${Math.round(scan.bytes / 1024)} kB, ${scan.durationMs} ms).`,
    "",
    "Résumé par famille :",
    ...(scan.modules ?? []).map(
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
  ].join("\n");
}

export function StartPage(): React.ReactElement {
  const session = useSession();
  const { locale } = useI18n();
  const fr = locale === "fr";
  const [url, setUrl] = useState("");
  const [scan, setScan] = useState<GuidedScan | null>(null);
  const [preview, setPreview] = useState<ScanPreview | null>(null);
  const [auditId, setAuditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  const interpret = useCallback(
    async (result: GuidedScan) => {
      if (!session.workspaceId) return;
      setExplaining(true);
      setExplainError(null);
      setExplanation(null);
      try {
        const body = await apiFetch<{ message: string }>("/api/v1/ai/chat", {
          method: "POST",
          body: {
            workspaceId: session.workspaceId,
            effort: "balanced",
            message: fr
              ? `Voici le résultat brut d'un scan PROOFCORE. Explique-le à quelqu'un qui n'est pas expert : quels sont les trois problèmes les plus coûteux, pourquoi ils comptent pour ce site précis, et dans quel ordre les corriger. Cite les constats par leur identifiant et dis clairement ce que le scan n'a pas pu mesurer.\n\n${report(result)}`
              : `Here is the raw result of a PROOFCORE scan. Explain it to someone who is not an expert: which three problems cost the most, why they matter for this site, and in what order to fix them. Cite findings by their id and state clearly what the scan could not measure.\n\n${report(result)}`,
          },
        });
        setExplanation(body.message);
      } catch (caught) {
        const apiError = caught as ApiError;
        setExplainError(
          apiError.code === "ai_not_configured"
            ? fr
              ? "Aucun fournisseur d'IA n'est connecté : les chiffres ci-dessus restent lisibles, mais la lecture détaillée demande une clé. Ajoute-la dans la page IA."
              : "No AI provider is connected: the numbers above still stand, but the detailed reading needs a key. Add it on the AI page."
            : apiError.message || (fr ? "L'IA n'a pas répondu." : "The AI did not answer.")
        );
      } finally {
        setExplaining(false);
      }
    },
    [session.workspaceId, fr]
  );

  const run = async () => {
    if (!session.workspaceId || busy) return;
    const target = url.trim();
    if (!/^https?:\/\/\S+/i.test(target)) {
      setError(
        new Error(
          fr
            ? "Une adresse http(s) complète est nécessaire, par exemple https://votre-site.com."
            : "A full http(s) address is needed, for example https://your-site.com."
        )
      );
      return;
    }
    setBusy(true);
    setError(null);
    setScan(null);
    setPreview(null);
    setAuditId(null);
    setExplanation(null);
    setExplainError(null);
    try {
      const body = await apiFetch<{
        audit: GuidedScan & { id: string };
        preview?: ScanPreview;
      }>("/api/v1/audits", {
        method: "POST",
        body: { workspaceId: session.workspaceId, url: target },
      });
      setScan(body.audit);
      setPreview(body.preview ?? null);
      setAuditId(body.audit.id);
      void interpret(body.audit);
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const failing = (scan?.findings ?? []).filter((item) => item.status === "FAIL");
  const warning = (scan?.findings ?? []).filter((item) => item.status === "WARN");

  return (
    <div className="app-page">
      <PageHeader
        eyebrow={fr ? "DÉMARRER / UNE ADRESSE" : "START / ONE ADDRESS"}
        title={fr ? "UNE ADRESSE. UN RÉSULTAT LISIBLE." : "ONE ADDRESS. A RESULT YOU CAN READ."}
        description={
          fr
            ? "Colle l'adresse de ton site. Aucun projet à créer, aucune commande à taper, rien à installer : le résultat arrive avec sa lecture."
            : "Paste your site's address. No project to create, no command to type, nothing to install: the result arrives with its reading."
        }
      />

      <Card className="scan-bar">
        <ScanLine size={17} aria-hidden className="scan-bar-icon" />
        <label className="sr-only" htmlFor="start-url">
          {fr ? "Adresse du site" : "Site address"}
        </label>
        <input
          id="start-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void run();
          }}
          placeholder="https://votre-site.com"
          className="app-input scan-input"
          spellCheck={false}
          autoComplete="url"
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
          {busy
            ? fr
              ? "Analyse en cours…"
              : "Scanning…"
            : fr
              ? "Voir le résultat"
              : "See the result"}
        </button>
      </Card>

      {error ? <ErrorState error={error} onRetry={() => void run()} /> : null}

      {busy ? (
        <p className="mt-4 text-xs text-muted">
          {fr
            ? "La page est lue côté serveur. Cela prend quelques secondes."
            : "The page is read server-side. This takes a few seconds."}
        </p>
      ) : null}

      {scan ? (
        <div className="mt-4 space-y-4">
          <Card
            title={`${scan.finalUrl.replace(/^https?:\/\//, "")}`}
            description={`HTTP ${scan.status} · ${Math.round(scan.bytes / 1024)} kB · ${scan.durationMs} ms`}
          >
            <div className="space-y-4 px-5 py-4">
              {preview ? (
                <div className="scan-paywall">
                  <p className="app-eyebrow">{fr ? "ANALYSE GRATUITE" : "FREE ANALYSIS"}</p>
                  <h2 className="scan-paywall-title">
                    {preview.shownCount} / {preview.totalCount}{" "}
                    {fr ? "tests visibles" : "tests visible"} — {preview.sharePercent} %
                  </h2>
                  <p className="scan-paywall-body">
                    {fr
                      ? "Les autres résultats n'ont jamais quitté le serveur. Un abonnement débloque l'analyse complète et toutes les fonctionnalités."
                      : "The other results never left the server. A subscription unlocks the full analysis and every feature."}
                  </p>
                  {preview.locked.length > 0 ? (
                    <details className="scan-paywall-locked">
                      <summary>
                        {preview.locked.length} {fr ? "tests restants" : "remaining tests"}
                      </summary>
                      <ul>
                        {preview.locked.slice(0, 40).map((item) => (
                          <li key={`${item.module}:${item.id}`}>
                            <code>{item.module.toUpperCase()}</code> {item.id}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  <Link to="/app/billing" className="app-btn app-btn-primary">
                    {fr ? "Voir les offres" : "See plans"} <ArrowRight size={14} />
                  </Link>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-5">
                {(scan.modules ?? []).map((item) => {
                  const label = LABELS[item.module];
                  return (
                    <div
                      key={item.module}
                      className="rounded-[var(--radius)] bg-surface-alt px-3 py-2"
                    >
                      <p className="app-eyebrow">
                        {item.module.toUpperCase()} ·{" "}
                        {label ? (fr ? label.fr : label.en) : item.module}
                      </p>
                      <p className="mt-1 text-xl font-semibold tabular-nums">
                        {item.verdict === "not_measured" ? "—" : item.score}
                      </p>
                      <p className="text-xs text-muted tabular-nums">
                        {item.verdict === "not_measured"
                          ? fr
                            ? "Non mesuré"
                            : "Not measured"
                          : `${item.failed} échec${item.failed === 1 ? "" : "s"} · ${item.warnings} avert.`}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-start gap-2 rounded-[var(--radius)] border border-black/10 bg-surface-alt px-3 py-2">
                <Info size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                <p className="text-xs leading-relaxed text-muted">
                  {scan.clientRendered
                    ? fr
                      ? "Cette page se construit dans le navigateur. Les contrôles de contenu et de mise en page sont marqués « non mesurés », pas réussis. Le rapport complet liste ce qui n'a pas pu être lu."
                      : "This page is built in the browser. Content and layout checks are marked “not measured”, not passed. The full report lists what could not be read."
                    : fr
                      ? "Le scan lit le HTML public, les en-têtes et les ressources visibles. Il ne se connecte pas, ne clique pas et ne teste pas un paiement réel."
                      : "The scan reads public HTML, headers and visible resources. It does not sign in, click, or test a real payment."}
                </p>
              </div>

              <p className="text-sm font-medium">
                {fr
                  ? `${failing.length} problème${failing.length === 1 ? "" : "s"} bloquant${failing.length === 1 ? "" : "s"}, ${warning.length} avertissement${warning.length === 1 ? "" : "s"}.`
                  : `${failing.length} blocking issue${failing.length === 1 ? "" : "s"}, ${warning.length} warning${warning.length === 1 ? "" : "s"}.`}
              </p>

              {failing.length > 0 ? (
                <ol className="space-y-1 text-sm">
                  {failing.slice(0, 3).map((item) => (
                    <li key={`${item.module}-${item.id}`}>
                      <span className="app-mono text-xs">{item.id}</span> — {item.why}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted">
                  {fr
                    ? "Rien de bloquant dans ce que le scan a pu mesurer."
                    : "Nothing blocking in what the scan could measure."}
                </p>
              )}
            </div>
          </Card>

          <Card
            title={fr ? "Ce que ça veut dire" : "What this means"}
            description={
              fr
                ? "Lecture automatique par l'IA à partir des constats ci-dessus."
                : "Read automatically by the AI from the findings above."
            }
          >
            <div className="space-y-3 px-5 py-4">
              {explaining ? (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                  {fr ? "Lecture en cours…" : "Reading…"}
                </p>
              ) : null}
              {explanation ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{explanation}</p>
              ) : null}
              {explainError ? (
                <div className="space-y-2 text-sm">
                  <p className="text-muted">{explainError}</p>
                  <Link to="/app/ai" className="app-btn">
                    {fr ? "Configurer l'IA" : "Set up the AI"} <ArrowRight size={13} />
                  </Link>
                </div>
              ) : null}
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            {auditId ? (
              <Link to={`/app/scan?audit=${auditId}`} className="app-btn">
                {fr ? "Voir le rapport complet" : "See the full report"} <ArrowRight size={13} />
              </Link>
            ) : null}
            <Link to="/app/projects" className="app-btn">
              {fr ? "Suivre ce site comme projet" : "Track this site as a project"}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
