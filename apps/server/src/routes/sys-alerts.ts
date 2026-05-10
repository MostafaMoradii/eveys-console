// Proxies Alertmanager's v2 firing-alerts query for the Console UI's
// "Firing alerts" panel. The browser never talks to Alertmanager
// directly — the Console mediates so JWT auth and CORS stay uniform
// with the other `/sys/...` surfaces.
//
// View-only and fail-soft by design: any upstream wobble (timeout,
// non-2xx, parse error, missing config) collapses to
// `{ alerts: [], unavailable: true }` with HTTP 200. The panel renders
// a single muted "Alertmanager not configured" row in that case —
// the operator's resting expectation is "no alerts" anyway, and a 503
// would just produce an error toast that drowns the actually-useful
// hint.

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
}
