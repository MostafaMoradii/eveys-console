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

const JWT_SECRET = 'a-test-secret-of-at-least-16-bytes';

interface BuildOptions {
  alertmanagerUrl?: string;
}

async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  // Just enough config for the route to read ALERTMANAGER_URL off it.
  app.decorate('config', {
    ALERTMANAGER_URL: opts.alertmanagerUrl,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  await registerSysAlertsRoute(app);
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
}

function mockFetchOnce(impl: () => Promise<MinimalResponseInit> | MinimalResponseInit) {
  // node:fetch is on globalThis in Node 20; replace it for the duration
  // of the test. Restore after each test via the afterEach below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = vi.fn(async () => impl());
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
    expect(res.json()).toEqual({ alerts: [], unavailable: true });
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
    expect(res.json()).toEqual({ alerts: [], unavailable: true });
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
    expect(res.json()).toEqual({ alerts: [], unavailable: true });
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
    expect(res.json()).toEqual({ alerts: [], unavailable: true });
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
    expect(res.json()).toEqual({ alerts: [], unavailable: true });
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
