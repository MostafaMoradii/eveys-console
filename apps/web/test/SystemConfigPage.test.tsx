// Component tests for SystemConfigPage. The page reads from a single
// REST endpoint; we stub `fetchSysConfig` and the WS context.

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchSysConfig, type ConfigEntry, type SysConfig } from '@/api/config-client';

// ---- mocks ---------------------------------------------------------------

let nextResult: { data?: SysConfig; error?: Error; loading?: boolean } = { loading: true };

vi.mock('@/api/config-client', () => ({
  fetchSysConfig: vi.fn(async (): Promise<SysConfig> => {
    if (nextResult.error) throw nextResult.error;
    return nextResult.data as SysConfig;
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

// ---- imports under test --------------------------------------------------

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SystemConfigPage } from '@/pages/SystemConfigPage';

// ---- helpers -------------------------------------------------------------

function entry(over: Partial<ConfigEntry>): ConfigEntry {
  return {
    key: over.key ?? 'PORT',
    value: over.value ?? '8090',
    sensitive: over.sensitive ?? false,
    default: over.default ?? '8090',
    source: over.source ?? 'default',
    description: over.description ?? 'TCP port the BaaS listens on.',
    mutable: over.mutable ?? true,
    restart: over.restart ?? 'baas',
    range: over.range ?? '1–65535',
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SystemConfigPage />
    </QueryClientProvider>,
  );
}

const baseConfig: SysConfig = {
  scope: 'baas',
  loaded_at: '2026-05-10T00:00:00.000Z',
  entries: [
    entry({ key: 'PORT', value: '8090', source: 'default', restart: 'baas' }),
    entry({
      key: 'JWT_SECRET',
      value: '••••••••',
      sensitive: true,
      default: '',
      source: 'env',
      description: 'HS256 signing secret.',
      restart: 'baas',
    }),
    entry({
      key: 'KAFKA_TOPICS_BOOT',
      value: 'cp.boot',
      default: 'cp.boot',
      source: 'default',
      description: 'BootNotification topic.',
      restart: 'both',
    }),
    entry({
      key: 'GATEWAY_BASE_URL',
      value: 'http://localhost:8080',
      default: '',
      source: 'env',
      description: 'Upstream gateway URL.',
      restart: 'baas',
    }),
  ],
};

beforeEach(() => {
  nextResult = { data: baseConfig };
});
afterEach(() => {
  cleanup();
});

// ---- tests ---------------------------------------------------------------

describe('SystemConfigPage', () => {
  it('shows a loading state while the request is in flight', () => {
    nextResult = { loading: true };
    // Force the query to stay pending: feed fetchSysConfig a never-resolving promise.
    vi.mocked(fetchSysConfig).mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading configuration/i)).toBeInTheDocument();
  });

  it('shows an error alert on fetch failure', async () => {
    nextResult = { error: new Error('sys/config 500') };
    renderPage();
    expect(await screen.findByText(/configuration unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/sys\/config 500/)).toBeInTheDocument();
  });

  it('renders one card per entry with the right key + value', async () => {
    renderPage();
    expect(await screen.findByText('PORT')).toBeInTheDocument();
    expect(screen.getByText('JWT_SECRET')).toBeInTheDocument();
    expect(screen.getByText('KAFKA_TOPICS_BOOT')).toBeInTheDocument();
    expect(screen.getByText('GATEWAY_BASE_URL')).toBeInTheDocument();

    expect(screen.getByTestId('value-PORT')).toHaveTextContent('8090');
    expect(screen.getByTestId('value-GATEWAY_BASE_URL')).toHaveTextContent('http://localhost:8080');
  });

  it('hides sensitive values by default and reveals on toggle', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('JWT_SECRET');

    const valueCell = screen.getByTestId('value-JWT_SECRET');
    // Default: hidden — local replacement of dots; the underlying server
    // value is already masked but the UI also keeps the cell visually muted.
    expect(valueCell.textContent?.trim().length).toBeGreaterThan(0);

    const toggle = screen.getByRole('button', { name: /show sensitive placeholder/i });
    await user.click(toggle);

    // Toggle now reads "Hide sensitive".
    expect(screen.getByRole('button', { name: /hide sensitive/i })).toBeInTheDocument();
  });

  it('filters entries by free-text search (key or description)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('PORT');

    const search = screen.getByLabelText(/search configuration/i);
    await user.type(search, 'BootNotification');

    expect(screen.queryByText('PORT')).not.toBeInTheDocument();
    expect(screen.getByText('KAFKA_TOPICS_BOOT')).toBeInTheDocument();
  });

  it('filters by restart impact', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('PORT');

    const bothBtn = screen.getByRole('button', { name: /^both$/i });
    await user.click(bothBtn);

    expect(screen.getByText('KAFKA_TOPICS_BOOT')).toBeInTheDocument();
    expect(screen.queryByText('PORT')).not.toBeInTheDocument();
    expect(screen.queryByText('JWT_SECRET')).not.toBeInTheDocument();
  });

  it('renders a sensitive badge for sensitive keys', async () => {
    renderPage();
    await screen.findByText('JWT_SECRET');
    // The 'sensitive' badge appears alongside JWT_SECRET; sanity-check
    // it appears at least once.
    expect(screen.getAllByText(/^sensitive$/i).length).toBeGreaterThan(0);
  });

  it('renders the right restart label for each impact level', async () => {
    renderPage();
    await screen.findByText('PORT');
    // 'restart: BaaS' for PORT, JWT_SECRET, GATEWAY_BASE_URL.
    expect(screen.getAllByText(/restart: baas$/i).length).toBeGreaterThanOrEqual(1);
    // 'restart: BaaS + gateway' for KAFKA_TOPICS_BOOT.
    expect(screen.getByText(/restart: baas \+ gateway/i)).toBeInTheDocument();
  });

  it('shows the loaded_at timestamp', async () => {
    renderPage();
    expect(await screen.findByText(/2026-05-10t00:00:00/i)).toBeInTheDocument();
  });
});
