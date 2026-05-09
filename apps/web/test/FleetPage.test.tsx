// Component tests for FleetPage. The page has enough state worth
// covering: snapshot rendering, delta application, view-mode (table
// vs grid + the phone force-grid override), client-side filters
// (search + status), server-side filter param passthrough, and
// the cursor-stack pagination.
//
// We stub the transport layer (use-subscription, ws-context) and
// the breakpoint hook so each test can drive page state directly.
// The router is also stubbed because mounting RouterProvider for a
// single page is heavy; we only verify <Link>'s `to` and
// `params` get the right values.

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChargePointSummary } from '@eveys-console/protocol';

// ---- mocks ---------------------------------------------------------------

// Capture every subscription call so tests can assert on params.
const subscriptionCalls: { query: string; params: Record<string, unknown> }[] = [];

// Per-test override of what the subscription returns.
type SubResult = {
  loading?: boolean;
  error?: string | null;
  snapshot?: {
    kind: 'charge-points';
    rows: ChargePointSummary[];
    next_cursor?: string | null;
  } | null;
  lastDelta?: unknown;
  cursor?: string | null;
};
let nextSubResult: SubResult = {};

vi.mock('@/hooks/use-subscription', () => ({
  useSubscription: (query: string, params: Record<string, unknown>) => {
    subscriptionCalls.push({ query, params: { ...params } });
    return {
      loading: false,
      error: null,
      snapshot: null,
      lastDelta: null,
      cursor: null,
      ...nextSubResult,
    };
  },
}));

let isPhone = false;
vi.mock('@/lib/use-breakpoint', () => ({
  useIsBelow: () => isPhone,
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

// Minimal router stub: <Link to="..." params={...}> renders <a> with
// a stable testid + href. FleetPage only uses Link.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    className,
    title,
  }: {
    to: string;
    params?: Record<string, unknown>;
    children: React.ReactNode;
    className?: string;
    title?: string;
  }) => {
    let href = to;
    if (params && typeof params === 'object') {
      for (const [k, v] of Object.entries(params)) {
        href = href.replace(`$${k}`, String(v));
      }
    }
    return (
      <a href={href} data-testid="router-link" className={className} title={title}>
        {children}
      </a>
    );
  },
}));

// ---- imports under test --------------------------------------------------

import { FleetPage } from '@/pages/FleetPage';

// ---- fixtures ------------------------------------------------------------

const baseRow = (
  cp_id: string,
  overrides: Partial<ChargePointSummary> = {},
): ChargePointSummary => ({
  cp_id,
  online: true,
  pod_id: 'pod-1',
  vendor: 'Eveys',
  model: 'Eveys-22kW-AC',
  firmware_version: '1.0.0',
  serial_number: cp_id,
  last_boot_at: '2026-05-09T10:00:00+00:00',
  last_heartbeat_at: '2026-05-09T11:00:00+00:00',
  last_status: 'Available',
  connectors: [
    { connector_id: 1, status: 'Available', error_code: 'NoError', last_changed_at: null },
  ],
  ...overrides,
});

