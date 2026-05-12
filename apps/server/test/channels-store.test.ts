// Round-trip tests for the ChannelsStore. The masking + the YAML
// shape are the two things that must not regress — masking guards a
// secret from reaching the browser, the YAML shape guards
// Alertmanager from rejecting a managed config.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChannelsStore, __test__, type Channel } from '../src/store/channels-store.js';

let dir: string;
let cfgPath: string;
let store: ChannelsStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'channels-'));
  cfgPath = join(dir, 'alertmanager-managed.yml');
  store = new ChannelsStore(cfgPath);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ChannelsStore — seedIfMissing', () => {
  it('creates an empty managed file when none exists', async () => {
    const created = await store.seedIfMissing();
    expect(created).toBe(true);
    const text = await readFile(cfgPath, 'utf8');
    expect(text).toContain('Managed by the Console');
    expect(text).toContain('__console_default__');
  });

  it('is a no-op when the file already exists', async () => {
    await writeFile(cfgPath, 'existing: content', 'utf8');
    const created = await store.seedIfMissing();
    expect(created).toBe(false);
    const text = await readFile(cfgPath, 'utf8');
    expect(text).toBe('existing: content');
  });
});

describe('ChannelsStore — empty / missing', () => {
  it('returns an empty config when the file does not exist', async () => {
    const cfg = await store.read();
    expect(cfg).toEqual({ channels: [], default_channel: '' });
  });

  it('returns an empty config for a YAML that parses to null', async () => {
    await writeFile(cfgPath, '', 'utf8');
    expect(await store.read()).toEqual({ channels: [], default_channel: '' });
  });
});

describe('ChannelsStore — round-trip', () => {
  it('round-trips a Slack receiver', async () => {
    const ch: Channel = {
      type: 'slack',
      name: 'ops-slack',
      api_url: 'https://hooks.slack.com/services/T1/B2/abcdefghij',
      channel: '#ocpp-alerts',
      title: '🚨 {{ .CommonLabels.alertname }}',
    };
    await store.updateChannels([ch], 'ops-slack');
    const out = await store.read();
    expect(out.default_channel).toBe('ops-slack');
    expect(out.channels).toHaveLength(1);
    expect(out.channels[0]).toEqual(ch);
  });

  it('round-trips an email receiver with auth', async () => {
    const ch: Channel = {
      type: 'email',
      name: 'oncall-email',
      to: 'oncall@example.com',
      from: 'console@example.com',
      smarthost: 'smtp.example.com:587',
      auth_username: 'console',
      auth_password: 'sek-r3t',
      require_tls: true,
    };
    await store.updateChannels([ch], 'oncall-email');
    const out = await store.read();
    expect(out.channels[0]).toEqual(ch);
  });

  it('round-trips a webhook receiver with basic auth', async () => {
    const ch: Channel = {
      type: 'webhook',
      name: 'pagerduty-bridge',
      url: 'https://events.pagerduty.com/integration/abc/enqueue',
      http_basic_auth_username: 'console',
      http_basic_auth_password: 'integration-key',
    };
    await store.updateChannels([ch], 'pagerduty-bridge');
    const out = await store.read();
    expect(out.channels[0]).toEqual(ch);
  });

  it('round-trips a webhook receiver with bearer-token auth', async () => {
    const ch: Channel = {
      type: 'webhook',
      name: 'opsgenie',
      url: 'https://api.opsgenie.com/v1/json/alertmanager',
      http_bearer_token: 'eyJhbGciOi-fake-jwt-for-test',
    };
    await store.updateChannels([ch], 'opsgenie');
    // Confirm the on-disk YAML carries the Alertmanager-shape
    // `authorization` block, not a `basic_auth` block.
    const text = await readFile(cfgPath, 'utf8');
    expect(text).toContain('type: Bearer');
    expect(text).toContain('credentials: eyJhbGciOi-fake-jwt-for-test');
    expect(text).not.toContain('basic_auth');
    // And it round-trips.
    const out = await store.read();
    expect(out.channels[0]).toEqual(ch);
  });

  it('bearer wins when both basic_auth and bearer are set on the same channel', async () => {
    const ch: Channel = {
      type: 'webhook',
      name: 'mixed',
      url: 'https://example/hook',
      http_basic_auth_username: 'u',
      http_basic_auth_password: 'p',
      http_bearer_token: 'tok',
    };
    await store.updateChannels([ch], 'mixed');
    const text = await readFile(cfgPath, 'utf8');
    expect(text).toContain('type: Bearer');
    expect(text).not.toContain('basic_auth');
  });

  it('round-trips a Telegram receiver', async () => {
    const ch: Channel = {
      type: 'telegram',
      name: 'oncall-tg',
      bot_token: '12345:AAEFxyz-fake-token-tail-9999',
      chat_id: '-1001234567890',
      api_url: 'https://api.telegram.org',
      parse_mode: 'HTML',
    };
    await store.updateChannels([ch], 'oncall-tg');
    const text = await readFile(cfgPath, 'utf8');
    // YAML emits chat_id as an integer (Alertmanager parses int64).
    expect(text).toContain('chat_id: -1001234567890');
    expect(text).toContain('bot_token: 12345:AAEFxyz-fake-token-tail-9999');
    expect(text).toContain('parse_mode: HTML');
    // Round-trip back through read(): chat_id arrives as the string
    // shape we hold on disk so very-large ids survive without
    // precision loss.
    const out = await store.read();
    expect(out.channels[0]).toEqual(ch);
  });

  it('preserves multiple receivers in order', async () => {
    const a: Channel = { type: 'slack', name: 'a', api_url: 'https://hooks/x', channel: '#a' };
    const b: Channel = {
      type: 'email',
      name: 'b',
      to: 'b@example.com',
      from: 'c@example.com',
      smarthost: 'smtp:25',
    };
    const c: Channel = { type: 'webhook', name: 'c', url: 'https://example/hook' };
    await store.updateChannels([a, b, c], 'b');
    const out = await store.read();
    expect(out.channels.map((x) => x.name)).toEqual(['a', 'b', 'c']);
    expect(out.default_channel).toBe('b');
  });

  it('writes a header comment so a peeking SRE knows the file is managed', async () => {
    await store.updateChannels([], '');
    const text = await readFile(cfgPath, 'utf8');
    expect(text).toContain('Managed by the Console');
  });

  it('always emits the console-default fallback receiver', async () => {
    await store.updateChannels([], '');
    const text = await readFile(cfgPath, 'utf8');
    // The fallback receiver name is reserved + prefixed so it never
    // collides with a real channel name and never serialises as the
    // YAML null literal.
    expect(text).toMatch(/name:\s*__console_default__/);
  });
});

