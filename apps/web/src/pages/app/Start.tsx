import { ArrowRight, Info, Loader2, ScanLine } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ReportExport } from "../../components/app/ReportExport.js";
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
 *
 * The address is not the only thing worth analysing, though, and the five targets are not
 * equivalent. A page is one request; a site is a bounded crawl that costs the target requests
 * and is not part of the free analysis; a journey needs a browser runner; an API and a project
 * are run from the surfaces that own the repository or the contract. This screen says so
 * before the click instead of letting a single field imply that everything is the same.
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

/** The crawl section, only present when the site — not just the address — was read. */
interface ScanSite {
  pages: {
    url: string;
    status: number;
    depth: number;
    measured: boolean;
    error: string | null;
  }[];
  skipped: { url: string; reason: string }[];
  truncated: boolean;
  truncatedBy: "pages" | "depth" | "time" | "bytes" | null;
  requests: number;
}

interface GuidedScan {
  id?: string;
  url: string;
  finalUrl: string;
  status: number;
  bytes: number;
  durationMs: number;
  scannedAt?: string;
  findings: GuidedFinding[];
  /** Absent on a free analysis: module scores would reveal the withheld 40 %. */
  modules?: GuidedModule[];
  clientRendered: boolean;
  site?: ScanSite;
}

type TargetChoice = "page" | "site" | "journey" | "api" | "project";

/**
 * The five targets, with what each one really costs and where it runs.
 *
 * Only the first two execute here. The other three name the surface that owns them: a
 * journey needs a browser runner, an API needs a contract, a project needs a repository.
 * Showing them disabled would hide a real capability; showing them executable would be a lie.
 */
const TARGETS: {
  id: TargetChoice;
  fr: string;
  en: string;
  scopeFr: string;
  scopeEn: string;
  to?: string;
  ctaFr?: string;
  ctaEn?: string;
}[] = [
  {
    id: "page",
    fr: "Une page",
    en: "One page",
    scopeFr: "Une adresse, une requête. Inclus dans l'analyse gratuite.",
    scopeEn: "One address, one request. Part of the free analysis.",
  },
  {
    id: "site",
    fr: "Tout le site",
    en: "The whole site",
    scopeFr: "Pages suivies dans le périmètre, budget de pages, adresses non suivies listées.",
    scopeEn: "Pages followed in scope, a page budget, and every address left out is listed.",
  },
  {
    id: "journey",
    fr: "Un parcours",
    en: "A journey",
    scopeFr: "Exige un navigateur d'exécution : se construit et s'exécute dans FLOW.",
    scopeEn: "Needs a browser runner: built and executed in FLOW.",
    to: "/app/flow",
    ctaFr: "Ouvrir FLOW",
    ctaEn: "Open FLOW",
  },
  {
    id: "api",
    fr: "Une API",
    en: "An API",
    scopeFr: "Contrats et réponses : lancé depuis la CLI, l'IA ou l'API, puis visible ici.",
    scopeEn: "Contracts and responses: run from the CLI, the AI or the API, then seen here.",
    to: "/app/cli",
    ctaFr: "Voir la CLI",
    ctaEn: "See the CLI",
  },
  {
    id: "project",
    fr: "Un projet",
    en: "A project",
    scopeFr: "Contrôles sur le code et les fichiers autorisés, depuis un projet suivi.",
    scopeEn: "Controls over code and permitted files, from a tracked project.",
    to: "/app/projects",
    ctaFr: "Ouvrir les projets",
    ctaEn: "Open projects",
  },
];

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
    ...(scan.site
      ? [
          "",
          `Exploration de site : ${scan.site.pages.filter((page) => page.measured).length} page(s) examinée(s) sur ${scan.site.pages.length + scan.site.skipped.length} découverte(s), ${scan.site.requests} requête(s).`,
          ...(scan.site.skipped.length > 0
            ? [
                "Adresses non examinées (ne pas conclure à leur sujet) :",
                ...scan.site.skipped.slice(0, 20).map((page) => `- ${page.url} — ${page.reason}`),
              ]
            : []),
          scan.site.truncated
            ? `Exploration arrêtée par la limite : ${scan.site.truncatedBy ?? "budget"}.`
            : "",
        ]
      : []),
  ].join("\n");
}

