// Typed client for the Console's firing-alerts proxy. The server side
// (`apps/server/src/routes/sys-alerts.ts`) talks to Alertmanager's v2
// API and re-shapes each entry into the same `Alert` type the existing
// client-derived panel renders, so this client returns a plain array
// of those.
//
// The route is fail-soft: on missing config / upstream wobble / parse
// error it returns `{ alerts: [], unavailable: true }` with HTTP 200.
// We surface `unavailable` to the hook so the panel can show its "not
// configured" hint instead of an error toast.

import { CONSOLE_BASE_URL as BASE } from '@/lib/console-url';
import type { Alert } from '@/lib/alerts';

/** Why the firing-alerts envelope is `unavailable`. Distinguishes a
 *  deployment that hasn't wired Alertmanager (`not_configured`) from
 *  one where Alertmanager is wired but unreachable (`unreachable` —
 *  pod down, DNS, 5xx). The UI uses this for honest copy on the
 *  dashboard. */
export type AlertsUnavailableReason = 'not_configured' | 'unreachable';

export interface FiringAlertsResponse {
  alerts: Alert[];
  unavailable: boolean;
  reason?: AlertsUnavailableReason;
}

export async function fetchFiringAlerts(token: string): Promise<FiringAlertsResponse> {
  const res = await fetch(`${BASE}/sys/alerts/firing`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sys/alerts/firing ${res.status}`);
  return (await res.json()) as FiringAlertsResponse;
}

// ---------------------------------------------------------------------------
// Silences
// ---------------------------------------------------------------------------

export type SilenceStatus = 'active' | 'pending' | 'expired';

export interface SilenceMatcher {
  name: string;
  value: string;
  is_regex: boolean;
  is_equal: boolean;
}

export interface Silence {
  id: string;
  matchers: SilenceMatcher[];
  starts_at: string;
  ends_at: string;
  comment: string;
  created_by: string;
  status: SilenceStatus;
}

export interface SilencesResponse {
  silences: Silence[];
  unavailable: boolean;
}

/** Input for `createSilence`. `starts_at` and `created_by` are optional —
 *  the server fills them with `now()` and the JWT subject when omitted. */
export interface CreateSilenceInput {
  matchers: Array<{ name: string; value: string; is_regex?: boolean; is_equal?: boolean }>;
  starts_at?: string;
  ends_at: string;
  comment?: string;
  created_by?: string;
}

export interface CreateSilenceResult {
  /** Set on success. */
  id?: string;
  /** Set when the upstream is missing or wedged; the UI surfaces a hint
   *  instead of an error toast in that case. */
  unavailable?: boolean;
}

export async function fetchSilences(token: string): Promise<SilencesResponse> {
  const res = await fetch(`${BASE}/sys/alerts/silences`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sys/alerts/silences ${res.status}`);
  return (await res.json()) as SilencesResponse;
}

export async function createSilence(
  token: string,
  input: CreateSilenceInput,
): Promise<CreateSilenceResult> {
  const res = await fetch(`${BASE}/sys/alerts/silences`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`POST sys/alerts/silences ${res.status}`);
  return (await res.json()) as CreateSilenceResult;
}

