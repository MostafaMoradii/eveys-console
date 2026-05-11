// Component tests for the per-charger transactions history card. The
// component is a thin TanStack Query wrapper over a typed REST
// client; the value-add of these tests is asserting (a) the loading,
// empty, and error branches render the right copy, (b) open and
// closed rows render their distinct status badges + duration / kWh
// values, (c) the tx_id link points at the per-tx detail route with
// the right param, (d) the cursor-stack pagination pushes on Next
// and pops on Previous, and (e) the 5-second polling cadence is
// honoured.

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchChargePointTransactions,
  type TransactionRow,
  type TransactionsList,
} from '@/api/transactions-client';

let listResult: { data?: TransactionsList; error?: Error } = {};

vi.mock('@/api/transactions-client', () => ({
  fetchChargePointTransactions: vi.fn(
    async (
      _token: string,
      _cpId: string,
      _params?: { active?: boolean; limit?: number; cursor?: string },
    ): Promise<TransactionsList> => {
      if (listResult.error) throw listResult.error;
      return listResult.data as TransactionsList;
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

// Subscription stub for the live meter-history feed. Tests set
// `subResult.lastDelta` to simulate a sample arriving.
interface SubStub {
  loading: boolean;
  error: string | null;
  snapshot: unknown;
  lastDelta: unknown;
  cursor: string | null;
}
let subResult: SubStub = {
  loading: false,
  error: null,
  snapshot: null,
  lastDelta: null,
  cursor: null,
};
vi.mock('@/hooks/use-subscription', () => ({
  useSubscription: () => subResult,
}));

// Minimal router stub: <Link to="..." params={...}> renders an <a>
// whose href has the param substituted in. The component only uses
// Link, so this is sufficient.
vi.mock('@tanstack/react-router', () => ({
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
      <a href={href} data-testid="router-link" className={className} data-to={to}>
        {children}
      </a>
    );
  },
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TransactionsHistory, formatClosedDuration } from '@/components/TransactionsHistory';

function makeRow(over: Partial<TransactionRow> = {}): TransactionRow {
  const startedDefault = '2026-05-10T10:00:00Z';
  const open = over.open ?? false;
  return {
    transaction_id: over.transaction_id ?? 1,
    cp_id: over.cp_id ?? 'cp_test',
    connector_id: over.connector_id ?? 1,
    id_tag: over.id_tag ?? 'TAG',
    meter_start_wh: over.meter_start_wh ?? 1000,
    started_at: over.started_at ?? startedDefault,
    meter_stop_wh: over.meter_stop_wh ?? (open ? null : 4500),
    stopped_at: over.stopped_at ?? (open ? null : '2026-05-10T11:30:00Z'),
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
      <TransactionsHistory cpId={cpId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listResult = {};
  vi.mocked(fetchChargePointTransactions).mockClear();
  subResult = {
    loading: false,
    error: null,
    snapshot: null,
    lastDelta: null,
    cursor: null,
  };
});

afterEach(() => cleanup());

describe('TransactionsHistory', () => {
  it('shows the loading state while the query is pending', () => {
    listResult = { data: { transactions: [], next_cursor: null } };
    renderWith();
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('renders an error message when the fetch rejects', async () => {
    listResult = { error: new Error('boom') };
    renderWith();
    expect(await screen.findByText(/Couldn't load:.*boom/i)).toBeInTheDocument();
  });

  it('renders the empty state when there are no transactions', async () => {
    listResult = { data: { transactions: [], next_cursor: null } };
    renderWith();
    expect(await screen.findByText(/No transactions yet for this charger/i)).toBeInTheDocument();
  });

  it('renders one row per transaction', async () => {
    listResult = {
      data: {
        transactions: [
          makeRow({ transaction_id: 1, open: true }),
          makeRow({ transaction_id: 2 }),
          makeRow({ transaction_id: 3 }),
        ],
        next_cursor: null,
      },
    };
    renderWith();
    // Wait for the table to materialise, then count <tr>s in the body.
    await screen.findByText('open');
    const links = screen.getAllByTestId('router-link');
    expect(links.map((a) => a.textContent)).toEqual(['1', '2', '3']);
  });

  it('renders the success "open" badge for an open transaction', async () => {
    listResult = {
      data: {
        transactions: [makeRow({ transaction_id: 1, open: true })],
        next_cursor: null,
      },
    };
    renderWith();
    expect(await screen.findByText('open')).toBeInTheDocument();
    // Open row with no live meter samples yet: kWh / kW / SoC all em-dash.
    const row = (await screen.findByTestId('tx-row')) as HTMLElement;
    expect(within(row).getByTestId('tx-row-kwh').textContent).toBe('—');
    expect(within(row).getByTestId('tx-row-kw').textContent).toBe('—');
    expect(within(row).getByTestId('tx-row-soc').textContent).toBe('—');
  });

  it('renders kWh and a closed-duration string for a closed transaction', async () => {
    listResult = {
      data: {
        transactions: [
          makeRow({
            transaction_id: 7,
            meter_start_wh: 1000,
            meter_stop_wh: 4500,
            started_at: '2026-05-10T10:00:00Z',
            stopped_at: '2026-05-10T11:30:00Z',
            stop_reason: 'Local',
          }),
        ],
        next_cursor: null,
      },
    };
    renderWith();
    expect(await screen.findByText('closed')).toBeInTheDocument();
    // (4500 - 1000) / 1000 = 3.5 kWh, formatted with two decimals.
    expect(screen.getByText('3.50')).toBeInTheDocument();
    // 90-minute session formatted via formatClosedDuration.
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();
  });

  it('tx_id link targets the per-tx detail route with the right param', async () => {
    listResult = {
      data: {
        transactions: [makeRow({ transaction_id: 42 })],
        next_cursor: null,
      },
    };
    renderWith();
    const link = (await screen.findByTestId('router-link')) as HTMLAnchorElement;
    expect(link.dataset.to).toBe('/inspect/transactions/$txId');
    expect(link.getAttribute('href')).toBe('/inspect/transactions/42');
  });

  it('Next pushes onto the cursor stack and refetches with the new cursor', async () => {
    listResult = {
      data: {
        transactions: [makeRow({ transaction_id: 1 })],
        next_cursor: 'cursor-2',
      },
    };
    const user = userEvent.setup();
    renderWith();
    await screen.findByTestId('router-link');
    expect(fetchChargePointTransactions).toHaveBeenCalledWith('test-token', 'cp_test', {
      limit: 20,
    });
    const next = screen.getByRole('button', { name: /Next/i });
    await user.click(next);
    // After clicking Next the query refires with cursor=cursor-2.
    await vi.waitFor(() => {
      expect(fetchChargePointTransactions).toHaveBeenCalledWith('test-token', 'cp_test', {
        limit: 20,
        cursor: 'cursor-2',
      });
    });
  });

  it('Previous pops the cursor stack', async () => {
    listResult = {
      data: {
        transactions: [makeRow({ transaction_id: 1 })],
        next_cursor: 'cursor-2',
      },
    };
    const user = userEvent.setup();
    renderWith();
    await screen.findByTestId('router-link');
    // Page 1 → Previous is disabled.
    expect(screen.getByRole('button', { name: /Previous/i })).toBeDisabled();

    // Push to page 2.
    await user.click(screen.getByRole('button', { name: /Next/i }));
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: /Previous/i })).not.toBeDisabled(),
    );

    // Pop back to page 1; the request should fire without a cursor.
    vi.mocked(fetchChargePointTransactions).mockClear();
    await user.click(screen.getByRole('button', { name: /Previous/i }));
    await vi.waitFor(() => {
      expect(fetchChargePointTransactions).toHaveBeenCalledWith('test-token', 'cp_test', {
        limit: 20,
      });
    });
  });

  it('polls the list endpoint at the 5-second interval', async () => {
    vi.useFakeTimers();
    try {
      listResult = { data: { transactions: [], next_cursor: null } };
      renderWith();
      // First fetch on mount.
      await vi.waitFor(() => expect(fetchChargePointTransactions).toHaveBeenCalledTimes(1));
      // Advance two refetch intervals (5s each) — TanStack should refire.
      await vi.advanceTimersByTimeAsync(5000);
      await vi.waitFor(() =>
        expect(vi.mocked(fetchChargePointTransactions).mock.calls.length).toBeGreaterThanOrEqual(2),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('open row pulls live kW + SoC + kWh from meter-history deltas', async () => {
    const open = makeRow({ transaction_id: 42, connector_id: 2, open: true, meter_start_wh: 5000 });
    listResult = { data: { transactions: [open], next_cursor: null } };

    // First render with no live data — kW / SoC empty.
    subResult.lastDelta = {
      kind: 'meter-history',
      append: {
        cp_id: 'cp_test',
        transaction_id: 42,
        connector_id: 2,
        measurand: 'POWER_ACTIVE_IMPORT',
        value: 22000, // 22 kW
        unit: 'W',
        recorded_at: '2026-05-10T10:01:00Z',
      },
    };
    renderWith();
    const row = await screen.findByTestId('tx-row');
    expect(within(row).getByTestId('tx-row-kw').textContent).toBe('22.0');

    // Push an SoC sample — same row should now also show SoC.
    subResult = {
      ...subResult,
      lastDelta: {
        kind: 'meter-history',
        append: {
          cp_id: 'cp_test',
          transaction_id: 42,
          connector_id: 2,
          measurand: 'SOC',
          value: 67,
          unit: '%',
          recorded_at: '2026-05-10T10:01:05Z',
        },
      },
    };
    // Force re-render by re-rendering the same component tree.
    cleanup();
    renderWith();
    const row2 = await screen.findByTestId('tx-row');
    expect(within(row2).getByTestId('tx-row-soc').textContent).toBe('67%');
  });

  it('formatClosedDuration renders compact closed-session durations', () => {
    expect(formatClosedDuration('2026-05-10T10:00:00Z', null)).toBe('—');
    expect(formatClosedDuration('2026-05-10T10:00:00Z', '2026-05-10T10:00:30Z')).toBe('30s');
    expect(formatClosedDuration('2026-05-10T10:00:00Z', '2026-05-10T10:05:00Z')).toBe('5m');
    expect(formatClosedDuration('2026-05-10T10:00:00Z', '2026-05-10T11:30:00Z')).toBe('1h 30m');
    expect(formatClosedDuration('2026-05-10T10:00:00Z', '2026-05-12T10:00:00Z')).toBe('2d');
  });
});
