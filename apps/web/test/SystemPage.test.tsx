// Component tests for SystemPage. The page composes pieces (the
// pure rule engine in alerts.test.ts, the fault-count helper in
// fault.test.ts, the MetricTile in its own renders trivially), so
// these tests focus on wiring:
//   - the AlertsPanel sits above the metrics row in DOM order,
//   - the four headline tiles derive numbers from the stubbed
//     subscriptions,
//   - the service-status pills colour by sys.gateway.ok / kafka.ok,
//   - the page renders without crashing while data is loading.

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChargePointSummary, TransactionSummary } from '@eveys-console/protocol';

import type { SysStatus } from '@/api/sys-client';

// ---- mocks ---------------------------------------------------------------

let nextSysStatus: SysStatus | null = null;
let sysQueryError: Error | null = null;

vi.mock('@/api/sys-client', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    fetchSysStatus: vi.fn(async () => {
      if (sysQueryError) throw sysQueryError;
      return nextSysStatus as SysStatus;
    }),
  };
});

interface SubStub<T> {
  loading?: boolean;
  error?: string | null;
  snapshot?: T | null;
}

let cpSubStub: SubStub<{ kind: 'charge-points'; rows: ChargePointSummary[] }> = {};
let txSubStub: SubStub<{ kind: 'transactions-active'; rows: TransactionSummary[] }> = {};

vi.mock('@/hooks/use-subscription', () => ({
  useSubscription: (query: string) => {
    const base = { loading: false, error: null, snapshot: null, lastDelta: null, cursor: null };
    if (query === 'charge-points') return { ...base, ...cpSubStub };
    if (query === 'transactions-active') return { ...base, ...txSubStub };
    return base;
  },
}));

vi.mock('@/lib/ws-context', () => ({
  useConsoleClient: () => ({
    client: { rpc: vi.fn(), subscribe: vi.fn(), close: vi.fn(), connect: vi.fn() },
    status: 'open',
    token: 'test-token',
    setToken: vi.fn(),
  }),
}));

// Stub the router's <Link> so the cp-link inside AlertsPanel and the
// tiles render as plain anchors.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, unknown>;
    children: React.ReactNode;
  } & Record<string, unknown>) => {
    let href = to;
    if (params && typeof params === 'object') {
      for (const [k, v] of Object.entries(params)) {
        href = href.replace(`$${k}`, String(v));
      }
    }
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

// ---- imports under test --------------------------------------------------

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SystemPage } from '@/pages/SystemPage';

// ---- fixtures ------------------------------------------------------------

function healthySys(over: Partial<SysStatus> = {}): SysStatus {
  return {
    console: { uptime_seconds: 60, started_at: '2026-05-10T11:59:00.000Z' },
    gateway: {
      ok: true,
      latency_ms: 50,
      version: 'test',
      components: { postgres: 'ok', redis: 'ok' },
    },
    kafka: { ok: true, consumer_running: true, topics: ['cp.events'] },
    connections: { websockets: 1 },
    ...over,
  };
}

function cp(over: Partial<ChargePointSummary> = {}): ChargePointSummary {
  return {
    cp_id: 'CP_A',
    online: true,
    pod_id: 'pod-1',
    vendor: 'Eveys',
    model: 'X1',
    firmware_version: '1.0.0',
    serial_number: 'SN1',
    last_boot_at: null,
    last_heartbeat_at: '2026-05-10T11:59:30.000Z',
    last_status: 'Available',
    connectors: [
      { connector_id: 1, status: 'Available', error_code: 'NoError', last_changed_at: null },
    ],
    ...over,
  } as ChargePointSummary;
}

function tx(over: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    transaction_id: 1,
    cp_id: 'CP_A',
    connector_id: 1,
    id_tag: 'TAG',
    meter_start_wh: 0,
    meter_stop_wh: null,
    consumed_wh: null,
    started_reported_at: '2026-05-10T11:30:00.000Z',
    started_received_at: '2026-05-10T11:30:00.000Z',
    stopped_reported_at: null,
    stopped_received_at: null,
    stop_reason: null,
    ...over,
  } as TransactionSummary;
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false, gcTime: 0, staleTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SystemPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  nextSysStatus = healthySys();
  sysQueryError = null;
  cpSubStub = { snapshot: { kind: 'charge-points', rows: [] } };
  txSubStub = { snapshot: { kind: 'transactions-active', rows: [] } };
  vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ---- tests ---------------------------------------------------------------

