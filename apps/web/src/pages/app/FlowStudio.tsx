import {
  FLOW_STEP_KINDS,
  type FlowStep,
  type FlowStepKind,
  validateFlowScenario,
} from "@proofcore/core";
import {
  ArrowDown,
  ArrowUp,
  Play,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Empty, ErrorState, Field, Loading } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch, clearApiCache } from "../../lib/api.js";
import { relativeTime } from "../../lib/format.js";
import { useSession } from "../../lib/session.js";

/**
 * FLOW Studio.
 *
 * A scenario is written here, validated by the same function the runner uses, saved as a
 * definition, and executed in a real browser when this deployment has one. The screen never
 * claims a journey was tested because a page loaded: the report lists the steps that ran,
 * the ones that were skipped, and the ones that failed with what the browser observed.
 *
 * Without a browser binding the run is refused with the CLI alternative. That is not a
 * degraded mode dressed as success; it is the limit of this deployment, stated where the
 * button is.
 */

interface Scenario {
  id: string;
  name: string;
  target: string;
  steps: FlowStep[];
  updatedAt: string;
  lastRunAt: string | null;
  lastReport: ScenarioReport | null;
}

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
  durationMs: number;
  final: { url: string; title: string } | null;
}

interface Draft {
  id: string | null;
  name: string;
  target: string;
  steps: FlowStep[];
}

const KIND_LABEL: Record<FlowStepKind, { fr: string; en: string }> = {
  navigate: { fr: "Ouvrir une adresse", en: "Open an address" },
  click: { fr: "Cliquer un contrôle", en: "Click a control" },
  type: { fr: "Remplir un champ", en: "Fill a field" },
  press: { fr: "Taper une touche", en: "Press a key" },
  scroll: { fr: "Défiler", en: "Scroll" },
  assert: { fr: "Vérifier un résultat", en: "Assert a result" },
};

function blankStep(kind: FlowStepKind, index: number): FlowStep {
  const id = `step-${index + 1}`;
  switch (kind) {
    case "click":
      return { id, kind, label: "Cliquer sur …", target: "" };
    case "type":
      return { id, kind, label: "Remplir …", target: "", value: "" };
    case "press":
      return { id, kind, label: "Taper Entrée", value: "Enter" };
    case "scroll":
      return { id, kind, label: "Défiler de 600 px", value: "600" };
    case "assert":
      return { id, kind, label: "La page contient …", expect: { textContains: "" } };
    default:
      return { id, kind, label: "Ouvrir la page", value: "" };
  }
}

function emptyDraft(): Draft {
  return {
    id: null,
    name: "",
    target: "",
    steps: [blankStep("navigate", 0), blankStep("assert", 1)],
  };
}

/**
 * The validator speaks one language (codes); the screen speaks the reader's. Translating
 * here rather than in the shared module keeps the codes usable by the API and the CLI.
 */
const ISSUE_TEXT: Record<string, { fr: string; en: string }> = {
  invalid_name: { fr: "Donne un nom au scénario.", en: "Give the scenario a name." },
  invalid_target: {
    fr: "L'adresse de départ doit être une adresse http(s) complète.",
    en: "The starting address must be a full http(s) address.",
  },
  empty_steps: {
    fr: "Un scénario a besoin d'au moins une étape.",
    en: "A scenario needs at least one step.",
  },
  too_many_steps: { fr: "20 étapes au maximum.", en: "20 steps at most." },
  unknown_kind: { fr: "Type d'étape inconnu.", en: "Unknown step kind." },
  missing_label: { fr: "Donne un libellé à l'étape.", en: "Give the step a label." },
  duplicate_id: { fr: "Deux étapes partagent le même identifiant.", en: "Two steps share an id." },
  missing_target: {
    fr: "Indique le texte visible du contrôle à cliquer.",
    en: "Name the visible text of the control to click.",
  },
  missing_value: {
    fr: "Une étape « ouvrir » a besoin d'une adresse complète.",
    en: "A navigate step needs a full address.",
  },
  invalid_key: {
    fr: "Un nom de touche est court : Enter, Tab, Escape.",
    en: "A key name is short.",
  },
  invalid_scroll: {
    fr: "Le défilement attend un nombre de pixels.",
    en: "Scroll expects a number of pixels.",
  },
  empty_expectation: {
    fr: "Une vérification sans attente ne peut pas échouer.",
    en: "An assertion without an expectation cannot fail.",
  },
};

