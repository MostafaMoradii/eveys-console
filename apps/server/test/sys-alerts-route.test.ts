// Route tests for the firing-alerts proxy. The proxy is fail-soft by
// design — any upstream wobble should collapse to
// `{ alerts: [], unavailable: true }` so the panel shows its hint
// instead of an error toast. These tests pin that contract along
// with the v2-response → Console-Alert mapping and severity-label
// translation.

import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mapFiringAlert, mapSilence, registerSysAlertsRoute } from '../src/routes/sys-alerts.js';
import { ChannelsStore } from '../src/store/channels-store.js';

const JWT_SECRET = 'a-test-secret-of-at-least-16-bytes';

interface BuildOptions {
  alertmanagerUrl?: string;
  channelsStore?: ChannelsStore;
}

async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  // Just enough config for the route to read ALERTMANAGER_URL off it.
  app.decorate('config', {
    ALERTMANAGER_URL: opts.alertmanagerUrl,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  const deps: { channelsStore?: ChannelsStore } = {};
  if (opts.channelsStore) deps.channelsStore = opts.channelsStore;
  await registerSysAlertsRoute(app, deps);
  await app.ready();
  return app;
}

function authHeader(app: FastifyInstance): string {
  const token = app.jwt.sign({ sub: 'tester' });
  return `Bearer ${token}`;
}

interface MinimalResponseInit {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
  /** Optional. The new reloadAlertmanager helper reads the body on
   *  failure to surface a useful detail (Alertmanager returns a
   *  plain-text error like `undefined receiver "X" used in route`).
   *  Mocks that don't set this get an empty string. */
  text?: () => Promise<string>;
}

function mockFetchOnce(impl: () => Promise<MinimalResponseInit> | MinimalResponseInit) {
  // node:fetch is on globalThis in Node 20; replace it for the duration
  // of the test. Restore after each test via the afterEach below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = vi.fn(async () => {
    const out = await impl();
    if (!out.text) out.text = async () => '';
    return out;
  });
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('GET /sys/alerts/firing', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    // Each test rebuilds the app explicitly so the ALERTMANAGER_URL
    // context is unambiguous.
  });

  it('returns 401 without a JWT', async () => {
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({ method: 'GET', url: '/sys/alerts/firing' });
    expect(res.statusCode).toBe(401);
  });

  it('returns unavailable when ALERTMANAGER_URL is unset (no upstream call)', async () => {
    app = await buildApp({});
    const spy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = spy;
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/firing',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      alerts: [],
      unavailable: true,
      reason: 'not_configured',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps a healthy v2 response to the Console Alert shape', async () => {
    mockFetchOnce(() => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          fingerprint: 'fp-1',
          startsAt: '2026-05-10T11:00:00.000Z',
          labels: { alertname: 'ConsoleDown', severity: 'warning', cp_id: 'CP_A' },
          annotations: { summary: 'Console scrape failing', description: 'no scrape for 1m' },
        },
        {
          fingerprint: 'fp-2',
          startsAt: '2026-05-10T11:05:00.000Z',
          labels: { alertname: 'GatewayDown', severity: 'critical' },
          annotations: { summary: 'Gateway scrape failing' },
        },
      ],
    }));

    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/firing',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      alerts: [
        {
          id: 'fp-1',
          severity: 'warning',
          title: 'ConsoleDown',
          detail: 'no scrape for 1m',
          since: '2026-05-10T11:00:00.000Z',
          cp_id: 'CP_A',
        },
        {
          id: 'fp-2',
          severity: 'critical',
          title: 'GatewayDown',
          detail: 'Gateway scrape failing',
          since: '2026-05-10T11:05:00.000Z',
        },
      ],
      unavailable: false,
    });
  });

  it('returns unavailable on upstream 500', async () => {
    mockFetchOnce(() => ({ ok: false, status: 500, json: async () => ({}) }));
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/firing',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ alerts: [], unavailable: true, reason: 'unreachable' });
  });

  it('returns unavailable on network error (rejected fetch)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/firing',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ alerts: [], unavailable: true, reason: 'unreachable' });
  });

  it('returns unavailable when the upstream body is not an array (malformed)', async () => {
    mockFetchOnce(() => ({
      ok: true,
      status: 200,
      json: async () => ({ alerts: 'not-an-array' }),
    }));
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/firing',
      headers: { authorization: authHeader(app) },
    });
    expect(res.json()).toEqual({ alerts: [], unavailable: true, reason: 'unreachable' });
  });

  it('returns unavailable when the JSON parse itself throws', async () => {
    mockFetchOnce(() => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('unexpected token');
      },
    }));
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/firing',
      headers: { authorization: authHeader(app) },
    });
    expect(res.json()).toEqual({ alerts: [], unavailable: true, reason: 'unreachable' });
  });

  it('truncates at 100 alerts with no synthetic marker', async () => {
    const many = Array.from({ length: 150 }).map((_, i) => ({
      fingerprint: `fp-${i}`,
      startsAt: '2026-05-10T11:00:00.000Z',
      labels: { alertname: `Rule${i}`, severity: 'warning' },
      annotations: { summary: `s${i}` },
    }));
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => many }));
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/firing',
      headers: { authorization: authHeader(app) },
    });
    const body = res.json() as {
      alerts: Array<{ id: string; title: string }>;
      unavailable: boolean;
    };
    expect(body.unavailable).toBe(false);
    expect(body.alerts).toHaveLength(100);
    // First 100 by index, last one is `fp-99`. No synthetic
    // `truncated` row.
    expect(body.alerts[0]!.id).toBe('fp-0');
    expect(body.alerts[99]!.id).toBe('fp-99');
    expect(body.alerts.find((a) => a.title === 'alerts-truncated')).toBeUndefined();
  });

  it('hits the correct upstream URL with the active+unsilenced query', async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = spy;
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093/' });
    await app.inject({
      method: 'GET',
      url: '/sys/alerts/firing',
      headers: { authorization: authHeader(app) },
    });
    expect(spy).toHaveBeenCalledOnce();
    const url = spy.mock.calls[0]![0];
    expect(url).toBe('http://alertmanager:9093/api/v2/alerts?active=true&silenced=false');
  });
});

