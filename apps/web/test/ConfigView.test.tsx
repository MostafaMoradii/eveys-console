// Component tests for the SystemConfigPage. The page hosts two tabs
// (Console + Gateway), each rendering the shared ConfigView with a
// different fetcher and filter set. Tests exercise both tabs and
// verify the tab-state ↔ URL sync.

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchConsoleConfig,
  fetchGatewayConfig,
  type ConfigEntry,
  type SysConfig,
} from '@/api/config-client';

let consoleResult: { data?: SysConfig; error?: Error } = {};
let gatewayResult: { data?: SysConfig; error?: Error } = {};

vi.mock('@/api/config-client', () => ({
  fetchConsoleConfig: vi.fn(async (): Promise<SysConfig> => {
    if (consoleResult.error) throw consoleResult.error;
    return consoleResult.data as SysConfig;
  }),
  fetchGatewayConfig: vi.fn(async (): Promise<SysConfig> => {
    if (gatewayResult.error) throw gatewayResult.error;
    return gatewayResult.data as SysConfig;
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

import { SystemConfigPage } from '@/pages/SystemConfigPage';

function entry(over: Partial<ConfigEntry>): ConfigEntry {
  return {
    key: over.key ?? 'PORT',
    value: over.value ?? '8090',
    sensitive: over.sensitive ?? false,
    default: over.default ?? '8090',
    source: over.source ?? 'default',
    description: over.description ?? 'TCP port the Console listens on.',
    category: over.category ?? 'network',
    mutable: over.mutable ?? true,
    restart: over.restart ?? 'console',
    range: over.range ?? '1–65535',
    ...(over.impact !== undefined ? { impact: over.impact } : {}),
    ...(over.stability !== undefined ? { stability: over.stability } : {}),
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

const consoleConfig: SysConfig = {
  scope: 'console',
  loaded_at: '2026-05-10T00:00:00.000Z',
  entries: [
    entry({
      key: 'PORT',
      value: '8090',
      source: 'default',
      restart: 'console',
      category: 'network',
    }),
    entry({
      key: 'JWT_SECRET',
      value: '••••••••',
      sensitive: true,
      default: '',
      source: 'env',
      description: 'HS256 signing secret.',
      restart: 'console',
      category: 'auth',
    }),
    entry({
      key: 'GATEWAY_BASE_URL',
      value: 'http://localhost:8080',
      default: '',
      source: 'env',
      description: 'Upstream gateway URL.',
      restart: 'console',
      category: 'gateway',
    }),
    entry({
      key: 'WS_PING_INTERVAL_MS',
      value: '30000',
      default: '30000',
      source: 'default',
      description: 'WS ping cadence.',
      restart: 'console',
      category: 'websocket',
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

beforeEach(() => {
  consoleResult = { data: consoleConfig };
  gatewayResult = { data: gatewayConfig };
  // Reset the URL between tests so tab-state from one test doesn't
  // leak into the next via window.history.
  window.history.replaceState(null, '', '/');
});
afterEach(() => cleanup());

describe('SystemConfigPage — Console tab (default)', () => {
  it('renders the Console tab content by default', async () => {
    renderPage();
    expect(await screen.findByText(/console configuration/i)).toBeInTheDocument();
    expect(screen.getByText('PORT')).toBeInTheDocument();
    expect(screen.getAllByText('JWT_SECRET').length).toBeGreaterThan(0);
  });

  it('omits Gateway and Both filter buttons on the Console tab', async () => {
    renderPage();
    await screen.findByText('PORT');
    // Console tab's filter bar excludes Gateway/Both. The 'Gateway'
    // text *does* appear elsewhere (the tab trigger), so check
    // specifically inside the filter group.
    const filterGroup = screen.getByRole('group', { name: /filter by restart impact/i });
    expect(filterGroup.querySelector('button[aria-pressed]:nth-child(1)')).toHaveTextContent(
      /^All$/i,
    );
    // No 'Both' button anywhere in the filter group.
    const filterButtons = filterGroup.querySelectorAll('button');
    const labels = Array.from(filterButtons).map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Gateway');
    expect(labels).not.toContain('Both');
    expect(labels).toContain('All');
    expect(labels).toContain('Console');
    expect(labels).toContain('Live');
  });

  it('does not initially fetch the gateway config', async () => {
    renderPage();
    await screen.findByText('PORT');
    expect(fetchConsoleConfig).toHaveBeenCalled();
    expect(fetchGatewayConfig).not.toHaveBeenCalled();
  });
});

describe('SystemConfigPage — Gateway tab', () => {
  it('switches to the Gateway tab on click and fetches gateway data', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('PORT');

    await user.click(screen.getByRole('tab', { name: /^gateway$/i }));

    expect(await screen.findByText(/gateway configuration/i)).toBeInTheDocument();
    expect(screen.getByText('rest_port')).toBeInTheDocument();
    expect(screen.getByText('kafka_topic_cp_boot')).toBeInTheDocument();
    expect(fetchGatewayConfig).toHaveBeenCalled();
  });

  it('shows the full filter set including Both on the Gateway tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('PORT');

    await user.click(screen.getByRole('tab', { name: /^gateway$/i }));
    await screen.findByText('rest_port');

    const filterGroup = screen.getByRole('group', { name: /filter by restart impact/i });
    const labels = Array.from(filterGroup.querySelectorAll('button')).map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toEqual(['All', 'Gateway', 'Console', 'Both', 'Live']);
  });

  it('renders impact + category for gateway entries', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('PORT');

    await user.click(screen.getByRole('tab', { name: /^gateway$/i }));
    await screen.findByText('rest_port');

    // Category now renders as a group heading (humanised), not a card badge.
    expect(screen.getByRole('heading', { name: /rest server.*\(/i })).toBeInTheDocument();
    expect(screen.getByText(/production network policy/i)).toBeInTheDocument();
  });

  it('writes ?tab=gateway to the URL when Gateway tab is selected', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('PORT');

    await user.click(screen.getByRole('tab', { name: /^gateway$/i }));
    await screen.findByText(/gateway configuration/i);

    expect(window.location.search).toContain('tab=gateway');
  });

  it('clears ?tab from the URL when switching back to Console', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('PORT');

    await user.click(screen.getByRole('tab', { name: /^gateway$/i }));
    await screen.findByText(/gateway configuration/i);
    expect(window.location.search).toContain('tab=gateway');

    await user.click(screen.getByRole('tab', { name: /^console$/i }));
    await screen.findByText(/console configuration/i);
    expect(window.location.search).not.toContain('tab=gateway');
  });
});

describe('SystemConfigPage — category grouping', () => {
  it('groups Console entries under category headings', async () => {
    renderPage();
    await screen.findByText('PORT');

    // Four categories in the fixture: network, auth, gateway, websocket.
    expect(screen.getByRole('heading', { name: /network.*\(/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /auth.*\(/i })).toBeInTheDocument();
    // Console-tab tab trigger is a `tab`, but a category labelled "Gateway"
    // heading is a `heading` role — disambiguate by role.
    expect(screen.getByRole('heading', { name: /gateway.*\(/i })).toBeInTheDocument();
    // WebSocket — case-sensitive: acronym map should yield 'WebSocket', not 'Websocket'.
    expect(screen.getByRole('heading', { name: /^WebSocket.*\(/ })).toBeInTheDocument();
  });

  it('renders the per-group entry count', async () => {
    renderPage();
    await screen.findByText('PORT');
    // Each fixture group has one entry — heading text should end with "(1)".
    const network = screen.getByRole('heading', { name: /^network.*\(1\)$/i });
    expect(network).toBeInTheDocument();
  });

  it('humanises snake_case category names in headings', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('PORT');

    await user.click(screen.getByRole('tab', { name: /^gateway$/i }));
    await screen.findByText('rest_port');
    // 'rest_server' → 'REST Server' (acronym), 'kafka_topics' → 'Kafka Topics'.
    expect(screen.getByRole('heading', { name: /^REST Server.*\(/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Kafka Topics.*\(/ })).toBeInTheDocument();
  });

  it('preserves canonical acronym casing in headings', async () => {
    const user = userEvent.setup();
    // Add an entry with an acronym-bearing category to the gateway fixture.
    gatewayResult = {
      data: {
        ...gatewayConfig,
        entries: [
          ...gatewayConfig.entries,
          entry({
            key: 'ws_host',
            value: '0.0.0.0',
            default: '0.0.0.0',
            source: 'default',
            restart: 'gateway',
            description: 'WS bind.',
            category: 'ws_server',
          }),
          entry({
            key: 'grpc_port',
            value: '50051',
            default: '50051',
            source: 'default',
            restart: 'gateway',
            description: 'gRPC port.',
            category: 'grpc_server',
          }),
          entry({
            key: 'clickhouse_host',
            value: 'localhost',
            default: 'localhost',
            source: 'default',
            restart: 'gateway',
            description: 'CH host.',
            category: 'clickhouse_ingest',
          }),
        ],
      },
    };
    renderPage();
    await screen.findByText('PORT');

    await user.click(screen.getByRole('tab', { name: /^gateway$/i }));
    await screen.findByText('ws_host');

    // Acronyms render with canonical casing — not plain Title Case.
    expect(screen.getByRole('heading', { name: /^WS Server.*\(/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^gRPC Server.*\(/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^ClickHouse Ingest.*\(/ })).toBeInTheDocument();
  });
});

describe('SystemConfigPage — sensitive-only filter', () => {
  it('hides non-sensitive entries when the toggle is on (Console tab)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('PORT');

    // Before: PORT (non-sensitive) and JWT_SECRET (sensitive) both visible.
    expect(screen.getByText('PORT')).toBeInTheDocument();
    expect(screen.getAllByText('JWT_SECRET').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /sensitive only/i }));

    // After: only sensitive entries remain. JWT_SECRET stays; PORT goes.
    expect(screen.queryByText('PORT')).not.toBeInTheDocument();
    expect(screen.getAllByText('JWT_SECRET').length).toBeGreaterThan(0);
  });

  it('toggle is aria-pressed when active', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('PORT');

    const btn = screen.getByRole('button', { name: /sensitive only/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');

    await user.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('combines with the search filter (Gateway tab)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('PORT');

    await user.click(screen.getByRole('tab', { name: /^gateway$/i }));
    await screen.findByText('rest_port');

    await user.click(screen.getByRole('button', { name: /sensitive only/i }));
    // Gateway fixture: only db_url is sensitive. rest_port / kafka_topic_cp_boot / log_level go away.
    expect(screen.getAllByText('db_url').length).toBeGreaterThan(0);
    expect(screen.queryByText('rest_port')).not.toBeInTheDocument();
    expect(screen.queryByText('log_level')).not.toBeInTheDocument();

    // Now narrow further with search; "db" matches db_url, the only sensitive entry.
    await user.type(screen.getByLabelText(/search configuration/i), 'sql');
    expect(screen.getAllByText('db_url').length).toBeGreaterThan(0);
  });
});

describe('SystemConfigPage — deep-link', () => {
  it('opens on the Gateway tab when ?tab=gateway is in the URL', async () => {
    window.history.replaceState(null, '', '/?tab=gateway');
    renderPage();

    expect(await screen.findByText(/gateway configuration/i)).toBeInTheDocument();
    expect(screen.getByText('rest_port')).toBeInTheDocument();
    expect(fetchGatewayConfig).toHaveBeenCalled();
  });
});
