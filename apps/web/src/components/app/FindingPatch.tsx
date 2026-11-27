import { Check, Copy, FileCode2, Loader2, Play, RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { useI18n } from "../../i18n/index.js";
import { type ApiError, apiFetch } from "../../lib/api.js";
import { errorText } from "../../lib/errorText.js";
import type { Remediation } from "./FindingRemediation.js";

/**
 * Prepare a code patch for one finding, with the product's assistant.
 *
 * The server does the honest part: it locates the uploaded file, asks the model for a
 * strict replacement, then verifies the `before` lines against the real file before it
 * returns a diff. This panel shows that verified diff, copies it, and offers a confirmed
 * "apply, then verify" step. The server never writes the target: the person applies the
 * diff, and a second measurement is what can prove it.
 */

interface Props {
  workspaceId: string;
  analysisId: string;
  findingKey: string;
  /** Called with the remediation after a verification run, so the panel can refresh. */
  onVerified?: (remediation: Remediation) => void;
}

interface PatchResult {
  patch: {
    diff: string;
    path: string;
    line: number;
    linesAdded: number;
    linesRemoved: number;
    rationale: string;
  } | null;
  reason?: string;
  message?: string;
}

interface VerificationResult {
  analysisId: string;
  outcome: "verified" | "still_failing" | "inconclusive";
  reason: string;
  verified: boolean;
  remediation: Remediation | null;
}

export function FindingPatch({ workspaceId, analysisId, findingKey, onVerified }: Props) {
  const { locale } = useI18n();
  const fr = locale === "fr";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [result, setResult] = useState<PatchResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [verifyStage, setVerifyStage] = useState<"idle" | "confirm">("idle");
  const [appliedConfirmed, setAppliedConfirmed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const applyId = useId();
  const [verification, setVerification] = useState<VerificationResult | null>(null);

  async function prepare() {
    setBusy(true);
    setError(null);
    setResult(null);
    setCopied(false);
    setVerification(null);
    setVerifyStage("idle");
    setAppliedConfirmed(false);
    try {
      setResult(
        await apiFetch<PatchResult>("/api/v1/ai/patch", {
          method: "POST",
          body: { workspaceId, analysisId, findingKey },
          timeoutMs: 30_000,
        })
      );
    } catch (caught) {
      setError(caught as ApiError | Error);
    } finally {
      setBusy(false);
    }
  }

  async function runVerification() {
    setVerifying(true);
    setError(null);
    try {
      const body = await apiFetch<VerificationResult>(
        `/api/v1/analyses/${encodeURIComponent(analysisId)}/verify-patch`,
        {
          method: "POST",
          body: { workspaceId, findingKey, applied: true },
          timeoutMs: 60_000,
        }
      );
      setVerification(body);
      setVerifyStage("idle");
      if (body.remediation) onVerified?.(body.remediation);
    } catch (caught) {
      setError(caught as ApiError | Error);
    } finally {
      setVerifying(false);
    }
  }

  async function copy() {
    if (!result?.patch) return;
    try {
      await navigator.clipboard.writeText(result.patch.diff);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError(
        new Error(
          fr
            ? "Le navigateur a refusé l'accès au presse-papiers."
            : "The browser refused clipboard access."
        )
      );
    }
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="app-btn app-btn-sm"
          disabled={busy}
          onClick={() => void prepare()}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <FileCode2 size={13} />}
          {busy
            ? fr
              ? "Préparation…"
              : "Preparing…"
            : fr
              ? "Préparer un patch"
              : "Prepare a patch"}
        </button>
        {result?.patch ? (
          <button type="button" className="app-btn app-btn-sm" onClick={() => void copy()}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? (fr ? "Copié" : "Copied") : fr ? "Copier le diff" : "Copy the diff"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-1 text-[0.68rem] text-danger">
          {errorText(error, fr)}
        </p>
      ) : null}

      {result?.patch ? (
        <>
          <p className="mt-2 text-[0.68rem] leading-relaxed text-muted">
            {fr ? "Proposition — rien n'est appliqué." : "Proposal — nothing is applied."}{" "}
            <code className="app-mono">
              {result.patch.path}:{result.patch.line}
            </code>{" "}
            (+{result.patch.linesAdded}/-{result.patch.linesRemoved})
          </p>
          {result.patch.rationale ? (
            <p className="mt-1 text-[0.68rem] text-muted">{result.patch.rationale}</p>
          ) : null}
          <pre className="mt-1 max-h-72 overflow-auto rounded-[var(--radius)] bg-surface-alt px-3 py-2 text-[0.66rem] leading-relaxed">
            <code>{result.patch.diff}</code>
          </pre>

          <div className="mt-2 rounded-[var(--radius)] bg-surface-alt px-3 py-2">
            <p className="text-[0.68rem] leading-relaxed text-muted">
              {fr
                ? "PROOFCORE n'applique pas ce patch. Applique-le, puis relis la cible : la vérification est une seconde mesure, pas une case à cocher."
                : "PROOFCORE does not apply this patch. Apply it, then re-read the target: verification is a second measurement, not a checkbox."}
            </p>
            {verification ? (
              <p
                role="status"
                className={`mt-1 text-[0.68rem] ${
                  verification.outcome === "verified"
                    ? "text-success"
                    : verification.outcome === "still_failing"
                      ? "text-danger"
                      : "text-warning"
                }`}
              >
                {verification.outcome === "verified"
                  ? fr
                    ? "Vérifié par l'analyse"
                    : "Verified by analysis"
                  : verification.outcome === "still_failing"
                    ? fr
                      ? "Toujours en échec"
                      : "Still failing"
                    : fr
                      ? "Non concluant"
                      : "Inconclusive"}{" "}
                <code className="app-mono">{verification.analysisId}</code> — {verification.reason}
              </p>
            ) : verifyStage === "confirm" ? (
              <div className="mt-1">
                <p className="text-[0.68rem] leading-relaxed text-warning">
                  {fr
                    ? "PROOFCORE ne peut pas écrire sur votre cible. Appliquez ce diff vous-même, puis confirmez : la vérification relira la cible et consommera une analyse."
                    : "PROOFCORE cannot write to your target. Apply this diff yourself, then confirm: verification re-reads the target and spends one analysis."}
                </p>
                <label
                  className="mt-1 flex items-start gap-2 text-[0.68rem] text-ink"
                  htmlFor={applyId}
                >
                  <input
                    id={applyId}
                    type="checkbox"
                    className="mt-0.5"
                    checked={appliedConfirmed}
                    disabled={verifying}
                    onChange={(event) => setAppliedConfirmed(event.target.checked)}
                  />
                  {fr
                    ? "J'ai appliqué ce diff sur la cible."
                    : "I have applied this diff to the target."}
                </label>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="app-btn app-btn-sm"
                    disabled={verifying || !appliedConfirmed}
                    onClick={() => void runVerification()}
                  >
                    {verifying ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Play size={13} />
                    )}
                    {fr ? "Confirmer et vérifier" : "Confirm and verify"}
                  </button>
                  <button
                    type="button"
                    className="app-btn app-btn-sm"
                    disabled={verifying}
                    onClick={() => {
                      setVerifyStage("idle");
                      setAppliedConfirmed(false);
                    }}
                  >
                    {fr ? "Annuler" : "Cancel"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="app-btn app-btn-sm mt-1"
                disabled={verifying}
                onClick={() => setVerifyStage("confirm")}
              >
                <RefreshCw size={13} />
                {fr ? "Appliquer le patch" : "Apply the patch"}
              </button>
            )}
          </div>
        </>
      ) : result ? (
        <p role="status" className="mt-1 text-[0.68rem] text-muted">
          {result.message ?? (fr ? "Aucun patch n'a été proposé." : "No patch was proposed.")}
        </p>
      ) : null}
    </div>
  );
}
