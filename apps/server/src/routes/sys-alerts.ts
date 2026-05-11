// Proxies Alertmanager's v2 firing-alerts + silences API for the
// Console UI's "Firing alerts" and "Active silences" panels. The
// browser never talks to Alertmanager directly — the Console mediates
// so JWT auth and CORS stay uniform with the other `/sys/...` surfaces.
//
// View-only by default; create/delete silences are the only mutating
// surfaces and they record the JWT's subject as Alertmanager's
// `createdBy` so an operator can be traced to their action.
//
// Fail-soft by design: any upstream wobble (timeout, non-2xx, parse
// error, missing config) on the GET routes collapses to an
// `{ ..., unavailable: true }` envelope with HTTP 200. The panels
// render a single muted "Alertmanager not configured" row in that
// case — the operator's resting expectation is "no alerts" anyway,
// and a 503 would just produce an error toast that drowns the
// actually-useful hint. POST and DELETE return the same envelope on
// upstream failure so the React Query mutation can surface it through
// the same code path the GETs do.

import { z } from 'zod';

import {
  maskSecrets,
  type Channel,
  type ChannelsStore,
  type ManagedConfig,
} from '../store/channels-store.js';
import type { AlertingRule, RulesStore } from '../store/rules-store.js';

// Mirror of the web side's `AlertSeverity` (see apps/web/src/lib/alerts.ts).
// Kept as a local literal so the server doesn't pull a web type. The
// /sys/alerts/firing response is JSON; the web client narrows it back
// into its own `Alert` at the boundary.
type AlertSeverity = 'critical' | 'warning' | 'info';

interface RouteDeps {
  // logger is optional so the existing test harness (which builds the
  // app with `logger: false`) can omit it without typing gymnastics.
  logger?: { warn: (obj: unknown, msg?: string) => void };
  // Optional so the firing/silences-only test harness can build the
  // route without standing up a real store. The channels routes
  // 503 when this is missing.
  channelsStore?: ChannelsStore;
  // Same shape — 503 from the managed-rules routes when missing.
  rulesStore?: RulesStore;
}

/** Mirror of the `Alert` shape on the web side. Kept here as a local
 *  literal so the server has no runtime dependency on the web's lib.
 *  The web client narrows the API response into its own `Alert` type
 *  at the boundary. */
export interface FiringAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  since: string;
  cp_id?: string;
}

/** Why an unavailable response is unavailable. `not_configured` means
 *  ALERTMANAGER_URL is unset (deployment hasn't wired Alertmanager
 *  yet). `unreachable` means the URL is set but the upstream call
 *  failed — network, DNS, 5xx, or a non-2xx response. The UI uses
 *  this to tell the operator whether to set an env var or check the
 *  Alertmanager pod. Omitted on the happy path. */
export type AlertsUnavailableReason = 'not_configured' | 'unreachable';

export interface FiringAlertsResponse {
  alerts: FiringAlert[];
  unavailable: boolean;
  reason?: AlertsUnavailableReason;
}

/** Mirror of the web-side `SilenceMatcher`. Alertmanager v2 represents
 *  this as `{ name, value, isRegex, isEqual }` — we re-shape into
 *  snake_case so the JSON the Console emits is consistent with the
 *  rest of /sys/... payloads (which are snake_case for transactions,
 *  charge-points, etc.). */
export interface SilenceMatcher {
  name: string;
  value: string;
  is_regex: boolean;
  is_equal: boolean;
}

export type SilenceStatus = 'active' | 'pending' | 'expired';

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

/** Per-rule fields surfaced to the UI. Mirrors Prometheus's
 *  `/api/v1/rules` response with a flatter shape. The browser narrows
 *  this into its own type at the boundary. */
