// Tests for the audit-grade TransactionsPage (PR A2 of #190). Covers
// (a) initial load uses default filters and forwards limit, (b) URL
// search params drive the filter row, (c) status select round-trips to
// the URL and refetches, (d) cp_id input commits on Enter, (e) cursor
// pagination Next/Previous round-trips, (f) per-row link to the
// detail page, (g) status badge derives from row.open, (h) empty/error
// states render.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  TransactionRow,
  TransactionsList,
  TransactionsListParams,
} from '@/api/transactions-client';

const nextResponse: { value: TransactionsList | null } = { value: null };
const nextError: { value: Error | null } = { value: null };
const fetchCalls: Array<TransactionsListParams> = [];
const responseQueue: TransactionsList[] = [];

vi.mock('@/api/transactions-client', () => ({
  fetchTransactions: async (
    _token: string,
    params: TransactionsListParams,
  ): Promise<TransactionsList> => {
    fetchCalls.push({ ...params });
    if (nextError.value) throw nextError.value;
    if (responseQueue.length > 0) return responseQueue.shift() as TransactionsList;
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

// Phones-vs-desktop: force desktop so the table (not the cards
// variant) renders; that's the surface most tests assert against.
vi.mock('@/lib/use-breakpoint', () => ({
  useIsBelow: () => false,
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

import { TransactionsPage } from '@/pages/TransactionsPage';

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TransactionsPage />
    </QueryClientProvider>,
  );
}

function row(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    transaction_id: 101,
    cp_id: 'CP_BERLIN_017',
    connector_id: 1,
    id_tag: 'TAG_A',
    meter_start_wh: 1_000,
    started_at: '2026-05-13T10:00:00Z',
    meter_stop_wh: 5_500,
    stopped_at: '2026-05-13T11:00:00Z',
    stop_reason: 'Local',
    open: false,
    ...overrides,
  };
}

beforeEach(() => {
  nextResponse.value = null;
  nextError.value = null;
  fetchCalls.length = 0;
  responseQueue.length = 0;
  for (const k of Object.keys(routerSearch)) delete routerSearch[k];
  searchSnapshot = {};
});

afterEach(() => cleanup());

describe('TransactionsPage — initial load', () => {
  it('uses default filters and forwards limit on first fetch', async () => {
    nextResponse.value = { transactions: [], next_cursor: null };
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    const params = fetchCalls[0];
    expect(params.status).toBe('all');
    expect(params.limit).toBe(20);
    expect(params.cursor).toBeUndefined();
    expect(params.cp_id).toBeUndefined();
    expect(params.id_tag).toBeUndefined();
  });

  it('renders rows with a link to the detail page and a status badge', async () => {
    nextResponse.value = {
      transactions: [
        row({ transaction_id: 101, open: false }),
        row({ transaction_id: 202, open: true, stopped_at: null, meter_stop_wh: null }),
      ],
      next_cursor: null,
    };
    renderPage();
    await waitFor(() => expect(screen.getByTestId('transactions-table')).toBeInTheDocument());

    // detail link present for each row
    const links = screen.getAllByTestId('router-link');
    const hrefs = links.map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/inspect/transactions/101');
    expect(hrefs).toContain('/inspect/transactions/202');

    // status badge reflects row.open
    expect(screen.getByTestId('tx-status-finished')).toBeInTheDocument();
    expect(screen.getByTestId('tx-status-active')).toBeInTheDocument();
  });

  it('renders empty state when no rows match', async () => {
    nextResponse.value = { transactions: [], next_cursor: null };
    renderPage();
    await waitFor(() => expect(screen.getByTestId('transactions-empty')).toBeInTheDocument());
  });

  it('renders error alert on fetch rejection', async () => {
    nextError.value = new Error('upstream 503');
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Couldn’t load transactions/i)).toBeInTheDocument();
      expect(screen.getByText('upstream 503')).toBeInTheDocument();
    });
  });
});

describe('TransactionsPage — filters', () => {
  it('respects URL search params on first render', async () => {
    searchSnapshot = { status: 'active', cp_id: 'CP_X', id_tag: 'TAG_Y' };
    nextResponse.value = { transactions: [], next_cursor: null };
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    const params = fetchCalls[0];
    expect(params.status).toBe('active');
    expect(params.cp_id).toBe('CP_X');
    expect(params.id_tag).toBe('TAG_Y');
  });

  it('changing status updates the URL and refetches', async () => {
    const user = userEvent.setup();
    nextResponse.value = { transactions: [], next_cursor: null };
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    nextResponse.value = { transactions: [], next_cursor: null };
    await user.selectOptions(screen.getByTestId('transactions-filter-status'), 'finished');

    await waitFor(() => expect(fetchCalls.length).toBe(2));
    expect(fetchCalls[1].status).toBe('finished');
    expect(routerSearch.status).toBe('finished');
  });

  it("doesn't keep `status` in the URL when it equals the default ('all')", async () => {
    const user = userEvent.setup();
    searchSnapshot = { status: 'active' };
    routerSearch.status = 'active';
    nextResponse.value = { transactions: [], next_cursor: null };
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    nextResponse.value = { transactions: [], next_cursor: null };
    await user.selectOptions(screen.getByTestId('transactions-filter-status'), 'all');

    await waitFor(() => expect(fetchCalls.length).toBe(2));
    expect(routerSearch.status).toBeUndefined();
  });

  it('cp_id input commits on Enter and forwards as filter', async () => {
    const user = userEvent.setup();
    nextResponse.value = { transactions: [], next_cursor: null };
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    nextResponse.value = { transactions: [], next_cursor: null };
    const input = screen.getByTestId('transactions-filter-cp-id');
    await user.click(input);
    await user.keyboard('CP_BERLIN_017{Enter}');

    await waitFor(() => expect(fetchCalls.length).toBeGreaterThanOrEqual(2));
    const last = fetchCalls[fetchCalls.length - 1];
    expect(last.cp_id).toBe('CP_BERLIN_017');
  });
});

describe('TransactionsPage — pagination', () => {
  it('Next pushes the cursor and Previous pops it', async () => {
    responseQueue.push(
      { transactions: [row({ transaction_id: 1 })], next_cursor: 'cur-page-2' },
      { transactions: [row({ transaction_id: 2 })], next_cursor: 'cur-page-3' },
      { transactions: [row({ transaction_id: 1 })], next_cursor: 'cur-page-2' },
    );

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(fetchCalls.length).toBe(1));
    expect(fetchCalls[0].cursor).toBeUndefined();

    await user.click(screen.getByTestId('transactions-next'));
    await waitFor(() => expect(fetchCalls.length).toBe(2));
    expect(fetchCalls[1].cursor).toBe('cur-page-2');

    await user.click(screen.getByTestId('transactions-prev'));
    await waitFor(() => expect(fetchCalls.length).toBe(3));
    expect(fetchCalls[2].cursor).toBeUndefined();
  });

  it('Previous is disabled on the first page; Next is disabled when there is no next cursor', async () => {
    nextResponse.value = { transactions: [row()], next_cursor: null };
    renderPage();
    await waitFor(() => expect(screen.getByTestId('transactions-pagination')).toBeInTheDocument());

    expect(screen.getByTestId('transactions-prev')).toBeDisabled();
    expect(screen.getByTestId('transactions-next')).toBeDisabled();
  });
});
