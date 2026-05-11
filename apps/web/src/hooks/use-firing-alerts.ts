// React Query hook for the firing-alerts proxy. Polls every 30 s
// because Alertmanager state changes on the order of minutes (the
// shortest `for:` window in our Phase 2 rules is 1 m); polling
// faster than that just burns requests without giving the operator
// fresher data. The 25 s `staleTime` keeps tab-switches from
// triggering an extra fetch.

import { useQuery } from '@tanstack/react-query';

import { fetchFiringAlerts, type AlertsUnavailableReason } from '@/api/alerts-client';
import type { Alert } from '@/lib/alerts';
import { useConsoleClient } from '@/lib/ws-context';

export interface UseFiringAlerts {
  alerts: Alert[];
  unavailable: boolean;
  /** When `unavailable === true`, describes why so the UI can tell
   *  the operator whether to wire Alertmanager (`not_configured`) or
   *  fix the upstream (`unreachable`). Undefined on the happy path. */
  reason?: AlertsUnavailableReason;
  loading: boolean;
  error: Error | null;
}

export function useFiringAlerts(): UseFiringAlerts {
  const { token } = useConsoleClient();
  const q = useQuery({
    queryKey: ['firing-alerts'],
    queryFn: () => fetchFiringAlerts(token!),
    enabled: !!token,
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  return {
    alerts: q.data?.alerts ?? [],
    // Treat "not yet loaded" as unavailable=false (no banner during the
    // first fetch); the loading spinner covers that case.
    unavailable: q.data?.unavailable ?? false,
    ...(q.data?.reason ? { reason: q.data.reason } : {}),
    loading: q.isLoading,
    error: q.error instanceof Error ? q.error : null,
  };
}