describe('mapFiringAlert', () => {
  const valid = {
    fingerprint: 'fp-x',
    startsAt: '2026-05-10T11:00:00.000Z',
    labels: { alertname: 'Foo', severity: 'warning' },
    annotations: { summary: 'foo summary', description: 'foo detail' },
  };

  it('prefers annotations.description over summary', () => {
    expect(mapFiringAlert(valid)?.detail).toBe('foo detail');
  });

  it('falls back to summary when description is missing', () => {
    expect(mapFiringAlert({ ...valid, annotations: { summary: 'just summary' } })?.detail).toBe(
      'just summary',
    );
  });

  it('uses empty detail when neither description nor summary is set', () => {
    expect(mapFiringAlert({ ...valid, annotations: {} })?.detail).toBe('');
  });

  it('returns null when labels.alertname is missing', () => {
    expect(mapFiringAlert({ ...valid, labels: { severity: 'warning' } })).toBeNull();
  });

  it('returns null when labels.alertname is an empty string', () => {
    expect(mapFiringAlert({ ...valid, labels: { alertname: '', severity: 'warning' } })).toBeNull();
  });

  it('returns null on a non-object input', () => {
    expect(mapFiringAlert(null)).toBeNull();
    expect(mapFiringAlert('not-an-object')).toBeNull();
    expect(mapFiringAlert(42)).toBeNull();
  });

  it('returns null when fingerprint is missing', () => {
    const { fingerprint: _fp, ...rest } = valid;
    expect(mapFiringAlert(rest)).toBeNull();
  });

  it('returns null when startsAt is missing', () => {
    const { startsAt: _s, ...rest } = valid;
    expect(mapFiringAlert(rest)).toBeNull();
  });

  it('maps severity page → critical', () => {
    expect(
      mapFiringAlert({ ...valid, labels: { ...valid.labels, severity: 'page' } })?.severity,
    ).toBe('critical');
  });

  it('maps severity critical → critical', () => {
    expect(
      mapFiringAlert({ ...valid, labels: { ...valid.labels, severity: 'critical' } })?.severity,
    ).toBe('critical');
  });

  it('maps severity warning → warning', () => {
    expect(
      mapFiringAlert({ ...valid, labels: { ...valid.labels, severity: 'warning' } })?.severity,
    ).toBe('warning');
  });

  it('maps any other severity to info', () => {
    expect(
      mapFiringAlert({ ...valid, labels: { ...valid.labels, severity: 'low' } })?.severity,
    ).toBe('info');
    expect(mapFiringAlert({ ...valid, labels: { alertname: 'Foo' } })?.severity).toBe('info');
  });

  it('attaches cp_id when present and non-empty', () => {
    expect(mapFiringAlert({ ...valid, labels: { ...valid.labels, cp_id: 'CP_A' } })?.cp_id).toBe(
      'CP_A',
    );
  });

  it('omits cp_id when absent or empty', () => {
    expect(mapFiringAlert(valid)?.cp_id).toBeUndefined();
    expect(
      mapFiringAlert({ ...valid, labels: { ...valid.labels, cp_id: '' } })?.cp_id,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Silences
// ---------------------------------------------------------------------------

describe('GET /sys/alerts/silences', () => {
  let app: FastifyInstance;

  it('returns 401 without a JWT', async () => {
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({ method: 'GET', url: '/sys/alerts/silences' });
    expect(res.statusCode).toBe(401);
  });

  it('returns unavailable when ALERTMANAGER_URL is unset (no upstream call)', async () => {
    app = await buildApp({});
    const spy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = spy;
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/silences',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ silences: [], unavailable: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps active + pending silences and drops expired ones', async () => {
    mockFetchOnce(() => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: '11111111-2222-3333-4444-555555555555',
          status: { state: 'active' },
          matchers: [{ name: 'alertname', value: 'ConsoleDown', isRegex: false, isEqual: true }],
          startsAt: '2026-05-10T11:00:00.000Z',
          endsAt: '2026-05-10T13:00:00.000Z',
          comment: 'silencing during deploy',
          createdBy: 'alice',
        },
        {
          id: '22222222-3333-4444-5555-666666666666',
          status: { state: 'pending' },
          matchers: [{ name: 'fingerprint', value: 'abc123', isRegex: false, isEqual: true }],
          startsAt: '2026-05-10T12:00:00.000Z',
          endsAt: '2026-05-10T14:00:00.000Z',
          comment: '',
          createdBy: 'bob',
        },
        {
          id: '33333333-4444-5555-6666-777777777777',
          status: { state: 'expired' },
          matchers: [{ name: 'alertname', value: 'OldThing' }],
          startsAt: '2026-05-09T10:00:00.000Z',
          endsAt: '2026-05-09T11:00:00.000Z',
          comment: 'old',
          createdBy: 'carol',
        },
      ],
    }));

    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/silences',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      silences: Array<{ id: string; status: string }>;
      unavailable: boolean;
    };
    expect(body.unavailable).toBe(false);
    expect(body.silences).toHaveLength(2);
    expect(body.silences.map((s) => s.status)).toEqual(['active', 'pending']);
    expect(body.silences[0]).toEqual({
      id: '11111111-2222-3333-4444-555555555555',
      matchers: [{ name: 'alertname', value: 'ConsoleDown', is_regex: false, is_equal: true }],
      starts_at: '2026-05-10T11:00:00.000Z',
      ends_at: '2026-05-10T13:00:00.000Z',
      comment: 'silencing during deploy',
      created_by: 'alice',
      status: 'active',
    });
  });

  it('returns unavailable on upstream 500', async () => {
    mockFetchOnce(() => ({ ok: false, status: 500, json: async () => ({}) }));
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/silences',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ silences: [], unavailable: true });
  });

  it('returns unavailable on network error', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/silences',
      headers: { authorization: authHeader(app) },
    });
    expect(res.json()).toEqual({ silences: [], unavailable: true });
  });
});

