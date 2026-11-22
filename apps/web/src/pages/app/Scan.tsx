import {
  AlertTriangle,
  ArrowRight,
  Check,
  Eye,
  Loader2,
  RefreshCw,
  ScanLine,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Card, ErrorState } from "../../components/app/ui.js";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";
import { API_BASE, ApiError, apiFetch } from "../../lib/api.js";
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

/**
 * A control's explanation, as the registry writes it.
 *
 * Fetched once per language from the public catalogue and indexed by `module:id`. Nothing
 * here is generated: when the catalogue cannot be reached, the finding keeps its observed
 * value and its one-line reason, and no text is invented to fill the gap.
 */
interface ControlCopy {
  title: string;
  objective: string;
  consequence: string;
  fix: string;
  verify: string;
  fixes: { stack: string; code: string }[];
  complexity: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
  aliasOf?: string;
}

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
  id?: string;
  projectId?: string | null;
  ownership?: "local" | "verified" | "unverified";
  redacted?: boolean;
  login?: { attempted: boolean; ok: boolean; status: number | null; reason?: string } | null;
  verification?: { tokenProvided: boolean; found: boolean; where: "meta" | "well-known" | null };
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

type CorrectionState = "todo" | "in_progress" | "fixed" | "verify";

interface CorrectionItem extends ScanFinding {
  key: string;
  /** False when the finding disappeared from the latest scan of the project. */
  present: boolean;
  state: CorrectionState;
  note: string | null;
  updatedAt: string | null;
  /** The last time this one finding was re-checked against the live site. */
  verification: {
    at: string;
    status: string | null;
    observed: string | null;
    before: string | null;
    verdict: CorrectionVerdict | null;
  } | null;
}

type CorrectionVerdict = "fixed" | "still_present" | "worse" | "not_checked" | "inconclusive";

const VERDICT_COPY: Record<CorrectionVerdict, { fr: string; en: string; tone: string }> = {
  fixed: {
    fr: "Corrigé : le contrôle passe maintenant",
    en: "Fixed: the control passes now",
    tone: "text-success",
  },
  still_present: { fr: "Toujours présent", en: "Still present", tone: "text-danger" },
  worse: { fr: "Pire qu'avant", en: "Worse than before", tone: "text-danger" },
  not_checked: {
    fr: "Contrôle absent de cette lecture",
    en: "The control was not part of this reading",
    tone: "text-muted",
  },
  inconclusive: {
    fr: "Site illisible : rien n'est conclu",
    en: "Site unreachable: nothing concluded",
    tone: "text-muted",
  },
};

interface ScanComparison {
  before: string;
  after: string;
  resolved: { key: string; module: string; id: string; status: string; observed: string }[];
  persisting: { key: string; module: string; id: string; status: string; observed: string }[];
  appeared: { key: string; module: string; id: string; status: string; observed: string }[];
  counts: { resolved: number; persisting: number; appeared: number };
}

interface CorrectionsResponse {
  auditId: string | null;
  scannedAt?: string;
  items: CorrectionItem[];
  comparison: ScanComparison | null;
}

const CORRECTION_LABELS: Record<CorrectionState, { fr: string; en: string }> = {
  todo: { fr: "À traiter", en: "To fix" },
  in_progress: { fr: "En cours", en: "In progress" },
  fixed: { fr: "Corrigé", en: "Fixed" },
  verify: { fr: "À vérifier", en: "To verify" },
};

interface ScanStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  detail?: string;
}

type StreamMessage = {
  type?: string;
  id?: string;
  label?: string;
  status?: ScanStep["status"] | number;
  detail?: string;
  message?: string;
  code?: string;
  audit?: ScanResult & { id: string; projectId?: string | null };
  comparison?: ScanComparison | null;
};

/**
 * The scan's real phases arrive as server-sent events.
 *
 * Each event is written by the server after the phase it names has started or finished,
 * so the list cannot advance on its own while the server is idle. A refused scan still
 * throws an ApiError with the server's exact code and message.
 */
