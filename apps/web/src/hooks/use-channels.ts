// React Query bindings for the Channels (receivers) CRUD + test surface.
// Same 30s poll cadence as the firing / silences hooks — receiver config
// changes infrequently and a stale list is harmless.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createChannel,
  deleteChannel,
  fetchChannels,
  testChannel,
  updateChannel,
  type Channel,
  type ChannelsResponse,
} from '@/api/alerts-client';
import { useConsoleClient } from '@/lib/ws-context';

const CHANNELS_KEY = ['alerts', 'channels'] as const;

export function useChannels(): {
  channels: Channel[];
  defaultChannel: string;
  loading: boolean;
  error: string | null;
} {
  const { token } = useConsoleClient();
  const q = useQuery({
    queryKey: CHANNELS_KEY,
    queryFn: () => fetchChannels(token!),
    refetchInterval: 30_000,
    staleTime: 25_000,
    enabled: !!token,
  });
  return {
    channels: q.data?.channels ?? [],
    defaultChannel: q.data?.default_channel ?? '',
    loading: q.isLoading,
    error: q.error instanceof Error ? q.error.message : null,
  };
}

/** Invalidates the channels query so the panel reflects the new
 *  state immediately rather than waiting up to 30s for the poll. */
function useInvalidateChannels(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: CHANNELS_KEY });
  };
}

export function useCreateChannel() {
  const { token } = useConsoleClient();
  const invalidate = useInvalidateChannels();
  return useMutation<ChannelsResponse, Error, Channel>({
    mutationFn: (channel) => createChannel(token!, channel),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateChannel() {
  const { token } = useConsoleClient();
  const invalidate = useInvalidateChannels();
  return useMutation<ChannelsResponse, Error, Channel>({
    mutationFn: (channel) => updateChannel(token!, channel),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteChannel() {
  const { token } = useConsoleClient();
  const invalidate = useInvalidateChannels();
  return useMutation<ChannelsResponse, Error, string>({
    mutationFn: (name) => deleteChannel(token!, name),
    onSuccess: () => invalidate(),
  });
}

export function useTestChannel() {
  const { token } = useConsoleClient();
  return useMutation<void, Error, string>({
    mutationFn: (name) => testChannel(token!, name),
  });
}