export async function expireSilence(token: string, id: string): Promise<void> {
  const res = await fetch(`${BASE}/sys/alerts/silences/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  // The server's "unavailable" envelope arrives as HTTP 200 with a JSON
  // body; success is HTTP 204. Anything else is a real error.
  if (res.status === 204) return;
  if (res.status === 200) {
    // Treat as a silent no-op from the caller's perspective. The next
    // refetch surfaces the unavailable banner.
    return;
  }
  throw new Error(`DELETE sys/alerts/silences ${res.status}`);
}

// ---------------------------------------------------------------------------
// Channels (receiver config)
// ---------------------------------------------------------------------------
// The browser mirrors the server's discriminated-union shape for
// receivers. Secret-bearing fields (Slack webhook URL, SMTP password,
// webhook basic-auth password) arrive masked from the server; the form
// treats an empty string as "keep existing" so an operator editing a
// non-secret field doesn't need to re-enter the secret.

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
  /** Override the managed Subject template. Empty/unset → managed
   *  `eveys.email.subject` ships verbatim. */
  subject?: string;
  /** Override the managed HTML body template. */
  html?: string;
  /** Override the managed plain-text fallback template. */
  text?: string;
}

export interface ChannelWebhook {
  type: 'webhook';
  name: string;
  url: string;
  http_basic_auth_username?: string;
  http_basic_auth_password?: string;
  /** Bearer token for the Authorization header on the outbound
   *  webhook. Mutually exclusive with basic-auth; server picks
   *  bearer when both are set. */
  http_bearer_token?: string;
}

export interface ChannelTelegram {
  type: 'telegram';
  name: string;
  /** Bot token from @BotFather — `<bot_id>:<token>`. Treated as
   *  a secret; arrives masked from the server, an empty/masked
   *  value on PUT keeps the existing token. */
  bot_token: string;
  /** Numeric chat id. Channels start with `-100…`; groups are
   *  negative, private chats positive. String to round-trip large
   *  ids without JS Number precision loss. */
  chat_id: string;
  /** Optional custom Bot API endpoint (e.g. a self-hosted Telegram
   *  bot API server). Empty / unset → upstream `api.telegram.org`. */
  api_url?: string;
  /** Optional message formatter. Alertmanager supports HTML and
   *  MarkdownV2; HTML matches the default template. */
  parse_mode?: 'HTML' | 'MarkdownV2';
  /** Override the managed Telegram message template. Empty/unset →
   *  managed `eveys.telegram.message` ships verbatim. The override
   *  respects the parse_mode above. */
  message?: string;
}

export type Channel = ChannelSlack | ChannelEmail | ChannelWebhook | ChannelTelegram;

export interface ChannelsResponse {
  channels: Channel[];
  /** Empty string when the synthetic null-fallback is the route's
   *  default — alerts fire but go nowhere. */
  default_channel: string;
  /** Present only when the on-disk write succeeded but Alertmanager
   *  refused to reload the new config. The file is updated; the
   *  running Alertmanager is still on the previous config. The UI
   *  must surface this — silent reload failure was the cause of
   *  "I saved Telegram but alerts kept going to email." */
  reload?: ReloadFailure;
}

export interface ReloadFailure {
  ok: false;
  status?: number;
  detail: string;
  /** True when ALERTMANAGER_URL isn't configured. Tests + dev stacks
   *  without Alertmanager hit this; the UI can stay quiet on it. */
  skipped?: boolean;
}

export async function fetchChannels(token: string): Promise<ChannelsResponse> {
  const res = await fetch(`${BASE}/sys/alerts/channels`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 503) {
    // The server reports "channels disabled" when the store isn't
    // wired (no ALERTMANAGER_CONFIG_PATH bound). The Channels tab
    // renders an explanatory hint in that case.
    return { channels: [], default_channel: '' };
  }
  if (!res.ok) throw new Error(`GET sys/alerts/channels ${res.status}`);
  return (await res.json()) as ChannelsResponse;
}

export async function createChannel(token: string, channel: Channel): Promise<ChannelsResponse> {
  const res = await fetch(`${BASE}/sys/alerts/channels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(channel),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST sys/alerts/channels ${res.status}: ${body}`);
  }
  return (await res.json()) as ChannelsResponse;
}

export async function updateChannel(token: string, channel: Channel): Promise<ChannelsResponse> {
  const res = await fetch(`${BASE}/sys/alerts/channels/${encodeURIComponent(channel.name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(channel),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PUT sys/alerts/channels ${res.status}: ${body}`);
  }
  return (await res.json()) as ChannelsResponse;
}

export async function deleteChannel(token: string, name: string): Promise<ChannelsResponse> {
  const res = await fetch(`${BASE}/sys/alerts/channels/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DELETE sys/alerts/channels ${res.status}: ${body}`);
  }
  return (await res.json()) as ChannelsResponse;
}

export async function testChannel(token: string, name: string): Promise<void> {
  const res = await fetch(`${BASE}/sys/alerts/channels/${encodeURIComponent(name)}/test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 202) return;
  // 502 / 503 / 404 / 400 all surface to the caller so the form can
  // distinguish "Alertmanager rejected" from "channel was renamed
  // mid-click."
  const body = await res.text();
  throw new Error(`POST sys/alerts/channels/.../test ${res.status}: ${body}`);
}

// ---------------------------------------------------------------------------
// Default-receiver switch
// ---------------------------------------------------------------------------

export async function setDefaultChannel(
  token: string,
  name: string | null,
): Promise<ChannelsResponse> {
  const res = await fetch(`${BASE}/sys/alerts/channels/default`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PUT sys/alerts/channels/default ${res.status}: ${body}`);
  }
  return (await res.json()) as ChannelsResponse;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface RuleEntry {
  name: string;
  type: 'alerting' | 'recording' | 'unknown';
  expr: string;
  duration: string;
  severity: string | null;
  summary: string | null;
  description: string | null;
  state: string;
  last_evaluation: string | null;
  evaluation_time: string | null;
  health: string | null;
}

export interface RuleGroup {
  name: string;
  file: string;
  interval: number | null;
  rules: RuleEntry[];
}

export interface RulesResponse {
  groups: RuleGroup[];
  unavailable: boolean;
}

export async function fetchRules(token: string): Promise<RulesResponse> {
  const res = await fetch(`${BASE}/sys/alerts/rules`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET sys/alerts/rules ${res.status}`);
  return (await res.json()) as RulesResponse;
}

// ---------------------------------------------------------------------------
// Managed rules CRUD
// ---------------------------------------------------------------------------

export interface ManagedAlertingRule {
  name: string;
  expr: string;
  duration: string;
  severity: 'critical' | 'warning' | 'info';
  summary: string;
  description: string;
}

export interface ManagedRulesResponse {
  managed: ManagedAlertingRule[];
  /** Set when the server's promtool wasn't available — write went
   *  through without the safety net. The UI surfaces a banner. */
  validation_skipped?: boolean;
}

export async function fetchManagedRules(token: string): Promise<ManagedRulesResponse> {
  const res = await fetch(`${BASE}/sys/alerts/rules/managed`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 503) return { managed: [] };
  if (!res.ok) throw new Error(`GET sys/alerts/rules/managed ${res.status}`);
  return (await res.json()) as ManagedRulesResponse;
}

export async function createManagedRule(
  token: string,
  rule: ManagedAlertingRule,
): Promise<ManagedRulesResponse> {
  const res = await fetch(`${BASE}/sys/alerts/rules/managed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(rule),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST sys/alerts/rules/managed ${res.status}: ${body}`);
  }
  return (await res.json()) as ManagedRulesResponse;
}

export async function updateManagedRule(
  token: string,
  rule: ManagedAlertingRule,
): Promise<ManagedRulesResponse> {
  const res = await fetch(`${BASE}/sys/alerts/rules/managed/${encodeURIComponent(rule.name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(rule),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PUT sys/alerts/rules/managed ${res.status}: ${body}`);
  }
  return (await res.json()) as ManagedRulesResponse;
}

export async function deleteManagedRule(
  token: string,
  name: string,
): Promise<ManagedRulesResponse> {
  const res = await fetch(`${BASE}/sys/alerts/rules/managed/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DELETE sys/alerts/rules/managed ${res.status}: ${body}`);
  }
  return (await res.json()) as ManagedRulesResponse;
}
