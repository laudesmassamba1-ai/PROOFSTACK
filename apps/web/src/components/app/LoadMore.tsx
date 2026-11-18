import { ChevronDown, Loader2 } from "lucide-react";
import type React from "react";

/**
 * The one "there is more" control.
 *
 * Three lists used to end without saying whether they were complete: runs stopped at the
 * requested limit, conversations stopped at a hard 50, findings had no control at all.
 * A truncated list that looks finished is a data-visibility bug — the reader concludes
 * the newest row is the last one. Every paged list now renders this, and the sentence
 * above the button states the real proportion ("25 of 340"), so the page can never be
 * mistaken for the whole.
 */
export function LoadMore({
  shown,
  total,
  loading,
  onLoad,
  fr,
  label,
  noun,
}: {
  shown: number;
  total: number;
  loading: boolean;
  onLoad: () => void;
  fr: boolean;
  /** Button text, e.g. "Charger 25 de plus". */
  label: string;
  /** Plural noun used in the counter, e.g. "constats". */
  noun: string;
}): React.ReactElement | null {
  if (shown >= total) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
      <p className="text-xs text-muted">
        {fr ? `${shown} sur ${total} ${noun}.` : `${shown} of ${total} ${noun}.`}
      </p>
      <button type="button" className="app-btn" onClick={onLoad} disabled={loading}>
        {loading ? (
          <Loader2 size={13} className="animate-spin" aria-hidden />
        ) : (
          <ChevronDown size={13} aria-hidden />
        )}
        {label}
      </button>
    </div>
  );
}