describe('ChannelsStore — readMasked', () => {
  it('masks the Slack webhook URL', async () => {
    const ch: Channel = {
      type: 'slack',
      name: 'ops-slack',
      api_url: 'https://hooks.slack.com/services/T1/B2/abcdefghij-token-tail',
      channel: '#ocpp',
    };
    await store.updateChannels([ch], 'ops-slack');
    const out = await store.readMasked();
    const masked = out.channels[0] as Extract<Channel, { type: 'slack' }>;
    expect(masked.api_url).not.toContain('abcdefghij');
    expect(masked.api_url).toContain('••••');
    // Keeps a recognisable head + tail of the URL.
    expect(masked.api_url.startsWith('https://hooks.slack.com')).toBe(true);
  });

  it('masks the email auth_password', async () => {
    const ch: Channel = {
      type: 'email',
      name: 'e',
      to: 'a@b',
      from: 'c@d',
      smarthost: 's:25',
      auth_password: 'my-secret-password',
    };
    await store.updateChannels([ch], 'e');
    const out = await store.readMasked();
    const masked = out.channels[0] as Extract<Channel, { type: 'email' }>;
    expect(masked.auth_password).toBe('••••word');
    expect(masked.auth_password).not.toContain('secret');
  });

  it('masks the webhook bearer token', async () => {
    const ch: Channel = {
      type: 'webhook',
      name: 'opsgenie',
      url: 'https://api.opsgenie.com/v1/hook',
      http_bearer_token: 'eyJhbGciOi-fake-jwt-tail-1234',
    };
    await store.updateChannels([ch], 'opsgenie');
    const out = await store.readMasked();
    const masked = out.channels[0] as Extract<Channel, { type: 'webhook' }>;
    expect(masked.http_bearer_token).toBe('••••1234');
  });

  it('masks the Telegram bot token, keeping the bot-id prefix visible', async () => {
    const ch: Channel = {
      type: 'telegram',
      name: 'oncall-tg',
      bot_token: '12345:AAEFxyz-fake-token-tail-9999',
      chat_id: '-100123',
    };
    await store.updateChannels([ch], 'oncall-tg');
    const out = await store.readMasked();
    const masked = out.channels[0] as Extract<Channel, { type: 'telegram' }>;
    // Bot id "12345:" visible, then the dotted mask + last-4 of the
    // post-colon secret. Operator can identify which bot without
    // seeing the token.
    expect(masked.bot_token).toBe('12345:••••9999');
    expect(masked.chat_id).toBe('-100123');
  });

  it('masks the webhook basic_auth password', async () => {
    const ch: Channel = {
      type: 'webhook',
      name: 'w',
      url: 'https://events.example.com/abc',
      http_basic_auth_username: 'console',
      http_basic_auth_password: 'shhhh-quiet',
    };
    await store.updateChannels([ch], 'w');
    const out = await store.readMasked();
    const masked = out.channels[0] as Extract<Channel, { type: 'webhook' }>;
    expect(masked.http_basic_auth_password).toBe('••••uiet');
  });

  it('leaves non-secret fields untouched', async () => {
    const ch: Channel = {
      type: 'slack',
      name: 'ops-slack',
      api_url: 'https://hooks.slack.com/services/T1/B2/abcdefghij-token-tail',
      channel: '#ocpp-alerts',
      title: 'Console alert',
    };
    await store.updateChannels([ch], 'ops-slack');
    const out = await store.readMasked();
    const masked = out.channels[0] as Extract<Channel, { type: 'slack' }>;
    expect(masked.channel).toBe('#ocpp-alerts');
    expect(masked.title).toBe('Console alert');
    expect(masked.name).toBe('ops-slack');
  });
});