describe('POST /sys/alerts/silences', () => {
  let app: FastifyInstance;

  it('returns 401 without a JWT', async () => {
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({ method: 'POST', url: '/sys/alerts/silences', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an empty body', async () => {
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'POST',
      url: '/sys/alerts/silences',
      headers: { authorization: authHeader(app) },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects matchers with empty strings', async () => {
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'POST',
      url: '/sys/alerts/silences',
      headers: { authorization: authHeader(app) },
      payload: {
        matchers: [{ name: '', value: 'x' }],
        ends_at: '2026-05-10T13:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('forwards a valid body and returns the upstream id', async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ silenceID: 'abc-uuid' }),
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = spy;

    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'POST',
      url: '/sys/alerts/silences',
      headers: { authorization: authHeader(app) },
      payload: {
        matchers: [{ name: 'fingerprint', value: 'fp-1', is_regex: false, is_equal: true }],
        starts_at: '2026-05-10T11:00:00.000Z',
        ends_at: '2026-05-10T13:00:00.000Z',
        comment: 'because',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: 'abc-uuid' });

    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('http://alertmanager:9093/api/v2/silences');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      matchers: [{ name: 'fingerprint', value: 'fp-1', isRegex: false, isEqual: true }],
      startsAt: '2026-05-10T11:00:00.000Z',
      endsAt: '2026-05-10T13:00:00.000Z',
      comment: 'because',
      createdBy: 'tester',
    });
  });

  it('defaults starts_at to now and created_by to the JWT sub when omitted', async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ silenceID: 'new-id' }),
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = spy;

    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const before = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/sys/alerts/silences',
      headers: { authorization: authHeader(app) },
      payload: {
        matchers: [{ name: 'alertname', value: 'ConsoleDown' }],
        ends_at: '2026-05-10T13:00:00.000Z',
      },
    });
    const after = Date.now();
    expect(res.statusCode).toBe(201);

    const body = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.createdBy).toBe('tester');
    const startsMs = new Date(body.startsAt).getTime();
    expect(startsMs).toBeGreaterThanOrEqual(before);
    expect(startsMs).toBeLessThanOrEqual(after);
    // Matcher defaults filled in.
    expect(body.matchers[0]).toEqual({
      name: 'alertname',
      value: 'ConsoleDown',
      isRegex: false,
      isEqual: true,
    });
  });

  it('returns unavailable when ALERTMANAGER_URL is unset', async () => {
    app = await buildApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/sys/alerts/silences',
      headers: { authorization: authHeader(app) },
      payload: {
        matchers: [{ name: 'alertname', value: 'ConsoleDown' }],
        ends_at: '2026-05-10T13:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ silences: [], unavailable: true });
  });

  it('returns unavailable on upstream 500', async () => {
    mockFetchOnce(() => ({ ok: false, status: 500, json: async () => ({}) }));
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'POST',
      url: '/sys/alerts/silences',
      headers: { authorization: authHeader(app) },
      payload: {
        matchers: [{ name: 'alertname', value: 'ConsoleDown' }],
        ends_at: '2026-05-10T13:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ unavailable: true });
  });

  it('returns unavailable on upstream malformed body (no silenceID)', async () => {
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => ({ wrong: 'shape' }) }));
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'POST',
      url: '/sys/alerts/silences',
      headers: { authorization: authHeader(app) },
      payload: {
        matchers: [{ name: 'alertname', value: 'ConsoleDown' }],
        ends_at: '2026-05-10T13:00:00.000Z',
      },
    });
    expect(res.json()).toEqual({ unavailable: true });
  });
});

describe('DELETE /sys/alerts/silences/:id', () => {
  let app: FastifyInstance;

  it('returns 401 without a JWT', async () => {
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/sys/alerts/silences/11111111-2222-3333-4444-555555555555',
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a non-UUID id with 400', async () => {
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/sys/alerts/silences/not-a-uuid',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 204 on upstream 200', async () => {
    const spy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = spy;

    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/sys/alerts/silences/11111111-2222-3333-4444-555555555555',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(204);
    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe(
      'http://alertmanager:9093/api/v2/silence/11111111-2222-3333-4444-555555555555',
    );
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('returns unavailable on upstream 500', async () => {
    mockFetchOnce(() => ({ ok: false, status: 500, json: async () => ({}) }));
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/sys/alerts/silences/11111111-2222-3333-4444-555555555555',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ unavailable: true });
  });

  it('returns unavailable on network error', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/sys/alerts/silences/11111111-2222-3333-4444-555555555555',
      headers: { authorization: authHeader(app) },
    });
    expect(res.json()).toEqual({ unavailable: true });
  });
});

