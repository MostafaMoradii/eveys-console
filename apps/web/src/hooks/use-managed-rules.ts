// React Query bindings for the Console-managed Prometheus rules. Same
// 30s poll cadence as the other alert hooks; the live-state read in
// useRules() already polls the same window, so the two stay in sync.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createManagedRule,
  deleteManagedRule,
  fetchManagedRules,
  updateManagedRule,
  type ManagedAlertingRule,
  type ManagedRulesResponse,
} from '@/api/alerts-client';
import { useConsoleClient } from '@/lib/ws-context';

const MANAGED_RULES_KEY = ['alerts', 'rules', 'managed'] as const;

export function useManagedRules(): {
  rules: ManagedAlertingRule[];
  validationSkipped: boolean;
  loading: boolean;
  error: string | null;
} {
  const { token } = useConsoleClient();
  const q = useQuery({
    queryKey: MANAGED_RULES_KEY,
    queryFn: () => fetchManagedRules(token!),
    refetchInterval: 30_000,
    staleTime: 25_000,
    enabled: !!token,
  });
  return {
    rules: q.data?.managed ?? [],
    validationSkipped: q.data?.validation_skipped ?? false,
    loading: q.isLoading,
    error: q.error instanceof Error ? q.error.message : null,
  };
}

function useInvalidate(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: MANAGED_RULES_KEY });
    // The live-state hook (useRules) polls a separate query; nudge it
    // so the Rules tab's status badges refresh after a Prometheus
    // reload rather than waiting up to 30 s.
    void qc.invalidateQueries({ queryKey: ['alerts', 'rules'] });
  };
}

export function useCreateManagedRule() {
  const { token } = useConsoleClient();
  const invalidate = useInvalidate();
  return useMutation<ManagedRulesResponse, Error, ManagedAlertingRule>({
    mutationFn: (rule) => createManagedRule(token!, rule),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateManagedRule() {
  const { token } = useConsoleClient();
  const invalidate = useInvalidate();
  return useMutation<ManagedRulesResponse, Error, ManagedAlertingRule>({
    mutationFn: (rule) => updateManagedRule(token!, rule),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteManagedRule() {
  const { token } = useConsoleClient();
  const invalidate = useInvalidate();
  return useMutation<ManagedRulesResponse, Error, string>({
    mutationFn: (name) => deleteManagedRule(token!, name),
    onSuccess: () => invalidate(),
  });
}
