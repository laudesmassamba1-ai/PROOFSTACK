import { ArrowRight, FolderPlus, Terminal } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Stack } from "../../components/app/CardStack.js";
import { FolderFloat } from "../../components/app/FolderFloat.js";
import { ModulePassRates, RunsTrend, SeverityBreakdown } from "../../components/app/Insights.js";
import { KpiCard } from "../../components/app/KpiCards.js";
import { Empty, ErrorState, Loading, StatusBadge } from "../../components/app/ui.js";
import { ModuleGlyph } from "../../components/brand/GlyphArt.js";
import { EnhancedCard } from "../../components/common/EnhancedCard.js";
import { useI18n } from "../../i18n/index.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { planLabel, severityLabel, usageLabel } from "../../lib/appLabels.js";
import { duration, formatDate, relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";
import { useTheme } from "../../lib/theme.js";

interface Insights {
  runsPerDay: { day: string; total: number; passed: number; failed: number }[];
  severityCounts: { severity: string; count: number }[];
  moduleTotals: {
    module: string;
    passed: number;
    failed: number;
    warnings: number;
    total: number;
  }[];
}

interface Overview {
  workspace: { id: string; name: string; myRole: string };
  projects: { id: string; name: string; baseUrl: string; enabledModules: string[] }[];
  recentRuns: {
    id: string;
    projectId: string;
    projectName: string;
    status: string;
    startedAt: string;
    durationMs: number;
    findingCount: number;
    totals: Record<
      string,
      {
        passed: number;
        failed: number;
        warnings: number;
        errors: number;
        skipped: number;
        total: number;
      }
    >;
  }[];
  modules: {
    module: string;
    status: string;
    passed: number;
    failed: number;
    warnings: number;
    errors: number;
    lastRunAt?: string;
  }[];
  recentFailures: {
    id: string;
    title: string;
    module: string;
    severity: string;
    detectedAt: string;
    projectId: string;
  }[];
  usage: {
    counters: { key: string; label: string; used: number; limit: number; counted: string }[];
  };
  subscription: {
    planKey: string;
    planName: string;
    entitled: boolean;
    state: string;
    reason: string | null;
    recurringSupported: boolean;
    renewalDueAt: string | null;
    currentPeriodEnd: string | null;
  };
}

type ModuleId = "world" | "flow" | "exit" | "fail" | "clean";
const MODULE_IDS: ModuleId[] = ["world", "flow", "exit", "fail", "clean"];

const MODULE_QUESTIONS: Record<ModuleId, { fr: string; en: string }> = {
  world: {
    fr: "Les données internationales passent-elles ?",
    en: "Does international data survive?",
  },
  flow: {
    fr: "Un utilisateur peut-il aller au bout ?",
    en: "Can a user complete the journey?",
  },
  exit: {
    fr: "Les données ressortent-elles intactes ?",
    en: "Does the data come back intact?",
  },
  fail: {
    fr: "Le site expose-t-il des failles ?",
    en: "Does the site expose weaknesses?",
  },
  clean: {
    fr: "L'interface est-elle structurée ?",
    en: "Is the interface structured?",
  },
};

const EMPTY_TOTALS = { passed: 0, failed: 0, warnings: 0, errors: 0, skipped: 0, total: 0 };

export function Overview() {
  const { workspaceId } = useSession();
  const { locale, t } = useI18n();
  const fr = locale === "fr";

  /* Sur téléphone, la main fait moins de la moitié d'un écran : le fan qui
     tourne les cartes déborde de la page. On remplace le fan par un deck
     vertical (recul vers le haut, aucune rotation) qui tient dans l'écran,
     et on resserre l'écart. Le clic déplie toujours les cinq questions. */
  const narrowDeck = typeof window !== "undefined" && window.innerWidth < 700;
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [data, setData] = useState<Overview | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    try {
      setData(await apiFetch<Overview>(`/api/v1/overview?workspaceId=${workspaceId}`));
      setInsights(await apiFetch<Insights>(`/api/v1/insights?workspaceId=${workspaceId}&days=14`));
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!workspaceId) {
    return (
      <Empty
        title={fr ? "Aucun espace de travail" : "No workspace yet"}
        body={fr ? "Créez un espace de travail pour commencer." : "Create a workspace to begin."}
        action={
          <Link to="/app/workspace" className="app-btn">
            {t("ws.overview.noWorkspace.action")}
          </Link>
        }
        tester={false}
      />
    );
  }
  if (error) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!data)
    return <Loading label={fr ? "Chargement de la situation…" : "Loading the situation…"} />;

  const latest = data.recentRuns[0];
  const failures = data.recentFailures.length;
  const hasProjects = data.projects.length > 0;
  const hasRuns = data.recentRuns.length > 0;

  const headline = !hasProjects
    ? t("ws.overview.noProject")
    : !hasRuns
      ? t("ws.overview.noRun")
      : failures > 0
        ? t("ws.overview.failures", { count: failures })
        : t("ws.overview.anomaly");

  const support = !hasProjects
    ? t("ws.overview.noProject.body")
    : !latest
      ? t("ws.overview.noRun.body", { project: data.projects[0]?.name ?? "The project" })
      : failures > 0
        ? t("ws.overview.failures.body", {
            project: latest.projectName,
            time: relativeTime(latest.startedAt),
          })
        : t("ws.overview.anomaly.body", { count: data.recentRuns.length });

  const firstFailure = data.recentFailures[0];
  const nextAction = !hasProjects
    ? { label: t("ws.overview.next.create"), to: "/app/projects", primary: true }
    : !hasRuns
      ? { label: t("ws.overview.next.scan"), to: "/app/start", primary: true }
      : failures > 0 && firstFailure
        ? {
            label: t("ws.overview.next.review"),
            to: `/app/modules/${firstFailure.module}`,
            primary: true,
          }
        : { label: t("ws.overview.next.run"), to: "/app/cli", primary: true };

  const runsCounter = data.usage.counters.find((counter) => counter.key === "monthly_test_runs");
  const quota = runsCounter?.limit ?? 0;
  const used = runsCounter?.used ?? 0;
  const percent = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;

  return (
    <div className="app-page app-overview">
      <EnhancedCard className="pk-enter" enable3d={undefined}>
        <section className="app-situation">
          <span className="dot-field" aria-hidden />
          <div className="app-situation-copy">
            <p className="app-eyebrow">
              {t("ws.overview.eyebrow")} / {data.workspace.name}
            </p>
            <h1 className="app-display app-situation-headline shiny-text">{headline}</h1>
            <p className="app-support">{support}</p>
            <Link to="/app/guide" className="app-text-link mt-3 inline-flex">
              {fr ? "Comprendre l'app en 2 minutes" : "Understand the app in 2 minutes"}{" "}
              <ArrowRight size={13} />
            </Link>
          </div>
          <aside
            className="app-situation-stamp"
            aria-label={fr ? "Faits réels du workspace" : "Real workspace facts"}
          >
            <p className="app-eyebrow">01 / {t("ws.overview.latest")}</p>
            <div className="app-stamp-facts">
              <div>
                <span className="app-stamp-value">{data.projects.length}</span>
                <span>{t("ws.overview.projects")}</span>
              </div>
              <div>
                <span className="app-stamp-value">{data.recentRuns.length}</span>
                <span>{t("ws.overview.runs.count")}</span>
              </div>
              <div>
                <span className={`app-stamp-value ${failures > 0 ? "is-danger" : ""}`}>
                  {failures}
                </span>
                <span>{t("ws.overview.failures.count")}</span>
              </div>
            </div>
            <p className="app-stamp-note">
              {latest
                ? `${latest.projectName} · ${relativeTime(latest.startedAt)}`
                : t("ws.overview.never")}
            </p>
            {hasProjects ? (
              /* The projects as a physical folder: open it and every project of
                 the workspace floats out as a pill; picking one lands on its
                 page. Click, not hover — the overview is a reading surface, the
                 cloud must not open while the eye passes over it. The physics
                 runs after the pills settle, and a reduced-motion user gets the
                 pills straight away, no world. */
              <div className="app-stamp-folder">
                <FolderFloat
                  items={data.projects.map((project) => ({
                    label: project.name,
                    value: project.id,
                  }))}
                  label={t("ws.overview.projects")}
                  sublabel={
                    data.projects.length === 1
                      ? fr
                        ? "1 projet"
                        : "1 project"
                      : fr
                        ? `${data.projects.length} projets`
                        : `${data.projects.length} projects`
                  }
                  trigger="click"
                  closeOnSelect
                  physics
                  drift={0.4}
                  onSelect={(projectId) => navigate(`/app/projects/${projectId}`)}
                  folderColor="var(--ink)"
                  frontColor="var(--ink)"
                  paperColor="var(--paper)"
                  itemColor="var(--surface)"
                  itemTextColor="var(--ink)"
                  labelColor="var(--paper)"
                  width={200}
                  height={132}
                  radius={12}
                  spread={typeof window !== "undefined" && window.innerWidth < 700 ? 120 : 180}
                  lift={24}
                />
              </div>
            ) : null}
          </aside>
        </section>
      </EnhancedCard>

      {/* The same four facts, but as a deck: the top card faces you, the three
          behind recede upward, and dragging (or a click) cycles them. All four
          stay visible — the deck spreads 0.35, so the numbers peek behind. */}
      <div className="app-kpi-stack" data-reveal>
        <Stack
          ariaLabel={
            fr
              ? "Faits du workspace — tirez la carte du dessus"
              : "Workspace facts — drag the top card"
          }
          layout="deck"
          visible={4}
          spread={0.35}
          depth={0.55}
          radius={14}
          speed={1.1}
          sendToBackOnClick
          cards={[
            <KpiCard
              key="projects"
              label={fr ? "Projets" : "Projects"}
              value={data.projects.length}
              tone="neutral"
              note={
                latest
                  ? `${latest.projectName} · ${relativeTime(latest.startedAt)}`
                  : fr
                    ? "Aucun projet suivi"
                    : "No tracked project"
              }
            />,
            <KpiCard
              key="checks"
              label={fr ? "Vérifications · 14 j" : "Checks · 14d"}
              value={
                insights ? insights.runsPerDay.reduce((total, day) => total + day.total, 0) : 0
              }
              tone="success"
              spark={insights?.runsPerDay.map((day) => day.total)}
              note={fr ? "Sur les quatorze derniers jours" : "Over the last fourteen days"}
            />,
            <KpiCard
              key="failures"
              label={fr ? "Constats ouverts" : "Open findings"}
              value={failures}
              tone={failures > 0 ? "danger" : "neutral"}
              note={
                firstFailure
                  ? `${firstFailure.module.toUpperCase()} · ${relativeTime(firstFailure.detectedAt)}`
                  : fr
                    ? "Aucun défaut ouvert"
                    : "No open defect"
              }
            />,
            <KpiCard
              key="quota"
              label={fr ? "Quota du plan" : "Plan quota"}
              value={percent}
              suffix="%"
              tone="cyan"
              meter={percent}
              note={
                quota === -1
                  ? fr
                    ? "Illimité ce mois-ci"
                    : "Unlimited this month"
                  : `${used} / ${quota} · ${data.subscription.planName}`
              }
            />,
          ]}
        />
      </div>

      {/* The beginner's first screen: four real doors, not a wall of statistics. It only
          appears while the workspace has no project, so it never hides real work. */}
      {!hasProjects ? (
        <section className="app-section" aria-labelledby="start-choices-title">
          <div className="app-section-head">
            <div>
              <p className="app-eyebrow">01 / {fr ? "PREMIER PAS" : "FIRST STEP"}</p>
              <h2 id="start-choices-title" className="app-section-title">
                {fr ? "Que souhaitez-vous faire aujourd'hui ?" : "What would you like to do today?"}
              </h2>
              <p className="app-support">
                {fr
                  ? "Choisissez une entrée. Tout se fait depuis cette page, sans commande ni fichier de configuration."
                  : "Pick an entry point. Everything happens here, with no command and no configuration file."}
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              to="/app/start"
              className="app-door app-door-cta"
              style={{ "--i": "0" } as React.CSSProperties}
            >
              <span className="app-eyebrow">01</span>
              <h3 className="mt-1 text-base font-semibold">
                {fr ? "Analyser mon site Internet" : "Analyse my website"}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {fr
                  ? "Une adresse suffit : sécurité, contenu, international. Le résultat arrive expliqué."
                  : "One address is enough: security, content, global readiness. The result comes explained."}
              </p>
              <span className="app-btn app-btn-primary mt-3 inline-flex">
                {fr ? "Analyser mon site" : "Analyse my site"} <ArrowRight size={13} />
              </span>
            </Link>
            <Link
              to="/app/projects"
              className="app-door"
              style={{ "--i": "1" } as React.CSSProperties}
            >
              <span className="app-eyebrow">02</span>
              <h3 className="mt-1 text-base font-semibold">
                {fr ? "Suivre une application" : "Track an application"}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {fr
                  ? "Créez un projet pour garder l'historique, les constats et les corrections. À utiliser quand vous voulez vérifier plusieurs fois."
                  : "Create a project to keep history, findings and fixes. Use it when you want to check repeatedly."}
              </p>
              <span className="app-text-link mt-3 inline-flex">
                {fr ? "Créer un projet" : "Create a project"} <ArrowRight size={13} />
              </span>
            </Link>
            <Link to="/app/cli" className="app-door" style={{ "--i": "2" } as React.CSSProperties}>
              <span className="app-eyebrow">03</span>
              <h3 className="mt-1 text-base font-semibold">
                {fr ? "Automatiser avec la CLI" : "Automate with the CLI"}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {fr
                  ? "Les mêmes contrôles sur votre machine ou dans la CI, avec un rapport téléversé seulement quand vous le décidez."
                  : "The same checks on your machine or in CI, with a report uploaded only when you decide."}
              </p>
              <span className="app-text-link mt-3 inline-flex">
                {fr ? "Ouvrir le guide CLI" : "Open the CLI guide"} <ArrowRight size={13} />
              </span>
            </Link>
            <Link
              to="/app/guide"
              className="app-door"
              style={{ "--i": "3" } as React.CSSProperties}
            >
              <span className="app-eyebrow">04</span>
              <h3 className="mt-1 text-base font-semibold">
                {fr ? "Comprendre les cinq contrôles" : "Understand the five checks"}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {fr
                  ? "Le guide explique chaque question, chaque statut et ce que l'app ne vérifie pas. Aucune donnée de démonstration n'est inventée."
                  : "The guide explains each question, each status and what the app does not check. No demonstration data is invented."}
              </p>
              <span className="app-text-link mt-3 inline-flex">
                {fr ? "Lire le guide" : "Read the guide"} <ArrowRight size={13} />
              </span>
            </Link>
          </div>
        </section>
      ) : null}

      {hasProjects ? (
        <section className="app-section" aria-labelledby="how-it-works-title">
          <div className="app-section-head">
            <div>
              <p className="app-eyebrow">{fr ? "MODE D'EMPLOI" : "HOW IT WORKS"}</p>
              <h2 id="how-it-works-title" className="app-section-title">
                {fr ? "Trois façons d'utiliser PROOFCORE." : "Three ways to use PROOFCORE."}
              </h2>
              <p className="app-support">
                {fr
                  ? "Un scan ne demande rien. Un projet garde l'historique. La CLI automatise les mêmes contrôles."
                  : "A scan needs nothing. A project keeps history. The CLI automates the same checks."}
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Link
              to="/app/start"
              className="rounded-[var(--radius)] border border-black/10 px-5 py-4 transition-colors hover:border-black/30"
            >
              <span className="app-eyebrow">01</span>
              <h3 className="mt-1 text-sm font-semibold">
                {fr ? "Analyser une adresse" : "Scan an address"}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {fr
                  ? "Pour un premier verdict immédiat, sans projet ni installation."
                  : "For an immediate first verdict, with no project or install."}
              </p>
              <span className="app-text-link mt-2 inline-flex">
                {fr ? "Ouvrir le scan" : "Open the scan"} <ArrowRight size={12} />
              </span>
            </Link>
            <Link
              to="/app/projects"
              className="rounded-[var(--radius)] border border-black/10 px-5 py-4 transition-colors hover:border-black/30"
            >
              <span className="app-eyebrow">02</span>
              <h3 className="mt-1 text-sm font-semibold">
                {fr ? "Suivre une application" : "Track an application"}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {fr
                  ? "Un projet garde les exécutions, les constats et les corrections dans le temps."
                  : "A project keeps runs, findings and fixes over time."}
              </p>
              <span className="app-text-link mt-2 inline-flex">
                {fr ? "Voir les projets" : "See projects"} <ArrowRight size={12} />
              </span>
            </Link>
            <Link
              to="/app/guide"
              className="rounded-[var(--radius)] border border-black/10 px-5 py-4 transition-colors hover:border-black/30"
            >
              <span className="app-eyebrow">03</span>
              <h3 className="mt-1 text-sm font-semibold">
                {fr ? "Comprendre les contrôles" : "Understand the checks"}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {fr
                  ? "La question derrière chaque module, les statuts et ce que l'app ne fait pas."
                  : "The question behind each module, the statuses and what the app does not do."}
              </p>
              <span className="app-text-link mt-2 inline-flex">
                {fr ? "Lire le guide" : "Read the guide"} <ArrowRight size={12} />
              </span>
            </Link>
          </div>
        </section>
      ) : null}

      <section className="app-section" data-reveal aria-labelledby="module-objects-title">
        <div className="app-section-head">
          <p className="app-eyebrow">02 / {t("ws.overview.modules")}</p>
          <h2 id="module-objects-title" className="app-section-title">
            {MODULE_IDS.map((module) => module.toUpperCase()).join(". ")}.
          </h2>
        </div>

        {/* The five questions as one fanned deck: the top card faces you, the
            four behind recede bottom-right, and a drag (or a flick) sends the
            top one to the back — the next question comes forward. A plain click
            still opens the module: the link survives, only the drag cycles. */}
        <div className="app-module-stack" data-reveal>
          <Stack
            ariaLabel={
              fr
                ? "Les cinq questions — cliquez la pile pour déplier"
                : "The five questions — click the pile to deal it out"
            }
            layout={narrowDeck ? "deck" : "fan"}
            visible={5}
            spread={narrowDeck ? 0.3 : 0.5}
            depth={narrowDeck ? 0.4 : 0.5}
            radius={20}
            threshold={90}
            expandable
            cards={MODULE_IDS.map((module, index) => {
              const latestModuleRun = data.recentRuns.find((run) => run.totals[module]);
              const totals = latestModuleRun?.totals[module] ?? EMPTY_TOTALS;
              const moduleRecord = data.modules.find((item) => item.module === module);
              const covered = moduleRecord?.lastRunAt ?? latestModuleRun?.startedAt;
              return (
                <Link
                  key={module}
                  to={`/app/modules/${module}`}
                  className={`app-object-card module-${module} app-object-card-${index + 1}`}
                >
                  <div className="app-object-card-head">
                    <span className="app-object-index">0{index + 1}</span>
                    {covered ? (
                      <StatusBadge status={moduleRecord?.status ?? latestModuleRun?.status ?? ""} />
                    ) : (
                      <span className="app-badge">{t("ws.status.notTested")}</span>
                    )}
                  </div>
                  <div className="app-object-stage">
                    <ModuleGlyph
                      kind={module as "world" | "flow" | "exit" | "fail" | "clean"}
                      tone={theme === "dark" ? "dark" : "ink"}
                    />
                  </div>
                  <div className="app-object-card-foot">
                    <h3 className="app-object-name">{module.toUpperCase()}</h3>
                    <p className="min-h-[2.7em] max-w-[30ch] text-[0.76rem] font-medium leading-[1.35] text-ink">
                      {fr ? MODULE_QUESTIONS[module].fr : MODULE_QUESTIONS[module].en}
                    </p>
                    <p className="app-object-state">
                      {covered
                        ? t("ws.module.latestSummary", {
                            passed: totals.passed,
                            failed: totals.failed,
                            skipped: totals.skipped,
                            warnings: totals.warnings,
                          })
                        : t("ws.module.latestNone")}
                    </p>
                    <span className="app-object-open">
                      {t("ws.overview.openModule")} <ArrowRight size={13} />
                    </span>
                  </div>
                </Link>
              );
            })}
          />
        </div>
      </section>

      {/* The trend panels are the page's most expensive real estate. Before the first
          run they would render three near-empty boxes of "…", half a viewport of paper
          that answers nothing — so the whole section waits for the data that gives it a
          reason to exist. */}
      {!hasRuns ? null : (
        <section className="app-section" data-reveal aria-labelledby="insights-title">
          <div className="app-section-head">
            <p className="app-eyebrow">03 / {fr ? "Évolution" : "Evolution"}</p>
            <h2 id="insights-title" className="app-section-title">
              {fr ? "14 derniers jours" : "Last 14 days"}
            </h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="app-workbench lg:col-span-2">
              <header className="app-workbench-head">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {fr ? "Vérifications par jour" : "Checks per day"}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-success/70" />
                    {fr ? "réussis" : "passed"}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-danger/80" />
                    {fr ? "échoués" : "failed"}
                  </span>
                </div>
              </header>
              {insights ? (
                <RunsTrend runs={insights.runsPerDay} locale={locale} />
              ) : (
                <p className="p-4 text-xs text-muted-foreground">…</p>
              )}
            </div>
            <div className="app-workbench">
              <header className="app-workbench-head">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {fr ? "Gravité des échecs" : "Failure severity"}
                  </p>
                </div>
              </header>
              <div className="p-4">
                {insights ? (
                  <SeverityBreakdown counts={insights.severityCounts} locale={locale} />
                ) : (
                  <p className="text-xs text-muted-foreground">…</p>
                )}
              </div>
            </div>
            <div className="app-workbench lg:col-span-3">
              <header className="app-workbench-head">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {fr ? "Taux de réussite par module" : "Pass rate per module"}
                  </p>
                </div>
              </header>
              <div className="p-4">
                {insights ? (
                  <ModulePassRates modules={insights.moduleTotals} />
                ) : (
                  <p className="text-xs text-muted-foreground">…</p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="app-next-action">
        <div>
          <p className="app-eyebrow">{t("ws.overview.next")}</p>
          <h2 className="app-next-title">{nextAction.label}</h2>
          <p className="app-next-body">
            {!hasProjects
              ? t("ws.overview.noProject.body")
              : !hasRuns
                ? t("ws.overview.runs.empty")
                : failures > 0
                  ? t("ws.overview.failures.empty")
                  : t("ws.overview.anomaly.body", { count: data.recentRuns.length })}
          </p>
          {!hasProjects ? (
            <ol className="app-onboard mt-5">
              {[
                t("ws.overview.onboard.step1"),
                t("ws.overview.onboard.step2"),
                t("ws.overview.onboard.step3"),
              ].map((step, index) => (
                <li key={step}>
                  <span className="app-onboard-index" aria-hidden>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
        <div className="app-next-actions">
          <Link
            to={nextAction.to}
            className={nextAction.primary ? "app-btn app-btn-mint" : "app-btn"}
          >
            {!hasProjects ? <FolderPlus size={14} /> : <Terminal size={14} />}
            {nextAction.label} <ArrowRight size={14} />
          </Link>
          <Link to={hasProjects ? "/app/projects" : "/app/cli"} className="app-btn app-btn-paper">
            {hasProjects ? t("ws.overview.allProjects") : t("ws.overview.next.cli")}
          </Link>
        </div>
      </section>

      <div className="app-overview-body">
        <section className="app-workbench" aria-labelledby="recent-runs-title">
          <header className="app-workbench-head">
            <div>
              <p className="app-eyebrow">04 / {t("ws.overview.runs")}</p>
              <h2 id="recent-runs-title" className="app-workbench-title">
                {t("ws.overview.runs")}
              </h2>
              <p>{t("ws.overview.runs.body")}</p>
            </div>
            <Link to="/app/projects" className="app-text-link">
              {t("ws.overview.allProjects")} <ArrowRight size={13} />
            </Link>
          </header>
          {!hasRuns ? (
            <Empty
              title={t("ws.overview.runs")}
              body={t("ws.overview.runs.empty")}
              tester="working"
              action={
                <Link to="/app/start" className="app-btn">
                  <Terminal size={14} /> {t("ws.overview.next.scan")}
                </Link>
              }
            />
          ) : (
            <div className="app-table-wrap">
              <table className="app-table app-runs-table">
                <thead>
                  <tr>
                    <th>{t("ws.module.project")}</th>
                    <th>{t("ws.module.status")}</th>
                    <th>{t("ws.module.started")}</th>
                    <th>{t("ws.module.duration")}</th>
                    <th>Findings</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentRuns.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <Link to={`/app/projects/${run.projectId}`} className="app-row-link">
                          {run.projectName}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="text-muted">{formatDate(run.startedAt)}</td>
                      <td className="text-muted">{duration(run.durationMs)}</td>
                      <td className="tabular-nums">{run.findingCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="app-overview-side">
          <section className="app-workbench app-failures-panel" aria-labelledby="failures-title">
            <header className="app-workbench-head">
              <div>
                <p className="app-eyebrow">05 / {t("ws.overview.failures.title")}</p>
                <h2 id="failures-title" className="app-workbench-title">
                  {t("ws.overview.failures.title")}
                </h2>
              </div>
              <span className="app-count-mark">{failures}</span>
            </header>
            {failures === 0 ? (
              /* The panel already carries its title; repeating it inside the empty state
                 made the panel say its own name twice. */
              <Empty title={null} body={t("ws.overview.failures.empty")} />
            ) : (
              <ul className="app-failure-list">
                {data.recentFailures.slice(0, 5).map((finding, findingIndex) => (
                  <li key={finding.id} style={{ "--i": findingIndex } as React.CSSProperties}>
                    <Link to={`/app/modules/${finding.module}`} className="app-failure-row">
                      <span className="app-failure-glyph" aria-hidden>
                        ×
                      </span>
                      <span className="min-w-0">
                        <span className="app-failure-title">{finding.title}</span>
                        <span className="app-failure-meta">
                          {finding.module.toUpperCase()} · {relativeTime(finding.detectedAt)}
                        </span>
                      </span>
                      <span className="app-badge app-badge-danger">
                        {severityLabel(finding.severity, fr)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="app-workbench app-usage-panel" aria-labelledby="usage-title">
            <header className="app-workbench-head">
              <div>
                <p className="app-eyebrow">06 / {t("ws.overview.usage")}</p>
                <h2 id="usage-title" className="app-workbench-title">
                  {planLabel(data.subscription.planKey, data.subscription.planName, fr)}
                </h2>
              </div>
              <span className="app-badge">
                {data.subscription.entitled ? t("ws.overview.plan") : t("ws.overview.free")}
              </span>
            </header>
            <div className="app-usage-body">
              <div className="app-usage-row">
                <span>
                  {runsCounter
                    ? usageLabel(runsCounter.key, runsCounter.label, fr)
                    : t("ws.overview.runs.count")}
                </span>
                <strong>{quota === -1 ? `${used}` : `${used} / ${quota}`}</strong>
              </div>
              <div className="app-meter" aria-hidden>
                <span style={{ width: `${quota === -1 ? 8 : percent}%` }} />
              </div>
              <p>
                {quota === -1
                  ? t("ws.overview.usage.unlimited")
                  : t("ws.overview.usage.left").replace("{n}", String(Math.max(0, quota - used)))}
              </p>
              {!data.subscription.entitled ? (
                <p className="app-usage-note">
                  {data.subscription.reason === "period_ended_awaiting_renewal"
                    ? t("ws.overview.usage.periodEnded").replace(
                        "{date}",
                        formatDate(data.subscription.currentPeriodEnd)
                      )
                    : t("ws.overview.usage.noSub")}{" "}
                  {t("ws.overview.usage.noSubNote")}
                </p>
              ) : null}
              <Link to="/app/billing" className="app-text-link">
                {data.subscription.entitled
                  ? t("ws.overview.usage.manage")
                  : t("ws.overview.usage.viewPlans")}{" "}
                <ArrowRight size={13} />
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