describe('mapSilence', () => {
  const valid = {
    id: 'abcdef01-2345-6789-abcd-ef0123456789',
    status: { state: 'active' },
    matchers: [{ name: 'alertname', value: 'ConsoleDown', isRegex: false, isEqual: true }],
    startsAt: '2026-05-10T11:00:00.000Z',
    endsAt: '2026-05-10T13:00:00.000Z',
    comment: 'because',
    createdBy: 'alice',
  };

  it('maps the v2 shape into the Console shape', () => {
    expect(mapSilence(valid)).toEqual({
      id: 'abcdef01-2345-6789-abcd-ef0123456789',
      matchers: [{ name: 'alertname', value: 'ConsoleDown', is_regex: false, is_equal: true }],
      starts_at: '2026-05-10T11:00:00.000Z',
      ends_at: '2026-05-10T13:00:00.000Z',
      comment: 'because',
      created_by: 'alice',
      status: 'active',
    });
  });

  it('preserves expired status (filtering is the route layer)', () => {
    const expired = { ...valid, status: { state: 'expired' } };
    expect(mapSilence(expired)?.status).toBe('expired');
  });

  it('returns null on non-object input', () => {
    expect(mapSilence(null)).toBeNull();
    expect(mapSilence('x')).toBeNull();
    expect(mapSilence(42)).toBeNull();
  });

  it('returns null when id is missing or empty', () => {
    expect(mapSilence({ ...valid, id: '' })).toBeNull();
    const { id: _id, ...rest } = valid;
    expect(mapSilence(rest)).toBeNull();
  });

  it('returns null when matchers is missing or empty', () => {
    expect(mapSilence({ ...valid, matchers: [] })).toBeNull();
    expect(mapSilence({ ...valid, matchers: 'nope' })).toBeNull();
  });

  it('returns null when startsAt or endsAt is missing', () => {
    const { startsAt: _s, ...noStarts } = valid;
    const { endsAt: _e, ...noEnds } = valid;
    expect(mapSilence(noStarts)).toBeNull();
    expect(mapSilence(noEnds)).toBeNull();
  });

  it('returns null on unknown status', () => {
    expect(mapSilence({ ...valid, status: { state: 'mystery' } })).toBeNull();
    expect(mapSilence({ ...valid, status: null })).toBeNull();
  });

  it('defaults comment and createdBy when absent', () => {
    const { comment: _c, createdBy: _cb, ...rest } = valid;
    const out = mapSilence(rest);
    expect(out?.comment).toBe('');
    expect(out?.created_by).toBe('');
  });

  it('defaults is_equal to true when the upstream omits isEqual', () => {
    const out = mapSilence({
      ...valid,
      matchers: [{ name: 'alertname', value: 'ConsoleDown' }],
    });
    expect(out?.matchers[0]).toEqual({
      name: 'alertname',
      value: 'ConsoleDown',
      is_regex: false,
      is_equal: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Channels routes
// ---------------------------------------------------------------------------

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function buildChannelsApp(opts?: { alertmanagerUrl?: string }): Promise<{
  app: FastifyInstance;
  store: ChannelsStore;
  dir: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'channels-route-'));
  const store = new ChannelsStore(join(dir, 'managed.yml'));
  // Default to a fake AM URL so the reload helper exercises the
  // fetch path; pass an empty string to opt out (skipped-reload path).
  const alertmanagerUrl =
    opts?.alertmanagerUrl === undefined ? 'http://alertmanager:9093' : opts.alertmanagerUrl;
  const app = await buildApp({
    alertmanagerUrl,
    channelsStore: store,
  });
  return { app, store, dir };
}

describe('Channels routes — disabled when no store is wired', () => {
  it('returns 503 from GET when channelsStore is missing', async () => {
    const app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

describe('GET /sys/alerts/channels', () => {
  let ctx: Awaited<ReturnType<typeof buildChannelsApp>>;
  beforeEach(async () => {
    ctx = await buildChannelsApp();
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('returns 401 without a JWT', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/sys/alerts/channels' });
    expect(res.statusCode).toBe(401);
  });

  it('returns an empty list when the file does not exist', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ channels: [], default_channel: '' });
  });

  it('returns receivers with secrets masked', async () => {
    await ctx.store.updateChannels(
      [
        {
          type: 'slack',
          name: 'ops',
          api_url: 'https://hooks.slack.com/services/T1/B2/THE-SECRET-TOKEN-tail',
          channel: '#a',
        },
      ],
      'ops',
    );
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
    });
    const body = res.json() as { channels: Array<{ api_url: string }> };
    expect(body.channels[0]?.api_url).not.toContain('THE-SECRET-TOKEN');
    expect(body.channels[0]?.api_url).toContain('••••');
  });
});

describe('POST /sys/alerts/channels', () => {
  let ctx: Awaited<ReturnType<typeof buildChannelsApp>>;
  beforeEach(async () => {
    ctx = await buildChannelsApp();
    // Don't actually call Alertmanager's /-/reload in tests.
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => ({}) }));
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('rejects an invalid body shape', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: { type: 'slack' /* missing api_url, channel, name */ },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates a Slack receiver and persists it', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'slack',
        name: 'ops',
        api_url: 'https://hooks.slack.com/services/T1/B2/abc123def-tail',
        channel: '#ocpp-alerts',
      },
    });
    expect(res.statusCode).toBe(201);
    const cfg = await ctx.store.read();
    expect(cfg.channels).toHaveLength(1);
    expect(cfg.channels[0]?.name).toBe('ops');
    expect(cfg.default_channel).toBe('ops');
  });

  it('rejects a duplicate name with 409', async () => {
    await ctx.store.updateChannels(
      [{ type: 'slack', name: 'ops', api_url: 'https://hooks/x', channel: '#a' }],
      'ops',
    );
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'slack',
        name: 'ops',
        api_url: 'https://hooks/y',
        channel: '#b',
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects an unsafe name', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'slack',
        name: '../etc/passwd',
        api_url: 'https://hooks/x',
        channel: '#a',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates an email receiver with a valid address', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'email',
        name: 'oncall-email',
        to: 'oncall@example.com',
        from: 'alerts@example.com',
        smarthost: 'smtp.example.com:587',
        require_tls: true,
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('accepts a comma-separated to-list', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'email',
        name: 'rota',
        to: 'a@example.com, b@example.com',
        from: 'alerts@example.com',
        smarthost: 'smtp.example.com:587',
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects a malformed smarthost with a field-level detail message', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'email',
        name: 'bad-smtp',
        to: 'oncall@example.com',
        from: 'alerts@example.com',
        smarthost: 'smtp.example.com', // missing :port
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as {
      error: string;
      detail: { fieldErrors?: Record<string, string[]> };
    };
    expect(body.error).toBe('invalid_body');
    expect(body.detail.fieldErrors?.smarthost?.[0]).toMatch(/host:port/);
  });

  it('creates a webhook receiver with a bearer token', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'webhook',
        name: 'opsgenie',
        url: 'https://api.opsgenie.com/v1/json/alertmanager',
        http_bearer_token: 'eyJhbGciOi-fake-jwt',
      },
    });
    expect(res.statusCode).toBe(201);
    const cfg = await ctx.store.read();
    const wh = cfg.channels[0] as Extract<(typeof cfg.channels)[number], { type: 'webhook' }>;
    expect(wh.http_bearer_token).toBe('eyJhbGciOi-fake-jwt');
  });

  it('creates a Telegram receiver', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'telegram',
        name: 'oncall-tg',
        bot_token: '12345:AAEFxyz_fake_token_tail_9999',
        chat_id: '-1001234567890',
        parse_mode: 'HTML',
      },
    });
    expect(res.statusCode).toBe(201);
    const cfg = await ctx.store.read();
    const tg = cfg.channels[0] as Extract<(typeof cfg.channels)[number], { type: 'telegram' }>;
    expect(tg.bot_token).toBe('12345:AAEFxyz_fake_token_tail_9999');
    expect(tg.chat_id).toBe('-1001234567890');
    expect(tg.parse_mode).toBe('HTML');
  });

  it('rejects a Telegram bot_token that does not match `<bot_id>:<token>`', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'telegram',
        name: 'tg-bad-token',
        bot_token: 'just-a-string',
        chat_id: '-100123',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as {
      error: string;
      detail: { fieldErrors?: Record<string, string[]> };
    };
    expect(body.error).toBe('invalid_body');
    expect(body.detail.fieldErrors?.bot_token?.[0]).toMatch(/BotFather/);
  });

  it('rejects a Telegram chat_id that is not numeric', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'telegram',
        name: 'tg-bad-chat',
        bot_token: '12345:AAEFxyz_fake_token_tail_9999',
        chat_id: 'not-numeric',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as {
      error: string;
      detail: { fieldErrors?: Record<string, string[]> };
    };
    expect(body.detail.fieldErrors?.chat_id?.[0]).toMatch(/numeric chat id/);
  });
});