export interface RuleEntry {
  name: string;
  type: 'alerting' | 'recording' | 'unknown';
  /** PromQL expression. */
  expr: string;
  /** `for:` duration like '5m'. Empty string when the rule has no
   *  pending window (recording rules, or alerts without `for:`). */
  duration: string;
  severity: string | null;
  summary: string | null;
  description: string | null;
  /** 'inactive' / 'pending' / 'firing' for alerting rules; 'ok' for
   *  recording rules. Mirrors Prometheus's state field. */
  state: string;
  /** ISO-8601 of last evaluation. */
  last_evaluation: string | null;
  /** Wall-clock duration of last evaluation as Prometheus emits it
   *  (seconds, as a string fraction in the v1 API). */
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

/** Map Prometheus's `/api/v1/rules` response to the Console's shape.
 *  Malformed entries are silently skipped (rather than dropping the
 *  whole response). Exported so the route test can exercise the
 *  mapping in isolation, same pattern as mapSilence / mapFiringAlert. */
export function mapRulesResponse(raw: unknown): RulesResponse {
  if (!isObject(raw)) return { groups: [], unavailable: true };
  const data = isObject(raw.data) ? raw.data : null;
  if (!data) return { groups: [], unavailable: true };
  const groupsRaw = Array.isArray(data.groups) ? data.groups : [];
  const groups: RuleGroup[] = [];
  for (const g of groupsRaw) {
    if (!isObject(g)) continue;
    const name = isString(g.name) ? g.name : '';
    const file = isString(g.file) ? g.file : '';
    if (!name) continue;
    const rulesRaw = Array.isArray(g.rules) ? g.rules : [];
    const rules: RuleEntry[] = [];
    for (const r of rulesRaw) {
      const mapped = mapRuleEntry(r);
      if (mapped) rules.push(mapped);
    }
    groups.push({
      name,
      file,
      interval: typeof g.interval === 'number' ? g.interval : null,
      rules,
    });
  }
  return { groups, unavailable: false };
}

function mapRuleEntry(raw: unknown): RuleEntry | null {
  if (!isObject(raw)) return null;
  const name = raw.name;
  if (!isString(name)) return null;
  const annotations = isObject(raw.annotations) ? raw.annotations : {};
  const labels = isObject(raw.labels) ? raw.labels : {};
  const type =
    raw.type === 'alerting' || raw.type === 'recording'
      ? (raw.type as RuleEntry['type'])
      : 'unknown';
  const durationRaw = raw.duration;
  const duration =
    typeof durationRaw === 'number' && Number.isFinite(durationRaw)
      ? formatDuration(durationRaw)
      : isString(durationRaw)
        ? durationRaw
        : '';
  return {
    name,
    type,
    expr: isString(raw.query) ? raw.query : '',
    duration,
    severity: isString(labels.severity) ? labels.severity : null,
    summary: isString(annotations.summary) ? annotations.summary : null,
    description: isString(annotations.description) ? annotations.description : null,
    state: isString(raw.state) ? raw.state : 'ok',
    last_evaluation: isString(raw.lastEvaluation) ? raw.lastEvaluation : null,
    evaluation_time: isString(raw.evaluationTime) ? raw.evaluationTime : null,
    health: isString(raw.health) ? raw.health : null,
  };
}

/** Format a Prometheus `for:` duration (in seconds) as the
 *  compact form the alerts.yml uses ('5m', '1h', '30s'). Mirrors the
 *  shape the operator types in the rule file so the Rules tab matches
 *  the source. */
function formatDuration(seconds: number): string {
  if (seconds <= 0) return '';
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

// Cap so a runaway Alertmanager (or a fleet-wide outage with hundreds
// of rules firing at once) can't blow up the panel render. 100 is
// well past what an operator can usefully scan; beyond that they need
// Alertmanager's own UI for grouping anyway.
const MAX_ALERTS = 100;

// Alertmanager's API is local-network-fast in practice. A 5 s ceiling
// is forgiving enough that a paused-GC blip doesn't trip it, tight
// enough that the UI poll doesn't pile up on a wedged upstream.
const FETCH_TIMEOUT_MS = 5000;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function mapSeverity(raw: unknown): AlertSeverity {
  // Alertmanager doesn't enforce a vocabulary; rules tag whatever they
  // like under `labels.severity`. Our own rules use 'warning'; we map
  // the conventional 'page'/'critical' to critical so an externally-
  // managed rule set drops in without a code change.
  if (raw === 'page' || raw === 'critical') return 'critical';
  if (raw === 'warning') return 'warning';
  return 'info';
}

/** Map one Alertmanager v2 alert into the Console's `Alert` shape.
 *  Returns null when the entry is malformed (missing alertname) so the
 *  route can filter those out rather than fabricate a row.
 *
 *  Exported so route tests can exercise the mapping in isolation, the
 *  same pattern as `mapTransactionsList` in sys-charge-point-transactions. */
export function mapFiringAlert(raw: unknown): FiringAlert | null {
  if (!isObject(raw)) return null;
  const labels = isObject(raw.labels) ? raw.labels : {};
  const annotations = isObject(raw.annotations) ? raw.annotations : {};
  const alertname = labels.alertname;
  if (!isString(alertname) || alertname.length === 0) return null;
  const fingerprint = raw.fingerprint;
  const startsAt = raw.startsAt;
  if (!isString(fingerprint) || !isString(startsAt)) return null;

  const detail =
    (isString(annotations.description) && annotations.description) ||
    (isString(annotations.summary) && annotations.summary) ||
    '';

  const out: FiringAlert = {
    id: fingerprint,
    severity: mapSeverity(labels.severity),
    title: alertname,
    detail,
    since: startsAt,
  };
  if (isString(labels.cp_id) && labels.cp_id.length > 0) {
    out.cp_id = labels.cp_id;
  }
  return out;
}

function mapStatus(raw: unknown): SilenceStatus | null {
  if (!isObject(raw)) return null;
  const state = raw.state;
  if (state === 'active' || state === 'pending' || state === 'expired') return state;
  return null;
}

function mapMatcher(raw: unknown): SilenceMatcher | null {
  if (!isObject(raw)) return null;
  const name = raw.name;
  const value = raw.value;
  if (!isString(name) || !isString(value)) return null;
  // v2 sends booleans as `isRegex` / `isEqual`. We default `is_equal`
  // to true because Alertmanager's own default is "name = value"; the
  // pre-OpenAPI v1 payloads omitted the field entirely.
  const is_regex = raw.isRegex === true;
  const is_equal = raw.isEqual === undefined ? true : raw.isEqual === true;
  return { name, value, is_regex, is_equal };
}

/** Map one Alertmanager v2 GettableSilence into the Console's `Silence`
 *  shape. Returns null when the entry is malformed (no id, no matchers,
 *  unknown status) so the route can drop it rather than fabricate a
 *  row. Status filtering ("drop expired") is done by the route, not
 *  here, so tests can exercise expired-mapping in isolation. */
export function mapSilence(raw: unknown): Silence | null {
  if (!isObject(raw)) return null;
  const id = raw.id;
  if (!isString(id) || id.length === 0) return null;

  const matchersRaw = raw.matchers;
  if (!Array.isArray(matchersRaw)) return null;
  const matchers: SilenceMatcher[] = [];
  for (const m of matchersRaw) {
    const mapped = mapMatcher(m);
    if (mapped) matchers.push(mapped);
  }
  if (matchers.length === 0) return null;

  const startsAt = raw.startsAt;
  const endsAt = raw.endsAt;
  if (!isString(startsAt) || !isString(endsAt)) return null;

  const status = mapStatus(raw.status);
  if (!status) return null;

  return {
    id,
    matchers,
    starts_at: startsAt,
    ends_at: endsAt,
    comment: isString(raw.comment) ? raw.comment : '',
    created_by: isString(raw.createdBy) ? raw.createdBy : '',
    status,
  };
}

// Body-shape validation for POST /sys/alerts/silences. We accept the
// snake_case shape the web client emits and re-shape into v2's camelCase
// at the boundary. `starts_at` and `created_by` are optional in the wire
// shape; the route fills them with `now()` and the JWT subject.
const matcherSchema = z.object({
  name: z.string().min(1).max(256),
  value: z.string().min(1).max(1024),
  is_regex: z.boolean().optional(),
  is_equal: z.boolean().optional(),
});

const createSilenceBody = z.object({
  matchers: z.array(matcherSchema).min(1).max(16),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime(),
  comment: z.string().max(1024).optional(),
  created_by: z.string().min(1).max(256).optional(),
});

// Alertmanager assigns silence IDs as UUIDs; we mirror that shape so a
// junk path segment hits a 400 before we waste an upstream round-trip.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerSysAlertsRoute(app: any, deps: RouteDeps = {}) {
  const requireAuth = async (
    req: { jwtVerify: () => Promise<unknown> },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    return undefined;
  };

  const unavailable = (reason: AlertsUnavailableReason): FiringAlertsResponse => ({
    alerts: [],
    unavailable: true,
    reason,
  });

  app.get('/sys/alerts/firing', { preHandler: requireAuth }, async () => {
    const base = app.config.ALERTMANAGER_URL;
    if (!base) return unavailable('not_configured');

    const url = `${base.replace(/\/+$/, '')}/api/v2/alerts?active=true&silenced=false`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        deps.logger?.warn(
          { upstream: 'alertmanager', status: res.status },
          'firing-alerts.upstream-bad-status',
        );
        return unavailable('unreachable');
      }
      const body: unknown = await res.json();
      if (!Array.isArray(body)) {
        deps.logger?.warn({ upstream: 'alertmanager' }, 'firing-alerts.unexpected-shape');
        return unavailable('unreachable');
      }
      const alerts: FiringAlert[] = [];
      for (const raw of body) {
        const mapped = mapFiringAlert(raw);
        if (mapped) alerts.push(mapped);
      }
      // Slice after mapping so malformed entries can't push real
      // alerts past the cap. No synthetic "truncated" marker — that
      // belongs in the client-derived panel where the alerts are
      // already operator-readable rows; here the operator who needs
      // the 101st row is already in Alertmanager's own UI.
      return { alerts: alerts.slice(0, MAX_ALERTS), unavailable: false };
    } catch (err) {
      deps.logger?.warn(
        { upstream: 'alertmanager', err: err instanceof Error ? err.message : String(err) },
        'firing-alerts.fetch-failed',
      );
      return unavailable('unreachable');
    }
  });

  const silencesUnavailable = (): SilencesResponse => ({ silences: [], unavailable: true });

  // ---- GET /sys/alerts/silences -----------------------------------------
  app.get('/sys/alerts/silences', { preHandler: requireAuth }, async () => {
    const base = app.config.ALERTMANAGER_URL;
    if (!base) return silencesUnavailable();
    const url = `${base.replace(/\/+$/, '')}/api/v2/silences`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        deps.logger?.warn(
          { upstream: 'alertmanager', status: res.status },
          'silences.upstream-bad-status',
        );
        return silencesUnavailable();
      }
      const body: unknown = await res.json();
      if (!Array.isArray(body)) {
        deps.logger?.warn({ upstream: 'alertmanager' }, 'silences.unexpected-shape');
        return silencesUnavailable();
      }
      const silences: Silence[] = [];
      for (const raw of body) {
        const mapped = mapSilence(raw);
        // Expired silences are noise on the panel; the operator's
        // resting question is "what's currently muted?". Filter at
        // the route layer (not in mapSilence) so unit tests can
        // exercise expired-mapping directly.
        if (mapped && mapped.status !== 'expired') silences.push(mapped);
      }
      return { silences, unavailable: false };
    } catch (err) {
      deps.logger?.warn(
        { upstream: 'alertmanager', err: err instanceof Error ? err.message : String(err) },
        'silences.fetch-failed',
      );
      return silencesUnavailable();
    }
  });

  // ---- POST /sys/alerts/silences ----------------------------------------
  app.post(
    '/sys/alerts/silences',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      const parsed = createSilenceBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request', detail: parsed.error.message });
      }
      const base = app.config.ALERTMANAGER_URL;
      if (!base) return silencesUnavailable();

      const sub =
        isObject(req.user) && isString(req.user.sub) && req.user.sub.length > 0
          ? req.user.sub
          : 'unknown';

      // Re-shape into v2's camelCase. Defaults: `startsAt = now`,
      // `createdBy = JWT sub`, `comment = ""`. Booleans on matchers
      // are passed through; absent ones get Alertmanager's documented
      // defaults (isEqual=true, isRegex=false).
      const upstreamBody = {
        matchers: parsed.data.matchers.map((m) => ({
          name: m.name,
          value: m.value,
          isRegex: m.is_regex ?? false,
          isEqual: m.is_equal ?? true,
        })),
        startsAt: parsed.data.starts_at ?? new Date().toISOString(),
        endsAt: parsed.data.ends_at,
        comment: parsed.data.comment ?? '',
        createdBy: parsed.data.created_by ?? sub,
      };

      const url = `${base.replace(/\/+$/, '')}/api/v2/silences`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(upstreamBody),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
          deps.logger?.warn(
            { upstream: 'alertmanager', status: res.status },
            'silence.create.upstream-bad-status',
          );
          return reply.code(200).send({ unavailable: true });
        }
        const body: unknown = await res.json();
        if (!isObject(body) || !isString(body.silenceID)) {
          deps.logger?.warn({ upstream: 'alertmanager' }, 'silence.create.unexpected-shape');
          return reply.code(200).send({ unavailable: true });
        }
        return reply.code(201).send({ id: body.silenceID });
      } catch (err) {
        deps.logger?.warn(
          { upstream: 'alertmanager', err: err instanceof Error ? err.message : String(err) },
          'silence.create.fetch-failed',
        );
        return reply.code(200).send({ unavailable: true });
      }
    },
  );

  // ---- DELETE /sys/alerts/silences/:id ----------------------------------
  app.delete(
    '/sys/alerts/silences/:id',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      const id = isObject(req.params) && isString(req.params.id) ? req.params.id : '';
      if (!UUID_RE.test(id)) {
        return reply.code(400).send({ error: 'invalid_id' });
      }
      const base = app.config.ALERTMANAGER_URL;
      if (!base) return reply.code(200).send({ unavailable: true });
      const url = `${base.replace(/\/+$/, '')}/api/v2/silence/${id}`;
      try {
        const res = await fetch(url, {
          method: 'DELETE',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
          deps.logger?.warn(
            { upstream: 'alertmanager', status: res.status },
            'silence.delete.upstream-bad-status',
          );
          return reply.code(200).send({ unavailable: true });
        }
        return reply.code(204).send();
      } catch (err) {
        deps.logger?.warn(
          { upstream: 'alertmanager', err: err instanceof Error ? err.message : String(err) },
          'silence.delete.fetch-failed',
        );
        return reply.code(200).send({ unavailable: true });
      }
    },
  );

  // ==========================================================================
  // Channels — receiver-config CRUD + test-alert
  // ==========================================================================
  //
  // All four routes 503 when channelsStore isn't wired. That's the
  // "Console didn't enable Channels management on this deployment"
  // path — distinct from the "Alertmanager isn't configured" path
  // covered by ALERTMANAGER_URL. The web side handles both as
  // "Channels tab unavailable" but the codes differ so the operator
  // can tell from the network tab.

  // ---- GET /sys/alerts/channels — list (secrets masked) -------------------
  app.get(
    '/sys/alerts/channels',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_req: any, reply: any) => {
      if (!deps.channelsStore) return reply.code(503).send({ error: 'channels_disabled' });
      try {
        const cfg = await deps.channelsStore.readMasked();
        return reply.code(200).send({
          channels: cfg.channels,
          default_channel: cfg.default_channel,
        });
      } catch (err) {
        deps.logger?.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'channels.read.failed',
        );
        return reply.code(500).send({ error: 'channels_read_failed' });
      }
    },
  );

  // Body shapes — kept as discriminated unions so a `type: 'slack'`
  // body cannot smuggle email fields into the YAML through trailing
  // unknown keys.
  const slackBody = z.object({
    type: z.literal('slack'),
    name: channelNameSchema,
    api_url: z.string().url(),
    channel: z.string().min(1).max(80),
    title: z.string().max(1024).optional(),
    text: z.string().max(4096).optional(),
  });
  // Email recipient (`to`) accepts a single address or a comma-
  // separated list — Alertmanager passes them through to the SMTP
  // RCPT TO. Loose check: every comma-split chunk must contain an
  // `@` with stuff on both sides; tight enough to catch typos,
  // permissive enough not to reject real-world addresses.
  const emailListSchema = z
    .string()
    .min(3)
    .max(1024)
    .refine((v) => v.split(',').every((part) => /\S+@\S+\.\S+/.test(part.trim())), {
      message: 'expected one or more email addresses, comma-separated',
    });
  const emailBody = z.object({
    type: z.literal('email'),
    name: channelNameSchema,
    to: emailListSchema,
    from: z
      .string()
      .min(3)
      .max(256)
      .regex(/\S+@\S+\.\S+/, 'expected an email address'),
    smarthost: z
      .string()
      .min(3)
      .max(256)
      .regex(/^\S+:\d{1,5}$/, 'expected host:port (e.g. smtp.example.com:587)'),
    auth_username: z.string().max(256).optional(),
    auth_password: z.string().max(1024).optional(),
    require_tls: z.boolean().optional(),
  });
  const webhookBody = z.object({
    type: z.literal('webhook'),
    name: channelNameSchema,
    url: z.string().url(),
    http_basic_auth_username: z.string().max(256).optional(),
    http_basic_auth_password: z.string().max(1024).optional(),
    http_bearer_token: z.string().max(4096).optional(),
  });
  const channelBody = z.discriminatedUnion('type', [slackBody, emailBody, webhookBody]);

  // ---- POST /sys/alerts/channels — add ------------------------------------
  app.post(
    '/sys/alerts/channels',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      if (!deps.channelsStore) return reply.code(503).send({ error: 'channels_disabled' });
      const parsed = channelBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.flatten() });
      }
      try {
        const cfg = await deps.channelsStore.read();
        if (cfg.channels.some((c) => c.name === parsed.data.name)) {
          return reply.code(409).send({ error: 'name_taken' });
        }
        const next = await deps.channelsStore.updateChannels(
          [...cfg.channels, parsed.data as Channel],
          // First channel added becomes the default if no default
          // is set yet. Otherwise leave the existing default alone.
          cfg.default_channel || parsed.data.name,
        );
        await reloadAlertmanager(app, deps);
        return reply.code(201).send(maskedResponse(next));
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        deps.logger?.warn({ err: detail }, 'channels.add.failed');
        return reply.code(500).send({ error: 'channels_write_failed', detail });
      }
    },
  );

  // ---- PUT /sys/alerts/channels/:name — replace ---------------------------
  app.put(
    '/sys/alerts/channels/:name',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      if (!deps.channelsStore) return reply.code(503).send({ error: 'channels_disabled' });
      const name = isObject(req.params) && isString(req.params.name) ? req.params.name : '';
      if (!CHANNEL_NAME_RE.test(name)) return reply.code(400).send({ error: 'invalid_name' });
      const parsed = channelBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.flatten() });
      }
      if (parsed.data.name !== name) {
        return reply.code(400).send({ error: 'name_mismatch' });
      }
      try {
        const cfg = await deps.channelsStore.read();
        const idx = cfg.channels.findIndex((c) => c.name === name);
        if (idx < 0) return reply.code(404).send({ error: 'not_found' });
        // Empty-string secrets mean "keep existing" — merge against
        // the current value so the operator doesn't have to re-enter
        // a Slack URL just to change the title.
        const merged = mergeKeepSecrets(cfg.channels[idx]!, parsed.data as Channel);
        const channels = [...cfg.channels];
        channels[idx] = merged;
        const next = await deps.channelsStore.updateChannels(channels, cfg.default_channel);
        await reloadAlertmanager(app, deps);
        return reply.code(200).send(maskedResponse(next));
      } catch (err) {
        deps.logger?.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'channels.put.failed',
        );
        return reply.code(500).send({ error: 'channels_write_failed' });
      }
    },
  );

  // ---- DELETE /sys/alerts/channels/:name — remove -------------------------
  app.delete(
    '/sys/alerts/channels/:name',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      if (!deps.channelsStore) return reply.code(503).send({ error: 'channels_disabled' });
      const name = isObject(req.params) && isString(req.params.name) ? req.params.name : '';
      if (!CHANNEL_NAME_RE.test(name)) return reply.code(400).send({ error: 'invalid_name' });
      try {
        const cfg = await deps.channelsStore.read();
        const remaining = cfg.channels.filter((c) => c.name !== name);
        if (remaining.length === cfg.channels.length) {
          return reply.code(404).send({ error: 'not_found' });
        }
        // If we just removed the current default, fall back to either
        // the first remaining channel or the synthetic null fallback.
        const nextDefault =
          cfg.default_channel === name ? (remaining[0]?.name ?? '') : cfg.default_channel;
        const next = await deps.channelsStore.updateChannels(remaining, nextDefault);
        await reloadAlertmanager(app, deps);
        return reply.code(200).send(maskedResponse(next));
      } catch (err) {
        deps.logger?.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'channels.delete.failed',
        );
        return reply.code(500).send({ error: 'channels_write_failed' });
      }
    },
  );

  // ---- POST /sys/alerts/channels/:name/test — fire a synthetic alert ------
  app.post(
    '/sys/alerts/channels/:name/test',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      if (!deps.channelsStore) return reply.code(503).send({ error: 'channels_disabled' });
      const name = isObject(req.params) && isString(req.params.name) ? req.params.name : '';
      if (!CHANNEL_NAME_RE.test(name)) return reply.code(400).send({ error: 'invalid_name' });
      const base = app.config.ALERTMANAGER_URL;
      if (!base) return reply.code(503).send({ error: 'alertmanager_disabled' });
      try {
        const cfg = await deps.channelsStore.read();
        if (!cfg.channels.some((c) => c.name === name)) {
          return reply.code(404).send({ error: 'not_found' });
        }
        // Inject a synthetic alert with a `receiver` matcher. The
        // managed route block routes by receiver name so the test
        // alert flows only to the named channel. The startsAt-/
        // endsAt window is tight (~2 min) — Alertmanager fires once
        // then resolves quietly.
        const now = new Date();
        const endsAt = new Date(now.getTime() + 120_000);
        const body = [
          {
            labels: {
              alertname: 'ConsoleTestAlert',
              severity: 'info',
              receiver: name,
              fingerprint_marker: `test-${now.getTime()}`,
            },
            annotations: {
              summary: `Console test alert → ${name}`,
              description:
                'Synthetic alert fired from the Console Channels page to verify delivery. ' +
                'If you see this in your channel, the receiver is wired correctly.',
            },
            startsAt: now.toISOString(),
            endsAt: endsAt.toISOString(),
          },
        ];
        const url = `${base.replace(/\/+$/, '')}/api/v2/alerts`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
          deps.logger?.warn(
            { upstream: 'alertmanager', status: res.status },
            'channels.test.upstream-bad-status',
          );
          return reply.code(502).send({ error: 'alertmanager_rejected' });
        }
        return reply.code(202).send({ ok: true });
      } catch (err) {
        deps.logger?.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'channels.test.failed',
        );
        return reply.code(502).send({ error: 'alertmanager_unreachable' });
      }
    },
  );

  // ==========================================================================
  // Default-receiver switch
  // ==========================================================================
  //
  // Updates only ManagedConfig.default_channel, leaves channels untouched.
  // null body clears the default (falls back to the synthetic
  // __console_default__ receiver — alerts fire but go nowhere).

  app.put(
    '/sys/alerts/channels/default',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      if (!deps.channelsStore) return reply.code(503).send({ error: 'channels_disabled' });
      const body = z.object({ name: z.string().nullable() }).safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
      try {
        const cfg = await deps.channelsStore.read();
        const nextName = body.data.name;
        if (nextName !== null && !cfg.channels.some((c) => c.name === nextName)) {
          return reply.code(404).send({ error: 'not_found' });
        }
        const next = await deps.channelsStore.updateChannels(cfg.channels, nextName ?? '');
        await reloadAlertmanager(app, deps);
        return reply.code(200).send(maskedResponse(next));
      } catch (err) {
        deps.logger?.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'channels.default.failed',
        );
        return reply.code(500).send({ error: 'channels_write_failed' });
      }
    },
  );

  // ==========================================================================
  // Rules — read-only proxy of Prometheus's /api/v1/rules
  // ==========================================================================
  //
  // The Rules tab shows what's evaluating. Fail-soft: unavailable
  // envelope on missing config or upstream wobble, same shape as the
  // firing-alerts route.

  app.get(
    '/sys/alerts/rules',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_req: any, reply: any) => {
      const base = app.config.PROMETHEUS_URL;
      if (!base) {
        return reply.code(200).send({ groups: [], unavailable: true });
      }
      try {
        const url = `${String(base).replace(/\/+$/, '')}/api/v1/rules`;
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) {
          deps.logger?.warn(
            { upstream: 'prometheus', status: res.status },
            'rules.upstream-bad-status',
          );
          return reply.code(200).send({ groups: [], unavailable: true });
        }
        const raw = (await res.json()) as unknown;
        return reply.code(200).send(mapRulesResponse(raw));
      } catch (err) {
        deps.logger?.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'rules.fetch-failed',
        );
        return reply.code(200).send({ groups: [], unavailable: true });
      }
    },
  );

  // ==========================================================================
  // Managed Prometheus rules (CRUD on the console-managed group)
  // ==========================================================================
  //
  // The bigger sibling of the read-only `/sys/alerts/rules` route.
  // Every write goes through `promtool check rules` before commit so
  // a bad expression can't break Prometheus. promtool missing on the
  // host (common in dev) downgrades to skipped+warn rather than
  // refusing the write — surfaced to the UI via `validation_skipped`.

  const alertingRuleBody = z.object({
    name: ruleNameSchema,
    expr: z.string().min(1).max(8192),
    // Prometheus accepts durations like `30s`, `5m`, `2h`, `1d`.
    // Empty string means no `for:` (alert fires on first matching scrape).
    duration: z
      .string()
      .max(16)
      .regex(/^$|^\d+(?:ms|s|m|h|d|w|y)$/i, {
        message: 'duration must be a Prometheus duration like 30s, 5m, 2h, 1d',
      }),
    severity: z.enum(['critical', 'warning', 'info']),
    summary: z.string().max(1024),
    description: z.string().max(4096),
  });

  app.get(
    '/sys/alerts/rules/managed',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_req: any, reply: any) => {
      if (!deps.rulesStore) return reply.code(503).send({ error: 'rules_disabled' });
      try {
        const cfg = await deps.rulesStore.read();
        return reply.code(200).send({ managed: cfg.managed });
      } catch (err) {
        deps.logger?.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'rules.managed.read-failed',
        );
        return reply.code(500).send({ error: 'rules_read_failed' });
      }
    },
  );

  app.post(
    '/sys/alerts/rules/managed',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      if (!deps.rulesStore) return reply.code(503).send({ error: 'rules_disabled' });
      const parsed = alertingRuleBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.flatten() });
      }
      try {
        const cfg = await deps.rulesStore.read();
        if (cfg.managed.some((r) => r.name === parsed.data.name)) {
          return reply.code(409).send({ error: 'name_taken' });
        }
        const nextRules = [...cfg.managed, parsed.data as AlertingRule];
        const validation = await deps.rulesStore.validate({
          ...cfg,
          managed: nextRules,
        });
        if (!validation.ok) {
          return reply.code(400).send({ error: 'invalid_rule', detail: validation.error });
        }
        await deps.rulesStore.updateManaged(nextRules);
        await reloadPrometheus(app, deps);
        return reply.code(201).send({
          managed: nextRules,
          ...(validation.skipped ? { validation_skipped: true } : {}),
        });
      } catch (err) {
        deps.logger?.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'rules.managed.add-failed',
        );
        return reply.code(500).send({ error: 'rules_write_failed' });
      }
    },
  );

  app.put(
    '/sys/alerts/rules/managed/:name',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      if (!deps.rulesStore) return reply.code(503).send({ error: 'rules_disabled' });
      const name = isObject(req.params) && isString(req.params.name) ? req.params.name : '';
      if (!RULE_NAME_RE.test(name)) return reply.code(400).send({ error: 'invalid_name' });
      const parsed = alertingRuleBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.flatten() });
      }
      if (parsed.data.name !== name) {
        return reply.code(400).send({ error: 'name_mismatch' });
      }
      try {
        const cfg = await deps.rulesStore.read();
        const idx = cfg.managed.findIndex((r) => r.name === name);
        if (idx < 0) return reply.code(404).send({ error: 'not_found' });
        const nextRules = [...cfg.managed];
        nextRules[idx] = parsed.data as AlertingRule;
        const validation = await deps.rulesStore.validate({ ...cfg, managed: nextRules });
        if (!validation.ok) {
          return reply.code(400).send({ error: 'invalid_rule', detail: validation.error });
        }
        await deps.rulesStore.updateManaged(nextRules);
        await reloadPrometheus(app, deps);
        return reply.code(200).send({
          managed: nextRules,
          ...(validation.skipped ? { validation_skipped: true } : {}),
        });
      } catch (err) {
        deps.logger?.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'rules.managed.put-failed',
        );
        return reply.code(500).send({ error: 'rules_write_failed' });
      }
    },
  );

  app.delete(
    '/sys/alerts/rules/managed/:name',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      if (!deps.rulesStore) return reply.code(503).send({ error: 'rules_disabled' });
      const name = isObject(req.params) && isString(req.params.name) ? req.params.name : '';
      if (!RULE_NAME_RE.test(name)) return reply.code(400).send({ error: 'invalid_name' });
      try {
        const cfg = await deps.rulesStore.read();
        const nextRules = cfg.managed.filter((r) => r.name !== name);
        if (nextRules.length === cfg.managed.length) {
          return reply.code(404).send({ error: 'not_found' });
        }
        // Validate the post-delete file too — a remaining rule that
        // referenced this one (unusual) would fail here.
        const validation = await deps.rulesStore.validate({ ...cfg, managed: nextRules });
        if (!validation.ok) {
          return reply.code(400).send({ error: 'invalid_rule', detail: validation.error });
        }
        await deps.rulesStore.updateManaged(nextRules);
        await reloadPrometheus(app, deps);
        return reply.code(200).send({ managed: nextRules });
      } catch (err) {
        deps.logger?.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'rules.managed.delete-failed',
        );
        return reply.code(500).send({ error: 'rules_write_failed' });
      }
    },
  );
}

