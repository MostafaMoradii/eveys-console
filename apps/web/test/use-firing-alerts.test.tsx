// Hook test for useFiringAlerts: confirms the React Query plumbing
// (a) fires the initial fetch with the bearer token from
// useConsoleClient and (b) re-fetches every 30 s when the query
// stays mounted. The fetch itself is mocked; we're testing the
// polling contract, not the proxy response.
//
// Note on timing: we don't use fake timers here. Fake timers interact
// awkwardly with React Query's internal scheduling and microtask
// flushes; the simpler path is to drive a *short* refetchInterval
// through a TestHook wrapper that re-exports the underlying
// useQuery options. Since the production code uses a hard-coded
// `30_000` we assert that constant via a static read instead of
// trying to wall-clock the wait.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ws-context', () => ({
  useConsoleClient: () => ({
    client: { rpc: vi.fn(), subscribe: vi.fn(), close: vi.fn(), connect: vi.fn() },
    status: 'open',
    token: 'test-token',
    setToken: vi.fn(),
  }),
}));

import { useFiringAlerts } from '@/hooks/use-firing-alerts';

const ORIGINAL_FETCH = globalThis.fetch;

function HookProbe({ onState }: { onState: (s: ReturnType<typeof useFiringAlerts>) => void }) {
  const state = useFiringAlerts();
  onState(state);
  return null;
}

function makeQc() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('useFiringAlerts', () => {
  it('issues an initial fetch on mount and then polls every 30 s', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ alerts: [], unavailable: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const qc = makeQc();
    render(
      <QueryClientProvider client={qc}>
        <HookProbe onState={() => undefined} />
      </QueryClientProvider>,
    );

    // Initial fetch fires on mount.
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    // 29 s in — still just the initial fetch.
    await vi.advanceTimersByTimeAsync(29_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Cross the 30 s mark and the next poll should fire.
    await vi.advanceTimersByTimeAsync(2_000);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    qc.clear();
  });

  it('surfaces unavailable=true from the route response', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ alerts: [], unavailable: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof globalThis.fetch;

    const states: ReturnType<typeof useFiringAlerts>[] = [];
    const qc = makeQc();
    render(
      <QueryClientProvider client={qc}>
        <HookProbe onState={(s) => states.push(s)} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const last = states[states.length - 1];
      expect(last?.unavailable).toBe(true);
    });
    qc.clear();
  });

  it('passes the bearer token from useConsoleClient on the request', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ alerts: [], unavailable: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const qc = makeQc();
    render(
      <QueryClientProvider client={qc}>
        <HookProbe onState={() => undefined} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const init = fetchSpy.mock.calls[0]![1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer test-token');

    qc.clear();
  });
});
