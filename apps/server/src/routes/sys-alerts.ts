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

// Mirror of the web side's `AlertSeverity` (see apps/web/src/lib/alerts.ts).
// Kept as a local literal so the server doesn't pull a web type. The
// /sys/alerts/firing response is JSON; the web client narrows it back
// into its own `Alert` at the boundary.
type AlertSeverity = 'critical' | 'warning' | 'info';

interface RouteDeps {
  // logger is optional so the existing test harness (which builds the
  // app with `logger: false`) can omit it without typing gymnastics.
  logger?: { warn: (obj: unknown, msg?: string) => void };
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

export interface FiringAlertsResponse {
  alerts: FiringAlert[];
  unavailable: boolean;
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

  const unavailable = (): FiringAlertsResponse => ({ alerts: [], unavailable: true });

  app.get('/sys/alerts/firing', { preHandler: requireAuth }, async () => {
    const base = app.config.ALERTMANAGER_URL;
    if (!base) return unavailable();

    const url = `${base.replace(/\/+$/, '')}/api/v2/alerts?active=true&silenced=false`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        deps.logger?.warn(
          { upstream: 'alertmanager', status: res.status },
          'firing-alerts.upstream-bad-status',
        );
        return unavailable();
      }
      const body: unknown = await res.json();
      if (!Array.isArray(body)) {
        deps.logger?.warn({ upstream: 'alertmanager' }, 'firing-alerts.unexpected-shape');
        return unavailable();
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
      return unavailable();
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
}