// The `reload` field on channel-write responses is how the UI learns
// that the on-disk write succeeded but Alertmanager refused the new
// config. Without it the operator sees "saved" and silently keeps
// hitting the previously-loaded config — the symptom that motivated
// this whole change (Telegram saved → alerts kept going to email).
describe('channel writes surface the Alertmanager /-/reload outcome', () => {
  let ctx: Awaited<ReturnType<typeof buildChannelsApp>>;
  beforeEach(async () => {
    ctx = await buildChannelsApp();
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('omits `reload` on the response when the reload succeeded (happy path)', async () => {
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => ({}) }));
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'slack',
        name: 'ops',
        api_url: 'https://hooks/x',
        channel: '#a',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { channels: unknown[]; reload?: unknown };
    expect(body.reload).toBeUndefined();
  });

  it('includes `reload.detail` from Alertmanager body when reload returns non-2xx', async () => {
    mockFetchOnce(() => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'failed to reload config: undefined receiver "tg" used in route',
    }));
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'slack',
        name: 'ops',
        api_url: 'https://hooks/x',
        channel: '#a',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      reload?: { ok: boolean; status?: number; detail: string; skipped?: boolean };
    };
    expect(body.reload).toBeDefined();
    expect(body.reload?.ok).toBe(false);
    expect(body.reload?.status).toBe(500);
    expect(body.reload?.detail).toContain('undefined receiver');
  });

  it('marks the reload as skipped when ALERTMANAGER_URL is not configured (dev / tests)', async () => {
    // Rebuild the app without ALERTMANAGER_URL — reload helper short-
    // circuits before any fetch.
    await ctx.app.close();
    await rm(ctx.dir, { recursive: true, force: true });
    ctx = await buildChannelsApp({ alertmanagerUrl: '' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'slack',
        name: 'ops',
        api_url: 'https://hooks/x',
        channel: '#a',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      reload?: { ok: boolean; skipped?: boolean; detail: string };
    };
    expect(body.reload?.skipped).toBe(true);
    expect(body.reload?.detail).toBe('alertmanager_url_not_configured');
  });

  it('still persists the write to disk even when reload fails (config + runtime can diverge; UI signals the operator)', async () => {
    mockFetchOnce(() => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'boom',
    }));
    await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'slack',
        name: 'ops',
        api_url: 'https://hooks/x',
        channel: '#a',
      },
    });
    const cfg = await ctx.store.read();
    expect(cfg.channels).toHaveLength(1);
    expect(cfg.channels[0]?.name).toBe('ops');
  });
});

