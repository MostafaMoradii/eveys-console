// React Query mutation wrappers for create + expire silence. Both
// invalidate `['silences']` AND `['firing-alerts']` on success so the
// two panels visibly converge within a render rather than waiting for
// the next 30 s poll. Alertmanager itself takes ~15 s to start
// suppressing a silenced alert, so the operator may still see the
// firing row for one tick — that's an upstream property, not
// something a more aggressive invalidate would fix.

import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  createSilence,
  expireSilence,
  type CreateSilenceInput,
  type CreateSilenceResult,
} from '@/api/alerts-client';
import { useConsoleClient } from '@/lib/ws-context';

export function useCreateSilence() {
  const { token } = useConsoleClient();
  const qc = useQueryClient();
  return useMutation<CreateSilenceResult, Error, CreateSilenceInput>({
    mutationFn: (input) => createSilence(token!, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['silences'] });
      qc.invalidateQueries({ queryKey: ['firing-alerts'] });
    },
  });
}

export function useExpireSilence() {
  const { token } = useConsoleClient();
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => expireSilence(token!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['silences'] });
      qc.invalidateQueries({ queryKey: ['firing-alerts'] });
    },
  });
}
