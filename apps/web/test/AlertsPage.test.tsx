// Focused tests for the new /sys/alerts page. The Firing /
// Silences panels themselves are exercised in their own component
// tests; what's worth covering here is (a) tab switching keys the
// URL, (b) the right panel is rendered for each tab, (c) the count
// pips reflect the hooks' state, (d) Channels/Rules render the
// placeholder cards.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '@/lib/theme-context';

// --- router stubs ---
// Mimic TanStack's URL-search store via useSyncExternalStore so a
// navigate() call triggers a consumer re-render. Without this the
// Tabs component stays pinned to its initial value.
let currentTab: 'firing' | 'silences' | 'channels' | 'rules' | undefined = undefined;
const navigateSpy = vi.fn();
const tabListeners = new Set<() => void>();
let tabSnapshot: { tab?: typeof currentTab } = {};

function setTabState(next: typeof currentTab) {
  currentTab = next;
  tabSnapshot = { tab: next };
  for (const fn of tabListeners) fn();
}

vi.mock('@tanstack/react-router', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useSearch: () =>
      useSyncExternalStore(
        (cb: () => void) => {
          tabListeners.add(cb);
          return () => tabListeners.delete(cb);
        },
        () => tabSnapshot,
      ),
    useNavigate: () => (opts: { search?: unknown; replace?: boolean }) => {
      navigateSpy(opts);
      if (typeof opts.search === 'function') {
        const next = (opts.search as (prev: Record<string, unknown>) => Record<string, unknown>)({
          tab: currentTab,
        });
        const t = next.tab;
        if (typeof t === 'string') setTabState(t as typeof currentTab);
      } else if (opts.search && typeof opts.search === 'object') {
        const t = (opts.search as Record<string, unknown>).tab;
        if (typeof t === 'string') setTabState(t as typeof currentTab);
      }
    },
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  };
});

// --- hook stubs ---
let firingStub = { alerts: [], unavailable: false, loading: false, error: null as string | null };
let silencesStub = {
  silences: [],
  unavailable: false,
  loading: false,
  error: null as string | null,
};

vi.mock('@/hooks/use-firing-alerts', () => ({
  useFiringAlerts: () => firingStub,
}));

vi.mock('@/hooks/use-silences', () => ({
  useSilences: () => silencesStub,
}));

// SilenceButton inside FiringAlertsPanel needs a query client; stub it
// so the panel test setup isn't replicated here.
vi.mock('@/hooks/use-silence-mutations', () => ({
  useCreateSilence: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useExpireSilence: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

// ChannelsPanel + RulesPanel need ws-context and their own queries.
// We're testing tab wiring here, not the panels — replace with stubs.
// Real panels have their own tests.
vi.mock('@/components/ChannelsPanel', () => ({
  ChannelsPanel: () => <div data-testid="channels-panel">stub</div>,
}));
vi.mock('@/components/RulesPanel', () => ({
  RulesPanel: () => <div data-testid="rules-panel">stub</div>,
}));
vi.mock('@/components/ManagedRulesPanel', () => ({
  ManagedRulesPanel: () => <div data-testid="managed-rules-panel">stub</div>,
}));

import { AlertsPage } from '@/pages/AlertsPage';

function withProviders(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider>{node}</ThemeProvider>
    </QueryClientProvider>
  );
}

function renderPage() {
  return render(withProviders(<AlertsPage />));
}

beforeEach(() => {
  currentTab = undefined;
  tabSnapshot = {};
  navigateSpy.mockClear();
  firingStub = { alerts: [], unavailable: false, loading: false, error: null };
  silencesStub = { silences: [], unavailable: false, loading: false, error: null };
});

afterEach(() => {
  cleanup();
});

describe('AlertsPage', () => {
  it('renders the four tabs', () => {
    renderPage();
    expect(screen.getByTestId('tab-firing')).toBeInTheDocument();
    expect(screen.getByTestId('tab-silences')).toBeInTheDocument();
    expect(screen.getByTestId('tab-channels')).toBeInTheDocument();
    expect(screen.getByTestId('tab-rules')).toBeInTheDocument();
  });

  it('defaults to the Firing tab when no ?tab is set', () => {
    renderPage();
    expect(screen.getByTestId('firing-alerts-panel')).toBeInTheDocument();
  });

  it('honours ?tab=silences', () => {
    setTabState('silences');
    renderPage();
    expect(screen.getByTestId('active-silences-panel')).toBeInTheDocument();
  });

  it('clicking a tab writes ?tab via useNavigate (replace=true)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('tab-silences'));
    expect(navigateSpy).toHaveBeenCalled();
    const lastCall = navigateSpy.mock.calls[navigateSpy.mock.calls.length - 1]?.[0];
    expect(lastCall?.replace).toBe(true);
  });

  it('Channels tab renders the channels panel', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('tab-channels'));
    expect(screen.getByTestId('channels-panel')).toBeInTheDocument();
  });

  it('Rules tab renders the rules panel', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('tab-rules'));
    expect(screen.getByTestId('rules-panel')).toBeInTheDocument();
  });

  it('shows the firing-count pip on the Firing tab when alerts are present', () => {
    firingStub = {
      ...firingStub,
      alerts: [
        { id: 'fp-1', severity: 'critical', title: 'X', detail: '' },
        { id: 'fp-2', severity: 'warning', title: 'Y', detail: '' },
      ],
    };
    renderPage();
    expect(screen.getByTestId('firing-count').textContent).toBe('2');
  });

  it('shows the silences-count pip on the Silences tab when silences are present', () => {
    silencesStub = {
      ...silencesStub,
      silences: [
        {
          id: 'a',
          matchers: [],
          starts_at: '2026-05-11T10:00:00Z',
          ends_at: '2026-05-11T12:00:00Z',
          comment: null,
          created_by: 'tester',
          status: 'active',
        },
      ],
    };
    renderPage();
    expect(screen.getByTestId('silences-count').textContent).toBe('1');
  });
});
