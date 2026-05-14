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

// Live overlay subscription. The page mounts `LiveTailRefetcher` only
// when `live=true && no date range filter`. We surface a per-test
// store of mounted (`query`, `params`) entries so tests can assert
// whether the WS subscription opened — that's how we verify the
// liveAllowed gate without instantiating a real broker.
interface SubProbe {
  query: string;
  setDelta: (d: unknown) => void;
}
const subMounts: Array<SubProbe> = [];
const subDispatchers = new Map<string, (d: unknown) => void>();

vi.mock('@/hooks/use-subscription', async () => {
  const { useEffect, useState } = await import('react');
  return {
    useSubscription: (query: string, _params: unknown) => {
      const [lastDelta, setLastDelta] = useState<unknown>(null);
      useEffect(() => {
        const probe: SubProbe = { query, setDelta: setLastDelta };
        subMounts.push(probe);
        subDispatchers.set(query, setLastDelta);
        return () => {
          const i = subMounts.indexOf(probe);
          if (i >= 0) subMounts.splice(i, 1);
          if (subDispatchers.get(query) === setLastDelta) {
            subDispatchers.delete(query);
          }
        };
      }, [query]);
      return { loading: false, error: null, snapshot: null, lastDelta, cursor: null };
    },
  };
});

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
    consumed_wh: 4_500,
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
  subMounts.length = 0;
  subDispatchers.clear();
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
        row({
          transaction_id: 202,
          open: true,
          stopped_at: null,
          meter_stop_wh: null,
          consumed_wh: null,
        }),
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

describe('TransactionsPage — live overlay', () => {
  it('does not open the WS subscription when live is off (default)', async () => {
    nextResponse.value = { transactions: [], next_cursor: null };
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    expect(subMounts.find((s) => s.query === 'transactions-active')).toBeUndefined();
  });

  it('opens the WS subscription when live=true', async () => {
    searchSnapshot = { live: true };
    routerSearch.live = true;
    nextResponse.value = { transactions: [], next_cursor: null };
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    await waitFor(() =>
      expect(subMounts.find((s) => s.query === 'transactions-active')).toBeDefined(),
    );
  });

  it('refetches on each incoming transactions-active delta', async () => {
    searchSnapshot = { live: true };
    routerSearch.live = true;
    responseQueue.push(
      { transactions: [row({ transaction_id: 1 })], next_cursor: null },
      { transactions: [row({ transaction_id: 2 })], next_cursor: null },
    );
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    const dispatch = await waitFor(() => {
      const fn = subDispatchers.get('transactions-active');
      if (!fn) throw new Error('subscription not yet mounted');
      return fn;
    });

    responseQueue.push({
      transactions: [row({ transaction_id: 99 })],
      next_cursor: null,
    });
    dispatch({
      kind: 'transactions-active',
      op: 'upsert',
      row: { transaction_id: 99 },
    });

    await waitFor(() => expect(fetchCalls.length).toBeGreaterThanOrEqual(2));
  });

  it('auto-disables live when a date range is set (no WS subscription opens)', async () => {
    searchSnapshot = { live: true, from: '2026-05-10T00:00:00Z' };
    routerSearch.live = true;
    routerSearch.from = '2026-05-10T00:00:00Z';
    nextResponse.value = { transactions: [], next_cursor: null };
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    // Subscription must NOT mount when liveAllowed=false.
    expect(subMounts.find((s) => s.query === 'transactions-active')).toBeUndefined();

    // And the checkbox is rendered disabled with the "disabled while a
    // date range is set" hint.
    const checkbox = screen.getByTestId('transactions-filter-live');
    expect(checkbox).toBeDisabled();
    expect(screen.getByText(/disabled while a date range is set/i)).toBeInTheDocument();
  });

  it('toggling the checkbox flips the URL search param', async () => {
    const user = userEvent.setup();
    nextResponse.value = { transactions: [], next_cursor: null };
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    await user.click(screen.getByTestId('transactions-filter-live'));
    await waitFor(() => expect(routerSearch.live).toBe(true));

    await user.click(screen.getByTestId('transactions-filter-live'));
    await waitFor(() => expect(routerSearch.live).toBeUndefined());
  });
});

