// Component test for SystemPage. SystemPage now hosts the
// AlertsPanel as the first card; we verify (a) the panel renders,
// (b) the alerts it computes from the stubbed sys_status + the
// stubbed charge-points subscription match what `computeAlerts`
// would produce. We don't re-test the rule engine here — that's
// alerts.test.ts. We just sanity-check the wiring.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChargePointSummary } from '@eveys-console/protocol';

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

let nextSubResult: {
  loading?: boolean;
  error?: string | null;
  snapshot?: { kind: 'charge-points'; rows: ChargePointSummary[] } | null;
} = {};

vi.mock('@/hooks/use-subscription', () => ({
  useSubscription: () => ({
    loading: false,
    error: null,
    snapshot: null,
    lastDelta: null,
    cursor: null,
    ...nextSubResult,
  }),
}));

vi.mock('@/lib/ws-context', () => ({
  useConsoleClient: () => ({
    client: { rpc: vi.fn(), subscribe: vi.fn(), close: vi.fn(), connect: vi.fn() },
    status: 'open',
    token: 'test-token',
    setToken: vi.fn(),
  }),
}));

// Stub the router's <Link> so the cp link inside AlertsPanel renders.
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
    gateway: { ok: true, latency_ms: 50, version: 'test' },
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
  nextSubResult = {};
  vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ---- tests ---------------------------------------------------------------

describe('SystemPage', () => {
  it('renders an AlertsPanel once sys_status loads', async () => {
    nextSysStatus = healthySys();
    nextSubResult = {
      snapshot: { kind: 'charge-points', rows: [cp()] },
    };
    renderPage();
    expect(await screen.findByTestId('alerts-panel')).toBeInTheDocument();
  });

  it('passes the right alerts to AlertsPanel when a faulted charger is in the snapshot', async () => {
    nextSysStatus = healthySys();
    nextSubResult = {
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
    nextSysStatus = healthySys();
    nextSubResult = {
      snapshot: { kind: 'charge-points', rows: [cp()] },
    };
    renderPage();
    expect(await screen.findByTestId('alerts-empty')).toHaveTextContent(/All clear/i);
  });
});