// Rule names: Prometheus accepts most strings; we constrain to the
// same shape as channel names so URL segments are safe.
const RULE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/i;
const ruleNameSchema = z.string().regex(RULE_NAME_RE, {
  message: 'name must be alphanumeric with optional -_, up to 63 chars',
});

async function reloadPrometheus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any,
  deps: RouteDeps,
): Promise<void> {
  const base = app.config.PROMETHEUS_URL;
  if (!base) return;
  try {
    const res = await fetch(`${String(base).replace(/\/+$/, '')}/-/reload`, {
      method: 'POST',
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) {
      deps.logger?.warn({ status: res.status }, 'rules.reload.bad-status');
    }
  } catch (err) {
    deps.logger?.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'rules.reload.failed',
    );
  }
}

// Channel names: Alertmanager treats receiver names as YAML strings;
// in practice they're short alphanumerics with - and _ to keep them
// safe in route matchers and config-file output. Enforce here too so
// the API surface can't smuggle in unsafe characters.
const CHANNEL_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/i;
const channelNameSchema = z.string().regex(CHANNEL_NAME_RE, {
  message: 'name must be alphanumeric with optional -_, up to 63 chars',
});

// Map a masked-empty secret back to the live one so PUT can update
// non-secret fields without forcing the operator to re-enter the
// Slack URL / SMTP password every time. The masked form from
// readMasked() will not round-trip equal to the live value; that's
// fine because the empty-string variant is what the form sends when
// the user didn't touch the field.
function mergeKeepSecrets(current: Channel, next: Channel): Channel {
  if (current.type !== next.type) return next;
  switch (next.type) {
    case 'slack':
      return {
        ...next,
        api_url:
          next.api_url && !next.api_url.includes('••••')
            ? next.api_url
            : (current as Extract<Channel, { type: 'slack' }>).api_url,
      };
    case 'email': {
      const cur = current as Extract<Channel, { type: 'email' }>;
      const out: Channel = { ...next };
      // empty-string or masked → keep existing
      if (!next.auth_password || next.auth_password.includes('••••')) {
        if (cur.auth_password) out.auth_password = cur.auth_password;
        else delete (out as { auth_password?: string }).auth_password;
      }
      return out;
    }
    case 'webhook': {
      const cur = current as Extract<Channel, { type: 'webhook' }>;
      const out: Channel = {
        ...next,
        url: next.url && !next.url.includes('••••') ? next.url : cur.url,
      };
      if (!next.http_basic_auth_password || next.http_basic_auth_password.includes('••••')) {
        if (cur.http_basic_auth_password)
          out.http_basic_auth_password = cur.http_basic_auth_password;
        else delete (out as { http_basic_auth_password?: string }).http_basic_auth_password;
      }
      if (!next.http_bearer_token || next.http_bearer_token.includes('••••')) {
        if (cur.http_bearer_token) out.http_bearer_token = cur.http_bearer_token;
        else delete (out as { http_bearer_token?: string }).http_bearer_token;
      }
      return out;
    }
  }
}

function maskedResponse(cfg: ManagedConfig): { channels: Channel[]; default_channel: string } {
  // Re-run the masking step on the in-memory config rather than
  // re-reading from disk — same result, no I/O.
  return {
    channels: cfg.channels.map(maskSecrets),
    default_channel: cfg.default_channel,
  };
}

// Best-effort reload: POSTs to Alertmanager's lifecycle endpoint.
// Failures log a warning but don't fail the write — the file is
// already persisted; the next time the operator hits a config-affecting
// endpoint we'll try again. The 1s budget keeps the UI snappy when
// Alertmanager is wedged.
async function reloadAlertmanager(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any,
  deps: RouteDeps,
): Promise<void> {
  const base = app.config.ALERTMANAGER_URL;
  if (!base) return;
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/-/reload`, {
      method: 'POST',
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) {
      deps.logger?.warn({ status: res.status }, 'channels.reload.bad-status');
    }
  } catch (err) {
    deps.logger?.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'channels.reload.failed',
    );
  }
}
