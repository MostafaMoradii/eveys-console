// Reads and writes the Alertmanager config file the Console manages.
//
// The file's lifecycle:
//   - Deploy seeds `data/alertmanager-managed.yml` from the legacy
//     `deploy/observability/alertmanager.yml` (one-time, if missing).
//   - From then on the Console is the only writer. Hand edits to the
//     file survive only until the next Channels-tab write.
//   - The file path is configurable via ALERTMANAGER_CONFIG_PATH.
//
// Why a single managed file rather than templating on top of a base:
// receivers, the route block, and the null fallback all interact —
// merging hand-edited bits with Console-managed bits gets ambiguous
// fast. One source of truth is cleaner.
//
// Secrets in YAML:
//   - Slack webhook URLs, SMTP passwords, basic-auth passwords end up
//     plain-text in the file. That's how Alertmanager works.
//   - On GET, the store MASKS the trailing portion of secret-bearing
//     fields so they don't reach the browser.
//   - On PUT, an empty string means "keep the existing secret"; a
//     non-empty string overwrites.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { parse, stringify } from 'yaml';

export type ChannelType = 'slack' | 'email' | 'webhook';

export interface ChannelSlack {
  type: 'slack';
  name: string;
  api_url: string;
  channel: string;
  title?: string;
  text?: string;
}

export interface ChannelEmail {
  type: 'email';
  name: string;
  to: string;
  from: string;
  smarthost: string;
  auth_username?: string;
  auth_password?: string;
  require_tls?: boolean;
}

export interface ChannelWebhook {
  type: 'webhook';
  name: string;
  url: string;
  http_basic_auth_username?: string;
  http_basic_auth_password?: string;
}

export type Channel = ChannelSlack | ChannelEmail | ChannelWebhook;

export interface ManagedConfig {
  channels: Channel[];
  /** Name of the receiver that gets all alerts when no route matches.
   *  Empty string means "use the synthetic `null` receiver" — alerts
   *  fire but go nowhere. */
  default_channel: string;
}

// Synthetic always-present receiver used as the route fallback when
// no real channel is set as the default. Named with leading + trailing
// underscores so it doesn't collide with the YAML `null` literal (which
// would parse back as JS null) AND so an operator scanning the file
// can tell it's a Console-managed placeholder, not theirs.
const NULL_RECEIVER_NAME = '__console_default__';

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export class ChannelsStore {
  constructor(private readonly path: string) {}

  /** Read the managed config. Returns an empty list + `null` default
   *  when the file is missing — caller renders the "no channels"
   *  empty state. Throws on parse failures so the operator sees what's
   *  wrong rather than a silent zero. */
  async read(): Promise<ManagedConfig> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (err) {
      if (isNoEntry(err)) return { channels: [], default_channel: '' };
      throw err;
    }
    return parseManagedYaml(text);
  }

  /** Read with secrets masked for transport to the browser. */
  async readMasked(): Promise<ManagedConfig> {
    const cfg = await this.read();
    return { ...cfg, channels: cfg.channels.map(maskSecrets) };
  }

  /** Write the file atomically. Caller is responsible for calling
   *  Alertmanager's /-/reload afterwards. Creates the parent dir on
   *  first write so the deploy doesn't need to pre-create `data/`. */
  async write(cfg: ManagedConfig): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const yaml = renderManagedYaml(cfg);
    const tmp = `${this.path}.tmp-${process.pid}`;
    await writeFile(tmp, yaml, 'utf8');
    // Rename is atomic on the same filesystem — readers never see a
    // half-written file. fs/promises has no rename in writeFile, so:
    const { rename } = await import('node:fs/promises');
    await rename(tmp, this.path);
  }

  /** Update the list of channels and persist. Returns the new config. */
  async updateChannels(channels: Channel[], defaultChannel: string): Promise<ManagedConfig> {
    const next: ManagedConfig = { channels, default_channel: defaultChannel };
    await this.write(next);
    return next;
  }
}

// ----------------------------------------------------------------------------
// Masking
// ----------------------------------------------------------------------------

/** Replace secret-bearing fields with a partial mask that preserves
 *  the last 4 chars (so the operator can recognise the active value)
 *  but never returns the live secret to the browser. Returns an empty
 *  string if the secret is short / unset — the form treats that as
 *  "no current secret". */
function maskSecrets(c: Channel): Channel {
  switch (c.type) {
    case 'slack':
      return { ...c, api_url: maskUrl(c.api_url) };
    case 'email': {
      const out: ChannelEmail = { ...c };
      if (c.auth_password) out.auth_password = maskValue(c.auth_password);
      return out;
    }
    case 'webhook': {
      const out: ChannelWebhook = { ...c, url: maskUrl(c.url) };
      if (c.http_basic_auth_password)
        out.http_basic_auth_password = maskValue(c.http_basic_auth_password);
      return out;
    }
  }
}

function maskValue(s: string): string {
  if (s.length <= 4) return '••••';
  return `••••${s.slice(-4)}`;
}

function maskUrl(s: string): string {
  // Show the host/path enough to recognise but hide the token tail.
  // Slack webhook URLs look like https://hooks.slack.com/services/T.../B.../<token>
  // We render the first 24 chars + ••••• + last 4.
  if (s.length <= 32) return maskValue(s);
  return `${s.slice(0, 24)}••••${s.slice(-4)}`;
}

