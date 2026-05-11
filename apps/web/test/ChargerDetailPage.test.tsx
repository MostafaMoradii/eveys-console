// Focused tests for the three Batch 4 behaviours on ChargerDetailPage:
// (1) heartbeat badge in the header, (2) Hard Reset behind an
// AlertDialog confirmation, (3) RemoteStart gated on a typed id_tag.
//
// Other parts of the page (status pills, fault banner, transactions
// history, statistics card, device events panel) are covered by their
// own component tests; we mock those out so this file stays scoped.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChargePointSummary } from '@eveys-console/protocol';

import { ToastProvider } from '@/components/ui/toaster';
import { ThemeProvider } from '@/lib/theme-context';

const rpcSpy = vi.fn<(method: string, params: Record<string, unknown>) => Promise<void>>();
rpcSpy.mockResolvedValue();

vi.mock('@/lib/ws-context', () => ({
  useConsoleClient: () => ({
    client: { rpc: rpcSpy, subscribe: vi.fn(), close: vi.fn(), connect: vi.fn() },
    status: 'open',
    diagnostics: { lastCloseCode: null, lastCloseReason: null, reconnectAttempt: 0 },
    token: 'test-token',
    setToken: vi.fn(),
  }),
}));

// Route param: ChargerDetailPage reads cpId via useParams.
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ cpId: 'cp_TEST' }),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

// Mock the heavyweight child panels — each has its own test file.
vi.mock('@/components/CommandsDrawer', () => ({
  CommandsDrawer: ({ trigger }: { trigger: ReactNode }) => <div>{trigger}</div>,
}));
vi.mock('@/components/DeviceEventsPanel', () => ({
  DeviceEventsPanel: () => <div data-testid="mock-device-events" />,
}));
vi.mock('@/components/DiagnosticsHistory', () => ({
  DiagnosticsHistory: () => <div data-testid="mock-diagnostics" />,
}));
vi.mock('@/components/StatisticsCard', () => ({
  StatisticsCard: () => <div data-testid="mock-stats" />,
}));
vi.mock('@/components/TransactionsHistory', () => ({
  TransactionsHistory: () => <div data-testid="mock-transactions" />,
}));

let isPhone = false;
vi.mock('@/lib/use-breakpoint', () => ({
  useIsBelow: () => isPhone,
}));

// Per-test override of what the subscription returns.
interface SubResult {
  loading?: boolean;
  error?: string | null;
  snapshot?: { kind: 'charge-point'; row: ChargePointSummary } | null;
  lastDelta?: unknown;
}
let nextSubResult: SubResult = {};

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

import { ChargerDetailPage } from '@/pages/ChargerDetailPage';

function baseCp(over: Partial<ChargePointSummary> = {}): ChargePointSummary {
  return {
    cp_id: 'cp_TEST',
    online: true,
    pod_id: 'pod-1',
    vendor: 'Eveys',
    model: 'Eveys-22kW-AC',
    firmware_version: '1.0.0',
    serial_number: 'cp_TEST',
    last_boot_at: '2026-05-10T10:00:00+00:00',
    last_heartbeat_at: '2026-05-10T11:48:00+00:00',
    last_status: 'Available',
    connectors: [
      { connector_id: 1, status: 'Available', error_code: 'NoError', last_changed_at: null },
    ],
    ...over,
  };
}

function withProviders(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <ToastProvider>{node}</ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function renderPage() {
  return render(withProviders(<ChargerDetailPage />));
}

// Commands moved to a tab in the detail-page refactor; helper opens
// it so the existing assertions on the Hard-Reset / RemoteStart
// controls keep working without each test re-implementing the click.
async function openCommandsTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('detail-tab-commands'));
}