describe('renderManagedYaml shape', () => {
  it('always sets a route with a fallback when default_channel is empty', () => {
    const yaml = __test__.renderManagedYaml({ channels: [], default_channel: '' });
    expect(yaml).toMatch(/receiver:\s*__console_default__/);
  });

  it('route.receiver points at the chosen default when set', () => {
    const yaml = __test__.renderManagedYaml({
      channels: [{ type: 'slack', name: 'ops', api_url: 'https://hooks/x', channel: '#a' }],
      default_channel: 'ops',
    });
    expect(yaml).toMatch(/receiver:\s*ops/);
  });

  it('emits a per-channel sub-route matching the `receiver` label (so the test endpoint reaches the named channel)', () => {
    const yaml = __test__.renderManagedYaml({
      channels: [
        { type: 'email', name: 'oncall-email', to: 'ops@example.com', smarthost: 'smtp:587' },
        {
          type: 'telegram',
          name: 'tg-alerts',
          bot_token: '12345:ABCDEF1234567890abcdef',
          chat_id: '-1001234567890',
          parse_mode: 'HTML',
        },
      ],
      default_channel: 'oncall-email',
    });
    // Top-level default is the email channel.
    expect(yaml).toMatch(/^route:\n\s+receiver:\s*oncall-email/m);
    // Sub-routes exist for both channels and match on the receiver label.
    expect(yaml).toContain('routes:');
    expect(yaml).toMatch(/-\s*receiver:\s*oncall-email[\s\S]*?receiver="oncall-email"/);
    expect(yaml).toMatch(/-\s*receiver:\s*tg-alerts[\s\S]*?receiver="tg-alerts"/);
  });

  it('omits the routes block when there are no channels', () => {
    const yaml = __test__.renderManagedYaml({ channels: [], default_channel: '' });
    expect(yaml).not.toContain('\n  routes:');
  });
});

