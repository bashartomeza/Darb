import { useEffect, useRef, useState } from "react";

export type PagedResult<T> = { items: T[]; total: number };
export type PagedPhase = "loading" | "ready" | "error";

/**
 * Loads one page of a server-paged list and keeps its own loading and error
 * state. A reply for an older request (another page, filter or search) is
 * dropped, so a slow response cannot overwrite a newer one.
 */
export function usePagedList<T>(load: (page: number) => Promise<PagedResult<T>>, dependencies: unknown[]) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [phase, setPhase] = useState<PagedPhase>("loading");
  const [loaded, setLoaded] = useState(false);
  const request = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  async function fetchPage(target: number) {
    const current = ++request.current;
    setPhase("loading");
    try {
      const result = await loader.current(target);
      if (current !== request.current) return;
      setItems(result.items);
      setTotal(result.total);
      setLoaded(true);
      setPhase("ready");
    } catch {
      if (current === request.current) setPhase("error");
    }
  }

  // A new filter or search starts again from the first page.
  const filterKey = JSON.stringify(dependencies);
  const lastFilter = useRef(filterKey);
  useEffect(() => {
    if (lastFilter.current !== filterKey) {
      lastFilter.current = filterKey;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    void fetchPage(page);
  }, [page, filterKey]);

  useEffect(() => () => { request.current += 1; }, []);

  return {
    page,
    items,
    total,
    phase,
    /** True once any page has loaded: a refresh keeps the rows on screen. */
    loaded,
    setPage,
    reload: () => fetchPage(page)
  };
}

/** The value after it has stopped changing for `delayMs`; used for search boxes that query the server. */
export function useDebouncedValue<T>(value: T, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