beforeEach(() => {
  rpcSpy.mockClear();
  isPhone = false;
  nextSubResult = {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ChargerDetailPage — header heartbeat badge', () => {
  beforeEach(() => {
    // Pin "now" so the relative-time assertion is deterministic.
    // Only the heartbeat tests need fake timers; userEvent interacts
    // badly with them in the other blocks.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
  });

  it('shows heartbeat: 12m ago with absolute UTC on hover', () => {
    nextSubResult = { snapshot: { kind: 'charge-point', row: baseCp() } };
    renderPage();
    const badge = screen.getByTestId('header-heartbeat');
    expect(badge.textContent).toMatch(/heartbeat:\s*12m ago/);
    // The TimeAgo span carries the title attribute.
    const timeNode = within(badge).getByTestId('time-ago');
    expect(timeNode.getAttribute('title')).toBe('2026-05-10 11:48:00 UTC');
  });

  it('hides the heartbeat badge when last_heartbeat_at is null', () => {
    nextSubResult = {
      snapshot: { kind: 'charge-point', row: baseCp({ last_heartbeat_at: null }) },
    };
    renderPage();
    expect(screen.queryByTestId('header-heartbeat')).toBeNull();
  });

  // Regression: the page used to render `sub.snapshot.row` directly,
  // so a fresh cp.boot / cp.status delta never showed up until the
  // next snapshot refresh. The detail page now merges `lastDelta` in.
  it('renders the lastDelta row (fresh BootNotification / StatusNotification) over the snapshot', () => {
    nextSubResult = {
      snapshot: {
        kind: 'charge-point',
        row: baseCp({ firmware_version: '1.0.0', last_status: 'Available' }),
      },
      lastDelta: {
        kind: 'charge-point',
        row: baseCp({ firmware_version: '2.5.0', last_status: 'Charging' }),
      },
    };
    renderPage();
    expect(screen.getByText(/firmware 2\.5\.0/)).toBeInTheDocument();
    expect(screen.queryByText(/firmware 1\.0\.0/)).toBeNull();
  });
});

describe('ChargerDetailPage — Hard Reset', () => {
  it('clicking the button opens an AlertDialog without firing the RPC', async () => {
    const user = userEvent.setup();
    nextSubResult = { snapshot: { kind: 'charge-point', row: baseCp() } };
    renderPage();
    await openCommandsTab(user);
    expect(screen.queryByTestId('hard-reset-dialog')).toBeNull();
    await user.click(screen.getByTestId('hard-reset-button'));
    expect(screen.getByTestId('hard-reset-dialog')).toBeInTheDocument();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('confirming the dialog fires reset with type=Hard', async () => {
    const user = userEvent.setup();
    nextSubResult = { snapshot: { kind: 'charge-point', row: baseCp() } };
    renderPage();
    await openCommandsTab(user);
    await user.click(screen.getByTestId('hard-reset-button'));
    await user.click(screen.getByTestId('hard-reset-confirm'));
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).toHaveBeenCalledWith('reset', { cp_id: 'cp_TEST', type: 'Hard' });
  });

  it('cancelling the dialog leaves the charger untouched', async () => {
    const user = userEvent.setup();
    nextSubResult = { snapshot: { kind: 'charge-point', row: baseCp() } };
    renderPage();
    await openCommandsTab(user);
    await user.click(screen.getByTestId('hard-reset-button'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

describe('ChargerDetailPage — RemoteStart id_tag', () => {
  it('RemoteStart is disabled until an id_tag is typed', async () => {
    const user = userEvent.setup();
    nextSubResult = { snapshot: { kind: 'charge-point', row: baseCp() } };
    renderPage();
    await openCommandsTab(user);
    const btn = screen.getByTestId('remote-start-button');
    expect(btn).toBeDisabled();
    await user.type(screen.getByTestId('remote-start-idtag'), 'TAG-1234');
    expect(btn).not.toBeDisabled();
  });

  it('forwards the typed id_tag to the RPC', async () => {
    const user = userEvent.setup();
    nextSubResult = { snapshot: { kind: 'charge-point', row: baseCp() } };
    renderPage();
    await openCommandsTab(user);
    await user.type(screen.getByTestId('remote-start-idtag'), 'TAG-9999');
    await user.click(screen.getByTestId('remote-start-button'));
    expect(rpcSpy).toHaveBeenCalledWith('remote-start', {
      cp_id: 'cp_TEST',
      id_tag: 'TAG-9999',
    });
  });

  it('trims whitespace from the typed id_tag before sending', async () => {
    const user = userEvent.setup();
    nextSubResult = { snapshot: { kind: 'charge-point', row: baseCp() } };
    renderPage();
    await openCommandsTab(user);
    await user.type(screen.getByTestId('remote-start-idtag'), '  TAG-1  ');
    await user.click(screen.getByTestId('remote-start-button'));
    expect(rpcSpy).toHaveBeenCalledWith('remote-start', {
      cp_id: 'cp_TEST',
      id_tag: 'TAG-1',
    });
  });

  it('whitespace-only input keeps the RemoteStart button disabled', async () => {
    const user = userEvent.setup();
    nextSubResult = { snapshot: { kind: 'charge-point', row: baseCp() } };
    renderPage();
    await openCommandsTab(user);
    await user.type(screen.getByTestId('remote-start-idtag'), '   ');
    expect(screen.getByTestId('remote-start-button')).toBeDisabled();
  });
});
