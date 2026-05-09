// Component tests for the shared ConfigView, covered through both
// the Console-config page (filter set: All / Console / Live) and the
// Gateway-config page (filter set: All / Gateway / Console / Both /
// Live). Each page is exercised end-to-end so the route → page →
// fetcher wiring is verified at the same time as the rendering.

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchConsoleConfig,
  fetchGatewayConfig,
  type ConfigEntry,
  type SysConfig,
} from '@/api/config-client';

let nextResult: { data?: SysConfig; error?: Error } = {};

vi.mock('@/api/config-client', () => ({
  fetchConsoleConfig: vi.fn(async (): Promise<SysConfig> => {
    if (nextResult.error) throw nextResult.error;
    return nextResult.data as SysConfig;
  }),
  fetchGatewayConfig: vi.fn(async (): Promise<SysConfig> => {
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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ConsoleConfigPage } from '@/pages/ConsoleConfigPage';
import { GatewayConfigPage } from '@/pages/GatewayConfigPage';

function entry(over: Partial<ConfigEntry>): ConfigEntry {
  return {
    key: over.key ?? 'PORT',
    value: over.value ?? '8090',
    sensitive: over.sensitive ?? false,
    default: over.default ?? '8090',
    source: over.source ?? 'default',
    description: over.description ?? 'TCP port the Console listens on.',
    mutable: over.mutable ?? true,
    restart: over.restart ?? 'console',
    range: over.range ?? '1–65535',
    ...(over.impact !== undefined ? { impact: over.impact } : {}),
    ...(over.category !== undefined ? { category: over.category } : {}),
    ...(over.stability !== undefined ? { stability: over.stability } : {}),
  };
}

function renderPage(Component: () => JSX.Element) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

const consoleConfig: SysConfig = {
  scope: 'console',
  loaded_at: '2026-05-10T00:00:00.000Z',
  entries: [
    entry({ key: 'PORT', value: '8090', source: 'default', restart: 'console' }),
    entry({
      key: 'JWT_SECRET',
      value: '••••••••',
      sensitive: true,
      default: '',
      source: 'env',
      description: 'HS256 signing secret.',
      restart: 'console',
    }),
    entry({
      key: 'GATEWAY_BASE_URL',
      value: 'http://localhost:8080',
      default: '',
      source: 'env',
      description: 'Upstream gateway URL.',
      restart: 'console',
    }),
  ],
};

const gatewayConfig: SysConfig = {
  scope: 'gateway',
  loaded_at: '2026-05-10T00:00:01.000Z',
  entries: [
    entry({
      key: 'rest_port',
      value: '8080',
      default: '8080',
      source: 'default',
      restart: 'gateway',
      description: 'Port the REST server listens on.',
      category: 'rest_server',
      stability: 'structural',
      impact: 'Production network policy must allow only the operator UI to reach this port.',
    }),
    entry({
      key: 'kafka_topic_cp_boot',
      value: 'cp.boot',
      default: 'cp.boot',
      source: 'default',
      restart: 'both',
      description: 'BootNotification topic.',
      category: 'kafka_topics',
    }),
    entry({
      key: 'log_level',
      value: 'INFO',
      default: 'INFO',
      source: 'default',
      restart: 'none',
      mutable: true,
      description: 'Minimum log level emitted.',
      category: 'logging',
    }),
    entry({
      key: 'db_url',
      value: '••••••••',
      sensitive: true,
      default: '',
      source: 'env',
      restart: 'gateway',
      description: 'SQLAlchemy async DSN.',
      category: 'postgres',
    }),
  ],
};

afterEach(() => cleanup());

describe('ConsoleConfigPage', () => {
  beforeEach(() => {
    nextResult = { data: consoleConfig };
  });

  it('renders one card per entry with Console-server copy', async () => {
    renderPage(ConsoleConfigPage);
    expect(await screen.findByText(/console configuration/i)).toBeInTheDocument();
    expect(screen.getByText('PORT')).toBeInTheDocument();
    // JWT_SECRET appears both in the sensitive-keys alert and as a card
    // title — assert at least one match.
    expect(screen.getAllByText('JWT_SECRET').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/console server/i).length).toBeGreaterThan(0);
  });

  it('omits Gateway and Both filter buttons (not meaningful here)', async () => {
    renderPage(ConsoleConfigPage);
    await screen.findByText('PORT');
    expect(screen.queryByRole('button', { name: /^gateway$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^both$/i })).not.toBeInTheDocument();
    // Console + Live + All are present.
    expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^console$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^live$/i })).toBeInTheDocument();
  });

  it('filters by free-text search', async () => {
    const user = userEvent.setup();
    renderPage(ConsoleConfigPage);
    await screen.findByText('PORT');

    await user.type(screen.getByLabelText(/search configuration/i), 'gateway');
    expect(screen.queryByText('PORT')).not.toBeInTheDocument();
    expect(screen.getByText('GATEWAY_BASE_URL')).toBeInTheDocument();
  });

  it('renders restart-Console pill on every entry', async () => {
    renderPage(ConsoleConfigPage);
    await screen.findByText('PORT');
    // Three entries all carry restart=console.
    expect(screen.getAllByText(/restart: console/i).length).toBeGreaterThanOrEqual(3);
  });

  it('shows an error alert on fetch failure', async () => {
    nextResult = { error: new Error('sys/config 500') };
    renderPage(ConsoleConfigPage);
    expect(await screen.findByText(/configuration unavailable/i)).toBeInTheDocument();
  });

  it('shows loading state while pending', () => {
    vi.mocked(fetchConsoleConfig).mockImplementationOnce(() => new Promise(() => {}));
    renderPage(ConsoleConfigPage);
    expect(screen.getByText(/loading configuration/i)).toBeInTheDocument();
  });
});

