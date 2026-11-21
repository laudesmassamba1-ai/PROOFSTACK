import { ArrowLeft, Download, Loader2, Plus, Save, Trash2 } from "lucide-react";
import type React from "react";
import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useState,
} from "react";
import { Link, useParams } from "react-router";
import { Card, ErrorState, Loading } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { useSession } from "../../lib/session.js";

/**
 * Module configuration without a TypeScript file.
 *
 * Every control here is a field the engine actually reads: WORLD profiles and its HTTP
 * target, FLOW payment mode and scenarios, EXIT formats and export source. Nothing is
 * invented for the screen. The API validates the payload with the same schema as the CLI
 * and refuses a real charge; the saved result is a complete `proofcore.config.json` the
 * user can download and run with `proofcore test`.
 *
 * FLOW journeys are editable because the CLI now executes them with the local browser
 * (`createBrowserJourneyRunner`). The server-side audit has no browser, so it reports
 * those journeys as skipped instead of pretending they ran.
 */

interface Issue {
  path: string;
  message: string;
  hint?: string;
}

interface WorldConfig {
  enabled: boolean;
  profiles: string[];
  categories: string[];
  strictRejectionDetection: boolean;
  target: {
    kind: "http" | "driver" | "none";
    submitUrl?: string;
    readbackUrl?: string;
    sortUrl?: string;
    tokenEnvVar?: string;
  };
  [key: string]: unknown;
}

type JourneyAction =
  | "navigate"
  | "click"
  | "fill"
  | "select"
  | "submit"
  | "waitFor"
  | "assertText"
  | "assertUrl"
  | "screenshot"
  | "api";

interface JourneyStep {
  id: string;
  action: JourneyAction;
  target?: string;
  value?: string;
  timeoutMs: number;
  optional: boolean;
}

interface Journey {
  id: string;
  name: string;
  startUrl?: string;
  steps: JourneyStep[];
  destructive: boolean;
}

interface FlowConfig {
  enabled: boolean;
  paymentMode: "simulated" | "sandbox" | "live_charge";
  scenarios: string[];
  journeys: Journey[];
  baseUrl?: string;
  webhookEndpoint?: string;
  [key: string]: unknown;
}

interface ExitConfig {
  enabled: boolean;
  formats: ("csv" | "json" | "zip")[];
  target: "synthetic" | "staging" | "production";
  exportSource?: { kind: "http" | "file" | "command"; value: string; method: "GET" | "POST" };
  maxRecords: number;
  roundTrip: { enabled: boolean };
  [key: string]: unknown;
}

interface ProjectConfig {
  modules: { world: WorldConfig; flow: FlowConfig; exit: ExitConfig };
  allowDestructiveProduction: boolean;
}

interface ConfigResponse {
  config: {
    modules: { world: WorldConfig; flow: FlowConfig; exit: ExitConfig };
    allowDestructiveProduction: boolean;
  };
  issues: Issue[];
  savedAt: string | null;
  source: "saved" | "defaults";
}

const CATEGORIES = [
  "identity",
  "phone",
  "address",
  "currency",
  "datetime",
  "forms",
  "sorting",
  "collation",
] as const;

const SCENARIOS = [
  "checkout_success",
  "checkout_declined",
  "checkout_cancelled",
  "checkout_timeout",
  "webhook_duplicate",
  "webhook_delayed",
  "webhook_out_of_order",
  "webhook_invalid_signature",
  "order_missing_confirmation",
  "order_duplicate",
  "refund_flow",
  "inconsistent_state",
] as const;

const FORMATS = ["json", "csv", "zip"] as const;

const JOURNEY_ACTIONS: JourneyAction[] = [
  "navigate",
  "click",
  "fill",
  "select",
  "submit",
  "waitFor",
  "assertText",
  "assertUrl",
  "screenshot",
  "api",
];

