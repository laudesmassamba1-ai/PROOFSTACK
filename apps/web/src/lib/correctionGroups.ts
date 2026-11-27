import { CAUSE_LABELS, type CauseId, causeOf } from "@proofcore/core";

/**
 * The correction board groups by cause, not by module.
 *
 * Two missing headers are two rows but one task at the edge; a broken checkout link and a
 * missing form label are one journey investigation. The group is the unit of work, so the
 * groups are ordered by how much is still open, never by the order rows arrived in.
 */

export interface CorrectionIdentity {
  module: string;
  id: string;
  /** The correction workflow state; "fixed" is the only closed state here. */
  state: string;
  /** False when the finding disappeared from the latest scan but is still tracked. */
  present: boolean;
}

export interface CorrectionGroup<T extends CorrectionIdentity> {
  cause: CauseId;
  label: { fr: string; en: string };
  items: T[];
  /** Findings not marked fixed, including tracked ones that left the scan. */
  open: number;
  /** Findings someone already marked fixed. */
  fixed: number;
  /** Tracked findings absent from the latest scan, to confirm rather than assume fixed. */
  vanished: number;
}

export function groupCorrections<T extends CorrectionIdentity>(
  items: readonly T[]
): CorrectionGroup<T>[] {
  const buckets = new Map<CauseId, T[]>();
  for (const item of items) {
    const cause = causeOf(item.module, item.id);
    const bucket = buckets.get(cause);
    if (bucket) bucket.push(item);
    else buckets.set(cause, [item]);
  }

  return [...buckets.entries()]
    .map(([cause, groupItems]) => ({
      cause,
      label: CAUSE_LABELS[cause],
      items: groupItems,
      open: groupItems.filter((item) => item.state !== "fixed").length,
      fixed: groupItems.filter((item) => item.state === "fixed").length,
      vanished: groupItems.filter((item) => !item.present).length,
    }))
    .sort(
      (a, b) =>
        b.open - a.open || b.items.length - a.items.length || a.label.fr.localeCompare(b.label.fr)
    );
}
