import { useEffect, useState } from 'react';

import type {
  DeltaForQuery,
  QueryName,
  QueryParams,
  SnapshotForQuery,
} from '@eveys-console/protocol';

import { useConsoleClient } from '../lib/ws-context';

export interface SubscriptionState<S, D> {
  loading: boolean;
  error: string | null;
  snapshot: S | null;
  lastDelta: D | null;
  cursor: string | null;
}

export function useSubscription<S extends SnapshotForQuery, D extends DeltaForQuery>(
  query: QueryName,
  params: QueryParams,
): SubscriptionState<S, D> {
  const { client, status } = useConsoleClient();
  const [state, setState] = useState<SubscriptionState<S, D>>({
    loading: true,
    error: null,
    snapshot: null,
    lastDelta: null,
    cursor: null,
  });

  useEffect(() => {
    if (status !== 'open') return;
    let unsub: (() => void) | null = null;
    let cancelled = false;

    void client
      .subscribe(query, params, {
        onSnapshot: (snapshot, cursor) => {
          if (cancelled) return;
          setState((prev) => ({
            ...prev,
            loading: false,
            snapshot: snapshot as S,
            cursor,
          }));
        },
        onDelta: (delta, cursor) => {
          if (cancelled) return;
          setState((prev) => ({ ...prev, lastDelta: delta as D, cursor }));
        },
        onError: (msg) => {
          if (cancelled) return;
          setState((prev) => ({ ...prev, error: msg, loading: false }));
        },
      })
      .then((handle) => {
        unsub = handle.unsubscribe;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'subscription failed',
        }));
      });

    return () => {
      cancelled = true;
      unsub?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, status, query, JSON.stringify(params)]);

  return state;
}
