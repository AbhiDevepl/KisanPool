/**
 * The one data-fetching shape every screen uses.
 *
 * Distinguishes three things the old screens conflated:
 *   loading    first paint, nothing on screen yet  -> skeleton
 *   refreshing user pulled, data still on screen   -> spinner in the RefreshControl
 *   error      the fetch failed                    -> <ErrorView /> with a retry
 *
 * `stale` marks data that is on screen but whose last refresh failed, so a screen
 * can keep showing it and say so rather than blanking out.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

export interface Loader<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: unknown;
  stale: boolean;
  refresh: () => void;
  /** re-run without touching any visible state — for socket-driven reconciliation */
  reconcile: () => Promise<void>;
  set: (updater: (previous: T) => T) => void;
}

export function useLoader<T>(
  fetcher: () => Promise<T>,
  options: { refetchOnFocus?: boolean } = {},
): Loader<T> {
  const { refetchOnFocus = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>();
  const [stale, setStale] = useState(false);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const hasData = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    if (mode === 'refresh') setRefreshing(true);
    if (mode === 'initial' && !hasData.current) setLoading(true);

    try {
      const result = await fetcherRef.current();
      if (!mounted.current) return;
      setData(result);
      hasData.current = true;
      setError(undefined);
      setStale(false);
    } catch (err) {
      if (!mounted.current) return;
      // data already on screen stays there; it is just marked stale
      if (hasData.current) setStale(true);
      else setError(err);
    } finally {
      if (!mounted.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (refetchOnFocus || !hasData.current) void run(hasData.current ? 'silent' : 'initial');
    }, [run, refetchOnFocus]),
  );

  const refresh = useCallback(() => {
    setError(undefined);
    void run('refresh');
  }, [run]);

  const reconcile = useCallback(() => run('silent'), [run]);

  const set = useCallback((updater: (previous: T) => T) => {
    setData((previous) => (previous == null ? previous : updater(previous)));
  }, []);

  return { data, loading, refreshing, error, stale, refresh, reconcile, set };
}