function issueText(code: string, message: string, fr: boolean): string {
  return ISSUE_TEXT[code]?.[fr ? "fr" : "en"] ?? message;
}

const STATUS_TEXT: Record<string, { fr: string; en: string }> = {
  PASS: { fr: "conforme", en: "passed" },
  WARN: { fr: "vigilance", en: "warning" },
  FAIL: { fr: "échec", en: "failed" },
  SKIPPED: { fr: "non exécuté", en: "skipped" },
};

const TONE: Record<string, string> = {
  PASS: "app-badge app-badge-success",
  WARN: "app-badge app-badge-warning",
  FAIL: "app-badge app-badge-danger",
  SKIPPED: "app-badge",
};

export function FlowStudioPage() {
  const session = useSession();
  const { locale } = useI18n();
  const fr = locale === "fr";
  const workspaceId = session.workspaceId;

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [saved, setSaved] = useState<string>(JSON.stringify(emptyDraft()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<ApiError | Error | null>(null);
  const [report, setReport] = useState<{ report: ScenarioReport; analysisId: string } | null>(null);
  const [serverIssues, setServerIssues] = useState<
    { step?: number; code: string; message: string }[]
  >([]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const body = await apiFetch<{ scenarios: Scenario[] }>(
        `/api/v1/flow/scenarios?workspaceId=${workspaceId}`
      );
      setScenarios(body.scenarios);
    } catch (caught) {
      setError(caught as Error);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const validation = useMemo(() => validateFlowScenario(draft), [draft]);
  const dirty = JSON.stringify(draft) !== saved;

  /**
   * Open the first saved scenario once it arrives.
   *
   * Landing on an empty draft beside a saved scenario made the screen look as if the saved
   * steps had been lost. The draft is only replaced while it is untouched: a name typed
   * before the list loads must not be overwritten.
   */
  useEffect(() => {
    if (draft.id || dirty) return;
    const first = scenarios[0];
    if (first) select(first);
  }, [scenarios, draft.id, dirty]);

  function select(scenario: Scenario) {
    const next: Draft = {
      id: scenario.id,
      name: scenario.name,
      target: scenario.target,
      steps: scenario.steps,
    };
    setDraft(next);
    setSaved(JSON.stringify(next));
    setReport(
      scenario.lastReport && scenario.lastRunAt
        ? { report: scenario.lastReport, analysisId: "" }
        : null
    );
    setRunError(null);
    setServerIssues([]);
  }

  function create() {
    const next = emptyDraft();
    setDraft(next);
    setSaved(JSON.stringify(next));
    setReport(null);
    setRunError(null);
    setServerIssues([]);
  }

  function patchStep(index: number, change: Partial<FlowStep>) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, at) => (at === index ? { ...step, ...change } : step)),
    }));
  }

  function patchExpect(index: number, key: "urlContains" | "textContains", value: string) {
    patchStep(index, { expect: { ...draft.steps[index]?.expect, [key]: value } });
  }

  function move(index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target >= draft.steps.length) return;
    setDraft((current) => {
      const steps = [...current.steps];
      const [moved] = steps.splice(index, 1);
      if (moved) steps.splice(target, 0, moved);
      return { ...current, steps };
    });
  }

  function removeStep(index: number) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.filter((_, at) => at !== index),
    }));
  }

  function addStep(kind: FlowStepKind) {
    setDraft((current) => ({
      ...current,
      steps: [...current.steps, blankStep(kind, current.steps.length)],
    }));
  }

  async function save() {
    if (!workspaceId || saving) return;
    setSaving(true);
    setServerIssues([]);
    try {
      const path = draft.id ? `/api/v1/flow/scenarios/${draft.id}` : "/api/v1/flow/scenarios";
      const body = await apiFetch<{ scenario: Scenario }>(path, {
        method: draft.id ? "PATCH" : "POST",
        body: { workspaceId, name: draft.name, target: draft.target, steps: draft.steps },
      });
      const next: Draft = {
        id: body.scenario.id,
        name: body.scenario.name,
        target: body.scenario.target,
        steps: body.scenario.steps,
      };
      setDraft(next);
      setSaved(JSON.stringify(next));
      setScenarios((current) => {
        const others = current.filter((item) => item.id !== body.scenario.id);
        return [body.scenario, ...others];
      });
      clearApiCache();
    } catch (caught) {
      const api = caught as ApiError;
      const issues = (
        api.details as { issues?: { step?: number; code: string; message: string }[] } | undefined
      )?.issues;
      if (issues?.length) setServerIssues(issues);
      else setError(api);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft.id || !workspaceId) return;
    setSaving(true);
    try {
      await apiFetch(`/api/v1/flow/scenarios/${draft.id}?workspaceId=${workspaceId}`, {
        method: "DELETE",
      });
      setScenarios((current) => current.filter((item) => item.id !== draft.id));
      create();
      clearApiCache();
    } catch (caught) {
      setError(caught as Error);
    } finally {
      setSaving(false);
    }
  }

  async function run() {
    if (!draft.id || !workspaceId || running) return;
    setRunning(true);
    setRunError(null);
    setReport(null);
    try {
      const body = await apiFetch<{ report: ScenarioReport; analysisId: string }>(
        `/api/v1/flow/scenarios/${draft.id}/run`,
        { method: "POST", body: { workspaceId } }
      );
      setReport(body);
      clearApiCache();
      await load();
    } catch (caught) {
      setRunError(caught as Error);
    } finally {
      setRunning(false);
    }
  }

  if (!workspaceId) return <Loading label={fr ? "Espace de travail…" : "Workspace…"} />;

  return (
    <div className="app-page flow-studio">
      <PageHeader
        eyebrow="FLOW / STUDIO"
        title={fr ? "Un parcours se construit, puis s'exécute." : "A journey is built, then run."}
        description={
          fr
            ? "Chaque étape est une action réelle : ouvrir, cliquer, remplir, vérifier. Le serveur revalide ce que l'éditeur accepte, et un déploiement sans navigateur le dit au lieu de simuler un parcours."
            : "Each step is a real action: open, click, fill, assert. The server re-validates what the editor accepts, and a deployment without a browser says so instead of simulating a journey."
        }
      />

      <div className="flow-layout">
        <aside className="flow-list" aria-label={fr ? "Scénarios enregistrés" : "Saved scenarios"}>
          <div className="flow-list-head">
            <span className="app-eyebrow">{fr ? "Scénarios" : "Scenarios"}</span>
            <button type="button" className="app-btn app-btn-sm" onClick={create}>
              <Plus size={14} /> {fr ? "Nouveau" : "New"}
            </button>
          </div>
          {loading ? (
            <Loading label={fr ? "Chargement…" : "Loading…"} />
          ) : scenarios.length === 0 ? (
            <Empty
              title={fr ? "Aucun scénario enregistré" : "No saved scenario"}
              body={
                fr
                  ? "Écris un parcours ici : il survivra au rechargement et pourra être rejoué."
                  : "Write a journey here: it will survive a reload and can be re-run."
              }
              tester={false}
            />
          ) : (
            <ul className="flow-list-items">
              {scenarios.map((scenario) => (
                <li key={scenario.id}>
                  <button
                    type="button"
                    className={`flow-list-item ${draft.id === scenario.id ? "is-active" : ""}`}
                    aria-current={draft.id === scenario.id}
                    onClick={() => select(scenario)}
                  >
                    <span className="flow-list-name">{scenario.name}</span>
                    <span className="flow-list-meta">
                      {scenario.steps.length} {fr ? "étapes" : "steps"} ·{" "}
                      {scenario.lastRunAt
                        ? `${fr ? "dernière exécution" : "last run"} ${relativeTime(scenario.lastRunAt)}`
                        : fr
                          ? "jamais exécuté"
                          : "never run"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="flow-editor" aria-labelledby="flow-editor-title">
          <header className="flow-editor-head">
            <div>
              <p className="app-eyebrow">
                {draft.id
                  ? fr
                    ? "Scénario enregistré"
                    : "Saved scenario"
                  : fr
                    ? "Nouveau scénario"
                    : "New scenario"}
              </p>
              <h2 id="flow-editor-title" className="flow-editor-title">
                {draft.name || (fr ? "Sans titre" : "Untitled")}
              </h2>
              {dirty ? (
                <p className="flow-dirty">
                  {fr ? "Modifications non enregistrées" : "Unsaved changes"}
                </p>
              ) : null}
            </div>
            <div className="flow-editor-actions">
              {draft.id ? (
                <button
                  type="button"
                  className="app-btn app-btn-sm"
                  onClick={run}
                  disabled={running || dirty}
                  title={
                    dirty ? (fr ? "Enregistre avant d'exécuter" : "Save before running") : undefined
                  }
                >
                  {running ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                  {fr ? "Exécuter" : "Run"}
                </button>
              ) : null}
              <button
                type="button"
                className="app-btn app-btn-primary app-btn-sm"
                onClick={save}
                disabled={saving || !dirty}
              >
                {saving ? <RefreshCw size={14} className="animate-spin" /> : null}
                {fr ? "Enregistrer" : "Save"}
              </button>
              {draft.id ? (
                <button
                  type="button"
                  className="app-btn app-btn-sm"
                  onClick={remove}
                  disabled={saving}
                >
                  <Trash2 size={14} /> {fr ? "Supprimer" : "Delete"}
                </button>
              ) : null}
            </div>
          </header>

          {error ? <ErrorState error={error} onRetry={() => void load()} /> : null}

          <div className="flow-fields">
            <Field label={fr ? "Nom du scénario" : "Scenario name"} htmlFor="flow-name">
              <input
                id="flow-name"
                className="app-input"
                value={draft.name}
                maxLength={80}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder={fr ? "Parcours d'achat" : "Checkout journey"}
              />
            </Field>
            <Field
              label={fr ? "Adresse de départ" : "Starting address"}
              htmlFor="flow-target"
              hint={fr ? "http(s) uniquement." : "http(s) only."}
            >
              <input
                id="flow-target"
                className="app-input"
                inputMode="url"
                value={draft.target}
                onChange={(event) => setDraft({ ...draft, target: event.target.value })}
                placeholder="https://exemple.com"
              />
            </Field>
          </div>

          {serverIssues.length > 0 ? (
            <div className="flow-issues" role="alert">
              <p className="flow-issues-title">
                {fr ? "Le serveur a refusé ce scénario :" : "The server refused this scenario:"}
              </p>
              <ul>
                {serverIssues.map((issue, index) => (
                  <li key={`${issue.step ?? "s"}-${index}`}>
                    {issue.step !== undefined
                      ? `${fr ? "Étape" : "Step"} ${issue.step + 1} · `
                      : ""}
                    {issueText(issue.code, issue.message, fr)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <ol className="flow-steps">
            {draft.steps.map((step, index) => {
              const issues = validation.ok
                ? []
                : validation.issues.filter((issue) => issue.step === index);
              return (
                <li key={step.id} className="flow-step">
                  <fieldset>
                    <legend className="sr-only">
                      {fr ? "Étape" : "Step"} {index + 1}
                    </legend>
                    <header className="flow-step-head">
                      <span className="flow-step-index">{String(index + 1).padStart(2, "0")}</span>
                      <select
                        className="app-input flow-step-kind"
                        aria-label={fr ? `Type de l'étape ${index + 1}` : `Step ${index + 1} kind`}
                        value={step.kind}
                        onChange={(event) =>
                          patchStep(index, { kind: event.target.value as FlowStepKind })
                        }
                      >
                        {FLOW_STEP_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {KIND_LABEL[kind][fr ? "fr" : "en"]}
                          </option>
                        ))}
                      </select>
                      <div className="flow-step-tools">
                        <button
                          type="button"
                          className="app-btn app-btn-sm flow-icon"
                          aria-label={fr ? "Monter l'étape" : "Move step up"}
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          className="app-btn app-btn-sm flow-icon"
                          aria-label={fr ? "Descendre l'étape" : "Move step down"}
                          onClick={() => move(index, 1)}
                          disabled={index === draft.steps.length - 1}
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          type="button"
                          className="app-btn app-btn-sm flow-icon"
                          aria-label={fr ? "Supprimer l'étape" : "Delete step"}
                          onClick={() => removeStep(index)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </header>

                    <div className="flow-step-grid">
                      <Field label={fr ? "Libellé" : "Label"} htmlFor={`flow-step-${index}-label`}>
                        <input
                          id={`flow-step-${index}-label`}
                          className="app-input"
                          value={step.label}
                          maxLength={160}
                          onChange={(event) => patchStep(index, { label: event.target.value })}
                        />
                      </Field>

                      {step.kind === "click" || step.kind === "type" ? (
                        <Field
                          label={fr ? "Contrôle (texte visible)" : "Control (visible text)"}
                          htmlFor={`flow-step-${index}-target`}
                          hint={
                            fr
                              ? "Le runner clique sur le texte qu'il voit."
                              : "The runner clicks the text it sees."
                          }
                        >
                          <input
                            id={`flow-step-${index}-target`}
                            className="app-input"
                            value={step.target ?? ""}
                            maxLength={160}
                            onChange={(event) => patchStep(index, { target: event.target.value })}
                          />
                        </Field>
                      ) : null}

                      {step.kind === "navigate" ? (
                        <Field
                          label={fr ? "Adresse à ouvrir" : "Address to open"}
                          htmlFor={`flow-step-${index}-value`}
                        >
                          <input
                            id={`flow-step-${index}-value`}
                            className="app-input"
                            inputMode="url"
                            value={step.value ?? ""}
                            onChange={(event) => patchStep(index, { value: event.target.value })}
                          />
                        </Field>
                      ) : null}

                      {step.kind === "type" ? (
                        <Field
                          label={fr ? "Texte saisi" : "Typed text"}
                          htmlFor={`flow-step-${index}-value`}
                        >
                          <input
                            id={`flow-step-${index}-value`}
                            className="app-input"
                            value={step.value ?? ""}
                            onChange={(event) => patchStep(index, { value: event.target.value })}
                          />
                        </Field>
                      ) : null}

                      {step.kind === "press" ? (
                        <Field label={fr ? "Touche" : "Key"} htmlFor={`flow-step-${index}-value`}>
                          <input
                            id={`flow-step-${index}-value`}
                            className="app-input"
                            value={step.value ?? "Enter"}
                            maxLength={20}
                            onChange={(event) => patchStep(index, { value: event.target.value })}
                          />
                        </Field>
                      ) : null}

                      {step.kind === "scroll" ? (
                        <Field
                          label={fr ? "Défilement (px)" : "Scroll (px)"}
                          htmlFor={`flow-step-${index}-value`}
                        >
                          <input
                            id={`flow-step-${index}-value`}
                            className="app-input"
                            inputMode="numeric"
                            value={step.value ?? "600"}
                            onChange={(event) => patchStep(index, { value: event.target.value })}
                          />
                        </Field>
                      ) : null}

                      {step.kind === "assert" ? (
                        <>
                          <Field
                            label={fr ? "L'URL contient" : "URL contains"}
                            htmlFor={`flow-step-${index}-url`}
                          >
                            <input
                              id={`flow-step-${index}-url`}
                              className="app-input"
                              value={step.expect?.urlContains ?? ""}
                              onChange={(event) =>
                                patchExpect(index, "urlContains", event.target.value)
                              }
                            />
                          </Field>
                          <Field
                            label={fr ? "Le texte contient" : "Text contains"}
                            htmlFor={`flow-step-${index}-text`}
                          >
                            <input
                              id={`flow-step-${index}-text`}
                              className="app-input"
                              value={step.expect?.textContains ?? ""}
                              onChange={(event) =>
                                patchExpect(index, "textContains", event.target.value)
                              }
                            />
                          </Field>
                        </>
                      ) : null}
                    </div>

                    {step.kind === "click" || step.kind === "press" ? (
                      <label
                        className="flow-destructive"
                        htmlFor={`flow-step-${index}-destructive`}
                      >
                        <input
                          id={`flow-step-${index}-destructive`}
                          type="checkbox"
                          checked={step.destructive === true}
                          onChange={(event) =>
                            patchStep(index, { destructive: event.target.checked })
                          }
                        />
                        {fr
                          ? "Cette action peut modifier l'état (paiement, envoi) : elle n'est exécutée que sur autorisation explicite."
                          : "This action can change state (payment, submit): it only runs with explicit authorization."}
                      </label>
                    ) : null}

                    {issues.length > 0 ? (
                      <ul className="flow-step-issues" role="alert">
                        {issues.map((issue, at) => (
                          <li key={at}>{issueText(issue.code, issue.message, fr)}</li>
                        ))}
                      </ul>
                    ) : null}
                  </fieldset>
                </li>
              );
            })}
          </ol>

          <div className="flow-add">
            <span className="app-eyebrow">{fr ? "Ajouter" : "Add"}</span>
            {FLOW_STEP_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="app-btn app-btn-sm"
                onClick={() => addStep(kind)}
              >
                <Plus size={13} /> {KIND_LABEL[kind][fr ? "fr" : "en"]}
              </button>
            ))}
          </div>

          {runError ? (
            <div className="flow-run-unavailable" role="alert">
              <p>{runError.message}</p>
              <pre>
                <code>proofcore audit interact --url {draft.target || "https://exemple.com"}</code>
              </pre>
            </div>
          ) : null}

          {report ? (
            <section className="flow-report" aria-labelledby="flow-report-title">
              <header>
                <div>
                  <p className="app-eyebrow">{fr ? "Dernière exécution" : "Last run"}</p>
                  <h2 id="flow-report-title">
                    {report.report.stepsRun} {fr ? "étapes exécutées" : "steps run"} ·{" "}
                    {report.report.stepsSkipped} {fr ? "ignorées" : "skipped"} ·{" "}
                    {Math.round(report.report.durationMs / 100) / 10} s
                  </h2>
                </div>
                {report.analysisId ? (
                  <Link
                    className="app-btn app-btn-sm"
                    to={`/app/analyses?analysis=${report.analysisId}`}
                  >
                    {fr ? "Ouvrir l'analyse" : "Open the analysis"} <RouteIcon size={13} />
                  </Link>
                ) : null}
              </header>
              {report.report.final ? (
                <p className="flow-report-final">
                  {fr ? "Page finale" : "Final page"} : {report.report.final.url}
                </p>
              ) : null}
              <ul className="flow-findings">
                {report.report.findings.map((finding) => (
                  <li key={finding.id}>
                    <span className={TONE[finding.status] ?? "app-badge"}>
                      {STATUS_TEXT[finding.status]?.[fr ? "fr" : "en"] ?? finding.status}
                    </span>
                    <div>
                      <p>{finding.observed}</p>
                      <p className="text-muted">{finding.why}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {report && report.report.findings.length === 0 ? (
            <p className="flow-report-empty">
              {fr
                ? "Aucun constat : les étapes n'ont produit aucune observation."
                : "No finding: the steps produced no observation."}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
