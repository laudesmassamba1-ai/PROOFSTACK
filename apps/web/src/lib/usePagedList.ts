import { useCallback, useRef, useState } from "react";
import { type ApiError, apiFetch } from "./api.js";

/**
 * A paged list, kept honest.
 *
 * Every list that can grow (runs, findings, conversations) needs the same four things:
 * the rows already loaded, the server's total, a loading flag for the "more" control, and
 * an error that does not throw away what is already on screen. Written three times, the
 * copies drift — one forgets to append, another forgets to update the total, a third
 * reloads from offset 0 and duplicates rows.
 *
 * The hook takes an `append` parameter rather than assuming it: a page can be merged by
 * id (`uniqueBy`) so a row inserted between two requests cannot appear twice.
 */
export interface PagedList<T> {
  items: T[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: ApiError | Error | null;
  /** First page (or a fresh page after the underlying key changed). */
  reload: () => Promise<void>;
  /** Next page, appended. No-op when everything is already loaded. */
  loadMore: () => Promise<void>;
  setItems: (updater: (items: T[]) => T[]) => void;
  /** Local removal that also decrements the total (deleting a conversation, a run…). */
  remove: (predicate: (item: T) => boolean) => void;
}

export interface PagedOptions<T> {
  /** Builds the URL for a page. */
  url: (page: { limit: number; offset: number }) => string;
  limit?: number;
  /** Fields to read out of the response body; defaults match the API contract. */
  shape?: { items?: string; total?: string };
  uniqueBy?: (item: T) => string;
}

export function usePagedList<T>(options: PagedOptions<T>): PagedList<T> {
  const { url, limit = 25, uniqueBy } = options;
  const itemsKey = options.shape?.items ?? "items";
  const totalKey = options.shape?.total ?? "total";

  const [items, setItemsState] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  // A ref, not state: two clicks in the same tick must not both fire a request.
  const inFlight = useRef(false);

  const read = (body: Record<string, unknown>): { items: T[]; total: number } => {
    const pageItems = (body[itemsKey] as T[] | undefined) ?? [];
    const pageTotal =
      typeof body[totalKey] === "number" ? (body[totalKey] as number) : pageItems.length;
    return { items: pageItems, total: pageTotal };
  };

  // The readers and the URL builder are pure functions of the caller's props; listing them
  // as dependencies would only re-create the callbacks every render without changing what
  // they do, so the intent is stated here instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable by construction
  const reload = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const body = await apiFetch<Record<string, unknown>>(url({ limit, offset: 0 }));
      const page = read(body);
      setItemsState(page.items);
      setTotal(page.total);
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
    // `url`, `limit` and the readers are stable inputs of the caller's render.
  }, [url, limit]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: same stability as reload
  const loadMore = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoadingMore(true);
    setError(null);
    try {
      const body = await apiFetch<Record<string, unknown>>(url({ limit, offset: items.length }));
      const page = read(body);
      setItemsState((current) => {
        const merged = [...current, ...page.items];
        if (!uniqueBy) return merged;
        const seen = new Set<string>();
        return merged.filter((item) => {
          const key = uniqueBy(item);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });
      setTotal(page.total);
    } catch (caught) {
      // Keep what is on screen: a failed "load more" must not blank the list.
      setError(caught as ApiError);
    } finally {
      setLoadingMore(false);
      inFlight.current = false;
    }
  }, [url, limit, items.length, uniqueBy]);

  const setItems = useCallback((updater: (items: T[]) => T[]) => {
    setItemsState((current) => updater(current));
  }, []);

  const remove = useCallback((predicate: (item: T) => boolean) => {
    setItemsState((current) => {
      const next = current.filter((item) => !predicate(item));
      const removed = current.length - next.length;
      if (removed > 0) setTotal((value) => Math.max(0, value - removed));
      return next;
    });
  }, []);

  return { items, total, loading, loadingMore, error, reload, loadMore, setItems, remove };
}
