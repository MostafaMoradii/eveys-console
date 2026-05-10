// Component tests for the per-charger StatisticsCard. The component
// is a thin TanStack Query wrapper around fetchAllChargePointTransactions
// + the pure computeStats helper; the tests assert (a) loading /
// error / empty branches render the right copy, (b) tiles render the
// expected values from a fixed fixture, (c) the window selector
// recomputes the tile contents when clicked, (d) the truncated-page
// footnote appears when the API client signals it.

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAllChargePointTransactions, type TransactionRow } from '@/api/transactions-client';

let result: { data?: { transactions: TransactionRow[]; truncated: boolean }; error?: Error } = {};

vi.mock('@/api/transactions-client', () => ({
  fetchAllChargePointTransactions: vi.fn(
    async (
      _token: string,
      _cpId: string,
    ): Promise<{ transactions: TransactionRow[]; truncated: boolean }> => {
      if (result.error) throw result.error;
      return result.data as { transactions: TransactionRow[]; truncated: boolean };
    },
  ),
}));

vi.mock('@/lib/ws-context', () => ({
  useConsoleClient: () => ({
    client: { rpc: vi.fn(), subscribe: vi.fn(), close: vi.fn(), connect: vi.fn() },
    status: 'open',
    token: 'test-token',
    setToken: vi.fn(),
  }),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { StatisticsCard, formatEnergy } from '@/components/StatisticsCard';

function makeRow(over: Partial<TransactionRow> = {}): TransactionRow {
  const open = over.open ?? false;
  return {
    transaction_id: over.transaction_id ?? 1,
    cp_id: over.cp_id ?? 'cp_test',
    connector_id: over.connector_id ?? 1,
    id_tag: over.id_tag ?? 'TAG',
    meter_start_wh: over.meter_start_wh ?? 0,
    started_at: over.started_at ?? '2026-05-10T10:00:00Z',
    meter_stop_wh: over.meter_stop_wh ?? (open ? null : 1000),
    stopped_at: over.stopped_at ?? (open ? null : '2026-05-10T11:00:00Z'),
    stop_reason: over.stop_reason ?? (open ? null : 'Local'),
    open,
  };
}

function renderWith(cpId = 'cp_test') {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false, gcTime: 0, staleTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <StatisticsCard cpId={cpId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  result = {};
  vi.mocked(fetchAllChargePointTransactions).mockClear();
  // Pin Date.now without swapping timers — findByText / userEvent
  // both rely on real timers underneath.
  vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('StatisticsCard', () => {
  it('shows the loading state while the query is pending', () => {
    result = { data: { transactions: [], truncated: false } };
    renderWith();
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('renders an error message when the fetch rejects', async () => {
    result = { error: new Error('boom') };
    renderWith();
    expect(await screen.findByText(/Couldn't load:.*boom/i)).toBeInTheDocument();
  });

  it('renders the empty state when there are no transactions', async () => {
    result = { data: { transactions: [], truncated: false } };
    renderWith();
    expect(await screen.findByText(/No sessions yet for this charger/i)).toBeInTheDocument();
  });

  it('renders four tiles with correct values for a fixed fixture', async () => {
    result = {
      data: {
        transactions: [
          // 5 kWh, 60 min
          makeRow({
            transaction_id: 1,
            meter_start_wh: 0,
            meter_stop_wh: 5000,
            started_at: '2026-05-10T08:00:00Z',
            stopped_at: '2026-05-10T09:00:00Z',
          }),
          // 2 kWh, 30 min
          makeRow({
            transaction_id: 2,
            meter_start_wh: 0,
            meter_stop_wh: 2000,
            started_at: '2026-05-10T11:00:00Z',
            stopped_at: '2026-05-10T11:30:00Z',
          }),
          // open
          makeRow({
            transaction_id: 3,
            open: true,
            started_at: '2026-05-10T11:45:00Z',
          }),
        ],
        truncated: false,
      },
    };
    renderWith();

    const total = await screen.findByTestId('stat-total-sessions');
    expect(within(total).getByText('3')).toBeInTheDocument();

    const completed = screen.getByTestId('stat-completed');
    expect(within(completed).getByText('2')).toBeInTheDocument();
    // activeNow = 1 → subtitle changes from window text to "1 active now"
    expect(within(completed).getByText('1 active now')).toBeInTheDocument();

    const energy = screen.getByTestId('stat-energy');
    expect(within(energy).getByText('7.00 kWh')).toBeInTheDocument();

    const mean = screen.getByTestId('stat-mean-duration');
    // (60 + 30) / 2 = 45 minutes → "45m"
    expect(within(mean).getByText('45m')).toBeInTheDocument();
  });

  it('window selector recomputes tiles when clicked', async () => {
    result = {
      data: {
        transactions: [
          // 5 days ago — outside 24h, inside 7d / 30d / all.
          makeRow({
            transaction_id: 1,
            meter_start_wh: 0,
            meter_stop_wh: 5000,
            started_at: '2026-05-05T08:00:00Z',
            stopped_at: '2026-05-05T09:00:00Z',
          }),
          // 1 hour ago — inside everything.
          makeRow({
            transaction_id: 2,
            meter_start_wh: 0,
            meter_stop_wh: 2000,
            started_at: '2026-05-10T11:00:00Z',
            stopped_at: '2026-05-10T11:30:00Z',
          }),
        ],
        truncated: false,
      },
    };
    const user = userEvent.setup();
    renderWith();

    // All-time (default): 2 sessions, 7.00 kWh.
    const total = await screen.findByTestId('stat-total-sessions');
    expect(within(total).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-energy')).getByText('7.00 kWh')).toBeInTheDocument();

    // Click 24h: only the recent session counts → 1 session, 2.00 kWh.
    await user.click(screen.getByRole('button', { name: '24h' }));
    expect(within(screen.getByTestId('stat-total-sessions')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-energy')).getByText('2.00 kWh')).toBeInTheDocument();
  });

  it('shows the truncated footnote when the API client signals truncation', async () => {
    result = {
      data: {
        transactions: [
          makeRow({
            transaction_id: 1,
            meter_start_wh: 0,
            meter_stop_wh: 1000,
            started_at: '2026-05-10T11:00:00Z',
            stopped_at: '2026-05-10T11:30:00Z',
          }),
        ],
        truncated: true,
      },
    };
    renderWith();
    expect(await screen.findByText(/Showing the most recent 2,500 sessions/i)).toBeInTheDocument();
  });

  it('does not show the truncated footnote when truncated=false', async () => {
    result = {
      data: {
        transactions: [
          makeRow({
            transaction_id: 1,
            meter_start_wh: 0,
            meter_stop_wh: 1000,
            started_at: '2026-05-10T11:00:00Z',
            stopped_at: '2026-05-10T11:30:00Z',
          }),
        ],
        truncated: false,
      },
    };
    renderWith();
    await screen.findByTestId('stat-total-sessions');
    expect(screen.queryByText(/Showing the most recent 2,500 sessions/i)).toBeNull();
  });

  it('renders an em-dash for mean duration when only open sessions are in the window', async () => {
    result = {
      data: {
        transactions: [
          makeRow({ transaction_id: 1, open: true, started_at: '2026-05-10T11:00:00Z' }),
        ],
        truncated: false,
      },
    };
    renderWith();
    const mean = await screen.findByTestId('stat-mean-duration');
    expect(within(mean).getByText('—')).toBeInTheDocument();
  });

  it('formatEnergy switches to MWh above 1000 kWh', () => {
    expect(formatEnergy(0)).toBe('0.00 kWh');
    expect(formatEnergy(12.345)).toBe('12.35 kWh');
    expect(formatEnergy(999.99)).toBe('999.99 kWh');
    expect(formatEnergy(1000)).toBe('1.00 MWh');
    expect(formatEnergy(1234.56)).toBe('1.23 MWh');
    expect(formatEnergy(-1)).toBe('—');
  });
});