// PR #169: Console-managed default templates.
//
// When ChannelsStore is constructed with `templatesInContainerPath`,
// the rendered config must (a) emit a top-level `templates:` list
// pointing at that path and (b) wire each templated medium's
// receiver to its named template. Webhook stays raw-JSON. Operator
// `title`/`text` overrides on Slack still win — that's the only
// override surface PR 1 exposes; PR 2 will broaden it.
describe('Console-managed default templates (PR #169)', () => {
  const TPL_PATH = '/etc/alertmanager/alertmanager-templates.yml';
  let templatedDir: string;
  let templatedPath: string;
  let templated: ChannelsStore;

  beforeEach(async () => {
    templatedDir = await mkdtemp(join(tmpdir(), 'channels-tpl-'));
    templatedPath = join(templatedDir, 'alertmanager-managed.yml');
    templated = new ChannelsStore(templatedPath, { templatesInContainerPath: TPL_PATH });
  });

  afterEach(async () => {
    await rm(templatedDir, { recursive: true, force: true });
  });

  it('emits a `templates:` block at the in-container path', async () => {
    await templated.updateChannels([], '');
    const text = await readFile(templatedPath, 'utf8');
    expect(text).toContain('templates:');
    expect(text).toContain(`- ${TPL_PATH}`);
  });

  it('omits the `templates:` block when no path was wired', async () => {
    await store.updateChannels([], '');
    const text = await readFile(cfgPath, 'utf8');
    expect(text).not.toContain('templates:');
  });

  it('wires Slack receivers to title + text templates by default', async () => {
    const ch: Channel = {
      type: 'slack',
      name: 'ops',
      api_url: 'https://hooks/x',
      channel: '#a',
    };
    await templated.updateChannels([ch], 'ops');
    const text = await readFile(templatedPath, 'utf8');
    expect(text).toContain('{{ template "eveys.slack.title" . }}');
    expect(text).toContain('{{ template "eveys.slack.text" . }}');
  });

  it('preserves an operator-set Slack title/text on round-trip (override wins)', async () => {
    const ch: Channel = {
      type: 'slack',
      name: 'ops',
      api_url: 'https://hooks/x',
      channel: '#a',
      title: '🚨 my custom title',
      text: 'my custom text',
    };
    await templated.updateChannels([ch], 'ops');
    const text = await readFile(templatedPath, 'utf8');
    expect(text).toContain('🚨 my custom title');
    expect(text).toContain('my custom text');
    expect(text).not.toContain('{{ template "eveys.slack.title" . }}');
    expect(text).not.toContain('{{ template "eveys.slack.text" . }}');
    const out = await templated.read();
    expect(out.channels[0]).toEqual(ch);
  });

  it('wires email receivers to html/text/Subject templates', async () => {
    const ch: Channel = {
      type: 'email',
      name: 'oncall',
      to: 'a@b',
      from: 'c@d',
      smarthost: 's:25',
    };
    await templated.updateChannels([ch], 'oncall');
    const text = await readFile(templatedPath, 'utf8');
    expect(text).toContain('{{ template "eveys.email.html" . }}');
    expect(text).toContain('{{ template "eveys.email.text" . }}');
    expect(text).toContain('Subject:');
    expect(text).toContain('{{ template "eveys.email.subject" . }}');
  });

  it('wires Telegram receivers to the message template and defaults parse_mode to HTML', async () => {
    const ch: Channel = {
      type: 'telegram',
      name: 'tg',
      bot_token: '12345:abc',
      chat_id: '-100123',
    };
    await templated.updateChannels([ch], 'tg');
    const text = await readFile(templatedPath, 'utf8');
    expect(text).toContain('{{ template "eveys.telegram.message" . }}');
    expect(text).toContain('parse_mode: HTML');
  });

  it('leaves webhook receivers untemplated — they POST raw JSON', async () => {
    const ch: Channel = {
      type: 'webhook',
      name: 'pd',
      url: 'https://events.pagerduty.com/x',
    };
    await templated.updateChannels([ch], 'pd');
    const text = await readFile(templatedPath, 'utf8');
    expect(text).not.toMatch(/\{\{ template "eveys\.(slack|email|telegram)\./);
  });

  it('round-trips a Slack channel through default-template strip on read', async () => {
    // The on-disk file has `{{ template "eveys.slack.title" . }}` for
    // both title and text. On read, the parsed Channel should have
    // neither field set — the UI then shows the channel as "using
    // defaults" rather than "operator-overridden".
    const ch: Channel = {
      type: 'slack',
      name: 'ops',
      api_url: 'https://hooks/x',
      channel: '#a',
    };
    await templated.updateChannels([ch], 'ops');
    const out = await templated.read();
    expect(out.channels[0]).toEqual(ch);
    expect((out.channels[0] as { title?: string }).title).toBeUndefined();
    expect((out.channels[0] as { text?: string }).text).toBeUndefined();
  });
});