async function streamScan(
  payload: unknown,
  onStep: (step: ScanStep) => void
): Promise<{
  audit: ScanResult & { id: string; projectId?: string | null };
  comparison: ScanComparison | null;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${API_BASE}/api/v1/audits/stream`, {
      method: "POST",
      headers: { accept: "text/event-stream", "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      let parsed: { error?: { message?: string; code?: string } } | null = null;
      try {
        parsed = JSON.parse(text) as { error?: { message?: string; code?: string } };
      } catch {
        // A non-JSON refusal is still a refusal; the status is the reliable part.
      }
      throw new ApiError(
        parsed?.error?.message ?? `HTTP ${response.status}`,
        response.status,
        parsed?.error?.code ?? `http_${response.status}`
      );
    }
    if (!response.body) throw new ApiError("The scan stream is unavailable.", 502, "no_stream");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let final: StreamMessage | null = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((entry) => entry.startsWith("data:"));
        if (!line) continue;
        let message: StreamMessage;
        try {
          message = JSON.parse(line.slice(5).trim()) as StreamMessage;
        } catch {
          continue;
        }
        if (message.type === "step" && message.id && message.label) {
          onStep({
            id: message.id,
            label: message.label,
            status: typeof message.status === "string" ? message.status : "running",
            ...(message.detail ? { detail: message.detail } : {}),
          });
        } else if (message.type === "error") {
          throw new ApiError(
            message.message ?? "The scan could not run.",
            typeof message.status === "number" ? message.status : 502,
            message.code ?? "scan_failed"
          );
        } else if (message.type === "result" && message.audit) {
          final = message;
        }
      }
    }
    if (!final?.audit) {
      throw new ApiError("The scan stream ended without a result.", 502, "stream_incomplete");
    }
    return { audit: final.audit, comparison: final.comparison ?? null };
  } finally {
    clearTimeout(timer);
  }
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
  const [params] = useSearchParams();
  // Set by the project page: open that exact audit, and interpret it without another click.
  const requestedAudit = params.get("audit");
  const requestedProject = params.get("project");
  const wantsExplanation = params.get("explain") === "1";
  const explainedFor = useRef<string | null>(null);
  const [url, setUrl] = useState("https://");
  const [cookie, setCookie] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  /** A site usually offers an account, not a cookie jar: that is the default path. */
  const [authMode, setAuthMode] = useState<"account" | "cookie">("account");
  const [loginUrl, setLoginUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showVerify, setShowVerify] = useState(false);
  const [verify, setVerify] = useState<{
    metaTag: string;
    wellKnownContent: string;
    wellKnownPath: string;
    instructions: string;
  } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [auditId, setAuditId] = useState<string | null>(null);
  // A scan belongs to a project only when it was started from one. Tracking, comparison
  // and re-control are project features: a pasted URL has no baseline to compare to.
  const [scanProjectId, setScanProjectId] = useState<string | null>(requestedProject);
  const [corrections, setCorrections] = useState<CorrectionsResponse | null>(null);
  const [verifyingCorrection, setVerifyingCorrection] = useState<string | null>(null);
  const [correctionsError, setCorrectionsError] = useState<string | null>(null);
  const [savingCorrection, setSavingCorrection] = useState<string | null>(null);
  const [steps, setSteps] = useState<ScanStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [history, setHistory] = useState<AuditSummary[]>([]);
  const [controls, setControls] = useState<Record<string, ControlCopy>>({});
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  const loadCorrections = useCallback(
    async (project: string | null = scanProjectId) => {
      if (!session.workspaceId || !project) {
        setCorrections(null);
        return;
      }
      try {
        const body = await apiFetch<CorrectionsResponse>(
          `/api/v1/projects/${project}/corrections?workspaceId=${session.workspaceId}`
        );
        setCorrections(body);
        setCorrectionsError(null);
      } catch (caught) {
        // The board is an addition to the report, never a reason to hide it.
        setCorrectionsError(
          (caught as ApiError).message || (fr ? "Suivi indisponible." : "Tracking unavailable.")
        );
      }
    },
    [session.workspaceId, scanProjectId, fr]
  );

  /**
   * Re-checks one finding against the live site, now.
   *
   * This is the loop the product was missing: a fix is only a fix once the site says so,
   * and waiting for the next full scan to learn one answer is a poor trade. The verdict is
   * shown as it came back, including "inconclusive" when the site could not be read.
   */
  const verifyCorrection = async (key: string) => {
    if (!session.workspaceId || !scanProjectId) return;
    setVerifyingCorrection(key);
    setCorrectionsError(null);
    try {
      const result = await apiFetch<{
        verdict: CorrectionVerdict;
        after: { status: string; observed: string } | null;
        checkedAt: string;
      }>(
        `/api/v1/projects/${scanProjectId}/corrections/${encodeURIComponent(key)}/verify?workspaceId=${session.workspaceId}`,
        { method: "POST", timeoutMs: 30_000 }
      );
      setCorrections((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.key === key
                  ? {
                      ...item,
                      // A proven fix is the one verdict that also moves the workflow.
                      state: result.verdict === "fixed" ? "fixed" : item.state,
                      verification: {
                        at: result.checkedAt,
                        status: result.after?.status ?? null,
                        observed: result.after?.observed ?? null,
                        before: item.observed,
                        verdict: result.verdict,
                      },
                    }
                  : item
              ),
            }
          : current
      );
    } catch (caught) {
      setCorrectionsError(
        (caught as ApiError).message || (fr ? "Vérification impossible." : "Verification failed.")
      );
    } finally {
      setVerifyingCorrection(null);
    }
  };

  const setCorrection = async (key: string, state: CorrectionState) => {
    if (!session.workspaceId || !scanProjectId) return;
    setSavingCorrection(key);
    setCorrectionsError(null);
    try {
      await apiFetch(
        `/api/v1/projects/${scanProjectId}/corrections/${encodeURIComponent(key)}?workspaceId=${session.workspaceId}`,
        { method: "PATCH", body: { state } }
      );
      setCorrections((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.key === key ? { ...item, state, updatedAt: new Date().toISOString() } : item
              ),
            }
          : current
      );
    } catch (caught) {
      setCorrectionsError(
        (caught as ApiError).message || (fr ? "État non enregistré." : "State not saved.")
      );
    } finally {
      setSavingCorrection(null);
    }
  };

  const loadHistory = useCallback(async () => {
    if (!session.workspaceId) return;
    try {
      const body = await apiFetch<{ items: AuditSummary[] }>(
        `/api/v1/audits?workspaceId=${session.workspaceId}&limit=10`
      );
      setHistory(body.items);
      return body.items;
    } catch {
      // History is a convenience; a failure here must not block scanning.
    }
  }, [session.workspaceId]);

  useEffect(() => {
    // The catalogue is the explanation. One request per language, cached by the browser for
    // a day; a failure leaves the findings readable with their raw observation only.
    let cancelled = false;
    void apiFetch<{ items: (ControlCopy & { module: string; id: string })[] }>(
      `/api/v1/controls?locale=${locale}`
    )
      .then((body) => {
        if (cancelled) return;
        const index: Record<string, ControlCopy> = {};
        for (const item of body.items) {
          const { module, ...copy } = item;
          index[`${module}:${item.id}`] = copy as ControlCopy;
        }
        setControls(index);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    // Opening the page shows the last scan rather than an empty form: the result someone
    // came back for is usually the one they just took. A requested audit wins over it.
    void loadHistory().then((items) => {
      const target = requestedAudit ?? items?.[0]?.id;
      if (!target) return;
      void apiFetch<{ id: string; projectId: string | null; result: ScanResult }>(
        `/api/v1/audits/${target}?workspaceId=${session.workspaceId}`
      )
        .then((body) => {
          setScan(body.result);
          setAuditId(body.id);
          setUrl(body.result.url);
          const project = body.projectId ?? requestedProject;
          setScanProjectId(project ?? null);
          void loadCorrections(project ?? null);
        })
        .catch(() => undefined);
    });
  }, [loadHistory, session.workspaceId, requestedAudit, requestedProject, loadCorrections]);

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
    if (authMode === "account" && (email.trim() || password)) {
      if (!/^https?:\/\/\S+/i.test(loginUrl.trim())) {
        setError(
          new Error(
            fr
              ? "Donne l'adresse complète de la page de connexion du site, ou laisse les identifiants vides."
              : "Give the full URL of the site's login endpoint, or leave the credentials empty."
          )
        );
        return;
      }
      if (!email.includes("@") || password.length === 0) {
        setError(
          new Error(
            fr ? "Email et mot de passe sont nécessaires." : "Email and password are needed."
          )
        );
        return;
      }
    }
    setBusy(true);
    setError(null);
    setScan(null);
    setExplanation(null);
    setExplainError(null);
    setSteps([
      {
        id: "request",
        label: fr ? "Validation et quota" : "Validation and quota",
        status: "pending",
      },
      {
        id: "fetch",
        label: fr ? "Lecture de la page et analyse" : "Page read and analysis",
        status: "pending",
      },
      { id: "verdict", label: fr ? "Calcul du verdict" : "Verdict calculation", status: "pending" },
      {
        id: "save",
        label: fr ? "Enregistrement et comparaison" : "Storing and comparison",
        status: "pending",
      },
    ]);
    try {
      const body = await streamScan(
        {
          workspaceId: session.workspaceId,
          url: target,
          ...(scanProjectId ? { projectId: scanProjectId } : {}),
          ...(authMode === "cookie" && cookie.trim() ? { headers: { cookie: cookie.trim() } } : {}),
          ...(authMode === "account" && email.trim() && password
            ? { login: { url: loginUrl.trim(), email: email.trim(), password } }
            : {}),
        },
        (step) =>
          setSteps((current) => {
            const index = current.findIndex((entry) => entry.id === step.id);
            if (index === -1) return [...current, step];
            return current.map((entry, position) => (position === index ? step : entry));
          })
      );
      setScan(body.audit);
      setAuditId(body.audit.id);
      const project = body.audit.projectId ?? scanProjectId;
      if (project) setScanProjectId(project);
      // The password exists to be used once: it leaves the form as soon as the scan starts.
      setPassword("");
      // The server already compared this scan to the previous one; reloading the board
      // shows the same comparison next to the four workflow states.
      await Promise.all([loadHistory(), loadCorrections(project)]);
    } catch (caught) {
      setError(caught as ApiError);
      setSteps((current) =>
        current.map((step) => (step.status === "running" ? { ...step, status: "failed" } : step))
      );
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
      const body = await apiFetch<{ id: string; projectId: string | null; result: ScanResult }>(
        `/api/v1/audits/${id}?workspaceId=${session.workspaceId}`
      );
      setScan(body.result);
      setAuditId(body.id);
      const project = body.projectId ?? scanProjectId;
      if (project) setScanProjectId(project);
      await loadCorrections(project);
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  /** The report the model reads: facts, counts, and what could not be measured. */
  const reportForModel = useCallback((): string => {
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
  }, [scan]);

  const explain = useCallback(async () => {
    if (!session.workspaceId || !scan || explaining) return;
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
  }, [session.workspaceId, scan, explaining, fr, reportForModel]);

  // The project page asks for the reading in the URL, so the user lands on it, not on a
  // button. The ref keeps a re-render from sending the same report twice.
  useEffect(() => {
    if (!wantsExplanation || !scan || !auditId) return;
    if (explainedFor.current === auditId) return;
    explainedFor.current = auditId;
    void explain();
  }, [wantsExplanation, scan, auditId, explain]);

  const loadVerification = async () => {
    if (!session.workspaceId) return;
    setShowVerify(true);
    if (verify) return;
    try {
      const body = await apiFetch<{
        metaTag: string;
        wellKnownContent: string;
        wellKnownPath: string;
        instructions: string;
      }>(`/api/v1/audits/verification-token?workspaceId=${session.workspaceId}`);
      setVerify(body);
    } catch (caught) {
      setError(caught as ApiError);
    }
  };

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600);
    } catch {
      // Clipboard refused: the text stays selectable, which is enough.
    }
  };

  const grouped = (module: string) =>
    (scan?.findings ?? []).filter((item) => item.module === module);

  // A reading that needs no model: what is broken, how much, and what to touch first.
  // The AI card below adds judgement; this line still says something true without a key.
  const failing = (scan?.findings ?? []).filter((item) => item.status === "FAIL");
  const warning = (scan?.findings ?? []).filter((item) => item.status === "WARN");
  const plainSummary = !scan
    ? null
    : `${
        fr
          ? `${failing.length} problème${failing.length === 1 ? "" : "s"} bloquant${failing.length === 1 ? "" : "s"}, ${warning.length} avertissement${warning.length === 1 ? "" : "s"}.`
          : `${failing.length} blocking issue${failing.length === 1 ? "" : "s"}, ${warning.length} warning${warning.length === 1 ? "" : "s"}.`
      }${
        failing.length > 0
          ? ` ${fr ? "À corriger d'abord :" : "Fix first:"} ${failing
              .slice(0, 3)
              .map((item) => `${item.id} (${item.why})`)
              .join(" · ")}`
          : ""
      }`;

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
          <div
            className="scan-auth-modes"
            role="tablist"
            aria-label={fr ? "Méthode de connexion" : "Sign-in method"}
          >
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "account"}
              className={authMode === "account" ? "is-active" : ""}
              onClick={() => setAuthMode("account")}
            >
              {fr ? "Compte du site" : "Site account"}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "cookie"}
              className={authMode === "cookie" ? "is-active" : ""}
              onClick={() => setAuthMode("cookie")}
            >
              Cookie
            </button>
          </div>

          {authMode === "account" ? (
            <div className="scan-auth-grid">
              <p className="scan-auth-hint">
                {fr
                  ? "Crée de préférence un compte dédié à l'audit sur le site, avec un rôle de lecture. L'app s'en sert pour voir les pages derrière le login, puis oublie tout : rien n'est stocké."
                  : "Preferably create an account dedicated to the audit on the site, with a read-only role. The app uses it to see the pages behind the login, then forgets it: nothing is stored."}
              </p>
              <label className="scan-field">
                <span>{fr ? "Adresse de connexion" : "Login endpoint"}</span>
                <input
                  type="url"
                  value={loginUrl}
                  onChange={(event) => setLoginUrl(event.target.value)}
                  placeholder="https://ton-site.com/api/auth/sign-in"
                  className="app-input"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label className="scan-field">
                <span>{fr ? "Email du compte d'audit" : "Audit account email"}</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="audit@ton-site.com"
                  className="app-input"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label className="scan-field">
                <span>{fr ? "Mot de passe" : "Password"}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="app-input"
                  autoComplete="off"
                />
              </label>
            </div>
          ) : (
            <div className="scan-auth-grid">
              <p className="scan-auth-hint">
                {fr
                  ? "Colle l'en-tête Cookie de ton navigateur. Il sert à la requête, n'est pas stocké et n'apparaît pas dans l'historique."
                  : "Paste your browser's Cookie header. It is used for the request, not stored, and not shown in history."}
              </p>
              <label className="scan-field">
                <span>{fr ? "Cookie de session" : "Session cookie"}</span>
                <input
                  type="text"
                  value={cookie}
                  onChange={(event) => setCookie(event.target.value)}
                  placeholder="session=…; other=…"
                  className="app-input"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
            </div>
          )}
        </Card>
      ) : null}

      {!scan && steps.length === 0 ? (
        <Card className="scan-preview">
          <p className="scan-preview-head">
            {fr ? "CE QUE L'ADRESSE VA SUBIR" : "WHAT THE ADDRESS GOES THROUGH"}
          </p>
          <ul className="scan-preview-grid">
            {[
              {
                id: "fail",
                note: fr ? "entêtes, cookies, CSP, exposition" : "headers, cookies, CSP, exposure",
              },
              {
                id: "clean",
                note: fr
                  ? "titres, contrastes, labels, poids"
                  : "headings, contrast, labels, weight",
              },
              {
                id: "flow",
                note: fr ? "parcours critique, bouton à bouton" : "critical journey, end to end",
              },
              {
                id: "world",
                note: fr ? "noms, montants, dates, locales" : "names, amounts, dates, locales",
              },
              {
                id: "exit",
                note: fr ? "export, aller-retour, intégrité" : "export, round-trip, integrity",
              },
            ].map((module) => (
              <li key={module.id} className="scan-preview-item">
                <span className="scan-preview-id">{module.id.toUpperCase()}</span>
                <span className="scan-preview-name">
                  {MODULE_LABELS[module.id]?.[fr ? "fr" : "en"]}
                </span>
                <span className="scan-preview-note">{module.note}</span>
              </li>
            ))}
          </ul>
          <p className="scan-preview-foot">
            {fr
              ? "Chaque lecture produit un constat nommé, avec ce qui a été observé et pourquoi. Rien n'est simulé."
              : "Each pass produces a named finding with what was observed and why. Nothing is simulated."}
          </p>
        </Card>
      ) : null}

      {error ? <ErrorState error={error} onRetry={() => void run()} /> : null}

      {steps.length > 0 ? (
        <Card className="scan-progress-card">
          <p className="scan-findings-head">
            {fr ? "DÉROULÉ RÉEL" : "REAL RUN"}{" "}
            <span>
              {fr ? "écrit par le serveur, pas animé" : "written by the server, not animated"}
            </span>
          </p>
          <ol className="scan-progress-list">
            {steps.map((step) => (
              <li key={step.id} className={`scan-progress-step is-${step.status}`}>
                <span className="scan-progress-mark" aria-hidden>
                  {step.status === "done" ? (
                    <Check size={12} />
                  ) : step.status === "failed" ? (
                    <X size={12} />
                  ) : step.status === "running" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <span className="scan-progress-dot" />
                  )}
                </span>
                <span className="scan-progress-label">{step.label}</span>
                {step.detail ? <span className="scan-progress-detail">{step.detail}</span> : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

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
            <span className={`scan-ownership is-${scan.ownership ?? "unverified"}`}>
              {scan.ownership === "local"
                ? fr
                  ? "Local"
                  : "Local"
                : scan.ownership === "verified"
                  ? fr
                    ? "Propriétaire vérifié"
                    : "Verified owner"
                  : fr
                    ? "Site distant non vérifié"
                    : "Remote, unverified"}
            </span>
            <button
              type="button"
              className="app-btn app-btn-primary"
              onClick={() => void explain()}
              disabled={explaining}
            >
              {explaining ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null}
              {fr ? "Interpréter avec l'IA" : "Interpret with AI"}
            </button>
          </div>

          {scan.login?.attempted && !scan.login.ok ? (
            <p className="scan-notice">
              <AlertTriangle size={13} aria-hidden />
              {fr
                ? `Le site a refusé les identifiants : le scan n'a vu que les pages publiques.${scan.login.reason ? ` (${scan.login.reason})` : ""}`
                : `The site refused the credentials, so the scan only saw public pages.${scan.login.reason ? ` (${scan.login.reason})` : ""}`}
            </p>
          ) : null}

          {scan.redacted ? (
            <div className="scan-ownership-gate">
              <p className="scan-ownership-title">
                <Eye size={13} aria-hidden />
                {fr ? "Failles réelles, emplacements masqués" : "Real weaknesses, hidden locations"}
              </p>
              <p>
                {fr
                  ? "Ce site n'est pas prouvé comme le tien : le scan dit ce qui ne va pas, pas où exactement. C'est ce qui empêche l'outil de servir de carte à un attaquant."
                  : "This site is not proven to be yours: the scan says what is wrong, not exactly where. That is what stops the tool from becoming a map for an attacker."}
              </p>
              <button
                type="button"
                className="app-btn app-btn-sm"
                onClick={() => void loadVerification()}
              >
                {fr ? "Prouver que ce site est le mien" : "Prove this site is mine"}
              </button>
              {showVerify ? (
                verify ? (
                  <div className="scan-verify">
                    <p className="scan-auth-hint">{verify.instructions}</p>
                    <div className="scan-verify-row">
                      <code>{verify.metaTag}</code>
                      <button
                        type="button"
                        className="app-btn app-btn-sm"
                        onClick={() => void copy(verify.metaTag, "meta")}
                      >
                        {copied === "meta" ? (
                          <Check size={13} aria-hidden />
                        ) : (
                          <Eye size={13} aria-hidden />
                        )}
                        {fr ? "Copier la balise" : "Copy the tag"}
                      </button>
                    </div>
                    <div className="scan-verify-row">
                      <code>{verify.wellKnownPath}</code>
                      <code>{verify.wellKnownContent}</code>
                      <button
                        type="button"
                        className="app-btn app-btn-sm"
                        onClick={() => void copy(verify.wellKnownContent, "file")}
                      >
                        {copied === "file" ? (
                          <Check size={13} aria-hidden />
                        ) : (
                          <Eye size={13} aria-hidden />
                        )}
                        {fr ? "Copier le contenu" : "Copy the content"}
                      </button>
                    </div>
                    <p className="scan-auth-hint">
                      {fr
                        ? "Publie l'un des deux, puis relance le scan : les emplacements exacts apparaîtront."
                        : "Publish either one, then re-run the scan: the exact locations will appear."}
                    </p>
                  </div>
                ) : (
                  <p className="scan-auth-hint">
                    {fr ? "Chargement du jeton…" : "Loading the token…"}
                  </p>
                )
              ) : null}
            </div>
          ) : null}

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

          {plainSummary ? (
            <p className="scan-notice">
              <ScanLine size={13} aria-hidden />
              {plainSummary}
            </p>
          ) : null}

          {explanation || explainError ? (
            <Card className="scan-ai">
              <p className="scan-ai-head">{fr ? "Lecture de l'IA" : "AI reading"}</p>
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

          {scanProjectId ? (
            <Card className="scan-corrections">
              <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
                <div>
                  <p className="scan-findings-head">
                    {fr ? "SUIVI DES CORRECTIONS" : "CORRECTION TRACKING"}{" "}
                    <span>
                      {fr ? "quatre états, et un re-contrôle" : "four states, and a re-check"}
                    </span>
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    {fr
                      ? "Un état décrit votre travail, pas le verdict du site. Seul un nouveau scan dit si le problème a disparu : « Re-contrôler » relance la même adresse et compare par identifiant de constat."
                      : "A state describes your work, not the site's verdict. Only a new scan says whether the problem is gone: “Re-check” runs the same address again and compares by finding id."}
                  </p>
                </div>
                <button
                  type="button"
                  className="app-btn app-btn-sm"
                  onClick={() => void run()}
                  disabled={busy}
                >
                  <RefreshCw size={13} className={busy ? "animate-spin" : undefined} />{" "}
                  {busy ? (fr ? "Re-contrôle…" : "Re-checking…") : fr ? "Re-contrôler" : "Re-check"}
                </button>
              </div>

              {corrections?.comparison ? (
                <div className="mx-5 mt-3 rounded-[var(--radius)] bg-surface-alt px-3 py-2 text-xs">
                  <p className="font-medium">
                    {fr ? "Comparaison avec le scan précédent" : "Compared with the previous scan"}:{" "}
                    <span className="text-success">
                      {corrections.comparison.counts.resolved} {fr ? "corrigés" : "resolved"}
                    </span>
                    {" · "}
                    <span className="text-warning">
                      {corrections.comparison.counts.persisting}{" "}
                      {fr ? "toujours présents" : "still present"}
                    </span>
                    {" · "}
                    <span className="text-danger">
                      {corrections.comparison.counts.appeared} {fr ? "nouveaux" : "new"}
                    </span>
                  </p>
                  {corrections.comparison.resolved.length > 0 ? (
                    <p className="mt-1 text-muted">
                      {fr ? "Disparus :" : "Gone:"}{" "}
                      {corrections.comparison.resolved.map((item) => item.id).join(" · ")}
                    </p>
                  ) : null}
                  {corrections.comparison.appeared.length > 0 ? (
                    <p className="mt-1 text-muted">
                      {fr ? "Apparus :" : "New:"}{" "}
                      {corrections.comparison.appeared.map((item) => item.id).join(" · ")}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mx-5 mt-3 text-xs text-muted">
                  {fr
                    ? "Aucune comparaison encore : ce scan est le premier de ce projet. Le prochain re-contrôle en produira une."
                    : "No comparison yet: this is the project's first scan. The next re-check will produce one."}
                </p>
              )}

              {correctionsError ? (
                <p className="mx-5 mt-2 text-xs text-danger">{correctionsError}</p>
              ) : null}

              {corrections && corrections.items.length > 0 ? (
                <ul className="mt-3 divide-y divide-border">
                  {corrections.items.map((item) => (
                    <li
                      key={item.key}
                      className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm"
                    >
                      <span
                        className={`scan-finding-status ${STATUS_STYLE[item.status as ScanStatus] ?? ""}`}
                      >
                        {statusIcon(item.status as ScanStatus)}
                        {item.status}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="app-mono text-xs">
                          {item.id}
                          {controls[`${item.module}:${item.id}`] ? (
                            <span className="scan-finding-title">
                              {controls[`${item.module}:${item.id}`]?.title}
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-muted">{item.observed}</p>
                        {!item.present ? (
                          <p className="text-xs text-success">
                            {fr
                              ? "Absent du dernier scan — confirmez s'il est réellement corrigé."
                              : "Absent from the latest scan — confirm it is actually fixed."}
                          </p>
                        ) : null}
                        {item.verification?.verdict ? (
                          <p className={`text-xs ${VERDICT_COPY[item.verification.verdict].tone}`}>
                            {VERDICT_COPY[item.verification.verdict][fr ? "fr" : "en"]}
                            {item.verification.observed ? ` · ${item.verification.observed}` : ""}
                            <span className="text-muted">
                              {" "}
                              {new Date(item.verification.at).toLocaleString(
                                fr ? "fr-FR" : "en-GB",
                                { dateStyle: "short", timeStyle: "short" }
                              )}
                            </span>
                          </p>
                        ) : null}
                      </div>
                      {item.status === "FAIL" || item.status === "WARN" ? (
                        <button
                          type="button"
                          className="app-button app-button-ghost text-xs"
                          disabled={verifyingCorrection !== null}
                          onClick={() => void verifyCorrection(item.key)}
                          title={
                            fr
                              ? "Relit cette page maintenant et compare ce contrôle à ce qu'il était."
                              : "Reads this page again now and compares this control to what it was."
                          }
                        >
                          {verifyingCorrection === item.key ? (
                            <Loader2 size={13} className="animate-spin" aria-hidden />
                          ) : (
                            <RefreshCw size={13} aria-hidden />
                          )}
                          {fr ? "Vérifier" : "Verify"}
                        </button>
                      ) : null}
                      <label className="text-xs text-muted">
                        <span className="sr-only">
                          {fr ? `État de ${item.id}` : `State of ${item.id}`}
                        </span>
                        <select
                          className="app-input"
                          value={item.state}
                          disabled={savingCorrection === item.key}
                          onChange={(event) =>
                            void setCorrection(item.key, event.target.value as CorrectionState)
                          }
                        >
                          {(Object.keys(CORRECTION_LABELS) as CorrectionState[]).map((state) => (
                            <option key={state} value={state}>
                              {CORRECTION_LABELS[state][fr ? "fr" : "en"]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-3 text-xs text-muted">
                  {fr
                    ? "Aucun constat à suivre sur le dernier scan de ce projet."
                    : "No finding to track on this project's latest scan."}
                </p>
              )}
            </Card>
          ) : (
            <p className="scan-notice">
              <ScanLine size={13} aria-hidden />
              {fr
                ? "Ce scan n'est rattaché à aucun projet : il n'a pas de baseline pour un re-contrôle. Lancez-le depuis la page d'un projet pour suivre ses corrections."
                : "This scan is not attached to a project, so there is no baseline to compare against. Start it from a project page to track corrections."}
            </p>
          )}

          {(["fail", "clean", "flow", "world", "exit"] as const).map((module) => {
            const items = grouped(module);
            if (items.length === 0) return null;
            return (
              <Card key={module} className="scan-findings">
                <p className="scan-findings-head">
                  {module.toUpperCase()} <span>{MODULE_LABELS[module]?.[fr ? "fr" : "en"]}</span>
                </p>
                <ul>
                  {items.map((item) => {
                    const copy = controls[`${item.module}:${item.id}`];
                    const fixable = item.status === "FAIL" || item.status === "WARN";
                    return (
                      <li key={item.id} className={STATUS_STYLE[item.status]}>
                        <span className="scan-finding-status">
                          {statusIcon(item.status)}
                          {item.status}
                        </span>
                        <div className="scan-finding-body">
                          <p className="scan-finding-id">
                            {item.id}
                            {copy ? <span className="scan-finding-title">{copy.title}</span> : null}
                          </p>
                          <p className="scan-finding-observed">{item.observed}</p>
                          <p className="scan-finding-why">{item.why}</p>
                          {copy && fixable ? (
                            <details className="scan-finding-explain">
                              <summary>
                                {fr ? "Comprendre et corriger" : "Understand and fix"}
                              </summary>
                              <dl>
                                <dt>{fr ? "Ce qui est établi" : "What is established"}</dt>
                                <dd>{copy.objective}</dd>
                                <dt>{fr ? "Ce que cela expose" : "What it exposes"}</dt>
                                <dd>{copy.consequence}</dd>
                                <dt>{fr ? "Le correctif" : "The fix"}</dt>
                                <dd>{copy.fix}</dd>
                                {copy.fixes.length > 0 ? (
                                  <>
                                    <dt>{fr ? "Exemple" : "Example"}</dt>
                                    <dd>
                                      {copy.fixes.map((example) => (
                                        <div key={example.stack} className="scan-fix-example">
                                          <span className="scan-fix-stack">{example.stack}</span>
                                          <pre>{example.code}</pre>
                                        </div>
                                      ))}
                                    </dd>
                                  </>
                                ) : null}
                                <dt>{fr ? "Comment vérifier" : "How to verify"}</dt>
                                <dd>{copy.verify}</dd>
                              </dl>
                            </details>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
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
