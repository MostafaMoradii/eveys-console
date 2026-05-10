// Route tests for the firing-alerts proxy. The proxy is fail-soft by
// design — any upstream wobble should collapse to
// `{ alerts: [], unavailable: true }` so the panel shows its hint
// instead of an error toast. These tests pin that contract along
// with the v2-response → Console-Alert mapping and severity-label
// translation.

import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mapFiringAlert, registerSysAlertsRoute } from '../src/routes/sys-alerts.js';

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