beforeEach(() => {
  subscriptionCalls.length = 0;
  nextSubResult = {};
  isPhone = false;
  // Each test gets a fresh localStorage for the view-mode pref.
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

// ---- helpers -------------------------------------------------------------

// Find a <select> by the visible text of its currently-selected
// option. The page has multiple selects but they all start at
// distinct default values ("All" for online, "Any" for status,
// "100" for page size), so a unique label-less query is feasible.
function selectByCurrentText(text: string | RegExp): HTMLSelectElement {
  const selects = document.querySelectorAll('select');
  for (const sel of Array.from(selects)) {
    const opt = sel.options[sel.selectedIndex];
    if (!opt) continue;
    const t = opt.textContent ?? '';
    const match = typeof text === 'string' ? t === text : text.test(t);
    if (match) return sel;
  }
  throw new Error(`No <select> found with selected option matching ${String(text)}`);
}

// ---- tests ---------------------------------------------------------------

describe('FleetPage — initial states', () => {
  it('renders a loading state while the subscription is pending', () => {
    nextSubResult = { loading: true, snapshot: null };
    render(<FleetPage />);
    expect(screen.getByText(/Loading charge points/i)).toBeInTheDocument();
  });

  it('renders an error alert when the subscription errors', () => {
    nextSubResult = { error: 'gateway 500', snapshot: null };
    render(<FleetPage />);
    expect(screen.getByText(/Couldn't load charge points/i)).toBeInTheDocument();
    expect(screen.getByText('gateway 500')).toBeInTheDocument();
  });

  it('renders an empty state when the snapshot is empty', () => {
    nextSubResult = { snapshot: { kind: 'charge-points', rows: [], next_cursor: null } };
    render(<FleetPage />);
    expect(screen.getByText(/No charge points match the current filters/i)).toBeInTheDocument();
  });
});

describe('FleetPage — snapshot rendering', () => {
  it('renders one row per charger in table view', () => {
    nextSubResult = {
      snapshot: {
        kind: 'charge-points',
        rows: [baseRow('CP_A'), baseRow('CP_B'), baseRow('CP_C', { online: false })],
        next_cursor: null,
      },
    };
    render(<FleetPage />);
    const links = screen.getAllByTestId('router-link');
    const cpLinks = links.filter((a) =>
      a.getAttribute('href')?.startsWith('/inspect/charge-points/'),
    );
    expect(cpLinks.map((a) => a.textContent)).toEqual(['CP_A', 'CP_B', 'CP_C']);
    // Heading reflects the row count.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/Charge points — 3/);
  });
});

describe('FleetPage — view toggle', () => {
  it('starts in table view by default and switches to grid on click', async () => {
    const user = userEvent.setup();
    nextSubResult = {
      snapshot: { kind: 'charge-points', rows: [baseRow('CP_A')], next_cursor: null },
    };
    render(<FleetPage />);
    // Table view → there's a column header named "cp_id"
    expect(screen.getByRole('columnheader', { name: 'cp_id' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /grid view/i }));
    expect(screen.queryByRole('columnheader', { name: 'cp_id' })).not.toBeInTheDocument();
  });

  it('forces grid view below sm and hides the toggle', () => {
    isPhone = true;
    // Even if the user previously saved table view…
    localStorage.setItem('eveys-console.fleet-view', 'table');
    nextSubResult = {
      snapshot: { kind: 'charge-points', rows: [baseRow('CP_A')], next_cursor: null },
    };
    render(<FleetPage />);
    // …the table doesn't render on phone.
    expect(screen.queryByRole('columnheader', { name: 'cp_id' })).not.toBeInTheDocument();
    // And the toggle is hidden.
    expect(screen.queryByRole('button', { name: /grid view/i })).not.toBeInTheDocument();
  });
});

describe('FleetPage — client-side filters', () => {
  it('search filter cuts visible rows by cp_id / vendor / model', async () => {
    const user = userEvent.setup();
    nextSubResult = {
      snapshot: {
        kind: 'charge-points',
        rows: [
          baseRow('CP_BERLIN_001', { vendor: 'Eveys' }),
          baseRow('CP_LONDON_002', { vendor: 'OtherCo' }),
          baseRow('CP_BERLIN_003', { vendor: 'Eveys' }),
        ],
        next_cursor: null,
      },
    };
    render(<FleetPage />);
    expect(screen.getAllByText(/CP_BERLIN_/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/CP_LONDON_002/).length).toBeGreaterThan(0);

    await user.type(screen.getByPlaceholderText(/filter loaded page/i), 'BERLIN');

    // The two BERLIN rows still show; the LONDON one is filtered out.
    expect(screen.getByText('CP_BERLIN_001')).toBeInTheDocument();
    expect(screen.getByText('CP_BERLIN_003')).toBeInTheDocument();
    expect(screen.queryByText('CP_LONDON_002')).not.toBeInTheDocument();
    // Heading should now show "X of Y shown".
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/2 of 3 shown/);
  });

  it('status filter narrows by last_status', async () => {
    const user = userEvent.setup();
    nextSubResult = {
      snapshot: {
        kind: 'charge-points',
        rows: [
          baseRow('CP_A', { last_status: 'Charging' }),
          baseRow('CP_B', { last_status: 'Available' }),
          baseRow('CP_C', { last_status: 'Charging' }),
        ],
        next_cursor: null,
      },
    };
    render(<FleetPage />);
    // The page has three native <select>s (online, vendor's
    // datalist isn't a select, status, page-size); identify the
    // status one by its current value "all" via the displayed text.
    const statusSelect = selectByCurrentText(/Any/);
    await user.selectOptions(statusSelect, 'Charging');

    expect(screen.getByText('CP_A')).toBeInTheDocument();
    expect(screen.getByText('CP_C')).toBeInTheDocument();
    expect(screen.queryByText('CP_B')).not.toBeInTheDocument();
  });
});

describe('FleetPage — server-side filter passthrough', () => {
  it('online select pushes online: true into subscription params', async () => {
    const user = userEvent.setup();
    nextSubResult = {
      snapshot: { kind: 'charge-points', rows: [baseRow('CP_A')], next_cursor: null },
    };
    render(<FleetPage />);
    subscriptionCalls.length = 0;

    // Online select's default visible text is "All"; pick it that way.
    await user.selectOptions(selectByCurrentText('All'), 'online');

    // After the change the most recent subscription call should
    // carry online: true.
    const last = subscriptionCalls.at(-1);
    expect(last?.params.online).toBe(true);
  });

  it('vendor input commits to subscription params on Enter', async () => {
    const user = userEvent.setup();
    nextSubResult = {
      snapshot: { kind: 'charge-points', rows: [baseRow('CP_A')], next_cursor: null },
    };
    render(<FleetPage />);
    subscriptionCalls.length = 0;

    // The Vendor field is an <input list="vendor-options">
    // identifiable by its placeholder.
    const vendor = screen.getByPlaceholderText('any');
    await user.click(vendor);
    await user.keyboard('Eveys{Enter}');

    const last = subscriptionCalls.at(-1);
    expect(last?.params.vendor).toBe('Eveys');
  });

  it('changing page-size resets the cursor stack to page 1', async () => {
    const user = userEvent.setup();
    nextSubResult = {
      snapshot: {
        kind: 'charge-points',
        rows: [baseRow('CP_A')],
        next_cursor: 'cursor-page-2',
      },
    };
    render(<FleetPage />);
    // Advance to page 2.
    await user.click(screen.getByRole('button', { name: /next/i }));
    // Now changing page-size resets to page 1.
    subscriptionCalls.length = 0;
    await user.selectOptions(screen.getByDisplayValue('100'), '50');
    const last = subscriptionCalls.at(-1);
    expect(last?.params.cursor).toBeUndefined();
    expect(last?.params.limit).toBe(50);
  });
});

describe('FleetPage — pagination', () => {
  it('Next pushes the next_cursor into a cursor stack', async () => {
    const user = userEvent.setup();
    nextSubResult = {
      snapshot: {
        kind: 'charge-points',
        rows: [baseRow('CP_A')],
        next_cursor: 'cursor-2',
      },
    };
    render(<FleetPage />);
    subscriptionCalls.length = 0;
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(subscriptionCalls.at(-1)?.params.cursor).toBe('cursor-2');
  });

  it('Previous is disabled on page 1 and enabled on page 2+', async () => {
    const user = userEvent.setup();
    nextSubResult = {
      snapshot: {
        kind: 'charge-points',
        rows: [baseRow('CP_A')],
        next_cursor: 'cursor-2',
      },
    };
    render(<FleetPage />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('button', { name: /previous/i })).not.toBeDisabled();
  });

  it('Next is disabled when next_cursor is null', () => {
    nextSubResult = {
      snapshot: {
        kind: 'charge-points',
        rows: [baseRow('CP_A')],
        next_cursor: null,
      },
    };
    render(<FleetPage />);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });
});

describe('FleetPage — delta application', () => {
  it('upsert delta replaces a snapshot row in place', () => {
    // Snapshot has the charger Available with a Faulted connector;
    // the delta flips the charger's last_status to Charging. The
    // assertion targets the "last status" column (third <td>) so
    // it's not confused by the connector-status pill in the
    // "connectors" column.
    nextSubResult = {
      snapshot: {
        kind: 'charge-points',
        rows: [
          baseRow('CP_A', {
            last_status: 'Available',
            connectors: [
              { connector_id: 1, status: 'Faulted', error_code: 'NoError', last_changed_at: null },
            ],
          }),
        ],
        next_cursor: null,
      },
      lastDelta: {
        kind: 'charge-points',
        op: 'upsert',
        row: baseRow('CP_A', {
          last_status: 'Charging',
          connectors: [
            { connector_id: 1, status: 'Faulted', error_code: 'NoError', last_changed_at: null },
          ],
        }),
      },
    };
    render(<FleetPage />);
    const link = screen.getByText('CP_A');
    const dataRow = link.closest('tr')! as HTMLTableRowElement;
    // Cells in order: [chevron, cp_id, online, last status, connectors, vendor/model, firmware, last heartbeat]
    const lastStatusCell = dataRow.cells[3]!;
    expect(within(lastStatusCell).getByText('Charging')).toBeInTheDocument();
    expect(within(lastStatusCell).queryByText('Available')).not.toBeInTheDocument();
  });

  it('upsert delta adds a row that was not in the snapshot', () => {
    nextSubResult = {
      snapshot: {
        kind: 'charge-points',
        rows: [baseRow('CP_A')],
        next_cursor: null,
      },
      lastDelta: {
        kind: 'charge-points',
        op: 'upsert',
        row: baseRow('CP_NEW'),
      },
    };
    render(<FleetPage />);
    expect(screen.getByText('CP_NEW')).toBeInTheDocument();
  });

  it('remove delta drops a row from the page', () => {
    nextSubResult = {
      snapshot: {
        kind: 'charge-points',
        rows: [baseRow('CP_A'), baseRow('CP_B')],
        next_cursor: null,
      },
      lastDelta: { kind: 'charge-points', op: 'remove', cp_id: 'CP_A' },
    };
    render(<FleetPage />);
    expect(screen.queryByText('CP_A')).not.toBeInTheDocument();
    expect(screen.getByText('CP_B')).toBeInTheDocument();
  });
});

describe('FleetPage — table-row connector drill-down', () => {
  it('expanding a row reveals connector detail', async () => {
    const user = userEvent.setup();
    nextSubResult = {
      snapshot: {
        kind: 'charge-points',
        rows: [
          baseRow('CP_A', {
            connectors: [
              { connector_id: 1, status: 'Charging', error_code: 'NoError', last_changed_at: null },
              {
                connector_id: 2,
                status: 'Faulted',
                error_code: 'GroundFailure',
                last_changed_at: null,
              },
            ],
          }),
        ],
        next_cursor: null,
      },
    };
    render(<FleetPage />);
    // Connector detail isn't rendered yet.
    expect(screen.queryByText('GroundFailure')).not.toBeInTheDocument();

    // The expand button has aria-label "Expand"
    await user.click(screen.getAllByRole('button', { name: /expand/i })[0]!);

    expect(screen.getByText('GroundFailure')).toBeInTheDocument();
  });
});

describe('FleetPage — links', () => {
  it('cp_id link points at /inspect/charge-points/$cpId', () => {
    nextSubResult = {
      snapshot: {
        kind: 'charge-points',
        rows: [baseRow('CP_TEST_ABC')],
        next_cursor: null,
      },
    };
    render(<FleetPage />);
    const link = screen.getByText('CP_TEST_ABC').closest('a')!;
    expect(link.getAttribute('href')).toBe('/inspect/charge-points/CP_TEST_ABC');
  });
});

// Suppress an `act()` warning that fires on the cleanup of tests
// using userEvent + the `<datalist>` autocomplete on the Vendor
// input. The warning is benign; jsdom doesn't fully model
// datalist-related events.
beforeEach(() => {
  const original = console.error;
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const msg = String(args[0] ?? '');
    if (msg.includes('not wrapped in act(') || msg.includes('was not wrapped')) return;
    original(...(args as []));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