describe('TransactionsPage — sortable columns', () => {
  it('default render does not send sort/dir + uses cursor mode', async () => {
    nextResponse.value = { transactions: [row()], next_cursor: null };
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBe(1));
    const c = fetchCalls[0];
    expect(c.sort).toBeUndefined();
    expect(c.dir).toBeUndefined();
    expect(c.page).toBeUndefined();
    // Cursor mode means `limit` is forwarded for page-size; absence of
    // `page` is the signal.
    expect(c.limit).toBe(20);
  });

  it('clicking the started header sorts desc and switches to page mode', async () => {
    nextResponse.value = { transactions: [row()], next_cursor: null };
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    nextResponse.value = {
      transactions: [row()],
      next_cursor: null,
      pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
    };
    await user.click(screen.getByTestId('transactions-sort-started_at'));

    await waitFor(() => expect(fetchCalls.length).toBe(2));
    const c = fetchCalls[1];
    expect(c.sort).toBe('started_at');
    expect(c.dir).toBe('desc');
    expect(c.page).toBe(1);
    expect(c.page_size).toBe(20);
    expect(c.cursor).toBeUndefined();
    expect(routerSearch.sort).toBe('started_at');
    expect(routerSearch.dir).toBe('desc');
  });

  it('clicking the same header again flips desc → asc, then clears to default', async () => {
    nextResponse.value = {
      transactions: [row()],
      next_cursor: null,
      pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
    };
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBe(1));

    nextResponse.value = {
      transactions: [row()],
      next_cursor: null,
      pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
    };
    // 1st click: desc
    await user.click(screen.getByTestId('transactions-sort-consumed_wh'));
    await waitFor(() => expect(routerSearch.dir).toBe('desc'));

    nextResponse.value = {
      transactions: [row()],
      next_cursor: null,
      pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
    };
    // 2nd click: asc
    await user.click(screen.getByTestId('transactions-sort-consumed_wh'));
    await waitFor(() => expect(routerSearch.dir).toBe('asc'));

    nextResponse.value = { transactions: [row()], next_cursor: null };
    // 3rd click: clear → back to default (sort/dir absent)
    await user.click(screen.getByTestId('transactions-sort-consumed_wh'));
    await waitFor(() => expect(routerSearch.sort).toBeUndefined());
    expect(routerSearch.dir).toBeUndefined();
  });

  it('honours sort/dir from the URL on first render', async () => {
    searchSnapshot = { sort: 'consumed_wh', dir: 'asc' };
    routerSearch.sort = 'consumed_wh';
    routerSearch.dir = 'asc';
    nextResponse.value = {
      transactions: [row()],
      next_cursor: null,
      pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
    };
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBe(1));
    const c = fetchCalls[0];
    expect(c.sort).toBe('consumed_wh');
    expect(c.dir).toBe('asc');
    expect(c.page).toBe(1);
  });

  it('Next bumps page index in page mode', async () => {
    searchSnapshot = { sort: 'consumed_wh', dir: 'desc' };
    routerSearch.sort = 'consumed_wh';
    routerSearch.dir = 'desc';
    responseQueue.push(
      {
        transactions: [row()],
        next_cursor: null,
        pagination: { page: 1, page_size: 20, total: 80, total_pages: 4 },
      },
      {
        transactions: [row()],
        next_cursor: null,
        pagination: { page: 2, page_size: 20, total: 80, total_pages: 4 },
      },
    );
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(fetchCalls.length).toBe(1));
    expect(fetchCalls[0].page).toBe(1);

    await user.click(screen.getByTestId('transactions-next'));
    await waitFor(() => expect(fetchCalls.length).toBe(2));
    expect(fetchCalls[1].page).toBe(2);
  });
});
