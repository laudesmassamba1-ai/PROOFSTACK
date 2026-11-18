import type { Context } from "hono";

/**
 * One pagination contract for every list endpoint.
 *
 * Before this module each list answered differently: findings had `{items,total,limit,
 * offset}`, runs had `{items}` with a `limit` that silently dropped the rest, the
 * workspace findings call capped at 100 with no way to reach the remainder, and the
 * conversation list stopped at 50 rows so an older thread simply disappeared. A client
 * cannot build "load more" against three shapes, and a list that truncates without
 * saying so is a data-visibility bug, not a performance choice.
 *
 * Rules this module enforces:
 *   - `limit` is clamped to [1, MAX_PAGE_SIZE]; an unparsable value falls back to the
 *     default instead of turning into `LIMIT NaN` at the SQL layer;
 *   - `offset` is never negative;
 *   - the response always carries `total`, so the UI can say "12 of 340" rather than
 *     pretending the page *is* the list.
 */

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export interface Page {
  limit: number;
  offset: number;
}

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function nonNegativeInt(raw: string | undefined): number {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

export function readPage(c: Context, defaults: { limit?: number; offset?: number } = {}): Page {
  return {
    limit: positiveInt(c.req.query("limit"), defaults.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    offset: nonNegativeInt(c.req.query("offset") ?? String(defaults.offset ?? 0)),
  };
}

export interface PageBody<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export function pageBody<T>(items: T[], total: number, page: Page): PageBody<T> {
  return { items, total, limit: page.limit, offset: page.offset };
}

/**
 * An exact count, with an explicit ceiling.
 *
 * Some tables can grow without a tenant-visible bound (findings on a long-running
 * project). Counting them is a real query, so the caller may pass `approx` when an
 * upper bound is enough for the UI: the body then says `totalIsExact: false` instead of
 * lying with a number the client would treat as final.
 */
export function pageBodyWithCount<T>(
  items: T[],
  total: number,
  page: Page,
  exact = true
): PageBody<T> & { totalIsExact: boolean } {
  return { ...pageBody(items, total, page), totalIsExact: exact };
}
