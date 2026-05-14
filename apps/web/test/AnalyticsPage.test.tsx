// Tests for the static analytics dashboard (PR B2 of #192). Verifies
// (a) two aggregate calls fire (by-day + by-cp), (b) URL search
// params override the last-30-days default, (c) the empty / error
// states render, (d) editing from/to round-trips through the URL.
//
// Recharts itself isn't asserted in detail — we check the card
// containers render the right titles + that the empty state shows
// when no data is returned. Chart-fidelity is not under test here;
// it's a visual surface.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AggregateParams, AggregateResponse } from '@/api/analytics-client';

const nextByDay: { value: AggregateResponse | null } = { value: null };
const nextByCp: { value: AggregateResponse | null } = { value: null };
const nextError: { value: Error | null } = { value: null };
const fetchCalls: Array<AggregateParams> = [];

vi.mock('@/api/analytics-client', () => ({
  fetchAggregate: async (_token: string, params: AggregateParams): Promise<AggregateResponse> => {
    fetchCalls.push({ ...params });
    if (nextError.value) throw nextError.value;
    if (params.group_by === 'cp_id' && nextByCp.value) return nextByCp.value;
    if (nextByDay.value) return nextByDay.value;
    throw new Error('test forgot to set responses');
  },
}));

vi.mock('@/lib/ws-context', () => ({
  useConsoleClient: () => ({
    client: {
      rpc: vi.fn(),
      subscribe: vi.fn(),
      close: vi.fn(),
      connect: vi.fn(),
    },
    status: 'open',
    token: 'test-token',
    setToken: vi.fn(),
  }),
}));

// Recharts measures its container — without a real layout pass, the
// chart elements don't paint and Tooltip warns about NaN width. Stub
// ResponsiveContainer to render its children directly so the chart
// content is at least mounted; we don't assert on the bars themselves.
vi.mock('@/components/ui/chart', () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart-container">{children}</div>
  ),
}));

const routerSearch: Record<string, unknown> = {};
const searchListeners = new Set<() => void>();
let searchSnapshot: Record<string, unknown> = {};
function applySearchMutation(
  mutate: (current: Record<string, unknown>) => Record<string, unknown>,
) {
  const next = mutate({ ...routerSearch });
  for (const k of Object.keys(routerSearch)) delete routerSearch[k];
  Object.assign(routerSearch, next);
  searchSnapshot = { ...routerSearch };
  for (const fn of searchListeners) fn();
}

vi.mock('@tanstack/react-router', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useSearch: () =>
      useSyncExternalStore(
        (cb: () => void) => {
          searchListeners.add(cb);
          return () => searchListeners.delete(cb);
        },
        () => searchSnapshot,
      ),
    useNavigate: () => (opts: { search?: unknown; replace?: boolean }) => {
      if (typeof opts.search === 'function') {
        applySearchMutation(
          opts.search as (cur: Record<string, unknown>) => Record<string, unknown>,
        );
      } else if (opts.search && typeof opts.search === 'object') {
        applySearchMutation((cur) => ({ ...cur, ...(opts.search as Record<string, unknown>) }));
      }
    },
  };
});

import { AnalyticsPage } from '@/pages/AnalyticsPage';

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AnalyticsPage />
    </QueryClientProvider>,
  );
}

function emptyResp(): AggregateResponse {
  return {
    buckets: [],
    window: {
      from: '2026-04-14T00:00:00Z',
      to: '2026-05-14T00:00:00Z',
      seconds: 30 * 86_400,
      bucket: 'day',
      group_by: 'none',
    },
  };
}

beforeEach(() => {
  nextByDay.value = null;
  nextByCp.value = null;
  nextError.value = null;
  fetchCalls.length = 0;
  for (const k of Object.keys(routerSearch)) delete routerSearch[k];
  searchSnapshot = {};
});

afterEach(() => cleanup());

