// Helper hook: subscribe to `device-events` for a cp_id and
// invalidate the given React Query keys whenever a relevant kind
// of event arrives. Lets polling-backed surfaces (transactions,
// statistics, diagnostics) react instantly to gateway-side state
// changes without bumping their poll cadence.
//
// Why not collapse polling entirely? The Kafka tail is best-effort
// for these surfaces (the broker re-fetches a row on cp.status but
// transactions / diagnostics tables don't have a corresponding
// re-fetch subscription). Keeping a slow poll as a safety net means
// the worst case stays bounded; the WS push just makes the common
// case feel live.

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import type { DeviceEvent } from '@eveys-console/protocol';

import { useSubscription } from '@/hooks/use-subscription';

export interface CpInvalidateOpts {
  cpId: string;
  /** Query keys to invalidate when a matching event arrives. */
  queryKeys: readonly unknown[][];
  /** Which device-event kinds should trigger the invalidate. If
   *  omitted, every kind matches. Mirrors DeviceEvent['kind']. */
  kinds?: readonly DeviceEvent['kind'][];
}

export function useInvalidateOnCpEvents({ cpId, queryKeys, kinds }: CpInvalidateOpts): void {
  const sub = useSubscription('device-events', { cp_id: cpId });
  const qc = useQueryClient();
  // Dedupe: the subscription delivers each delta by reference. We
  // only want to invalidate once per delta, even when the parent
  // re-renders.
  const lastSeenRef = useRef<unknown>(null);

  useEffect(() => {
    const delta = sub.lastDelta;
    if (!delta || delta.kind !== 'device-events') return;
    if (lastSeenRef.current === delta.append) return;
    lastSeenRef.current = delta.append;
    if (kinds && !kinds.includes(delta.append.kind)) return;
    for (const key of queryKeys) {
      void qc.invalidateQueries({ queryKey: key });
    }
  }, [sub.lastDelta, qc, queryKeys, kinds]);
}
