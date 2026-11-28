import { ArrowRight, Download, Loader2, Play, ScanLine } from "lucide-react";
import { useCallback, useState } from "react";
import { Link } from "react-router";
import { Empty, ErrorState, StatusBadge } from "../../components/app/ui.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { downloadText } from "../../lib/report-export.js";
import { useSession } from "../../lib/session.js";

/**
 * Browser interaction, from the dashboard.
 *
 * The Worker runs the scenario through Cloudflare Browser Rendering: no local runner, no
 * browser to install, no separate service. This page sends a URL and renders only what
 * the engine observed. A failed action is a FAIL, a missing control is a SKIPPED, and an
 * interaction that changed nothing is a WARN — never a green result by default.
 */

interface ScenarioFinding {
  id: string;
  status: "PASS" | "WARN" | "FAIL" | "SKIPPED";
  observed: string;
  why: string;
  reproduce?: string;
}

interface ScenarioReport {
  scenarioId: string;
  name: string;
  url: string;
  findings: ScenarioFinding[];
  stepsRun: number;
  stepsSkipped: number;
  final: {
    url: string;
    title: string;
    headings: string[];
    elementCount: number;
    formCount: number;
  } | null;
  durationMs: number;
  unavailable?: boolean;
}

export function InteractPage() {
  const { workspaceId } = useSession();
  const { locale } = { locale: "fr" as const };
  const [url, setUrl] = useState("");
  const [report, setReport] = useState<ScenarioReport | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    if (!workspaceId || !url.trim()) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      setReport(
        await apiFetch<ScenarioReport>("/api/v1/browser/scenario", {
          method: "POST",
          body: { workspaceId, url: url.trim(), allowDestructive: false },
          timeoutMs: 120_000,
        })
      );
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  }, [workspaceId, url]);

  const fr = locale === "fr";

  return (
    <>
      <PageHeader
        title={fr ? "Interaction navigateur" : "Browser interaction"}
        description={
          fr
            ? "Le navigateur du serveur ouvre une application, clique, saisit et remonte les erreurs JavaScript et réseau réellement observées."
            : "The server's browser opens an application, clicks, types and reports JavaScript and network errors actually observed."
        }
        actions={
          <Link to="/app/guide" className="app-btn">
            {fr ? "Comprendre" : "Guide"}
          </Link>
        }
      />

      {!workspaceId ? (
        <Empty
          title={fr ? "Aucun espace de travail" : "No workspace"}
          body={
            fr
              ? "Choisissez un espace de travail pour lancer une interaction."
              : "Pick a workspace to run an interaction."
          }
        />
      ) : (
        <>
          <section className="app-card p-5">
            <label className="app-label" htmlFor="interact-url">
              {fr ? "Adresse de l'application" : "Application address"}
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                id="interact-url"
                className="app-input min-w-[260px] flex-1"
                type="url"
                inputMode="url"
                placeholder="https://mon-application.example"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void run();
                }}
              />
              <button
                type="button"
                className="app-btn app-btn-primary"
                disabled={busy || !url.trim()}
                onClick={() => void run()}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                {busy ? (fr ? "Exécution…" : "Running…") : fr ? "Lancer" : "Run"}
              </button>
            </div>
            <p className="mt-3 text-xs text-muted">
              {fr
                ? "Seules les actions déclarées sont exécutées. Aucun formulaire n'est soumis sans accord explicite."
                : "Only declared actions run. No form is submitted without an explicit opt-in."}
            </p>
          </section>

          {error ? (
            <div className="mt-4">
              <ErrorState error={error} onRetry={() => void run()} />
            </div>
          ) : null}

          {report ? (
            <section className="mt-5">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="text-base font-semibold">{report.name}</h2>
                <button
                  type="button"
                  className="app-btn app-btn-sm"
                  onClick={() => {
                    const stem = `proofcore-scenario-${report.scenarioId}`;
                    downloadText(
                      `${stem}.json`,
                      JSON.stringify(report, null, 2),
                      "application/json;charset=utf-8"
                    );
                    downloadText(
                      `${stem}.md`,
                      [
                        `# ${report.name}`,
                        "",
                        `- Scénario : ${report.scenarioId}`,
                        `- URL : ${report.url}`,
                        `- Étapes : ${report.stepsRun} exécutées, ${report.stepsSkipped} ignorées`,
                        `- Durée : ${report.durationMs} ms`,
                        ...(report.unavailable
                          ? ["- Navigateur indisponible : aucun parcours exécuté."]
                          : []),
                        "",
                        ...report.findings.flatMap((finding) => [
                          `## ${finding.status} — ${finding.id}`,
                          "",
                          finding.observed,
                          "",
                          finding.why,
                          ...(finding.reproduce ? ["", finding.reproduce] : []),
                          "",
                        ]),
                        ...(report.final
                          ? [
                              "## État final",
                              "",
                              `- URL : ${report.final.url}`,
                              `- Titre : ${report.final.title}`,
                              `- Titres : ${report.final.headings.join(" · ")}`,
                              `- Éléments : ${report.final.elementCount}`,
                              `- Formulaires : ${report.final.formCount}`,
                            ]
                          : []),
                      ].join("\n"),
                      "text/markdown;charset=utf-8"
                    );
                  }}
                  aria-label={
                    fr ? "Télécharger les résultats du scénario" : "Download the scenario results"
                  }
                >
                  <Download size={14} /> {fr ? "Télécharger" : "Download"}
                </button>
                <StatusBadge
                  status={
                    report.unavailable
                      ? "SKIPPED"
                      : report.findings.some((f) => f.status === "FAIL")
                        ? "FAILED"
                        : "COMPLETED"
                  }
                />
                <span className="text-xs text-muted">
                  {report.stepsRun} {fr ? "étapes" : "steps"} ·{" "}
                  {(report.durationMs / 1000).toFixed(1)}s
                </span>
              </div>

              {report.findings.length === 0 ? (
                <Empty
                  title={fr ? "Aucun constat" : "No findings"}
                  body={
                    fr
                      ? "Le scénario n'a produit aucune observation."
                      : "The scenario produced no observations."
                  }
                />
              ) : (
                <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
                  {report.findings.map((finding) => (
                    <li key={finding.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={finding.status} />
                        <code className="app-mono text-xs">{finding.id}</code>
                      </div>
                      <p className="mt-2 text-sm">{finding.observed}</p>
                      <p className="mt-1 text-xs text-muted">{finding.why}</p>
                      {finding.reproduce ? (
                        <p className="app-mono mt-1 text-[0.68rem] text-muted">
                          {finding.reproduce}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {report.final ? (
                <p className="mt-3 text-xs text-muted">
                  {fr ? "État final" : "Final state"}:{" "}
                  <code className="app-mono">{report.final.url}</code> · {report.final.elementCount}{" "}
                  {fr ? "éléments" : "elements"} · {report.final.formCount}{" "}
                  {fr ? "formulaires" : "forms"}
                </p>
              ) : null}
            </section>
          ) : (
            <div className="app-card mt-5 p-5">
              <ScanLine size={22} className="text-muted" />
              <p className="mt-3 text-sm font-medium">
                {fr ? "Aucune interaction lancée." : "No interaction run yet."}
              </p>
              <p className="mt-1 text-xs text-muted">
                {fr
                  ? "Entrez une adresse pour voir ce que le navigateur observe réellement."
                  : "Enter an address to see what the browser actually observes."}
              </p>
              <Link to="/app/guide" className="app-text-link mt-3 inline-flex text-xs">
                {fr ? "Comment ça marche" : "How it works"} <ArrowRight size={13} />
              </Link>
            </div>
          )}
        </>
      )}
    </>
  );
}
