import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ErrorState, SkeletonCards } from "../ui/Feedback";

export type Query<T> = {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /** Es liegen Daten vor, werden aber gerade neu geladen. */
  refreshing: boolean;
  reload: () => void;
  setData: (fn: (prev: T) => T) => void;
};

/** Lädt Daten beim Einblenden und bei Änderung von `deps`; `reload()` holt neu, ohne den Inhalt zu leeren. */
export function useQuery<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): Query<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const firstFor = useRef<string>("");

  useEffect(() => {
    const ctrl = new AbortController();
    const key = JSON.stringify(deps);
    const keyChanged = firstFor.current !== key;
    firstFor.current = key;
    if (keyChanged) setDataState(undefined);
    setLoading(true);
    setError(null);
    loadRef
      .current(ctrl.signal)
      .then((d) => {
        if (!ctrl.signal.aborted) {
          setDataState(d);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(e);
        setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((fn: (prev: T) => T) => setDataState((p) => (p === undefined ? p : fn(p))), []);
  return { data, error, loading, refreshing: loading && data !== undefined, reload, setData };
}

/** Zeigt Skeleton, Fehler mit «Erneut versuchen» oder den Inhalt. */
export function QueryView<T>({
  query,
  skeleton,
  children,
}: {
  query: Query<T>;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.error) return <ErrorState error={query.error} onRetry={query.reload} />;
  return <>{skeleton ?? <SkeletonCards />}</>;
}
