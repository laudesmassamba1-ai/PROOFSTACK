import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../../i18n/index.js";
import type { ApiError } from "../../lib/api.js";
import { errorText } from "../../lib/errorText.js";
import { TesterScene, type TesterVariant } from "./Testers.js";

/**
 * Small dashboard primitives.
 *
 * Status colours are semantic, not decorative: success for a verified pass, danger
 * for a product defect, warning for something that ran but proved nothing.
 */
const STATUS_LABELS = {
  PASSED: "ws.status.passed",
  FAILED: "ws.status.failed",
  COMPLETED: "ws.status.completed",
  PARTIAL: "ws.status.partial",
  WARNING: "ws.status.warning",
  SKIPPED: "ws.status.skipped",
  ERROR: "ws.status.error",
  NOTHING_VERIFIED: "ws.status.nothingVerified",
  PENDING: "ws.status.pending",
  RUNNING: "ws.status.running",
  CANCELLED: "ws.status.cancelled",
  ACTIVE: "ws.status.active",
  SUCCEEDED: "ws.status.succeeded",
  PAID: "ws.status.paid",
  EXPIRED: "ws.status.expired",
  PAST_DUE: "ws.status.pastDue",
  GRACE_PERIOD: "ws.status.gracePeriod",
  PROCESSING: "ws.status.processing",
  FREE: "ws.status.free",
  NONE: "ws.status.none",
} as const;

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const normalized = status.toUpperCase();
  const labelKey = STATUS_LABELS[normalized as keyof typeof STATUS_LABELS];
  const tone =
    normalized === "PASSED" ||
    normalized === "COMPLETED" ||
    normalized === "ACTIVE" ||
    normalized === "SUCCEEDED" ||
    normalized === "PAID"
      ? "app-badge-success"
      : normalized === "FAILED" || normalized === "ERROR" || normalized === "EXPIRED"
        ? "app-badge-danger"
        : normalized === "WARNING" ||
            normalized === "PARTIAL" ||
            normalized === "PAST_DUE" ||
            normalized === "GRACE_PERIOD" ||
            normalized === "PENDING" ||
            normalized === "PROCESSING"
          ? "app-badge-warning"
          : normalized === "SKIPPED" ||
              normalized === "NOTHING_VERIFIED" ||
              normalized === "CANCELLED"
            ? ""
            : "app-badge-accent";
  return (
    <span className={`app-badge ${tone}`}>
      {labelKey ? t(labelKey) : normalized.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  enhanced?: boolean;
}) {
  return (
    <section className={`app-card ${className}`}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="app-card px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-[1.35rem] font-semibold leading-none">{value}</p>
      {hint ? <p className="mt-2 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="app-loading-inline">
      <TesterScene variant="working" />
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}

/**
 * The single place an API failure becomes a sentence.
 *
 * The API speaks English (CLI, logs, webhook debugging all read those messages), while
 * this interface is bilingual. Translating per page is how "The current password is
 * incorrect." ended up in the middle of a French settings screen: some pages did it, most
 * did not. `errorText` maps the stable `code`, and anything unmapped keeps the API's own
 * wording rather than inventing a vaguer local one.
 */
export function ErrorState({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  const { locale } = useI18n();
  const fr = locale === "fr";
  const isApi = "code" in error;
  return (
    <div role="alert" className="app-card flex items-start gap-3 border-danger/40 px-5 py-4">
      <CircleAlert size={17} className="mt-0.5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium">{errorText(error, fr)}</p>
        {isApi ? <p className="mt-1 text-xs text-muted">Code: {(error as ApiError).code}</p> : null}
        {onRetry ? (
          <button type="button" className="app-btn mt-3" onClick={onRetry}>
            {fr ? "Réessayer" : "Retry"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Empty({
  title,
  body,
  action,
  tester = "empty",
}: {
  title: string;
  body: string;
  action?: ReactNode;
  tester?: TesterVariant | false;
}) {
  return (
    <div className="app-empty">
      {tester ? <TesterScene variant={tester} /> : null}
      <p className="app-empty-title">{title}</p>
      <p className="app-empty-body">{body}</p>
      {action ? <div className="app-empty-action">{action}</div> : null}
    </div>
  );
}

export function Cannot({ reason }: { reason: string }) {
  return (
    <p className="border-t border-line px-5 py-3 text-xs text-muted" role="note">
      {reason}
    </p>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  /** Id of the control passed as children; explicit association, not a wrapper guess. */
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="app-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : null}
      {hint && !error ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </div>
  );
}
