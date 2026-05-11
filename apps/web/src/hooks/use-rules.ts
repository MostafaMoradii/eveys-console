// React Query binding for the Rules tab on /sys/alerts. Read-only —
// Prometheus rule definitions live in alerts.yml; the Console only
// displays them. Same 30s poll cadence as the other alert hooks;
// rule state ('inactive' / 'pending' / 'firing') changes slowly so
// staleness is harmless.

import { useQuery } from '@tanstack/react-query';

import { fetchRules, type RuleGroup } from '@/api/alerts-client';
import { useConsoleClient } from '@/lib/ws-context';

const RULES_KEY = ['alerts', 'rules'] as const;

export function useRules(): {
  groups: RuleGroup[];
  unavailable: boolean;
  loading: boolean;
  error: string | null;
} {
  const { token } = useConsoleClient();
  const q = useQuery({
    queryKey: RULES_KEY,
    queryFn: () => fetchRules(token!),
    refetchInterval: 30_000,
    staleTime: 25_000,
    enabled: !!token,
  });
  return {
    groups: q.data?.groups ?? [],
    unavailable: q.data?.unavailable ?? false,
    loading: q.isLoading,
    error: q.error instanceof Error ? q.error.message : null,
  };
}