describe('PUT /sys/alerts/channels/:name', () => {
  let ctx: Awaited<ReturnType<typeof buildChannelsApp>>;
  beforeEach(async () => {
    ctx = await buildChannelsApp();
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => ({}) }));
    await ctx.store.updateChannels(
      [
        {
          type: 'slack',
          name: 'ops',
          api_url: 'https://hooks.slack.com/services/T1/B2/REAL-SECRET',
          channel: '#a',
          title: 'old title',
        },
      ],
      'ops',
    );
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('updates non-secret fields and keeps the existing api_url when the body sends a masked value', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/sys/alerts/channels/ops',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'slack',
        name: 'ops',
        api_url: 'https://hooks.slack.com••••CRET',
        channel: '#ocpp',
        title: 'new title',
      },
    });
    expect(res.statusCode).toBe(200);
    const cfg = await ctx.store.read();
    const ch = cfg.channels[0] as {
      type: 'slack';
      api_url: string;
      title?: string;
      channel: string;
    };
    expect(ch.api_url).toBe('https://hooks.slack.com/services/T1/B2/REAL-SECRET');
    expect(ch.title).toBe('new title');
    expect(ch.channel).toBe('#ocpp');
  });

  it('replaces the api_url when the body sends a fresh non-masked value', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/sys/alerts/channels/ops',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'slack',
        name: 'ops',
        api_url: 'https://hooks.slack.com/services/T1/B2/NEW-SECRET',
        channel: '#a',
      },
    });
    expect(res.statusCode).toBe(200);
    const cfg = await ctx.store.read();
    const ch = cfg.channels[0] as { type: 'slack'; api_url: string };
    expect(ch.api_url).toBe('https://hooks.slack.com/services/T1/B2/NEW-SECRET');
  });

  it('returns 400 when path name and body name disagree', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/sys/alerts/channels/ops',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'slack',
        name: 'other',
        api_url: 'https://hooks/x',
        channel: '#a',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the named channel does not exist', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/sys/alerts/channels/ghost',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'slack',
        name: 'ghost',
        api_url: 'https://hooks/x',
        channel: '#a',
      },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /sys/alerts/channels/:name', () => {
  let ctx: Awaited<ReturnType<typeof buildChannelsApp>>;
  beforeEach(async () => {
    ctx = await buildChannelsApp();
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => ({}) }));
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('removes the named channel', async () => {
    await ctx.store.updateChannels(
      [
        { type: 'slack', name: 'a', api_url: 'https://hooks/x', channel: '#a' },
        { type: 'slack', name: 'b', api_url: 'https://hooks/y', channel: '#b' },
      ],
      'a',
    );
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/sys/alerts/channels/a',
      headers: { authorization: authHeader(ctx.app) },
    });
    expect(res.statusCode).toBe(200);
    const cfg = await ctx.store.read();
    expect(cfg.channels.map((c) => c.name)).toEqual(['b']);
    // Default falls back to the remaining channel.
    expect(cfg.default_channel).toBe('b');
  });

  it('returns 404 for an unknown channel', async () => {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/sys/alerts/channels/ghost',
      headers: { authorization: authHeader(ctx.app) },
    });
    expect(res.statusCode).toBe(404);
  });

  it('clears the default when the last channel is removed', async () => {
    await ctx.store.updateChannels(
      [{ type: 'slack', name: 'only', api_url: 'https://hooks/x', channel: '#a' }],
      'only',
    );
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/sys/alerts/channels/only',
      headers: { authorization: authHeader(ctx.app) },
    });
    expect(res.statusCode).toBe(200);
    const cfg = await ctx.store.read();
    expect(cfg.channels).toHaveLength(0);
    expect(cfg.default_channel).toBe('');
  });
});

describe('POST /sys/alerts/channels/:name/test', () => {
  let ctx: Awaited<ReturnType<typeof buildChannelsApp>>;
  beforeEach(async () => {
    ctx = await buildChannelsApp();
    await ctx.store.updateChannels(
      [{ type: 'slack', name: 'ops', api_url: 'https://hooks/x', channel: '#a' }],
      'ops',
    );
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('returns 202 on successful upstream', async () => {
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => ({}) }));
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels/ops/test',
      headers: { authorization: authHeader(ctx.app) },
    });
    expect(res.statusCode).toBe(202);
  });

  it('returns 404 when the channel does not exist', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels/ghost/test',
      headers: { authorization: authHeader(ctx.app) },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 502 when Alertmanager rejects the test alert', async () => {
    mockFetchOnce(() => ({ ok: false, status: 400, json: async () => ({}) }));
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels/ops/test',
      headers: { authorization: authHeader(ctx.app) },
    });
    expect(res.statusCode).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// Default-receiver switch
// ---------------------------------------------------------------------------

describe('PUT /sys/alerts/channels/default', () => {
  let ctx: Awaited<ReturnType<typeof buildChannelsApp>>;
  beforeEach(async () => {
    ctx = await buildChannelsApp();
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => ({}) }));
    await ctx.store.updateChannels(
      [
        { type: 'slack', name: 'a', api_url: 'https://hooks/x', channel: '#a' },
        { type: 'slack', name: 'b', api_url: 'https://hooks/y', channel: '#b' },
      ],
      'a',
    );
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('rejects an invalid body', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/sys/alerts/channels/default',
      headers: { authorization: authHeader(ctx.app) },
      payload: { not_name: 'b' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown channel name', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/sys/alerts/channels/default',
      headers: { authorization: authHeader(ctx.app) },
      payload: { name: 'ghost' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('updates the default to the given channel', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/sys/alerts/channels/default',
      headers: { authorization: authHeader(ctx.app) },
      payload: { name: 'b' },
    });
    expect(res.statusCode).toBe(200);
    const cfg = await ctx.store.read();
    expect(cfg.default_channel).toBe('b');
    expect(cfg.channels.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('clears the default when name is null', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/sys/alerts/channels/default',
      headers: { authorization: authHeader(ctx.app) },
      payload: { name: null },
    });
    expect(res.statusCode).toBe(200);
    const cfg = await ctx.store.read();
    expect(cfg.default_channel).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

import { mapRulesResponse } from '../src/routes/sys-alerts.js';

async function buildRulesApp(opts: { prometheusUrl?: string } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  app.decorate('config', {
    PROMETHEUS_URL: opts.prometheusUrl,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  await registerSysAlertsRoute(app, {});
  await app.ready();
  return app;
}

describe('GET /sys/alerts/rules', () => {
  it('returns unavailable when PROMETHEUS_URL is unset', async () => {
    const app = await buildRulesApp({});
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/rules',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ groups: [], unavailable: true });
    await app.close();
  });

  it('returns 401 without a JWT', async () => {
    const app = await buildRulesApp({ prometheusUrl: 'http://prometheus:9090' });
    const res = await app.inject({ method: 'GET', url: '/sys/alerts/rules' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns unavailable on upstream 500', async () => {
    mockFetchOnce(() => ({ ok: false, status: 500, json: async () => ({}) }));
    const app = await buildRulesApp({ prometheusUrl: 'http://prometheus:9090' });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/rules',
      headers: { authorization: authHeader(app) },
    });
    expect(res.json()).toEqual({ groups: [], unavailable: true });
    await app.close();
  });

  it('maps a real-shaped /api/v1/rules response', async () => {
    mockFetchOnce(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        data: {
          groups: [
            {
              name: 'eveys-console',
              file: '/etc/prometheus/alerts.yml',
              interval: 15,
              rules: [
                {
                  type: 'alerting',
                  name: 'ConsoleDown',
                  query: 'up{job="eveys-console"} == 0',
                  duration: 300,
                  labels: { severity: 'warning' },
                  annotations: { summary: 'Console scrape failing', description: 'no scrape 5m' },
                  state: 'inactive',
                  health: 'ok',
                  lastEvaluation: '2026-05-11T09:00:00.000Z',
                  evaluationTime: '0.001234',
                },
              ],
            },
          ],
        },
      }),
    }));
    const app = await buildRulesApp({ prometheusUrl: 'http://prometheus:9090' });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/rules',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      groups: Array<{
        name: string;
        rules: Array<{ name: string; duration: string; severity: string | null }>;
      }>;
    };
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]?.rules[0]).toMatchObject({
      name: 'ConsoleDown',
      duration: '5m',
      severity: 'warning',
      state: 'inactive',
    });
    await app.close();
  });
});

