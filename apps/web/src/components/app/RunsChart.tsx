import { Empty } from "./ui.js";

/**
 * A small, dependency-free execution chart.
 *
 * It consumes only the runs returned by `/overview`; it never extrapolates a
 * trend. Fewer than two uploaded runs produce an explicit empty state because a
 * single bar is not a history.
 */
interface ChartRun {
  id: string;
  projectName: string;
  status: string;
  startedAt: string;
  totals: Record<string, { passed: number; failed: number; warnings: number }>;
}

export function RunsChart({ runs }: { runs: ChartRun[] }) {
  if (runs.length < 2) {
    return (
      <Empty
        title="Not enough history yet"
        body="At least two uploaded runs are needed to draw an execution history. The chart is not extrapolated from a single result."
      />
    );
  }

  const recent = runs.slice(0, 14).reverse();
  const totals = recent.map((run) => {
    const values = Object.values(run.totals);
    return {
      passed: values.reduce((sum, item) => sum + item.passed, 0),
      failed: values.reduce((sum, item) => sum + item.failed, 0),
      warnings: values.reduce((sum, item) => sum + item.warnings, 0),
    };
  });
  const max = Math.max(1, ...totals.map((item) => item.passed + item.failed + item.warnings));

  return (
    <div className="px-5 py-5">
      <div className="flex h-44 items-end gap-1.5" role="img" aria-label="Execution history by run">
        {recent.map((run, index) => {
          const total = totals[index] ?? { passed: 0, failed: 0, warnings: 0 };
          const runTotal = total.passed + total.failed + total.warnings;
          const height = Math.max(3, Math.round((runTotal / max) * 100));
          return (
            <div
              key={run.id}
              className="group relative flex h-full min-w-0 flex-1 items-end"
              title={`${run.projectName} · ${run.status} · ${new Date(run.startedAt).toLocaleDateString()} · ${total.passed} passed / ${total.failed} failed / ${total.warnings} warning(s)`}
            >
              <div
                className="flex w-full flex-col justify-end overflow-hidden rounded-t-sm transition-opacity group-hover:opacity-75"
                style={{ height: `${height}%` }}
              >
                <div
                  className="w-full bg-warning/70"
                  style={{ height: `${(total.warnings / Math.max(1, runTotal)) * 100}%` }}
                />
                <div
                  className="w-full bg-danger/75"
                  style={{ height: `${(total.failed / Math.max(1, runTotal)) * 100}%` }}
                />
                <div
                  className="w-full bg-success/80"
                  style={{ height: `${(total.passed / Math.max(1, runTotal)) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.68rem] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2 rounded-sm bg-success/80" /> passed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2 rounded-sm bg-danger/75" /> failed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2 rounded-sm bg-warning/70" /> warnings
        </span>
        <span className="ml-auto font-mono">{recent.length} most recent runs</span>
      </div>
      <p className="mt-2 text-[0.7rem] leading-relaxed text-muted">
        Bar height is the number of cases in that run. Only uploaded runs are shown; skipped cases
        are not turned into passes.
      </p>
    </div>
  );
}