describe('SystemPage — alerts strip', () => {
  it('renders an AlertsPanel once sys_status loads', async () => {
    cpSubStub = { snapshot: { kind: 'charge-points', rows: [cp()] } };
    renderPage();
    expect(await screen.findByTestId('alerts-panel')).toBeInTheDocument();
  });

  it('places the AlertsPanel above the metrics row in DOM order', async () => {
    cpSubStub = { snapshot: { kind: 'charge-points', rows: [cp()] } };
    renderPage();
    const panel = await screen.findByTestId('alerts-panel');
    const metrics = await screen.findByTestId('metrics-row');
    // compareDocumentPosition: 4 = panel precedes metrics.
    expect(panel.compareDocumentPosition(metrics)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('passes the right alerts to AlertsPanel when a faulted charger is in the snapshot', async () => {
    cpSubStub = {
      snapshot: {
        kind: 'charge-points',
        rows: [
          cp({
            cp_id: 'CP_FAULT',
            connectors: [
              {
                connector_id: 1,
                status: 'Faulted',
                error_code: 'GroundFailure',
                last_changed_at: null,
              },
            ],
          }),
        ],
      },
    };
    renderPage();
    await screen.findByTestId('alerts-panel');
    const rows = screen.getAllByTestId('alerts-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!).toHaveAttribute('data-alert-id', 'charger-faulted:CP_FAULT');
    expect(rows[0]!).toHaveAttribute('data-severity', 'critical');
  });

  it('shows the empty alerts state when sys_status is healthy and the fleet has no faults', async () => {
    cpSubStub = { snapshot: { kind: 'charge-points', rows: [cp()] } };
    renderPage();
    expect(await screen.findByTestId('alerts-empty')).toHaveTextContent(/All clear/i);
  });
});

describe('SystemPage — headline metrics', () => {
  it('renders chargers-online tile as online / total', async () => {
    cpSubStub = {
      snapshot: {
        kind: 'charge-points',
        rows: [cp({ cp_id: 'A', online: true }), cp({ cp_id: 'B', online: false })],
      },
    };
    renderPage();
    const tile = await screen.findByTestId('metric-chargers');
    expect(within(tile).getByText('1')).toBeInTheDocument();
    expect(within(tile).getByText(/of 2 known/)).toBeInTheDocument();
  });

  it('renders active-sessions tile from the transactions-active subscription', async () => {
    txSubStub = {
      snapshot: {
        kind: 'transactions-active',
        rows: [tx({ transaction_id: 1 }), tx({ transaction_id: 2, cp_id: 'CP_B' })],
      },
    };
    renderPage();
    const tile = await screen.findByTestId('metric-sessions');
    expect(within(tile).getByText('2')).toBeInTheDocument();
  });

  it('renders faults tile counting cps with any Faulted connector', async () => {
    cpSubStub = {
      snapshot: {
        kind: 'charge-points',
        rows: [
          cp({ cp_id: 'A' }),
          cp({
            cp_id: 'B',
            connectors: [
              {
                connector_id: 1,
                status: 'Faulted',
                error_code: 'GroundFailure',
                last_changed_at: null,
              },
            ],
          }),
          cp({
            cp_id: 'C',
            connectors: [
              {
                connector_id: 1,
                status: 'Faulted',
                error_code: 'OverCurrent',
                last_changed_at: null,
              },
            ],
          }),
        ],
      },
    };
    renderPage();
    const tile = await screen.findByTestId('metric-faults');
    expect(within(tile).getByText('2')).toBeInTheDocument();
  });

  it('shows an em-dash and an honest hint on the 24h energy tile (no fleet aggregate yet)', async () => {
    renderPage();
    const tile = await screen.findByTestId('metric-energy');
    expect(within(tile).getByText('—')).toBeInTheDocument();
    expect(within(tile).getByText(/data not available/i)).toBeInTheDocument();
  });

  it('faults tile links to the fleet view with the faults filter pre-engaged', async () => {
    renderPage();
    const tile = await screen.findByTestId('metric-faults');
    const anchor = tile.closest('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('/inspect/charge-points');
    // The router-Link mock spreads extra props as attributes on the
    // anchor, so the `search={{ faults: true }}` prop lands as
    // attribute "search" with its toString'd form. We assert presence
    // rather than exact serialisation: TanStack handles the query-
    // string encoding in production.
    expect(anchor?.hasAttribute('search')).toBe(true);
  });
});

describe('SystemPage — service status pills', () => {
  it('renders a green pill for each component when everything is ok', async () => {
    nextSysStatus = healthySys();
    renderPage();
    const row = await screen.findByTestId('service-pills');
    const consolePill = within(row).getByTestId('service-pill-console');
    const gatewayPill = within(row).getByTestId('service-pill-gateway');
    const kafkaPill = within(row).getByTestId('service-pill-kafka');
    expect(consolePill).toHaveAttribute('data-tone', 'success');
    expect(gatewayPill).toHaveAttribute('data-tone', 'success');
    expect(kafkaPill).toHaveAttribute('data-tone', 'success');
    // Per-component pills from gateway.components:
    expect(within(row).getByTestId('service-pill-gw-postgres')).toHaveAttribute(
      'data-tone',
      'success',
    );
    expect(within(row).getByTestId('service-pill-gw-redis')).toHaveAttribute(
      'data-tone',
      'success',
    );
  });

  it('flags the gateway pill destructive when sys.gateway.ok is false', async () => {
    nextSysStatus = healthySys({
      gateway: { ok: false, detail: 'probe failed', components: {} },
    });
    renderPage();
    const pill = await screen.findByTestId('service-pill-gateway');
    expect(pill).toHaveAttribute('data-tone', 'destructive');
    expect(pill).toHaveAttribute('aria-label', expect.stringContaining('probe failed'));
  });

  it('flags the kafka pill warning when the consumer is stopped but the broker is reachable', async () => {
    nextSysStatus = healthySys({
      kafka: { ok: true, consumer_running: false, topics: [] },
    });
    renderPage();
    const pill = await screen.findByTestId('service-pill-kafka');
    expect(pill).toHaveAttribute('data-tone', 'warning');
  });
});

describe('SystemPage — loading + error states', () => {
  it('renders without crashing while the charge-points subscription is still loading', async () => {
    cpSubStub = { loading: true, snapshot: null };
    renderPage();
    // Title is the cheapest "page rendered" assertion.
    expect(await screen.findByText('System status')).toBeInTheDocument();
    // Tiles should show their loading placeholder, not throw.
    const chargers = await screen.findByTestId('metric-chargers');
    expect(within(chargers).getByText('…')).toBeInTheDocument();
  });

  it('shows the error alert when fetchSysStatus rejects', async () => {
    sysQueryError = new Error('boom');
    renderPage();
    expect(await screen.findByText(/System status unavailable/i)).toBeInTheDocument();
  });
});
