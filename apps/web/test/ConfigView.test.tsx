// Component tests for the SystemConfigPage. The page hosts two tabs
// (Console + Gateway), each rendering the shared ConfigView with a
// different fetcher and filter set. Tests exercise both tabs and
// verify the tab-state ↔ URL sync.

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchConsoleConfig,
  fetchConsoleAdminConfig,
  fetchGatewayConfig,
  fetchGatewayAdminConfig,
  setGatewayAdminConfig,
  setConsoleAdminConfig,
  clearGatewayAdminOverride,
  clearConsoleAdminOverride,
  type ConfigEntry,
  type ConsoleAdminConfig,
  type GatewayAdminConfig,
  type SysConfig,
} from '@/api/config-client';

let consoleResult: { data?: SysConfig; error?: Error } = {};
let gatewayResult: { data?: SysConfig; error?: Error } = {};
let adminResult: { data?: GatewayAdminConfig; error?: Error } = {};
let consoleAdminResult: { data?: ConsoleAdminConfig; error?: Error } = {};

vi.mock('@/api/config-client', () => ({
  fetchConsoleConfig: vi.fn(async (): Promise<SysConfig> => {
    if (consoleResult.error) throw consoleResult.error;
    return consoleResult.data as SysConfig;
  }),
  fetchGatewayConfig: vi.fn(async (): Promise<SysConfig> => {
    if (gatewayResult.error) throw gatewayResult.error;
    return gatewayResult.data as SysConfig;
  }),
  fetchGatewayAdminConfig: vi.fn(async (): Promise<GatewayAdminConfig> => {
    if (adminResult.error) throw adminResult.error;
    return adminResult.data as GatewayAdminConfig;
  }),
  fetchConsoleAdminConfig: vi.fn(async (): Promise<ConsoleAdminConfig> => {
    if (consoleAdminResult.error) throw consoleAdminResult.error;
    return consoleAdminResult.data as ConsoleAdminConfig;
  }),
  setGatewayAdminConfig: vi.fn(
    async (_token: string, _updates: Record<string, unknown>): Promise<GatewayAdminConfig> =>
      adminResult.data as GatewayAdminConfig,
  ),
  setConsoleAdminConfig: vi.fn(
    async (_token: string, _k: string, _v: unknown): Promise<ConsoleAdminConfig> =>
      consoleAdminResult.data as ConsoleAdminConfig,
  ),
  clearGatewayAdminOverride: vi.fn(
    async (_token: string, _key: string): Promise<GatewayAdminConfig> =>
      adminResult.data as GatewayAdminConfig,
  ),
  clearConsoleAdminOverride: vi.fn(
    async (_token: string, _key: string): Promise<ConsoleAdminConfig> =>
      consoleAdminResult.data as ConsoleAdminConfig,
  ),
}));

