import {
  EXPERIENCE_LEVEL_LABELS,
  EXPERIENCE_LEVELS,
  type ExperienceLevel,
  ONBOARDING_GOAL_LABELS,
  ONBOARDING_GOALS,
  type OnboardingGoal,
  PROJECT_TYPE_LABELS,
  PROJECT_TYPES,
  type ProjectType,
} from "@proofcore/core";
import { ArrowRight, Check, Compass, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Card, ErrorState, Loading } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { useSession } from "../../lib/session.js";

/**
 * Getting started, for both audiences.
 *
 * Four questions, and each answer has a consequence the person can see: the target type
 * changes what can be measured, the goal picks a profile from the shared registry, the
 * level decides how much interface is shown, the address is what will actually be
 * scanned. Nothing is invented here — the recommendation comes from the same registry the
 * engine runs, and when a target type has no page to analyse the page says so instead of
 * proposing a scan that would measure nothing.
 */

interface Recommendation {
  profile: {
    id: string;
    fr: { name: string; description: string };
    en: { name: string; description: string };
    modules: string[];
  } | null;
  modules: string[];
  reason: { fr: string; en: string };
}

interface Payload {
  onboarding: {
    experience: "simple" | "studio";
    projectType: ProjectType | null;
    goal: OnboardingGoal | null;
    level: ExperienceLevel | null;
    target: string | null;
    completed: boolean;
  };
  steps: string[];
  progress: { filled: number; total: number; next: string | null; complete: boolean };
  recommendation: Recommendation | null;
}

const STEPS = ["projectType", "goal", "level", "target"] as const;
type Step = (typeof STEPS)[number];

