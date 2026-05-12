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

import { CHANNEL_TEMPLATE_INVOCATIONS } from './templates-defaults.js';

export type ChannelType = 'slack' | 'email' | 'webhook' | 'telegram';

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
  /** Basic-auth on the outbound webhook. Mutually exclusive with
   *  bearer-token; if both are set the bearer wins. */
  http_basic_auth_username?: string;
  http_basic_auth_password?: string;
  /** Bearer-token on the outbound webhook. Serialized to
   *  Alertmanager's `http_config.authorization.{type,credentials}`. */
  http_bearer_token?: string;
}

export interface ChannelTelegram {
  type: 'telegram';
  name: string;
  /** Bot token from @BotFather. Treated as a secret — masked on
   *  the wire, kept as-is in the managed YAML file. */
  bot_token: string;
  /** Numeric chat id (channels start with `-100…`, groups are
   *  negative, private chats are positive). Stored as a string
   *  because some channel ids are too large for JS Number. */
  chat_id: string;
  /** Optional override of the Telegram Bot API base URL. Empty
   *  string means "default upstream `https://api.telegram.org`". */
  api_url?: string;
  /** Optional message-format hint. Alertmanager accepts HTML or
   *  MarkdownV2; we expose only HTML in the UI (matches the default
   *  template). Server is permissive — anything else round-trips. */
  parse_mode?: string;
}

export type Channel = ChannelSlack | ChannelEmail | ChannelWebhook | ChannelTelegram;

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

export interface ChannelsStoreOptions {
  /** Path **as Alertmanager sees it inside its container** of the
   *  Console-managed templates file. When set, the rendered config
   *  emits a `templates:` block pointing here and wires every
   *  templated receiver to the matching named template. When unset
   *  (e.g. unit tests that don't care), receivers fall back to
   *  Alertmanager's built-in defaults — same behaviour as pre-#169. */
  templatesInContainerPath?: string;
}

export class ChannelsStore {
  private readonly templatesInContainerPath: string | undefined;

  constructor(
    private readonly path: string,
    opts: ChannelsStoreOptions = {},
  ) {
    this.templatesInContainerPath = opts.templatesInContainerPath;
  }

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
    const yaml = renderManagedYaml(
      cfg,
      this.templatesInContainerPath
        ? { templatesInContainerPath: this.templatesInContainerPath }
        : {},
    );
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