const toast = vi.fn();
vi.mock('@/components/ui/toaster', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useToast: () => ({ toast }) };
});

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
      key: 'webhook_url_cp_boot',
      value: '',
      default: '',
      source: 'default',
      restart: 'none',
      mutable: true,
      description: 'Per-event webhook URL for cp.boot.',
      category: 'webhooks',
    }),
    entry({
      key: 'webhook_enable_cp_boot',
      value: 'false',
      default: 'false',
      source: 'default',
      restart: 'none',
      mutable: true,
      description: 'Toggle for cp.boot webhook delivery.',
      category: 'webhooks',
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

// Mirrors what the gateway returns from `/api/v1/admin/config`. The
// allowlist is the set of keys the gateway flags as runtime-mutable
// (the override allowlist in `runtime_overrides.py`).
const adminConfig: GatewayAdminConfig = {
  scope: 'gateway',
  overrides: {},
  allowlist: {
    log_level: 'Minimum log level emitted by the gateway.',
    webhook_url_cp_boot: 'Per-event webhook URL for cp.boot.',
    webhook_enable_cp_boot: 'Toggle for cp.boot webhook delivery.',
  },
};

beforeEach(() => {
  consoleResult = { data: consoleConfig };
  gatewayResult = { data: gatewayConfig };
  adminResult = { data: adminConfig };
  consoleAdminResult = {
    data: {
      entries: consoleConfig.entries,
      overridable_keys: ['LOG_LEVEL', 'PROMETHEUS_URL', 'ALERTMANAGER_URL'],
    },
  };
  toast.mockReset();
  vi.mocked(setGatewayAdminConfig).mockClear();
  vi.mocked(clearGatewayAdminOverride).mockClear();
  vi.mocked(fetchGatewayAdminConfig).mockClear();
  vi.mocked(fetchConsoleAdminConfig).mockClear();
  vi.mocked(setConsoleAdminConfig).mockClear();
  vi.mocked(clearConsoleAdminOverride).mockClear();
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

  it('shows the gateway-relevant restart-impact filters on the Gateway tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('PORT');

    await user.click(screen.getByRole('tab', { name: /^gateway$/i }));
    await screen.findByText('rest_port');

    // Gateway tab keeps only the values that actually apply to a
    // gateway entry: All / Gateway / Live (none). 'Console' / 'Both'
    // were removed because no gateway key has restart=console.
    const filterGroup = screen.getByRole('group', { name: /filter by restart impact/i });
    const labels = Array.from(filterGroup.querySelectorAll('button')).map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toEqual(['All', 'Gateway', 'Live']);
  });

  it('renders impact + category for gateway entries', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('PORT');

    await user.click(screen.getByRole('tab', { name: /^gateway$/i }));
    await screen.findByText('rest_port');

    // Category renders as a collapsible <details> with a humanised
    // summary; the data-testid carries the raw category for stable
    // matching across the redesign.
    const cat = screen.getByTestId('config-category-rest_server');
    expect(within(cat).getByText(/REST Server/)).toBeInTheDocument();
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
  it('groups Console entries under collapsible category sections', async () => {
    renderPage();
    await screen.findByText('PORT');

    // Four categories in the fixture: network, auth, gateway, websocket.
    expect(screen.getByTestId('config-category-network')).toBeInTheDocument();
    expect(screen.getByTestId('config-category-auth')).toBeInTheDocument();
    expect(screen.getByTestId('config-category-gateway')).toBeInTheDocument();
    expect(screen.getByTestId('config-category-websocket')).toBeInTheDocument();
    // Acronym-aware humanisation: WebSocket not Websocket.
    expect(
      within(screen.getByTestId('config-category-websocket')).getByText(/WebSocket/),
    ).toBeInTheDocument();
  });

  it('renders the per-category entry count badge', async () => {
    renderPage();
    await screen.findByText('PORT');
    // Each fixture group has one entry — the count badge reads "1".
    const network = screen.getByTestId('config-category-network');
    expect(within(network).getByText('1')).toBeInTheDocument();
  });

  it('humanises snake_case category names in summaries', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('PORT');

    await user.click(screen.getByRole('tab', { name: /^gateway$/i }));
    await screen.findByText('rest_port');
    // 'rest_server' → 'REST Server' (acronym), 'kafka_topics' → 'Kafka Topics'.
    expect(
      within(screen.getByTestId('config-category-rest_server')).getByText(/REST Server/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('config-category-kafka_topics')).getByText(/Kafka Topics/),
    ).toBeInTheDocument();
  });

  it('preserves canonical acronym casing in summaries', async () => {
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
    expect(
      within(screen.getByTestId('config-category-ws_server')).getByText(/WS Server/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('config-category-grpc_server')).getByText(/gRPC Server/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('config-category-clickhouse_ingest')).getByText(
        /ClickHouse Ingest/,
      ),
    ).toBeInTheDocument();
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

describe('SystemConfigPage — Gateway tab inline-edit', () => {
  async function openGateway() {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('PORT');
    await user.click(screen.getByRole('tab', { name: /^gateway$/i }));
    await screen.findByText('rest_port');
    return user;
  }

  it('renders inline editors for allowlisted entries on the Gateway tab', async () => {
    await openGateway();

    // log_level → enum select
    expect(screen.getByLabelText(/^edit log_level$/i)).toBeInTheDocument();
    // webhook_url_cp_boot → URL text input
    expect(screen.getByLabelText(/^edit webhook_url_cp_boot$/i)).toBeInTheDocument();
    // webhook_enable_cp_boot → toggle
    expect(screen.getByLabelText(/^toggle webhook_enable_cp_boot$/i)).toBeInTheDocument();
  });

  it('renders a disabled lock for non-allowlisted gateway entries', async () => {
    await openGateway();

    // rest_port is NOT in our allowlist fixture — should render a Read-only
    // disabled button with the explanatory tooltip.
    const card = screen.getByText('rest_port').closest('div.rounded-lg, [class*="card"], section');
    // Use a broader check: every "Read-only" button on the gateway tab should be
    // disabled.
    const lockButtons = screen.getAllByRole('button', { name: /not runtime-editable/i });
    expect(lockButtons.length).toBeGreaterThan(0);
    for (const btn of lockButtons) expect(btn).toBeDisabled();
    expect(card).not.toBeNull();
  });

  it('renders the per-pod runtime-overrides notice on the Gateway tab', async () => {
    await openGateway();
    expect(screen.getByText(/runtime overrides are per-pod/i)).toBeInTheDocument();
  });

  it('does NOT render the per-pod notice on the Console tab', async () => {
    renderPage();
    await screen.findByText('PORT');
    expect(screen.queryByText(/runtime overrides are per-pod/i)).not.toBeInTheDocument();
  });

  it('saving a URL field POSTs an updates payload and toasts on success', async () => {
    const user = await openGateway();
    const input = screen.getByLabelText(/^edit webhook_url_cp_boot$/i);
    // userEvent.clear doesn't fire when value is empty; just type into the
    // empty field.
    await user.type(input, 'https://hooks.example.com/cp-boot');
    // Find the closest form's submit button.
    const form = (input as HTMLInputElement).closest('form')!;
    await user.click(within(form).getByRole('button', { name: /^save$/i }));

    expect(setGatewayAdminConfig).toHaveBeenCalledWith('test-token', {
      webhook_url_cp_boot: 'https://hooks.example.com/cp-boot',
    });

    // Wait for the success toast to fire.
    await vi.waitFor(() => expect(toast).toHaveBeenCalled());
    const lastCall = toast.mock.calls.at(-1)![0] as { variant?: string; title: string };
    expect(lastCall.variant).not.toBe('destructive');
    expect(lastCall.title).toMatch(/override applied/i);
  });

  it('toggling a boolean opens AlertDialog; Cancel does not fire the request', async () => {
    const user = await openGateway();
    await user.click(screen.getByLabelText(/^toggle webhook_enable_cp_boot$/i));

    // Confirmation dialog should render with the per-pod copy.
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/per-pod and not persisted/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(setGatewayAdminConfig).not.toHaveBeenCalled();
  });

  it('toggling a boolean → Confirm fires the override request', async () => {
    const user = await openGateway();
    await user.click(screen.getByLabelText(/^toggle webhook_enable_cp_boot$/i));
    await screen.findByRole('alertdialog');

    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    expect(setGatewayAdminConfig).toHaveBeenCalledWith('test-token', {
      webhook_enable_cp_boot: true,
    });
  });

  it('renders Reset to env when an override is active and DELETE fires on click', async () => {
    adminResult = {
      data: {
        ...adminConfig,
        overrides: { log_level: 'DEBUG' },
      },
    };
    const user = await openGateway();

    // Overridden rows render twice — once in the pinned "Active
    // overrides" section, once inside their native category section.
    // Both buttons trigger the same mutation; clicking either is fine.
    const resetBtns = await screen.findAllByRole('button', {
      name: /^reset log_level to env$/i,
    });
    expect(resetBtns.length).toBeGreaterThan(0);
    await user.click(resetBtns[0]!);

    expect(clearGatewayAdminOverride).toHaveBeenCalledWith('test-token', 'log_level');
    await vi.waitFor(() => expect(toast).toHaveBeenCalled());
  });

  it('toasts destructive on a failed override using the gateway error envelope', async () => {
    vi.mocked(setGatewayAdminConfig).mockRejectedValueOnce(
      new Error('value out of range for log_level'),
    );
    const user = await openGateway();
    const input = screen.getByLabelText(/^edit webhook_url_cp_boot$/i);
    await user.type(input, 'https://hooks.example.com/x');
    const form = (input as HTMLInputElement).closest('form')!;
    await user.click(within(form).getByRole('button', { name: /^save$/i }));

    await vi.waitFor(() => expect(toast).toHaveBeenCalled());
    const lastCall = toast.mock.calls.at(-1)![0] as { variant?: string; description: string };
    expect(lastCall.variant).toBe('destructive');
    expect(lastCall.description).toMatch(/out of range/i);
  });

  it('Console tab now fetches its own admin allowlist, not the gateway one', async () => {
    renderPage();
    await screen.findByText('PORT');
    // Console-side admin endpoint hit; gateway-side untouched on the
    // Console tab.
    expect(fetchConsoleAdminConfig).toHaveBeenCalled();
    expect(fetchGatewayAdminConfig).not.toHaveBeenCalled();
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