export function OnboardingPage() {
  const session = useSession();
  const { locale } = useI18n();
  const fr = locale === "fr";
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [step, setStep] = useState<Step>("projectType");
  const [busy, setBusy] = useState(false);
  const [experience, setExperience] = useState<"simple" | "studio">("simple");
  const [projectType, setProjectType] = useState<ProjectType | null>(null);
  const [goal, setGoal] = useState<OnboardingGoal | null>(null);
  const [level, setLevel] = useState<ExperienceLevel | null>(null);
  const [target, setTarget] = useState("");

  const load = useCallback(async () => {
    if (!session.workspaceId) return;
    setError(null);
    try {
      const body = await apiFetch<Payload>(
        `/api/v1/onboarding?workspaceId=${encodeURIComponent(session.workspaceId)}`
      );
      setData(body);
      setExperience(body.onboarding.experience);
      setProjectType(body.onboarding.projectType);
      setGoal(body.onboarding.goal);
      setLevel(body.onboarding.level);
      setTarget(body.onboarding.target ?? "");
      // Come back where the work stopped: the first unanswered question, or the last one
      // once everything is answered, so a returning visitor sees the recap and the next step.
      const pending = body.progress.next;
      setStep(
        pending && (STEPS as readonly string[]).includes(pending) ? (pending as Step) : "target"
      );
    } catch (caught) {
      setError(caught as ApiError);
    }
  }, [session.workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!session.workspaceId) return null;
      setBusy(true);
      setError(null);
      try {
        const body = await apiFetch<Payload>(
          `/api/v1/onboarding?workspaceId=${encodeURIComponent(session.workspaceId)}`,
          { method: "PUT", body: patch }
        );
        setData(body);
        if (typeof patch.experience === "string") {
          try {
            window.localStorage.setItem("proofcore.ui-mode.v1", patch.experience);
          } catch {
            // A blocked storage must not stop the save: the workspace holds the choice.
          }
        }
        return body;
      } catch (caught) {
        setError(caught as ApiError);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [session.workspaceId]
  );

  const progress = data?.progress;
  const index = STEPS.indexOf(step);
  const recommendation = data?.recommendation ?? null;
  const hasPage = projectType !== "api" && projectType !== "local";

  const canContinue = useMemo(() => {
    if (step === "projectType") return Boolean(projectType);
    if (step === "goal") return Boolean(goal);
    if (step === "level") return Boolean(level);
    return target.trim().length > 0;
  }, [goal, level, projectType, step, target]);

  const next = async () => {
    if (!canContinue) return;
    const patch =
      step === "projectType"
        ? { projectType }
        : step === "goal"
          ? { goal }
          : step === "level"
            ? { level }
            : { target: target.trim() };
    const body = await save(patch);
    if (!body) return;
    const at = STEPS.indexOf(step);
    if (at < STEPS.length - 1) setStep(STEPS[at + 1] as Step);
  };

  if (!session.workspaceId) return null;

  if (error && !data) {
    return <ErrorState error={error} onRetry={() => void load()} />;
  }
  if (!data) return <Loading label={fr ? "Lecture de l'espace…" : "Reading the workspace…"} />;

  return (
    <div className="app-page">
      <PageHeader
        eyebrow={fr ? "DÉMARRAGE / QUATRE QUESTIONS" : "GETTING STARTED / FOUR QUESTIONS"}
        title={fr ? "QUE DOIT PROUVER PROOFCORE ?" : "WHAT SHOULD PROOFCORE PROVE?"}
        description={
          fr
            ? "Réponds à quatre questions : elles décident de ce qui sera mesuré, et de ce qui ne peut pas l'être."
            : "Answer four questions: they decide what will be measured, and what cannot be."
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.68rem] uppercase tracking-wide text-muted">
              {fr ? "Étape" : "Step"} {index + 1} / {STEPS.length}
            </span>
            <span className="text-[0.68rem] text-muted">
              {fr ? "enregistré" : "saved"} {progress?.filled ?? 0}/
              {progress?.total ?? STEPS.length}
            </span>
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-ink transition-[width]"
              style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
            />
          </div>

          {step === "projectType" ? (
            <section className="mt-5">
              <h2 className="text-lg font-medium">
                {fr ? "Quel genre de projet est-ce ?" : "What kind of project is it?"}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {fr
                  ? "Ce choix change ce qui peut être mesuré : une API n'a pas de page, un projet local n'a pas d'adresse publique."
                  : "This changes what can be measured: an API has no page, a local project has no public address."}
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {PROJECT_TYPES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={projectType === value}
                    onClick={() => setProjectType(value)}
                    className={`rounded-md border p-3 text-left transition-colors ${
                      projectType === value
                        ? "border-ink bg-canvas"
                        : "border-line hover:border-ink/40"
                    }`}
                  >
                    <span className="block text-sm font-medium">
                      {PROJECT_TYPE_LABELS[value][fr ? "fr" : "en"]}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {PROJECT_TYPE_LABELS[value].hint[fr ? "fr" : "en"]}
                    </span>
                  </button>
                ))}
              </div>
              <fieldset className="mt-5">
                <legend className="text-sm font-medium">
                  {fr ? "Quelle interface veux-tu ?" : "Which interface do you want?"}
                </legend>
                <p className="mt-1 text-xs text-muted">
                  {fr
                    ? "Simple pose les questions et lance la mission. Studio ouvre la configuration, les modules et les preuves. Les données sont les mêmes."
                    : "Simple asks the questions and runs the mission. Studio opens configuration, modules and evidence. The data is the same."}
                </p>
                <div className="mt-2 flex gap-2">
                  {(["simple", "studio"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={experience === mode}
                      className={`app-btn app-btn-sm ${experience === mode ? "app-btn-primary" : ""}`}
                      onClick={() => {
                        setExperience(mode);
                        void save({ experience: mode });
                      }}
                    >
                      {mode === "simple" ? (fr ? "Simple" : "Simple") : "Studio"}
                    </button>
                  ))}
                </div>
              </fieldset>
            </section>
          ) : null}

          {step === "goal" ? (
            <section className="mt-5">
              <h2 className="text-lg font-medium">
                {fr ? "Qu'est-ce qui doit être vrai à la fin ?" : "What should be true at the end?"}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {fr
                  ? "L'objectif choisit le profil de contrôles, pas l'inverse."
                  : "The goal picks the control profile, not the other way around."}
              </p>
              <div className="mt-4 grid gap-2">
                {ONBOARDING_GOALS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={goal === value}
                    onClick={() => setGoal(value)}
                    className={`rounded-md border p-3 text-left transition-colors ${
                      goal === value ? "border-ink bg-canvas" : "border-line hover:border-ink/40"
                    }`}
                  >
                    <span className="block text-sm font-medium">
                      {ONBOARDING_GOAL_LABELS[value][fr ? "fr" : "en"]}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {ONBOARDING_GOAL_LABELS[value].question[fr ? "fr" : "en"]}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {step === "level" ? (
            <section className="mt-5">
              <h2 className="text-lg font-medium">
                {fr ? "Où en es-tu techniquement ?" : "Where are you technically?"}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {fr
                  ? "Cela décide du niveau de détail affiché, jamais de ce qui est mesuré."
                  : "This decides how much detail is shown, never what is measured."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {EXPERIENCE_LEVELS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={level === value}
                    onClick={() => setLevel(value)}
                    className={`app-btn app-btn-sm ${level === value ? "app-btn-primary" : ""}`}
                  >
                    {EXPERIENCE_LEVEL_LABELS[value][fr ? "fr" : "en"]}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {step === "target" ? (
            <section className="mt-5">
              <h2 className="text-lg font-medium">
                {hasPage
                  ? fr
                    ? "Quelle adresse doit être analysée ?"
                    : "Which address should be analysed?"
                  : fr
                    ? "Quelle cible locale ou quelle API ?"
                    : "Which local target or API?"}
              </h2>
              <label className="mt-3 block text-sm font-medium" htmlFor="onboarding-target">
                {hasPage ? (fr ? "Adresse du site" : "Site address") : fr ? "Cible" : "Target"}
              </label>
              <input
                id="onboarding-target"
                className="app-input mt-1 w-full"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder={
                  hasPage ? "https://votre-site.com" : "http://localhost:8787/api/health"
                }
                inputMode="url"
                autoComplete="url"
              />
              <p className="mt-2 text-xs text-muted">
                {hasPage
                  ? fr
                    ? "Une seule page est lue par le scan guidé. L'exploration de site et les parcours navigateur se lancent depuis Studio."
                    : "The guided scan reads a single page. Site exploration and browser journeys run from Studio."
                  : fr
                    ? "Ce type de cible n'a pas de page : les contrôles disponibles sont ceux du projet, pas ceux du scan guidé."
                    : "This target type has no page: the available checks are project checks, not the guided scan."}
              </p>
            </section>
          ) : null}

          {error ? <p className="mt-4 text-sm text-danger">{error.message}</p> : null}

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {index > 0 ? (
              <button
                type="button"
                className="app-btn app-btn-sm"
                onClick={() => setStep(STEPS[index - 1] as Step)}
              >
                {fr ? "Retour" : "Back"}
              </button>
            ) : null}
            {step !== "target" ? (
              <button
                type="button"
                className="app-btn app-btn-primary app-btn-sm"
                disabled={!canContinue || busy}
                onClick={() => void next()}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                {fr ? "Continuer" : "Continue"}
                <ArrowRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                className="app-btn app-btn-primary app-btn-sm"
                disabled={!canContinue || busy}
                onClick={() => void next()}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {fr ? "Terminer" : "Finish"}
              </button>
            )}
            <Link className="app-btn app-btn-sm ml-auto" to="/app">
              {fr ? "Plus tard" : "Later"}
            </Link>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-medium">
            {fr ? "CE QUI SERA MESURÉ" : "WHAT WILL BE MEASURED"}
          </h2>
          {recommendation?.profile ? (
            <>
              <p className="mt-2 text-lg font-medium">
                {recommendation.profile[fr ? "fr" : "en"].name}
              </p>
              <p className="mt-1 text-sm">{recommendation.profile[fr ? "fr" : "en"].description}</p>
              <p className="mt-1 text-sm text-muted">{recommendation.reason[fr ? "fr" : "en"]}</p>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {recommendation.modules.map((module) => (
                  <li
                    key={module}
                    className="rounded-sm border border-line px-1.5 py-0.5 text-[0.68rem] uppercase tracking-wide text-muted"
                  >
                    {module}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted">
                {fr
                  ? "Les modules sans navigateur disponible rendent SKIPPED, pas un résultat inventé. Le détail des contrôles vient du registre de capacités."
                  : "Modules without an available browser return SKIPPED, not an invented result. Control details come from the capability registry."}
              </p>
            </>
          ) : recommendation ? (
            // The registry answered, and its answer is "no page profile fits this target".
            // Saying so is the honest result; proposing a scan would measure nothing.
            <p className="mt-2 text-sm text-muted" role="status">
              {recommendation.reason[fr ? "fr" : "en"]}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">
              {fr
                ? "Réponds au type de projet et à l'objectif : le profil de contrôles apparaîtra ici, calculé par le registre partagé."
                : "Answer the project type and the goal: the control profile will appear here, computed by the shared registry."}
            </p>
          )}

          <details className="mt-5 border-t border-line pt-4 text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted">
              {fr
                ? "Voir à quoi ressemble un rapport (exemple fictif)"
                : "See what a report looks like (fictional example)"}
            </summary>
            <div className="mt-3 rounded-[var(--radius)] border border-dashed border-line p-3">
              <p className="text-[0.68rem] font-medium uppercase tracking-wide text-warning">
                {fr
                  ? "Données fictives · aucune analyse réelle"
                  : "Fictional data · no real analysis"}
              </p>
              <p className="mt-2 text-xs text-muted">
                {fr
                  ? "Exemple : boutique.example — 2 constats sur une page. Les chiffres ci-dessous sont inventés pour montrer la forme du rapport, pas votre site."
                  : "Example: shop.example — 2 findings on one page. The numbers below are invented to show the report shape, not your site."}
              </p>
              <ul className="mt-3 space-y-2 text-xs">
                <li>
                  <span className="font-medium text-danger">FAILED · FAIL / hsts</span>
                  <p className="text-muted">
                    {fr
                      ? "L’en-tête HSTS est absent. Preuve : observed « absent », attendu « max-age ≥ 31536000 »."
                      : "The HSTS header is missing. Evidence: observed “absent”, expected “max-age ≥ 31536000”."}
                  </p>
                </li>
                <li>
                  <span className="font-medium text-warning">WARNING · CLEAN / contrast</span>
                  <p className="text-muted">
                    {fr
                      ? "Un texte gris sur fond clair mesure 3,2:1. Correction proposée : utiliser la couleur ink-soft (≥ 4,5:1)."
                      : "Grey text on a light background measures 3.2:1. Suggested fix: use ink-soft (≥ 4.5:1)."}
                  </p>
                </li>
              </ul>
              <p className="mt-3 text-[0.68rem] text-muted">
                {fr
                  ? "Un rapport réel cite l’URL, la méthode, la valeur observée et l’identifiant de l’analyse."
                  : "A real report cites the URL, method, observed value and analysis id."}
              </p>
            </div>
          </details>

          {data.onboarding.completed ? (
            <div className="mt-5 border-t border-line pt-4">
              <p className="flex items-center gap-1.5 text-sm text-success">
                <Check size={14} />
                {fr ? "Démarrage enregistré" : "Getting started saved"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {hasPage ? (
                  <Link
                    className="app-btn app-btn-primary app-btn-sm"
                    to={`/app/start?target=${encodeURIComponent(target.trim())}`}
                  >
                    {fr ? "Analyser cette adresse" : "Analyse this address"}
                  </Link>
                ) : null}
                <Link className="app-btn app-btn-sm" to="/app/analyses">
                  {fr ? "Voir les analyses" : "See analyses"}
                </Link>
              </div>
            </div>
          ) : (
            <p className="mt-5 flex items-center gap-1.5 border-t border-line pt-4 text-xs text-muted">
              <Compass size={13} />
              {fr
                ? "Tout est enregistré à chaque étape : rien à ressaisir si tu reviens plus tard."
                : "Every step is saved: nothing to retype if you come back later."}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