describe('mapRulesResponse', () => {
  it('returns the unavailable envelope on a non-object input', () => {
    expect(mapRulesResponse(null)).toEqual({ groups: [], unavailable: true });
    expect(mapRulesResponse('whatever')).toEqual({ groups: [], unavailable: true });
  });

  it('skips groups without a name', () => {
    const out = mapRulesResponse({
      data: {
        groups: [
          { name: 'good', rules: [] },
          { rules: [] }, // no name → skipped
        ],
      },
    });
    expect(out.groups.map((g) => g.name)).toEqual(['good']);
  });

  it('formats durations 60 → 1m, 3600 → 1h, 90 → 90s', () => {
    const out = mapRulesResponse({
      data: {
        groups: [
          {
            name: 'g',
            rules: [
              { name: 'a', type: 'alerting', query: 'x', duration: 60, state: 'inactive' },
              { name: 'b', type: 'alerting', query: 'x', duration: 3600, state: 'inactive' },
              { name: 'c', type: 'alerting', query: 'x', duration: 90, state: 'inactive' },
            ],
          },
        ],
      },
    });
    const rules = out.groups[0]?.rules;
    expect(rules?.map((r) => r.duration)).toEqual(['1m', '1h', '90s']);
  });
});

// ---------------------------------------------------------------------------
// Managed rules CRUD
// ---------------------------------------------------------------------------

import { RulesStore } from '../src/store/rules-store.js';