export function StartPage(): React.ReactElement {
  const session = useSession();
  const { locale } = useI18n();
  const fr = locale === "fr";
  // The onboarding hands its answer over in the URL: the address someone typed once is
  // not typed again on the scan screen.
  const [search] = useSearchParams();
  const [url, setUrl] = useState(() => search.get("target") ?? "");
  const [choice, setChoice] = useState<TargetChoice>("page");
  /** A crawl asks the target for several pages: the budget is chosen, not guessed. */
  const [maxPages, setMaxPages] = useState(200);
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
    // The other three targets are opened where they run; a retry of a page error must not
    // quietly post a page scan after the person selected "a journey".
    if (choice !== "page" && choice !== "site") return;
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
        body:
          choice === "site"
            ? { workspaceId: session.workspaceId, url: target, crawl: { maxPages } }
            : { workspaceId: session.workspaceId, url: target },
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
          choice === "site"
            ? fr
              ? "Le site est exploré dans un périmètre borné, page par page. Ce qui n'a pas été lu est listé, jamais compté comme sain."
              : "The site is crawled within a bounded scope, page by page. What was not read is listed, never counted as healthy."
            : choice === "page"
              ? fr
                ? "Colle l'adresse de ton site. Aucun projet à créer, aucune commande à taper, rien à installer : le résultat arrive avec sa lecture."
                : "Paste your site's address. No project to create, no command to type, nothing to install: the result arrives with its reading."
              : fr
                ? "Cinq cibles, cinq périmètres. Ce que cette page ne peut pas exécuter est ouvert là où cela tourne réellement."
                : "Five targets, five scopes. What this page cannot run opens where it actually runs."
        }
      />

      <fieldset className="start-targets">
        <legend className="sr-only">
          {fr ? "Ce que tu veux analyser" : "What you want to analyse"}
        </legend>
        {TARGETS.map((item) => {
          const active = choice === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={active ? "start-target is-active" : "start-target"}
              aria-pressed={active}
              disabled={busy}
              onClick={() => setChoice(item.id)}
            >
              <span className="start-target-name">{fr ? item.fr : item.en}</span>
              <span className="start-target-scope">{fr ? item.scopeFr : item.scopeEn}</span>
            </button>
          );
        })}
      </fieldset>

      {choice === "page" || choice === "site" ? (
        <>
          <Card className="scan-bar">
            <ScanLine size={17} aria-hidden className="scan-bar-icon" />
            <label className="sr-only" htmlFor="start-url">
              {choice === "site"
                ? fr
                  ? "Adresse du site à explorer"
                  : "Site address to crawl"
                : fr
                  ? "Adresse du site"
                  : "Site address"}
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
                  ? choice === "site"
                    ? "Explorer le site"
                    : "Voir le résultat"
                  : choice === "site"
                    ? "Explore the site"
                    : "See the result"}
            </button>
          </Card>

          {choice === "site" ? (
            <div className="start-budget">
              <label htmlFor="start-max-pages" className="app-eyebrow">
                {fr ? "Budget de pages" : "Page budget"}
              </label>
              <input
                id="start-max-pages"
                type="number"
                min={1}
                max={200}
                value={maxPages}
                onChange={(event) =>
                  setMaxPages(Math.max(1, Math.min(200, Number(event.target.value) || 1)))
                }
                className="app-input start-budget-input"
              />
              <p className="start-budget-note">
                {fr
                  ? "L'exploration demande plusieurs pages à la cible : elle n'est pas couverte par l'analyse gratuite. Les adresses non suivies sont listées avec leur raison."
                  : "The crawl requests several pages from the target: it is not part of the free analysis. Addresses left out are listed with the reason."}
              </p>
            </div>
          ) : null}
        </>
      ) : (
        (() => {
          const item = TARGETS.find((entry) => entry.id === choice);
          return (
            <Card className="start-elsewhere">
              <p className="app-eyebrow">{fr ? item?.fr : item?.en}</p>
              <p className="start-elsewhere-scope">{fr ? item?.scopeFr : item?.scopeEn}</p>
              {item?.to ? (
                <Link to={item.to} className="app-btn app-btn-primary">
                  {fr ? item.ctaFr : item.ctaEn} <ArrowRight size={14} aria-hidden />
                </Link>
              ) : null}
            </Card>
          );
        })()
      )}

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
          {scan.site ? (
            <Card
              title={
                fr
                  ? "CE QUI A ÉTÉ LU — ET CE QUI NE L'A PAS ÉTÉ"
                  : "WHAT WAS READ — AND WHAT WASN'T"
              }
              description={
                fr
                  ? "Une page non suivie n'est pas une page saine : elle n'a simplement pas été mesurée."
                  : "A page left out is not a healthy page: it simply was not measured."
              }
            >
              <div className="space-y-3 px-5 py-4">
                <p className="text-sm tabular-nums">
                  {scan.site.pages.filter((page) => page.measured).length}{" "}
                  {fr ? "page(s) examinée(s) sur" : "page(s) examined of"}{" "}
                  {scan.site.pages.length + scan.site.skipped.length}{" "}
                  {fr ? "découverte(s)" : "discovered"} · {scan.site.requests}{" "}
                  {fr ? "requête(s)" : "request(s)"}
                </p>
                {scan.site.truncated ? (
                  <p className="start-site-truncated">
                    {fr
                      ? `Exploration arrêtée par le budget : ${scan.site.truncatedBy ?? "limite"}. Le résultat porte sur ces pages, pas sur le site entier.`
                      : `Crawl stopped by the budget: ${scan.site.truncatedBy ?? "limit"}. The result covers these pages, not the whole site.`}
                  </p>
                ) : null}
                <ul className="start-site-pages">
                  {scan.site.pages.slice(0, 20).map((page) => (
                    <li key={page.url}>
                      <code>{page.url.replace(/^https?:\/\//, "")}</code>
                      <span className="text-muted">
                        {" "}
                        · HTTP {page.status}
                        {page.measured ? "" : fr ? " · non mesurée" : " · not measured"}
                        {page.error ? ` — ${page.error}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                {scan.site.pages.length > 20 ? (
                  <p className="text-xs text-muted">
                    + {scan.site.pages.length - 20} {fr ? "autre(s)" : "more"}
                  </p>
                ) : null}
                {scan.site.skipped.length > 0 ? (
                  <details className="start-site-skipped">
                    <summary>
                      {scan.site.skipped.length}{" "}
                      {fr
                        ? "adresse(s) volontairement non suivie(s) — leur état est inconnu"
                        : "address(es) deliberately not followed — their state is unknown"}
                    </summary>
                    <ul>
                      {scan.site.skipped.slice(0, 30).map((page) => (
                        <li key={page.url}>
                          <code>{page.url.replace(/^https?:\/\//, "")}</code> —{" "}
                          <span className="text-muted">{page.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {auditId ? (
                  <Link to={`/app/scan?audit=${auditId}`} className="app-btn app-btn-ghost">
                    {fr ? "Ouvrir le rapport complet" : "Open the full report"}{" "}
                    <ArrowRight size={14} aria-hidden />
                  </Link>
                ) : null}
                {scan ? (
                  <ReportExport
                    scan={{
                      ...scan,
                      modules: scan.modules ?? [],
                      scannedAt: scan.scannedAt ?? new Date().toISOString(),
                      site: scan.site
                        ? {
                            ...scan.site,
                            pages: scan.site.pages.map((page) => ({
                              ...page,
                              finalUrl: page.url,
                              title: null,
                              bytes: 0,
                              durationMs: 0,
                            })),
                            robots: null,
                            sitemap: null,
                            durationMs: 0,
                            findings: [],
                          }
                        : undefined,
                    }}
                    controls={{}}
                    fr={fr}
                  />
                ) : null}
              </div>
            </Card>
          ) : null}
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