describe('AnalyticsPage — initial fetch', () => {
  it('fires two queries: bucket=day group_by=none + group_by=cp_id', async () => {
    nextByDay.value = emptyResp();
    nextByCp.value = { ...emptyResp(), window: { ...emptyResp().window, group_by: 'cp_id' } };
    renderPage();

    await waitFor(() => expect(fetchCalls.length).toBe(2));
    const groups = fetchCalls.map((c) => c.group_by);
    expect(groups).toContain('none');
    expect(groups).toContain('cp_id');
    // Both buckets are 'day'.
    expect(fetchCalls.every((c) => c.bucket === 'day')).toBe(true);
  });

  it('defaults the window to last 30 days when no URL filters', async () => {
    nextByDay.value = emptyResp();
    nextByCp.value = emptyResp();
    renderPage();

    await waitFor(() => expect(fetchCalls.length).toBeGreaterThanOrEqual(1));
    const span = new Date(fetchCalls[0].to).getTime() - new Date(fetchCalls[0].from).getTime();
    expect(span).toBeCloseTo(30 * 86_400_000, -3);
  });

  it('respects URL search params on first render', async () => {
    searchSnapshot = {
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-05T00:00:00.000Z',
    };
    nextByDay.value = emptyResp();
    nextByCp.value = emptyResp();
    renderPage();

    await waitFor(() => expect(fetchCalls.length).toBeGreaterThanOrEqual(1));
    expect(fetchCalls[0].from).toBe('2026-05-01T00:00:00.000Z');
    expect(fetchCalls[0].to).toBe('2026-05-05T00:00:00.000Z');
  });
});

describe('AnalyticsPage — rendering', () => {
  it('renders three cards even on empty data', async () => {
    nextByDay.value = emptyResp();
    nextByCp.value = emptyResp();
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('analytics-sessions-by-day')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('analytics-energy-by-day')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-top-chargers')).toBeInTheDocument();
    // Each card shows its own empty-state line.
    expect(screen.getAllByTestId('analytics-empty').length).toBe(3);
  });

  it('renders an error alert on fetch rejection', async () => {
    nextError.value = new Error('upstream 503');
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Couldn’t load analytics/i)).toBeInTheDocument();
      expect(screen.getByText('upstream 503')).toBeInTheDocument();
    });
  });

  it('renders the cards (no empty hint) when buckets contain data', async () => {
    nextByDay.value = {
      buckets: [
        {
          bucket_at: '2026-05-13T00:00:00Z',
          session_count: 5,
          consumed_wh_total: 12_500,
          duration_seconds_total: 3600,
        },
      ],
      window: emptyResp().window,
    };
    nextByCp.value = {
      buckets: [
        {
          bucket_at: '2026-05-13T00:00:00Z',
          group: 'CP_A',
          session_count: 3,
          consumed_wh_total: 8_000,
          duration_seconds_total: 1800,
        },
        {
          bucket_at: '2026-05-13T00:00:00Z',
          group: 'CP_B',
          session_count: 2,
          consumed_wh_total: 4_500,
          duration_seconds_total: 1800,
        },
      ],
      window: { ...emptyResp().window, group_by: 'cp_id' },
    };
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('analytics-sessions-by-day')).toBeInTheDocument(),
    );
    // No empty hints when data is present.
    expect(screen.queryAllByTestId('analytics-empty').length).toBe(0);
  });
});

describe('AnalyticsPage — range edits', () => {
  it('clearing the From picker writes an empty value through the URL', async () => {
    // The picker triggers + calendar grid live in a Radix Portal which
    // jsdom renders fine, but driving a day-grid click in headless
    // mode is flaky (the grid measures itself). The clear-button path
    // is the deterministic one to assert URL write-through: it's a
    // simple <button>, doesn't need layout, and the failure mode it
    // protects against ("ranges stick after the operator clears them")
    // is the one operators have actually reported.
    searchSnapshot = { from: '2026-05-10T00:00:00.000Z' };
    routerSearch.from = '2026-05-10T00:00:00.000Z';
    nextByDay.value = emptyResp();
    nextByCp.value = emptyResp();
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThanOrEqual(1));

    // The clear affordance only appears when the picker has a value.
    const clearBtn = screen.getByTestId('analytics-from-clear');
    await user.click(clearBtn);

    await waitFor(() => expect(routerSearch.from).toBeUndefined());
  });
});