describe('GatewayConfigPage', () => {
  beforeEach(() => {
    nextResult = { data: gatewayConfig };
  });

  it('renders the gateway-config heading and entries', async () => {
    renderPage(GatewayConfigPage);
    expect(await screen.findByText(/gateway configuration/i)).toBeInTheDocument();
    expect(screen.getByText('rest_port')).toBeInTheDocument();
    expect(screen.getByText('kafka_topic_cp_boot')).toBeInTheDocument();
    expect(screen.getByText('log_level')).toBeInTheDocument();
    // db_url is sensitive → appears in the alert AND the card.
    expect(screen.getAllByText('db_url').length).toBeGreaterThan(0);
  });

  it('shows the full filter set including Both', async () => {
    renderPage(GatewayConfigPage);
    await screen.findByText('rest_port');
    expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^gateway$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^console$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^both$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^live$/i })).toBeInTheDocument();
  });

  it('renders the right restart label for every impact level', async () => {
    renderPage(GatewayConfigPage);
    await screen.findByText('rest_port');
    expect(screen.getAllByText(/restart: gateway$/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/restart: console \+ gateway/i)).toBeInTheDocument();
    // 'Live' appears as both a filter-bar button and as the badge on
    // restart=none entries; assert at least one (the badge).
    expect(screen.getAllByText(/^live$/i).length).toBeGreaterThanOrEqual(1);
  });

  it('filters by Both — only the kafka_topic shows', async () => {
    const user = userEvent.setup();
    renderPage(GatewayConfigPage);
    await screen.findByText('rest_port');

    await user.click(screen.getByRole('button', { name: /^both$/i }));
    expect(screen.getByText('kafka_topic_cp_boot')).toBeInTheDocument();
    expect(screen.queryByText('rest_port')).not.toBeInTheDocument();
    expect(screen.queryByText('log_level')).not.toBeInTheDocument();
  });

  it('renders impact + category for gateway entries', async () => {
    renderPage(GatewayConfigPage);
    await screen.findByText('rest_port');
    // Category badge.
    expect(screen.getByText('rest_server')).toBeInTheDocument();
    // Impact text.
    expect(screen.getByText(/production network policy/i)).toBeInTheDocument();
  });

  it('masks sensitive values', async () => {
    renderPage(GatewayConfigPage);
    // db_url appears in the alert AND the card; wait for the card to render.
    await screen.findByText('rest_port');
    expect(screen.getAllByText('db_url').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^sensitive$/i).length).toBeGreaterThan(0);
  });

  it('shows an error alert on fetch failure', async () => {
    nextResult = { error: new Error('sys/gateway-config 502') };
    renderPage(GatewayConfigPage);
    expect(await screen.findByText(/configuration unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/sys\/gateway-config 502/)).toBeInTheDocument();
  });

  it('shows loading state while pending', () => {
    vi.mocked(fetchGatewayConfig).mockImplementationOnce(() => new Promise(() => {}));
    renderPage(GatewayConfigPage);
    expect(screen.getByText(/loading configuration/i)).toBeInTheDocument();
  });
});