// ----------------------------------------------------------------------------
// YAML serialization
// ----------------------------------------------------------------------------

interface AlertmanagerYaml {
  global?: Record<string, unknown>;
  route?: AlertmanagerRoute;
  receivers?: AlertmanagerReceiver[];
}

interface AlertmanagerRoute {
  receiver: string;
  group_wait?: string;
  group_interval?: string;
  repeat_interval?: string;
}

interface AlertmanagerReceiver {
  name: string;
  slack_configs?: Array<{
    api_url: string;
    channel?: string;
    title?: string;
    text?: string;
    send_resolved?: boolean;
  }>;
  email_configs?: Array<{
    to: string;
    from?: string;
    smarthost?: string;
    auth_username?: string;
    auth_password?: string;
    require_tls?: boolean;
    send_resolved?: boolean;
  }>;
  webhook_configs?: Array<{
    url: string;
    http_config?: {
      basic_auth?: { username: string; password: string };
    };
    send_resolved?: boolean;
  }>;
}

function parseManagedYaml(text: string): ManagedConfig {
  const raw = parse(text) as AlertmanagerYaml | null;
  if (!raw || typeof raw !== 'object') return { channels: [], default_channel: '' };
  const channels: Channel[] = [];
  for (const r of raw.receivers ?? []) {
    if (!r || typeof r.name !== 'string') continue;
    if (r.name === NULL_RECEIVER_NAME) continue;
    const c = receiverToChannel(r);
    if (c) channels.push(c);
  }
  const defaultChannel = raw.route?.receiver === NULL_RECEIVER_NAME ? '' : (raw.route?.receiver ?? '');
  return { channels, default_channel: defaultChannel };
}

function receiverToChannel(r: AlertmanagerReceiver): Channel | null {
  const slack = r.slack_configs?.[0];
  if (slack && typeof slack.api_url === 'string') {
    return {
      type: 'slack',
      name: r.name,
      api_url: slack.api_url,
      channel: slack.channel ?? '',
      ...(slack.title ? { title: slack.title } : {}),
      ...(slack.text ? { text: slack.text } : {}),
    };
  }
  const email = r.email_configs?.[0];
  if (email && typeof email.to === 'string') {
    const out: ChannelEmail = {
      type: 'email',
      name: r.name,
      to: email.to,
      from: email.from ?? '',
      smarthost: email.smarthost ?? '',
    };
    if (email.auth_username) out.auth_username = email.auth_username;
    if (email.auth_password) out.auth_password = email.auth_password;
    if (typeof email.require_tls === 'boolean') out.require_tls = email.require_tls;
    return out;
  }
  const webhook = r.webhook_configs?.[0];
  if (webhook && typeof webhook.url === 'string') {
    const out: ChannelWebhook = {
      type: 'webhook',
      name: r.name,
      url: webhook.url,
    };
    const ba = webhook.http_config?.basic_auth;
    if (ba) {
      out.http_basic_auth_username = ba.username;
      out.http_basic_auth_password = ba.password;
    }
    return out;
  }
  return null;
}

function renderManagedYaml(cfg: ManagedConfig): string {
  const receivers: AlertmanagerReceiver[] = [{ name: NULL_RECEIVER_NAME }];
  for (const c of cfg.channels) receivers.push(channelToReceiver(c));
  const route: AlertmanagerRoute = {
    receiver: cfg.default_channel || NULL_RECEIVER_NAME,
    group_wait: '30s',
    group_interval: '5m',
    repeat_interval: '4h',
  };
  const yaml: AlertmanagerYaml = { route, receivers };
  // Prefix with a comment so an SRE peeking at the file knows what
  // it is and how to edit it (don't).
  //
  return (
    '# Managed by the Console — edits via /sys/alerts → Channels.\n' +
    '# Direct edits are overwritten on the next Channels write.\n' +
    stringify(yaml, { lineWidth: 0 })
  );
}

function channelToReceiver(c: Channel): AlertmanagerReceiver {
  switch (c.type) {
    case 'slack':
      return {
        name: c.name,
        slack_configs: [
          {
            api_url: c.api_url,
            channel: c.channel,
            ...(c.title ? { title: c.title } : {}),
            ...(c.text ? { text: c.text } : {}),
            send_resolved: true,
          },
        ],
      };
    case 'email':
      return {
        name: c.name,
        email_configs: [
          {
            to: c.to,
            from: c.from,
            smarthost: c.smarthost,
            ...(c.auth_username ? { auth_username: c.auth_username } : {}),
            ...(c.auth_password ? { auth_password: c.auth_password } : {}),
            ...(c.require_tls !== undefined ? { require_tls: c.require_tls } : {}),
            send_resolved: true,
          },
        ],
      };
    case 'webhook':
      return {
        name: c.name,
        webhook_configs: [
          {
            url: c.url,
            ...(c.http_basic_auth_username && c.http_basic_auth_password
              ? {
                  http_config: {
                    basic_auth: {
                      username: c.http_basic_auth_username,
                      password: c.http_basic_auth_password,
                    },
                  },
                }
              : {}),
            send_resolved: true,
          },
        ],
      };
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function isNoEntry(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'ENOENT'
  );
}

export const __test__ = {
  parseManagedYaml,
  renderManagedYaml,
  maskSecrets,
};
