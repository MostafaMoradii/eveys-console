// Tests for the push-refresh helper. Drives `useSubscription` via a
// per-test override so we can simulate the broker emitting deltas
// and assert that the matching React Query keys are invalidated.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeltaForQuery, DeviceEvent } from '@eveys-console/protocol';

interface SubStub {
  loading: boolean;
  error: string | null;
  snapshot: unknown;
  lastDelta: DeltaForQuery | null;
  cursor: string | null;
}

let stub: SubStub = {
  loading: false,
  error: null,
  snapshot: null,
  lastDelta: null,
  cursor: null,
};

vi.mock('@/hooks/use-subscription', () => ({
  useSubscription: () => stub,
}));

import { useInvalidateOnCpEvents } from '@/hooks/use-invalidate-on-cp-events';

function makeEvent(over: Partial<DeviceEvent> = {}): DeviceEvent {
  return {
    at: over.at ?? '2026-05-11T22:00:00Z',
    kind: over.kind ?? 'tx-started',
    summary: over.summary ?? 'tx',
    detail: over.detail ?? null,
    connector_id: over.connector_id ?? 1,
  };
}

function delta(ev: DeviceEvent): DeltaForQuery {
  return { kind: 'device-events', append: ev };
}

function wrapper(qc: QueryClient): React.FC<{ children: ReactNode }> {
  // eslint-disable-next-line react/display-name
  return ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  stub = {
    loading: false,
    error: null,
    snapshot: null,
    lastDelta: null,
    cursor: null,
  };
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useInvalidateOnCpEvents', () => {
  it('invalidates the given query keys when a matching event arrives', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');

    stub.lastDelta = delta(makeEvent({ kind: 'tx-started' }));
    renderHook(
      () =>
        useInvalidateOnCpEvents({
          cpId: 'cp_A',
          queryKeys: [['cp-transactions', 'cp_A']],
          kinds: ['tx-started'],
        }),
      { wrapper: wrapper(qc) },
    );

    expect(spy).toHaveBeenCalledWith({ queryKey: ['cp-transactions', 'cp_A'] });
  });

  it('skips events whose kind is not in the filter', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');

    stub.lastDelta = delta(makeEvent({ kind: 'meter' }));
    renderHook(
      () =>
        useInvalidateOnCpEvents({
          cpId: 'cp_A',
          queryKeys: [['cp-statistics', 'cp_A']],
          kinds: ['tx-started'],
        }),
      { wrapper: wrapper(qc) },
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('does nothing without a kind filter when there is no lastDelta', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    stub.lastDelta = null;
    renderHook(
      () =>
        useInvalidateOnCpEvents({
          cpId: 'cp_A',
          queryKeys: [['cp-anything', 'cp_A']],
        }),
      { wrapper: wrapper(qc) },
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('invalidates multiple keys per event', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    stub.lastDelta = delta(makeEvent({ kind: 'tx-started' }));
    renderHook(
      () =>
        useInvalidateOnCpEvents({
          cpId: 'cp_A',
          queryKeys: [
            ['cp-transactions', 'cp_A'],
            ['cp-statistics', 'cp_A'],
          ],
        }),
      { wrapper: wrapper(qc) },
    );
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