async function buildRulesApp2(
  opts: { promtoolPath?: string; prometheusUrl?: string } = {},
): Promise<{
  app: FastifyInstance;
  store: RulesStore;
  dir: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'rules-route-'));
  // Default to a missing binary so promtool falls into skipped path.
  const store = new RulesStore(
    join(dir, 'alerts-managed.yml'),
    opts.promtoolPath ?? '/definitely-not-a-real-binary',
  );
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  app.decorate('config', {
    PROMETHEUS_URL: opts.prometheusUrl,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  await registerSysAlertsRoute(app, { rulesStore: store });
  await app.ready();
  return { app, store, dir };
}

describe('Managed rules routes — disabled without a store', () => {
  it('returns 503 from GET when rulesStore is missing', async () => {
    const app = await buildApp({ alertmanagerUrl: 'http://alertmanager:9093' });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/alerts/rules/managed',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

describe('GET /sys/alerts/rules/managed', () => {
  let ctx: Awaited<ReturnType<typeof buildRulesApp2>>;
  beforeEach(async () => {
    ctx = await buildRulesApp2();
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('returns 401 without a JWT', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/sys/alerts/rules/managed' });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty list when the file does not exist', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/sys/alerts/rules/managed',
      headers: { authorization: authHeader(ctx.app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ managed: [] });
  });
});

describe('POST /sys/alerts/rules/managed', () => {
  let ctx: Awaited<ReturnType<typeof buildRulesApp2>>;
  beforeEach(async () => {
    ctx = await buildRulesApp2({ prometheusUrl: 'http://prometheus:9091' });
    // Mock the /-/reload call.
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => ({}) }));
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('creates a valid rule + validation_skipped flag when promtool is missing', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/rules/managed',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        name: 'MyAlert',
        expr: 'up == 0',
        duration: '5m',
        severity: 'warning',
        summary: 'down',
        description: '',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { managed: Array<{ name: string }>; validation_skipped?: boolean };
    expect(body.managed[0]?.name).toBe('MyAlert');
    expect(body.validation_skipped).toBe(true);
    const onDisk = await ctx.store.read();
    expect(onDisk.managed).toHaveLength(1);
  });

  it('rejects an invalid body', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/rules/managed',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        name: 'X',
        expr: '' /* empty */,
        duration: '5m',
        severity: 'warning',
        summary: '',
        description: '',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a bad duration format', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/rules/managed',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        name: 'Bad',
        expr: 'up == 0',
        duration: 'not-a-duration',
        severity: 'warning',
        summary: '',
        description: '',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unsafe rule names', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/rules/managed',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        name: '../etc/passwd',
        expr: 'up == 0',
        duration: '5m',
        severity: 'warning',
        summary: '',
        description: '',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid severity', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/rules/managed',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        name: 'X',
        expr: 'up == 0',
        duration: '5m',
        severity: 'omega',
        summary: '',
        description: '',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a duplicate name with 409', async () => {
    await ctx.store.updateManaged([
      {
        name: 'X',
        expr: 'up == 0',
        duration: '5m',
        severity: 'warning',
        summary: '',
        description: '',
      },
    ]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/rules/managed',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        name: 'X',
        expr: 'up == 1',
        duration: '5m',
        severity: 'warning',
        summary: '',
        description: '',
      },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('PUT /sys/alerts/rules/managed/:name', () => {
  let ctx: Awaited<ReturnType<typeof buildRulesApp2>>;
  beforeEach(async () => {
    ctx = await buildRulesApp2({ prometheusUrl: 'http://prometheus:9091' });
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => ({}) }));
    await ctx.store.updateManaged([
      {
        name: 'Existing',
        expr: 'up == 0',
        duration: '5m',
        severity: 'warning',
        summary: 'old',
        description: '',
      },
    ]);
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('updates an existing rule', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/sys/alerts/rules/managed/Existing',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        name: 'Existing',
        expr: 'up == 0',
        duration: '10m',
        severity: 'critical',
        summary: 'new',
        description: '',
      },
    });
    expect(res.statusCode).toBe(200);
    const cfg = await ctx.store.read();
    expect(cfg.managed[0]?.severity).toBe('critical');
    expect(cfg.managed[0]?.summary).toBe('new');
  });

  it('returns 400 when path and body names disagree', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/sys/alerts/rules/managed/Existing',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        name: 'Other',
        expr: 'up == 0',
        duration: '5m',
        severity: 'warning',
        summary: '',
        description: '',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an unknown rule', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/sys/alerts/rules/managed/Ghost',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        name: 'Ghost',
        expr: 'up == 0',
        duration: '5m',
        severity: 'warning',
        summary: '',
        description: '',
      },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /sys/alerts/rules/managed/:name', () => {
  let ctx: Awaited<ReturnType<typeof buildRulesApp2>>;
  beforeEach(async () => {
    ctx = await buildRulesApp2({ prometheusUrl: 'http://prometheus:9091' });
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => ({}) }));
    await ctx.store.updateManaged([
      {
        name: 'A',
        expr: 'up == 0',
        duration: '5m',
        severity: 'warning',
        summary: '',
        description: '',
      },
      {
        name: 'B',
        expr: 'up == 1',
        duration: '5m',
        severity: 'warning',
        summary: '',
        description: '',
      },
    ]);
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('removes the named rule', async () => {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/sys/alerts/rules/managed/A',
      headers: { authorization: authHeader(ctx.app) },
    });
    expect(res.statusCode).toBe(200);
    const cfg = await ctx.store.read();
    expect(cfg.managed.map((r) => r.name)).toEqual(['B']);
  });

  it('returns 404 for an unknown rule', async () => {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/sys/alerts/rules/managed/Ghost',
      headers: { authorization: authHeader(ctx.app) },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PR #170 — per-receiver template overrides on the Channels form
// ---------------------------------------------------------------------------

describe('POST /sys/alerts/channels — template-override validation', () => {
  let ctx: Awaited<ReturnType<typeof buildChannelsApp>>;
  beforeEach(async () => {
    ctx = await buildChannelsApp();
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => ({}) }));
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('accepts an email override using allowlisted helpers', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'email',
        name: 'oncall',
        to: 'a@b.com',
        from: 'c@d.com',
        smarthost: 'smtp.example.com:587',
        subject: 'Alert: {{ .CommonLabels.alertname }}',
        text: 'Status {{ .Status }}',
      },
    });
    expect(res.statusCode).toBe(201);
    const cfg = await ctx.store.read();
    const email = cfg.channels[0] as Extract<(typeof cfg.channels)[number], { type: 'email' }>;
    expect(email.subject).toBe('Alert: {{ .CommonLabels.alertname }}');
    expect(email.text).toBe('Status {{ .Status }}');
  });

  it('rejects an email subject that references an unknown helper with 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'email',
        name: 'oncall',
        to: 'a@b.com',
        from: 'c@d.com',
        smarthost: 'smtp.example.com:587',
        // `.CommonLabel` (missing trailing `s`) is the typo to catch.
        subject: 'Alert: {{ .CommonLabel.alertname }}',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as {
      error: string;
      detail: { field: string; bad: string[]; message: string };
    };
    expect(body.error).toBe('invalid_template_override');
    expect(body.detail.field).toBe('subject');
    expect(body.detail.bad).toContain('.CommonLabel');
    expect(body.detail.message).toMatch(/Allowed roots/);
  });

  it('accepts a Telegram message override using allowlisted helpers', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'telegram',
        name: 'tg',
        bot_token: '12345:AAEFxyz_fake_token_tail_9999',
        chat_id: '-100123',
        message: '🚨 {{ .CommonLabels.alertname }} on {{ .Status }}',
      },
    });
    expect(res.statusCode).toBe(201);
    const cfg = await ctx.store.read();
    const tg = cfg.channels[0] as Extract<(typeof cfg.channels)[number], { type: 'telegram' }>;
    expect(tg.message).toBe('🚨 {{ .CommonLabels.alertname }} on {{ .Status }}');
  });

  it('rejects a Telegram message override with an unknown helper', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'telegram',
        name: 'tg',
        bot_token: '12345:AAEFxyz_fake_token_tail_9999',
        chat_id: '-100123',
        message: '{{ .Foo.bar }}',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; detail: { field: string; bad: string[] } };
    expect(body.error).toBe('invalid_template_override');
    expect(body.detail.field).toBe('message');
    expect(body.detail.bad).toContain('.Foo');
  });

  it('accepts a Slack override with `text` template referencing `.GroupLabels`', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'slack',
        name: 'ops',
        api_url: 'https://hooks.slack.com/services/T1/B2/abc123def-tail',
        channel: '#ops',
        text: 'group {{ .GroupLabels.cluster }}',
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('PUT also validates overrides — typo-on-edit is rejected', async () => {
    // First create a valid channel.
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/sys/alerts/channels',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'email',
        name: 'oncall',
        to: 'a@b.com',
        from: 'c@d.com',
        smarthost: 'smtp.example.com:587',
      },
    });
    expect(create.statusCode).toBe(201);
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => ({}) }));

    // Now try to PUT with a bad override.
    const put = await ctx.app.inject({
      method: 'PUT',
      url: '/sys/alerts/channels/oncall',
      headers: { authorization: authHeader(ctx.app) },
      payload: {
        type: 'email',
        name: 'oncall',
        to: 'a@b.com',
        from: 'c@d.com',
        smarthost: 'smtp.example.com:587',
        html: '<h1>{{ .Bogus }}</h1>',
      },
    });
    expect(put.statusCode).toBe(400);
    const body = put.json() as { error: string; detail: { field: string } };
    expect(body.error).toBe('invalid_template_override');
    expect(body.detail.field).toBe('html');
  });
});
