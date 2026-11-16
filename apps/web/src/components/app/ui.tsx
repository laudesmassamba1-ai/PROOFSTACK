import { CircleAlert, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { ApiError } from "../../lib/api.js";

/**
 * Small dashboard primitives.
 *
 * Status colours are semantic, not decorative: success for a verified pass, danger
 * for a product defect, warning for something that ran but proved nothing.
 */
export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
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
    <span className={`app-badge ${tone}`}>{normalized.replaceAll("_", " ").toLowerCase()}</span>
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
    <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted">
      <LoaderCircle size={15} className="animate-spin" /> {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  const isApi = "code" in error;
  return (
    <div className="app-card flex items-start gap-3 border-danger/40 px-5 py-4">
      <CircleAlert size={17} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0">
        <p className="text-sm font-medium">{error.message}</p>
        {isApi ? <p className="mt-1 text-xs text-muted">Code: {(error as ApiError).code}</p> : null}
        {onRetry ? (
          <button type="button" className="app-btn mt-3" onClick={onRetry}>
            Retry
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
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-[52ch] text-xs leading-relaxed text-muted">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
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
