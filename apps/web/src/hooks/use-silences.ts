// React Query hook for the silences proxy. Polled separately from
// firing alerts (different React Query key) so the two panels can
// invalidate independently — a silence creation re-fetches both, but
// a poll of the firing list doesn't blow away the silences cache.
//
// Same 30 s cadence as firing alerts: Alertmanager only re-evaluates
// silence windows roughly every 15 s, polling faster just burns
// requests.

import { useQuery } from '@tanstack/react-query';

import { fetchSilences, type Silence } from '@/api/alerts-client';
import { useConsoleClient } from '@/lib/ws-context';

export interface UseSilences {
  silences: Silence[];
  unavailable: boolean;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useSilences(): UseSilences {
  const { token } = useConsoleClient();
  const q = useQuery({
    queryKey: ['silences'],
    queryFn: () => fetchSilences(token!),
    enabled: !!token,
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  return {
    silences: q.data?.silences ?? [],
    unavailable: q.data?.unavailable ?? false,
    loading: q.isLoading,
    error: q.error instanceof Error ? q.error : null,
    refetch: () => {
      q.refetch();
    },
  };
}
