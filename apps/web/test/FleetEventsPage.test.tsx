// Tests for the Fleet Events search page. The page itself is a
// fairly thin filter-and-show shell over fetchFleetStatusHistory;
// the value-add of these tests is verifying the filter→params
// translation works (status defaults to "Faulted", repeated status
// passthrough, cp_id scope, range switcher) and that the results
// table renders with a Link to the per-charger detail page.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FleetStatusParams, FleetStatusResponse } from '@/api/fleet-status-history-client';

const nextResponse: { value: FleetStatusResponse | null } = { value: null };
const nextError: { value: Error | null } = { value: null };
const fetchCalls: Array<FleetStatusParams> = [];

vi.mock('@/api/fleet-status-history-client', () => ({
  fetchFleetStatusHistory: async (
    _token: string,
    params: FleetStatusParams,
  ): Promise<FleetStatusResponse> => {
    fetchCalls.push({ ...params });
    if (nextError.value) throw nextError.value;
    if (nextResponse.value) return nextResponse.value;
    throw new Error('test forgot to set nextResponse / nextError');
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

// Route-tree stub. The page consumes useSearch + useNavigate from
// @tanstack/react-router; we drive them through a tiny store so
// assertions on filter behaviour run without RouterProvider.
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
    Link: ({
      to,
      params,
      children,
      className,
    }: {
      to: string;
      params?: Record<string, unknown>;
      children: React.ReactNode;
      className?: string;
    }) => {
      let href = to;
      if (params && typeof params === 'object') {
        for (const [k, v] of Object.entries(params)) {
          href = href.replace(`$${k}`, String(v));
        }
      }
      return (
        <a href={href} data-testid="router-link" className={className}>
          {children}
        </a>
      );
    },
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

import { FleetEventsPage } from '@/pages/FleetEventsPage';

beforeEach(() => {
  nextResponse.value = null;
  nextError.value = null;
  fetchCalls.length = 0;
  for (const k of Object.keys(routerSearch)) delete routerSearch[k];
  searchSnapshot = {};
});

afterEach(() => cleanup());

function _row(
  cp_id: string,
  status = 'Faulted',
  error_code: string | null = 'GroundFailure',
): FleetStatusResponse['events'][number] {
  return {
    event_id: `evt-${cp_id}-${status}`,
    occurred_at: '2026-05-12T10:00:00Z',
    cp_id,
    connector_id: 1,
    status,
    error_code,
    info: null,
    vendor_id: null,
    vendor_error_code: null,
    charger_reported_at: '2026-05-12T10:00:00Z',
  };
}

describe('FleetEventsPage — filters', () => {
  it('defaults status=Faulted and last-24h on first render', async () => {
    nextResponse.value = { events: [], request_id: 'r' };
    render(<FleetEventsPage />);
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    const params = fetchCalls[0];
    expect(params.status).toEqual(['Faulted']);
    // last-24h window: to - from = 86_400_000 ms
    const from = new Date(params.from).getTime();
    const to = new Date(params.to).getTime();
    expect(to - from).toBeCloseTo(86_400_000, -3);
  });

  it('switching status to "all" drops the param entirely', async () => {
    const user = userEvent.setup();
    nextResponse.value = { events: [], request_id: 'r' };
    render(<FleetEventsPage />);
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    nextResponse.value = { events: [], request_id: 'r' };
    await user.selectOptions(screen.getByTestId('fleet-events-status'), 'all');

    await waitFor(() => expect(fetchCalls.length).toBe(2));
    expect(fetchCalls[1].status).toBeUndefined();
  });

  it('range switcher widens the window', async () => {
    const user = userEvent.setup();
    nextResponse.value = { events: [], request_id: 'r' };
    render(<FleetEventsPage />);
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    nextResponse.value = { events: [], request_id: 'r' };
    await user.click(screen.getByTestId('fleet-events-range-168')); // 7d

    await waitFor(() => expect(fetchCalls.length).toBe(2));
    const span = new Date(fetchCalls[1].to).getTime() - new Date(fetchCalls[1].from).getTime();
    expect(span).toBeCloseTo(7 * 86_400_000, -3);
  });

  it('cp_id input commits on Enter and forwards as scope', async () => {
    const user = userEvent.setup();
    nextResponse.value = { events: [], request_id: 'r' };
    render(<FleetEventsPage />);
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    nextResponse.value = { events: [], request_id: 'r' };
    const input = screen.getByTestId('fleet-events-cpid-input');
    await user.click(input);
    await user.keyboard('CP_BERLIN_017{Enter}');

    await waitFor(() => expect(fetchCalls.length).toBe(2));
    expect(fetchCalls[1].cp_id).toEqual(['CP_BERLIN_017']);
  });
});

describe('FleetEventsPage — results', () => {
  it('renders a per-row link to the charger detail page', async () => {
    nextResponse.value = {
      events: [_row('CP_BERLIN_017'), _row('CP_BERLIN_022')],
      request_id: 'r',
    };
    render(<FleetEventsPage />);

    await waitFor(() => expect(screen.getByTestId('fleet-events-results')).toBeInTheDocument());
    const links = screen.getAllByTestId('router-link');
    const hrefs = links.map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/inspect/charge-points/CP_BERLIN_017');
    expect(hrefs).toContain('/inspect/charge-points/CP_BERLIN_022');
  });

  it('renders the empty-state copy when there are no matches', async () => {
    nextResponse.value = { events: [], request_id: 'r' };
    render(<FleetEventsPage />);
    await waitFor(() => {
      expect(screen.getByText(/No StatusNotifications match these filters/i)).toBeInTheDocument();
    });
  });

  it('renders the error alert on fetch rejection', async () => {
    nextError.value = new Error('upstream 502');
    render(<FleetEventsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Couldn't load fleet events/i)).toBeInTheDocument();
      expect(screen.getByText('upstream 502')).toBeInTheDocument();
    });
  });
});
