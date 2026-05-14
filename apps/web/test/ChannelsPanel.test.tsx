// Focused tests for the Channels tab panel. Covers the resting
// states (loading / empty / populated), the add-Slack happy path,
// the edit dialog pre-fill, the delete confirm gate, and the test-
// channel mutation wiring. The forms for email + webhook are
// structurally identical to Slack; spot-tested via shape rather
// than exhaustively duplicating.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel } from '@/api/alerts-client';
import { ToastProvider } from '@/components/ui/toaster';
import { ThemeProvider } from '@/lib/theme-context';

// --- hook stubs ---
let channelsStub: {
  channels: Channel[];
  defaultChannel: string;
  loading: boolean;
  error: string | null;
} = { channels: [], defaultChannel: '', loading: false, error: null };

const createMutate = vi.fn();
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
const testMutate = vi.fn();
const setDefaultMutate = vi.fn();

vi.mock('@/hooks/use-channels', () => ({
  useChannels: () => channelsStub,
  useCreateChannel: () => ({
    mutate: createMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  useUpdateChannel: () => ({
    mutate: updateMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  useDeleteChannel: () => ({
    mutate: deleteMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  useTestChannel: () => ({
    mutate: testMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  useSetDefaultChannel: () => ({
    mutate: setDefaultMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

import { ChannelsPanel } from '@/components/ChannelsPanel';

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

function renderPanel() {
  return render(withProviders(<ChannelsPanel />));
}

beforeEach(() => {
  channelsStub = { channels: [], defaultChannel: '', loading: false, error: null };
  createMutate.mockClear();
  updateMutate.mockClear();
  deleteMutate.mockClear();
  testMutate.mockClear();
  setDefaultMutate.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('ChannelsPanel — resting states', () => {
  it('shows the empty state when no channels are configured', () => {
    renderPanel();
    expect(screen.getByTestId('channels-empty')).toBeInTheDocument();
  });

  it('shows a loading hint when the hook is loading', () => {
    channelsStub = { channels: [], defaultChannel: '', loading: true, error: null };
    renderPanel();
    expect(screen.getByTestId('channels-loading')).toBeInTheDocument();
  });

  it('shows the error alert when the hook errors', () => {
    channelsStub = {
      channels: [],
      defaultChannel: '',
      loading: false,
      error: 'GET sys/alerts/channels 500',
    };
    renderPanel();
    expect(screen.getByTestId('channels-error')).toBeInTheDocument();
  });

  it('renders one row per channel with the default badge on the chosen one', () => {
    channelsStub = {
      channels: [
        { type: 'slack', name: 'ops', api_url: 'https://hooks/x', channel: '#a' },
        { type: 'email', name: 'oncall', to: 'a@b', from: 'c@d', smarthost: 's:25' },
      ],
      defaultChannel: 'ops',
      loading: false,
      error: null,
    };
    renderPanel();
    const rows = screen.getAllByTestId('channel-row');
    expect(rows).toHaveLength(2);
    const opsRow = rows.find((r) => r.getAttribute('data-channel-name') === 'ops')!;
    expect(within(opsRow).getByText('default')).toBeInTheDocument();
  });
});

describe('ChannelsPanel — add receiver menu', () => {
  it('opens the menu and reveals the three receiver types', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('add-channel-button'));
    expect(screen.getByTestId('add-channel-slack')).toBeInTheDocument();
    expect(screen.getByTestId('add-channel-email')).toBeInTheDocument();
    expect(screen.getByTestId('add-channel-webhook')).toBeInTheDocument();
  });

  it('opens the Slack form when Slack is picked', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('add-channel-button'));
    await user.click(screen.getByTestId('add-channel-slack'));
    expect(screen.getByTestId('channel-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('slack-name')).toBeInTheDocument();
    expect(screen.getByTestId('slack-api-url')).toBeInTheDocument();
    expect(screen.getByTestId('slack-channel')).toBeInTheDocument();
  });
});

describe('ChannelsPanel — Slack form', () => {
  it('disables submit until required fields are filled', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('add-channel-button'));
    await user.click(screen.getByTestId('add-channel-slack'));
    const submit = screen.getByTestId('submit-channel');
    expect(submit).toBeDisabled();
    await user.type(screen.getByTestId('slack-name'), 'ops');
    await user.type(screen.getByTestId('slack-api-url'), 'https://hooks.slack.com/x');
    await user.type(screen.getByTestId('slack-channel'), '#ocpp');
    expect(submit).not.toBeDisabled();
  });

  it('fires createChannel with the trimmed payload on submit', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('add-channel-button'));
    await user.click(screen.getByTestId('add-channel-slack'));
    await user.type(screen.getByTestId('slack-name'), '  ops  ');
    await user.type(screen.getByTestId('slack-api-url'), 'https://hooks.slack.com/x');
    await user.type(screen.getByTestId('slack-channel'), '#ocpp');
    await user.click(screen.getByTestId('submit-channel'));
    expect(createMutate).toHaveBeenCalledTimes(1);
    const payload = createMutate.mock.calls[0]?.[0] as Channel;
    expect(payload).toMatchObject({
      type: 'slack',
      name: 'ops',
      api_url: 'https://hooks.slack.com/x',
      channel: '#ocpp',
    });
  });
});

describe('ChannelsPanel — template overrides (PR #170)', () => {
  it('Email form renders the override disclosure and submits override fields', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('add-channel-button'));
    await user.click(screen.getByTestId('add-channel-email'));

    // Disclosure is closed by default for an empty form — the
    // override section exists but its inner inputs aren't accessible
    // by default. Expand it.
    expect(screen.getByTestId('email-overrides')).toBeInTheDocument();
    await user.click(within(screen.getByTestId('email-overrides')).getByText(/Custom message/i));

    await user.type(screen.getByTestId('email-name'), 'oncall');
    await user.type(screen.getByTestId('email-to'), 'a@b.com');
    await user.type(screen.getByTestId('email-from'), 'c@d.com');
    await user.type(screen.getByTestId('email-smarthost'), 'smtp.example.com:587');
    // userEvent.type interprets `{` as a keyboard-escape prefix; for
    // template-literal values we want pasted verbatim, do a direct
    // change-event instead.
    const subjectEl = screen.getByTestId('email-subject') as HTMLInputElement;
    subjectEl.focus();
    await user.paste('Custom: {{ .CommonLabels.alertname }}');
    await user.type(screen.getByTestId('email-html'), '<h1>custom html</h1>');
    await user.click(screen.getByTestId('submit-channel'));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const payload = createMutate.mock.calls[0]?.[0] as Channel & {
      subject?: string;
      html?: string;
    };
    expect(payload.type).toBe('email');
    expect(payload.subject).toBe('Custom: {{ .CommonLabels.alertname }}');
    expect(payload.html).toBe('<h1>custom html</h1>');
  });

  it('Telegram form renders the override disclosure and submits the message override', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('add-channel-button'));
    await user.click(screen.getByTestId('add-channel-telegram'));

    expect(screen.getByTestId('telegram-overrides')).toBeInTheDocument();
    await user.click(within(screen.getByTestId('telegram-overrides')).getByText(/Custom message/i));

    await user.type(screen.getByTestId('telegram-name'), 'oncall-tg');
    await user.type(screen.getByTestId('telegram-bot-token'), '12345:AAEFxyz_fake_token_99999');
    await user.type(screen.getByTestId('telegram-chat-id'), '-1001234567890');
    await user.type(screen.getByTestId('telegram-message'), 'tg override');
    await user.click(screen.getByTestId('submit-channel'));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const payload = createMutate.mock.calls[0]?.[0] as Channel & { message?: string };
    expect(payload.type).toBe('telegram');
    expect(payload.message).toBe('tg override');
  });

  it('Edit-flow pre-fills override fields and opens the disclosure when overrides exist', async () => {
    const user = userEvent.setup();
    channelsStub = {
      channels: [
        {
          type: 'email',
          name: 'oncall',
          to: 'a@b.com',
          from: 'c@d.com',
          smarthost: 'smtp.example.com:587',
          subject: 'EXISTING SUBJECT',
        },
      ],
      defaultChannel: 'oncall',
      loading: false,
      error: null,
    };
    renderPanel();
    await user.click(screen.getByTestId('edit-channel-button'));
    // Subject is pre-filled; disclosure is open because the row has
    // an override.
    expect((screen.getByTestId('email-subject') as HTMLInputElement).value).toBe(
      'EXISTING SUBJECT',
    );
    expect(screen.getByTestId('email-overrides')).toHaveAttribute('open');
  });

  it('Webhook form does NOT render an override disclosure (webhooks POST raw JSON)', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('add-channel-button'));
    await user.click(screen.getByTestId('add-channel-webhook'));
    expect(screen.queryByTestId('webhook-overrides')).toBeNull();
  });
});

describe('ChannelsPanel — edit', () => {
  it('pre-fills the form from the selected channel and disables the name field', async () => {
    const user = userEvent.setup();
    channelsStub = {
      channels: [
        {
          type: 'slack',
          name: 'ops',
          api_url: 'https://hooks.slack.com••••3a4b',
          channel: '#ocpp',
          title: 'Alert',
        },
      ],
      defaultChannel: 'ops',
      loading: false,
      error: null,
    };
    renderPanel();
    await user.click(screen.getByTestId('edit-channel-button'));
    expect(screen.getByTestId('channel-dialog')).toBeInTheDocument();
    expect((screen.getByTestId('slack-name') as HTMLInputElement).value).toBe('ops');
    expect((screen.getByTestId('slack-name') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('slack-api-url') as HTMLInputElement).value).toContain('••••');
  });
});

describe('ChannelsPanel — delete', () => {
  it('opens a confirm dialog on Remove and fires deleteChannel only on confirm', async () => {
    const user = userEvent.setup();
    channelsStub = {
      channels: [{ type: 'slack', name: 'ops', api_url: 'https://hooks/x', channel: '#a' }],
      defaultChannel: 'ops',
      loading: false,
      error: null,
    };
    renderPanel();
    await user.click(screen.getByTestId('delete-channel-button'));
    expect(screen.getByTestId('delete-channel-dialog')).toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('delete-channel-confirm'));
    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(deleteMutate.mock.calls[0]?.[0]).toBe('ops');
  });
});

describe('ChannelsPanel — Set as default', () => {
  it('shows the Set-default button only on non-default channels', () => {
    channelsStub = {
      channels: [
        { type: 'slack', name: 'a', api_url: 'https://hooks/x', channel: '#a' },
        { type: 'slack', name: 'b', api_url: 'https://hooks/y', channel: '#b' },
      ],
      defaultChannel: 'a',
      loading: false,
      error: null,
    };
    renderPanel();
    const buttons = screen.queryAllByTestId('set-default-channel-button');
    expect(buttons).toHaveLength(1);
  });

  it('fires the setDefault mutation with the row name when clicked', async () => {
    const user = userEvent.setup();
    channelsStub = {
      channels: [
        { type: 'slack', name: 'a', api_url: 'https://hooks/x', channel: '#a' },
        { type: 'slack', name: 'b', api_url: 'https://hooks/y', channel: '#b' },
      ],
      defaultChannel: 'a',
      loading: false,
      error: null,
    };
    renderPanel();
    await user.click(screen.getByTestId('set-default-channel-button'));
    expect(setDefaultMutate).toHaveBeenCalledTimes(1);
    expect(setDefaultMutate.mock.calls[0]?.[0]).toBe('b');
  });
});

describe('ChannelsPanel — test', () => {
  it('fires testChannel with the row name', async () => {
    const user = userEvent.setup();
    channelsStub = {
      channels: [{ type: 'slack', name: 'ops', api_url: 'https://hooks/x', channel: '#a' }],
      defaultChannel: 'ops',
      loading: false,
      error: null,
    };
    renderPanel();
    await user.click(screen.getByTestId('test-channel-button'));
    expect(testMutate).toHaveBeenCalledTimes(1);
    expect(testMutate.mock.calls[0]?.[0]).toBe('ops');
  });
});
