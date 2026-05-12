// Helper hook: subscribe to `device-events` for a cp_id and force-
// refetch the given React Query keys whenever a relevant kind of
// event arrives. Lets polling-backed surfaces (transactions,
// statistics, diagnostics) react instantly to gateway-side state
// changes without bumping their poll cadence.
//
// We use `refetchQueries` rather than `invalidateQueries` so a query
// that's already considered fresh (e.g. just polled 1s ago) still
// re-fetches when a state change arrives. invalidateQueries only
// marks-stale-and-fetches-if-active, which the React Query docs
// also say should trigger an active observer to refetch — but in
// practice on the per-charger Transactions card a new tx.started
// often didn't surface until the next poll cycle. refetchQueries
// is the louder hammer and matches the user-facing contract
// "events appear live."
//
// Why not collapse polling entirely? The Kafka tail is best-effort
// for these surfaces. Keeping a slow poll as a safety net means
// the worst case stays bounded; the WS push just makes the common
// case feel live.

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import type { DeviceEvent } from '@eveys-console/protocol';

import { useSubscription } from '@/hooks/use-subscription';

export interface CpInvalidateOpts {
  cpId: string;
  /** Query keys to refetch when a matching event arrives. */
  queryKeys: readonly unknown[][];
  /** Which device-event kinds should trigger the refetch. If
   *  omitted, every kind matches. Mirrors DeviceEvent['kind']. */
  kinds?: readonly DeviceEvent['kind'][];
}

export function useInvalidateOnCpEvents({ cpId, queryKeys, kinds }: CpInvalidateOpts): void {
  const sub = useSubscription('device-events', { cp_id: cpId });
  const qc = useQueryClient();
  // Dedupe: the subscription delivers each delta by reference. We
  // only want to refetch once per delta, even when the parent
  // re-renders.
  const lastSeenRef = useRef<unknown>(null);

  useEffect(() => {
    const delta = sub.lastDelta;
    if (!delta || delta.kind !== 'device-events') return;
    if (lastSeenRef.current === delta.append) return;
    lastSeenRef.current = delta.append;
    if (kinds && !kinds.includes(delta.append.kind)) return;
    for (const key of queryKeys) {
      // refetchQueries with `type: 'active'` only hits queries with
      // a live observer — saves work compared to refetching every
      // ever-mounted query for the same key. The prefix match in
      // React Query means `['cp-transactions', cpId]` covers
      // `['cp-transactions', cpId, pageSize, cursor]` automatically.
      void qc.refetchQueries({ queryKey: key, type: 'active' });
    }
  }, [sub.lastDelta, qc, queryKeys, kinds]);
}