  /** Write an empty managed config if the file doesn't exist yet.
   *  Called once at startup so the Alertmanager container has a valid
   *  --config.file to start against on a fresh deployment. No-op when
   *  the file is already there. */
  async seedIfMissing(): Promise<boolean> {
    try {
      await readFile(this.path, 'utf8');
      return false;
    } catch (err) {
      if (!isNoEntry(err)) throw err;
      await this.write({ channels: [], default_channel: '' });
      return true;
    }
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
      if (c.http_bearer_token) out.http_bearer_token = maskValue(c.http_bearer_token);
      return out;
    }
    case 'telegram': {
      const out: ChannelTelegram = { ...c };
      // Telegram bot tokens look like `12345:AAEFxyz…` — split on the
      // colon to keep the bot-id prefix visible (operator can confirm
      // the right bot) while hiding the secret tail.
      if (c.bot_token) {
        const colon = c.bot_token.indexOf(':');
        if (colon > 0) {
          out.bot_token = `${c.bot_token.slice(0, colon + 1)}${maskValue(c.bot_token.slice(colon + 1))}`;
        } else {
          out.bot_token = maskValue(c.bot_token);
        }
      }
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
  templates?: string[];
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
    html?: string;
    text?: string;
    headers?: Record<string, string>;
  }>;
  webhook_configs?: Array<{
    url: string;
    http_config?: {
      basic_auth?: { username: string; password: string };
      authorization?: { type: string; credentials: string };
    };
    send_resolved?: boolean;
  }>;
  telegram_configs?: Array<{
    bot_token: string;
    // Alertmanager parses chat_id as int64. We keep it as a string
    // through the Console so very-large channel ids round-trip
    // losslessly; the YAML library serializes it back as a number.
    chat_id: number;
    api_url?: string;
    parse_mode?: string;
    send_resolved?: boolean;
    message?: string;
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
  const defaultChannel =
    raw.route?.receiver === NULL_RECEIVER_NAME ? '' : (raw.route?.receiver ?? '');
  return { channels, default_channel: defaultChannel };
}

/** A receiver field value is a Console-managed default (not an operator
 *  override) when it's exactly our canonical `{{ template "eveys.<…>" . }}`
 *  invocation. We strip those on read so the UI shows the field as
 *  empty / "using default" instead of round-tripping the invocation as
 *  if the operator had typed it. */
function isDefaultTemplateInvocation(value: string | undefined, name: string): boolean {
  return value === `{{ template "${name}" . }}`;
}

function receiverToChannel(r: AlertmanagerReceiver): Channel | null {
  const slack = r.slack_configs?.[0];
  if (slack && typeof slack.api_url === 'string') {
    const inv = CHANNEL_TEMPLATE_INVOCATIONS.slack;
    const title =
      slack.title && !isDefaultTemplateInvocation(slack.title, inv.title) ? slack.title : undefined;
    const text =
      slack.text && !isDefaultTemplateInvocation(slack.text, inv.text) ? slack.text : undefined;
    return {
      type: 'slack',
      name: r.name,
      api_url: slack.api_url,
      channel: slack.channel ?? '',
      ...(title ? { title } : {}),
      ...(text ? { text } : {}),
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
    const auth = webhook.http_config?.authorization;
    if (auth && typeof auth.credentials === 'string' && auth.type.toLowerCase() === 'bearer') {
      out.http_bearer_token = auth.credentials;
    }
    return out;
  }
  const telegram = r.telegram_configs?.[0];
  if (telegram && typeof telegram.bot_token === 'string') {
    const out: ChannelTelegram = {
      type: 'telegram',
      name: r.name,
      bot_token: telegram.bot_token,
      chat_id: String(telegram.chat_id),
    };
    if (telegram.api_url) out.api_url = telegram.api_url;
    if (telegram.parse_mode) out.parse_mode = telegram.parse_mode;
    return out;
  }
  return null;
}

interface RenderOptions {
  /** When set, the rendered YAML's top-level `templates:` block points
   *  at this file and every templated receiver emits a `{{ template
   *  "eveys.<medium>.<field>" . }}` invocation in place of relying on
   *  Alertmanager's built-in defaults. Pass the path **as Alertmanager
   *  sees it inside its container**, since that's what the file's own
   *  loader resolves at startup / reload time. */
  templatesInContainerPath?: string;
}

function renderManagedYaml(cfg: ManagedConfig, opts: RenderOptions = {}): string {
  const templatesEnabled = Boolean(opts.templatesInContainerPath);
  const receivers: AlertmanagerReceiver[] = [{ name: NULL_RECEIVER_NAME }];
  for (const c of cfg.channels) receivers.push(channelToReceiver(c, templatesEnabled));
  const route: AlertmanagerRoute = {
    receiver: cfg.default_channel || NULL_RECEIVER_NAME,
    group_wait: '30s',
    group_interval: '5m',
    repeat_interval: '4h',
  };
  const yaml: AlertmanagerYaml = {};
  if (opts.templatesInContainerPath) {
    yaml.templates = [opts.templatesInContainerPath];
  }
  yaml.route = route;
  yaml.receivers = receivers;
  // Prefix with a comment so an SRE peeking at the file knows what
  // it is and how to edit it (don't).
  //
  return (
    '# Managed by the Console — edits via /sys/alerts → Channels.\n' +
    '# Direct edits are overwritten on the next Channels write.\n' +
    stringify(yaml, { lineWidth: 0 })
  );
}

function channelToReceiver(c: Channel, templatesEnabled: boolean): AlertmanagerReceiver {
  // Wrap a template name into Go-template invocation syntax. The two
  // dots (`.`) at the end pass the current notification scope to the
  // named template — same convention Alertmanager's docs use.
  const tpl = (name: string) => `{{ template "${name}" . }}`;
  switch (c.type) {
    case 'slack': {
      // Slack: title + text fields receive the template invocations.
      // Operator-set custom title/text on the channel record wins, so
      // overrides round-trip unchanged.
      const inv = CHANNEL_TEMPLATE_INVOCATIONS.slack;
      const title = c.title ?? (templatesEnabled ? tpl(inv.title) : undefined);
      const text = c.text ?? (templatesEnabled ? tpl(inv.text) : undefined);
      return {
        name: c.name,
        slack_configs: [
          {
            api_url: c.api_url,
            channel: c.channel,
            ...(title !== undefined ? { title } : {}),
            ...(text !== undefined ? { text } : {}),
            send_resolved: true,
          },
        ],
      };
    }
    case 'email': {
      // Email: html, text and Subject all come from named templates.
      // The legacy default-receiver behaviour shipped subject+plain
      // body; we keep that fallback when templates aren't wired, so
      // pre-PR-#169 deploys behave identically.
      const inv = CHANNEL_TEMPLATE_INVOCATIONS.email;
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
            ...(templatesEnabled
              ? {
                  html: tpl(inv.html),
                  text: tpl(inv.text),
                  headers: { Subject: tpl(inv.headers_subject) },
                }
              : {}),
            send_resolved: true,
          },
        ],
      };
    }
    case 'webhook': {
      // Auth selection — bearer wins when both are set; the form
      // shouldn't let that happen, but the contract is explicit.
      // Webhook receivers don't take a template — they POST the raw
      // Alertmanager alert payload as JSON. Consumers on the other
      // end (PagerDuty, OpsGenie, in-house pipelines) parse the
      // structured fields directly.
      let httpConfig:
        | {
            basic_auth?: { username: string; password: string };
            authorization?: { type: string; credentials: string };
          }
        | undefined;
      if (c.http_bearer_token) {
        httpConfig = { authorization: { type: 'Bearer', credentials: c.http_bearer_token } };
      } else if (c.http_basic_auth_username && c.http_basic_auth_password) {
        httpConfig = {
          basic_auth: {
            username: c.http_basic_auth_username,
            password: c.http_basic_auth_password,
          },
        };
      }
      return {
        name: c.name,
        webhook_configs: [
          {
            url: c.url,
            ...(httpConfig ? { http_config: httpConfig } : {}),
            send_resolved: true,
          },
        ],
      };
    }
    case 'telegram': {
      // chat_id ships as an int64 in Alertmanager's YAML; convert the
      // string we hold on disk to a number for serialization. Invalid
      // / non-numeric values fall back to 0 which Alertmanager will
      // reject loudly on reload — better than silently dropping the
      // receiver.
      const chatId = Number.parseInt(c.chat_id, 10);
      const inv = CHANNEL_TEMPLATE_INVOCATIONS.telegram;
      return {
        name: c.name,
        telegram_configs: [
          {
            bot_token: c.bot_token,
            chat_id: Number.isFinite(chatId) ? chatId : 0,
            ...(c.api_url ? { api_url: c.api_url } : {}),
            // Default to HTML parse_mode so the Telegram template's
            // <b>/<i>/<a> tags render. Operators can override on the
            // channel form (e.g. for MarkdownV2 + a custom message).
            parse_mode: c.parse_mode ?? 'HTML',
            ...(templatesEnabled ? { message: tpl(inv.message) } : {}),
            send_resolved: true,
          },
        ],
      };
    }
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function isNoEntry(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  );
}

/** Exported for the route layer, which re-masks the in-memory result
 *  of a write before sending it back. (Re-reading from disk would
 *  produce the same result with extra I/O.) */
export { maskSecrets };

export const __test__ = {
  parseManagedYaml,
  renderManagedYaml,
  maskSecrets,
};