function localId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  // The control is rendered by the caller, so the label is attached by injecting the same
  // generated id into it. A visual label without `htmlFor` is an accessibility dead end.
  const id = useId();
  return (
    <div className="block space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {Children.map(children, (child) =>
        isValidElement(child)
          ? cloneElement(child as React.ReactElement<{ id?: string }>, { id })
          : child
      )}
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5"
      />
      <span>
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export function ProjectConfigPage(): React.ReactElement {
  const { projectId = "" } = useParams();
  const session = useSession();
  const { locale } = useI18n();
  const fr = locale === "fr";
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [source, setSource] = useState<"saved" | "defaults">("defaults");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const load = useCallback(async () => {
    if (!session.workspaceId || !projectId) return;
    setLoading(true);
    setError(null);
    try {
      const body = await apiFetch<ConfigResponse>(
        `/api/v1/projects/${projectId}/config?workspaceId=${session.workspaceId}`
      );
      setConfig({
        modules: body.config.modules,
        allowDestructiveProduction: body.config.allowDestructiveProduction,
      });
      setIssues(body.issues);
      setSavedAt(body.savedAt);
      setSource(body.source);
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setLoading(false);
    }
  }, [session.workspaceId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!config || !session.workspaceId) return;
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    try {
      // An empty optional URL is the absence of a value, not an invalid one: the
      // schema validates `startUrl` as a URL when present.
      const payload = {
        ...config,
        modules: {
          ...config.modules,
          flow: {
            ...config.modules.flow,
            journeys: (config.modules.flow.journeys ?? []).map((journey) => ({
              ...journey,
              ...(journey.startUrl?.trim() ? {} : { startUrl: undefined }),
            })),
          },
        },
      };
      const body = await apiFetch<ConfigResponse>(
        `/api/v1/projects/${projectId}/config?workspaceId=${session.workspaceId}`,
        { method: "PUT", body: payload }
      );
      setConfig({
        modules: body.config.modules,
        allowDestructiveProduction: body.config.allowDestructiveProduction,
      });
      setIssues(body.issues);
      setSavedAt(body.savedAt);
      setSource(body.source);
      setSavedFlash(true);
    } catch (caught) {
      const apiError = caught as ApiError;
      setError(apiError);
      // A refusal carries the exact issues; show them instead of only the envelope.
      const details = apiError.details as { issues?: Issue[] } | undefined;
      if (details?.issues) setIssues(details.issues);
    } finally {
      setSaving(false);
    }
  };

  const download = () => {
    if (!config) return;
    const payload = {
      schemaVersion: 1,
      project: { name: projectId, baseUrl: "" },
      environment: "local",
      modules: config.modules,
      allowDestructiveProduction: config.allowDestructiveProduction,
      enabledModules: ["world", "flow", "exit"],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "proofcore.config.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!session.workspaceId) return <Loading />;
  if (loading)
    return <Loading label={fr ? "Chargement de la configuration…" : "Loading configuration…"} />;
  if (error && !config) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!config) return <Loading />;

  const { world, flow, exit } = config.modules;
  const updateWorld = (patch: Partial<WorldConfig>) =>
    setConfig({ ...config, modules: { ...config.modules, world: { ...world, ...patch } } });
  const updateFlow = (patch: Partial<FlowConfig>) =>
    setConfig({ ...config, modules: { ...config.modules, flow: { ...flow, ...patch } } });
  const updateExit = (patch: Partial<ExitConfig>) =>
    setConfig({ ...config, modules: { ...config.modules, exit: { ...exit, ...patch } } });

  const toggleIn = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const journeys = flow.journeys ?? [];
  const updateJourney = (id: string, patch: Partial<Journey>) =>
    updateFlow({
      journeys: journeys.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  const addJourney = () => {
    const id = localId("journey");
    updateFlow({
      journeys: [
        ...journeys,
        {
          id,
          name: fr ? "Parcours de connexion" : "Sign-in journey",
          startUrl: flow.baseUrl ?? "",
          destructive: false,
          steps: [
            {
              id: localId("step"),
              action: "navigate",
              target: "/",
              value: "",
              timeoutMs: 15_000,
              optional: false,
            },
          ],
        },
      ],
    });
  };
  const addStep = (journeyId: string) => {
    const journey = journeys.find((item) => item.id === journeyId);
    if (!journey) return;
    updateJourney(journeyId, {
      steps: [
        ...journey.steps,
        {
          id: localId("step"),
          action: "click",
          target: "",
          value: "",
          timeoutMs: 15_000,
          optional: false,
        },
      ],
    });
  };
  const updateStep = (journeyId: string, stepId: string, patch: Partial<JourneyStep>) => {
    const journey = journeys.find((item) => item.id === journeyId);
    if (!journey) return;
    updateJourney(journeyId, {
      steps: journey.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    });
  };

  return (
    <div className="app-page">
      <Link to={`/app/projects/${projectId}`} className="app-text-link mb-3 inline-flex">
        <ArrowLeft size={13} /> {fr ? "Retour au projet" : "Back to the project"}
      </Link>
      <PageHeader
        eyebrow={fr ? "CONFIGURATION / SANS CODE" : "CONFIGURATION / NO CODE"}
        title={fr ? "CONFIGURER LES MODULES" : "CONFIGURE THE MODULES"}
        description={
          fr
            ? "Chaque champ ci-dessous est lu par le moteur. Enregistrez, téléchargez proofcore.config.json, puis lancez `proofcore test` — aucun fichier TypeScript à écrire."
            : "Every field below is read by the engine. Save, download proofcore.config.json, then run `proofcore test` — no TypeScript file to write."
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="app-btn app-btn-primary"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? (fr ? "Enregistrement…" : "Saving…") : fr ? "Enregistrer" : "Save"}
        </button>
        <button type="button" className="app-btn" onClick={download}>
          <Download size={14} />{" "}
          {fr ? "Télécharger la configuration" : "Download the configuration"}
        </button>
        <span className="text-xs text-muted">
          {source === "saved"
            ? fr
              ? `Enregistrée ${savedAt ? new Date(savedAt).toLocaleString(locale) : ""}`
              : `Saved ${savedAt ? new Date(savedAt).toLocaleString(locale) : ""}`
            : fr
              ? "Configuration par défaut, pas encore enregistrée"
              : "Default configuration, not saved yet"}
        </span>
      </div>

      {savedFlash ? (
        <p className="mb-4 text-sm" role="status">
          {fr ? "Configuration enregistrée et validée." : "Configuration saved and validated."}
        </p>
      ) : null}
      {error ? <ErrorState error={error} onRetry={() => void save()} /> : null}

      {issues.length > 0 ? (
        <Card
          title={fr ? "À vérifier avant d'exécuter" : "Check before running"}
          description={
            fr
              ? "Ces points sont enregistrés, mais le moteur produira des cas ignorés ou bloqués tant qu'ils ne sont pas réglés."
              : "These settings are saved, but the engine will produce skipped or blocked cases until they are fixed."
          }
          className="mb-4"
        >
          <ul className="space-y-1 px-5 py-4 text-sm">
            {issues.map((issue) => (
              <li key={`${issue.path}-${issue.message}`}>
                <code className="app-mono text-xs">{issue.path}</code> — {issue.message}
                {issue.hint ? <span className="block text-xs text-muted">{issue.hint}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        title="WORLD"
        description={
          fr
            ? "Formats, devises et adresses de chaque pays."
            : "Formats, currencies and addresses per country."
        }
        className="mb-4"
      >
        <div className="space-y-4 px-5 py-4">
          <Toggle
            checked={world.enabled}
            onChange={(enabled) => updateWorld({ enabled })}
            label={fr ? "Activer WORLD" : "Enable WORLD"}
          />
          <Field
            label={fr ? "Pays et langues à vérifier" : "Countries and languages to check"}
            hint={
              fr
                ? "Codes BCP-47 séparés par des virgules, par exemple fr-FR, en-US, fr-BJ."
                : "Comma-separated BCP-47 codes, for example fr-FR, en-US, fr-BJ."
            }
          >
            <input
              className="app-input"
              value={world.profiles.join(", ")}
              onChange={(event) =>
                updateWorld({
                  profiles: event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <div>
            <p className="mb-2 text-sm font-medium">
              {fr ? "Ce qui est vérifié" : "What is checked"}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {CATEGORIES.map((category) => (
                <Toggle
                  key={category}
                  checked={world.categories.includes(category)}
                  onChange={() => updateWorld({ categories: toggleIn(world.categories, category) })}
                  label={category}
                />
              ))}
            </div>
          </div>
          <Field
            label={fr ? "Comment envoyer un enregistrement" : "How a record is submitted"}
            hint={
              fr
                ? "« Aucune cible » produit des cas ignorés avec une raison, jamais un faux succès."
                : "“No target” produces skipped cases with a reason, never a false pass."
            }
          >
            <select
              className="app-input"
              value={world.target.kind}
              onChange={(event) =>
                updateWorld({
                  target: {
                    ...world.target,
                    kind: event.target.value as WorldConfig["target"]["kind"],
                  },
                })
              }
            >
              <option value="none">
                {fr ? "Aucune cible (non configuré)" : "No target (not configured)"}
              </option>
              <option value="http">
                {fr ? "Endpoint HTTP du produit" : "Product HTTP endpoint"}
              </option>
            </select>
          </Field>
          {world.target.kind === "http" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={fr ? "URL d'envoi" : "Submit URL"}>
                <input
                  className="app-input"
                  value={world.target.submitUrl ?? ""}
                  onChange={(event) =>
                    updateWorld({ target: { ...world.target, submitUrl: event.target.value } })
                  }
                  placeholder="https://exemple.com/api/records"
                />
              </Field>
              <Field
                label={fr ? "URL de relecture (facultatif)" : "Read-back URL (optional)"}
                hint={
                  fr
                    ? "Contient {recordId} ; sert à détecter une corruption du stockage."
                    : "Contains {recordId}; detects storage corruption."
                }
              >
                <input
                  className="app-input"
                  value={world.target.readbackUrl ?? ""}
                  onChange={(event) =>
                    updateWorld({ target: { ...world.target, readbackUrl: event.target.value } })
                  }
                />
              </Field>
              <Field
                label={fr ? "Variable du jeton (facultatif)" : "Token variable (optional)"}
                hint={
                  fr
                    ? "Le nom de la variable, jamais le jeton."
                    : "The variable name, never the token."
                }
              >
                <input
                  className="app-input"
                  value={world.target.tokenEnvVar ?? ""}
                  onChange={(event) =>
                    updateWorld({ target: { ...world.target, tokenEnvVar: event.target.value } })
                  }
                  placeholder="PROOFCORE_WORLD_TOKEN"
                />
              </Field>
            </div>
          ) : null}
          <Toggle
            checked={world.strictRejectionDetection}
            onChange={(strictRejectionDetection) => updateWorld({ strictRejectionDetection })}
            label={
              fr
                ? "Refuser les valeurs qu'un pays doit accepter"
                : "Reject values a country must accept"
            }
            hint={
              fr
                ? "Un refus ici est un défaut du produit, pas du test."
                : "A rejection here is a product defect, not a test defect."
            }
          />
        </div>
      </Card>

      <Card
        title="FLOW"
        description={
          fr ? "Paiement, webhooks et états de commande." : "Payment, webhooks and order states."
        }
        className="mb-4"
      >
        <div className="space-y-4 px-5 py-4">
          <Toggle
            checked={flow.enabled}
            onChange={(enabled) => updateFlow({ enabled })}
            label={fr ? "Activer FLOW" : "Enable FLOW"}
          />
          <Field
            label={fr ? "Mode de paiement" : "Payment mode"}
            hint={
              fr
                ? "Le paiement réel est refusé depuis le web : il doit rester une action humaine."
                : "Real charges are refused from the web: they must remain a human action."
            }
          >
            <select
              className="app-input"
              value={flow.paymentMode === "live_charge" ? "sandbox" : flow.paymentMode}
              onChange={(event) =>
                updateFlow({ paymentMode: event.target.value as FlowConfig["paymentMode"] })
              }
            >
              <option value="simulated">
                {fr ? "Simulé (aucun réseau, aucun argent)" : "Simulated (no network, no money)"}
              </option>
              <option value="sandbox">
                {fr ? "Bac à sable du fournisseur" : "Provider sandbox"}
              </option>
            </select>
          </Field>
          <div>
            <p className="mb-2 text-sm font-medium">
              {fr ? "Scénarios exécutés" : "Scenarios executed"}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {SCENARIOS.map((scenario) => (
                <Toggle
                  key={scenario}
                  checked={flow.scenarios.includes(scenario)}
                  onChange={() => updateFlow({ scenarios: toggleIn(flow.scenarios, scenario) })}
                  label={scenario}
                />
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={fr ? "URL de base (facultatif)" : "Base URL (optional)"}>
              <input
                className="app-input"
                value={flow.baseUrl ?? ""}
                onChange={(event) => updateFlow({ baseUrl: event.target.value })}
                placeholder="https://exemple.com"
              />
            </Field>
            <Field
              label={fr ? "Endpoint des webhooks (facultatif)" : "Webhook endpoint (optional)"}
            >
              <input
                className="app-input"
                value={flow.webhookEndpoint ?? ""}
                onChange={(event) => updateFlow({ webhookEndpoint: event.target.value })}
              />
            </Field>
          </div>
          <div className="border-t border-[var(--border)] pt-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">
                  {fr ? "Parcours navigateur" : "Browser journeys"}
                </p>
                <p className="text-xs text-muted">
                  {fr
                    ? "Exécutés par `proofcore test` avec le navigateur de votre machine, étape par étape. Un audit lancé depuis le serveur les marque comme ignorés : il n'a pas de navigateur."
                    : "Executed by `proofcore test` with your machine's browser, step by step. A server-side audit marks them skipped because it has no browser."}
                </p>
              </div>
              <button type="button" className="app-btn" onClick={addJourney}>
                <Plus size={14} /> {fr ? "Ajouter un parcours" : "Add a journey"}
              </button>
            </div>
            {journeys.length === 0 ? (
              <p className="mt-3 text-xs text-muted">
                {fr
                  ? "Aucun parcours configuré. Les scénarios de paiement ci-dessus restent vérifiés sans navigateur."
                  : "No journey configured. The payment scenarios above are still verified without a browser."}
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {journeys.map((journey) => (
                  <div
                    key={journey.id}
                    className="rounded-[var(--radius)] border border-[var(--border)] p-3"
                  >
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[180px] flex-1">
                        <Field label={fr ? "Nom du parcours" : "Journey name"}>
                          <input
                            className="app-input"
                            value={journey.name}
                            onChange={(event) =>
                              updateJourney(journey.id, { name: event.target.value })
                            }
                          />
                        </Field>
                      </div>
                      <div className="min-w-[200px] flex-1">
                        <Field label={fr ? "URL de départ" : "Start URL"}>
                          <input
                            className="app-input"
                            value={journey.startUrl ?? ""}
                            placeholder={flow.baseUrl ?? "https://exemple.com/connexion"}
                            onChange={(event) =>
                              updateJourney(journey.id, { startUrl: event.target.value })
                            }
                          />
                        </Field>
                      </div>
                      <button
                        type="button"
                        className="app-btn"
                        aria-label={fr ? "Supprimer le parcours" : "Remove journey"}
                        onClick={() =>
                          updateFlow({
                            journeys: journeys.filter((item) => item.id !== journey.id),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="mt-2">
                      <Toggle
                        checked={journey.destructive}
                        onChange={(destructive) => updateJourney(journey.id, { destructive })}
                        label={
                          fr
                            ? "Parcours destructif (commande réelle, refusé en production)"
                            : "Destructive journey (real order, refused in production)"
                        }
                      />
                    </div>
                    <div className="mt-3 space-y-2">
                      {journey.steps.map((step, stepIndex) => (
                        <div
                          key={step.id}
                          className="grid gap-2 rounded-[var(--radius)] bg-[var(--surface-2)] p-2 sm:grid-cols-[130px_1fr_1fr_90px_auto]"
                        >
                          <select
                            className="app-input"
                            aria-label={`${fr ? "Action" : "Action"} ${stepIndex + 1}`}
                            value={step.action}
                            onChange={(event) =>
                              updateStep(journey.id, step.id, {
                                action: event.target.value as JourneyAction,
                              })
                            }
                          >
                            {JOURNEY_ACTIONS.map((action) => (
                              <option key={action} value={action}>
                                {action}
                              </option>
                            ))}
                          </select>
                          <input
                            className="app-input"
                            aria-label={`${fr ? "Cible" : "Target"} ${stepIndex + 1}`}
                            value={step.target ?? ""}
                            placeholder={fr ? "sélecteur CSS ou URL" : "CSS selector or URL"}
                            onChange={(event) =>
                              updateStep(journey.id, step.id, { target: event.target.value })
                            }
                          />
                          <input
                            className="app-input"
                            aria-label={`${fr ? "Valeur" : "Value"} ${stepIndex + 1}`}
                            value={step.value ?? ""}
                            placeholder={fr ? "texte saisi ou attendu" : "text to type or expect"}
                            onChange={(event) =>
                              updateStep(journey.id, step.id, { value: event.target.value })
                            }
                          />
                          <input
                            className="app-input"
                            type="number"
                            min={1000}
                            max={120000}
                            step={1000}
                            aria-label={`${fr ? "Délai" : "Timeout"} ${stepIndex + 1}`}
                            value={step.timeoutMs}
                            onChange={(event) =>
                              updateStep(journey.id, step.id, {
                                timeoutMs: Number(event.target.value) || 15_000,
                              })
                            }
                          />
                          <div className="flex items-center gap-1">
                            <label className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={step.optional}
                                onChange={(event) =>
                                  updateStep(journey.id, step.id, {
                                    optional: event.target.checked,
                                  })
                                }
                              />
                              {fr ? "facultatif" : "optional"}
                            </label>
                            <button
                              type="button"
                              className="app-btn"
                              aria-label={fr ? "Supprimer l'étape" : "Remove step"}
                              disabled={journey.steps.length <= 1}
                              onClick={() =>
                                updateJourney(journey.id, {
                                  steps: journey.steps.filter((item) => item.id !== step.id),
                                })
                              }
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="app-btn mt-2"
                      onClick={() => addStep(journey.id)}
                    >
                      <Plus size={13} /> {fr ? "Ajouter une étape" : "Add a step"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="EXIT"
        description={fr ? "Exports de données et intégrité." : "Data exports and integrity."}
        className="mb-4"
      >
        <div className="space-y-4 px-5 py-4">
          <Toggle
            checked={exit.enabled}
            onChange={(enabled) => updateExit({ enabled })}
            label={fr ? "Activer EXIT" : "Enable EXIT"}
          />
          <div>
            <p className="mb-2 text-sm font-medium">
              {fr ? "Formats exportés" : "Exported formats"}
            </p>
            <div className="flex flex-wrap gap-4">
              {FORMATS.map((format) => (
                <Toggle
                  key={format}
                  checked={exit.formats.includes(format)}
                  onChange={() =>
                    updateExit({ formats: toggleIn(exit.formats, format) as ExitConfig["formats"] })
                  }
                  label={format.toUpperCase()}
                />
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={fr ? "Type de données" : "Data type"}
              hint={
                fr
                  ? "La production exige une confirmation explicite."
                  : "Production requires an explicit acknowledgement."
              }
            >
              <select
                className="app-input"
                value={exit.target}
                onChange={(event) =>
                  updateExit({ target: event.target.value as ExitConfig["target"] })
                }
              >
                <option value="synthetic">{fr ? "Données synthétiques" : "Synthetic data"}</option>
                <option value="staging">
                  {fr ? "Jeu de données de staging" : "Staging dataset"}
                </option>
                <option value="production">
                  {fr ? "Production (dangereux)" : "Production (dangerous)"}
                </option>
              </select>
            </Field>
            <Field label={fr ? "Nombre maximum d'enregistrements" : "Maximum records"}>
              <input
                className="app-input"
                type="number"
                min={1}
                max={1000000}
                value={exit.maxRecords}
                onChange={(event) => updateExit({ maxRecords: Number(event.target.value) || 1 })}
              />
            </Field>
          </div>
          <Field
            label={fr ? "D'où vient l'export" : "Where the export comes from"}
            hint={
              fr
                ? "Un fichier local, une URL du produit, ou une commande (argv, sans shell)."
                : "A local file, a product URL, or a command (argv, no shell)."
            }
          >
            <select
              className="app-input"
              value={exit.exportSource?.kind ?? "none"}
              onChange={(event) => {
                const kind = event.target.value as "none" | "http" | "file" | "command";
                if (kind === "none") {
                  const rest = { ...exit };
                  delete rest.exportSource;
                  setConfig({ ...config, modules: { ...config.modules, exit: rest } });
                  return;
                }
                updateExit({ exportSource: { kind, value: "", method: "GET" } });
              }}
            >
              <option value="none">{fr ? "Non configuré" : "Not configured"}</option>
              <option value="http">{fr ? "URL HTTP" : "HTTP URL"}</option>
              <option value="file">{fr ? "Fichier local" : "Local file"}</option>
              <option value="command">{fr ? "Commande" : "Command"}</option>
            </select>
          </Field>
          {exit.exportSource ? (
            <Field label={fr ? "Adresse, chemin ou commande" : "Address, path or command"}>
              <input
                className="app-input"
                value={exit.exportSource.value}
                onChange={(event) => {
                  if (!exit.exportSource) return;
                  updateExit({
                    exportSource: { ...exit.exportSource, value: event.target.value },
                  });
                }}
              />
            </Field>
          ) : null}
          {exit.target === "production" ? (
            <Toggle
              checked={config.allowDestructiveProduction}
              onChange={(allowDestructiveProduction) =>
                setConfig({ ...config, allowDestructiveProduction })
              }
              label={fr ? "J'autorise un export de production" : "I allow a production export"}
              hint={
                fr
                  ? "Sans cette case, l'enregistrement est refusé."
                  : "Without this box, saving is refused."
              }
            />
          ) : null}
          <Toggle
            checked={exit.roundTrip.enabled}
            onChange={(enabled) => updateExit({ roundTrip: { ...exit.roundTrip, enabled } })}
            label={
              fr ? "Vérifier le ré-import de l'export" : "Verify the export can be re-imported"
            }
          />
        </div>
      </Card>

      <p className="text-xs text-muted">
        {fr
          ? "Cette page modifie la configuration du projet, pas les valeurs secrètes : les jetons restent dans les variables d'environnement de votre machine ou de votre CI."
          : "This page edits the project configuration, not secrets: tokens stay in the environment variables of your machine or CI."}
      </p>
    </div>
  );
}
