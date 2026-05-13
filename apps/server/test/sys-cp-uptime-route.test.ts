// Route test for the uptime proxy. The route is a pass-through to
// the gateway client; we verify JWT enforcement, required
// `from`/`to` validation, query forwarding, and that the upstream
// body is returned verbatim (no shape translation — the gateway
// already returns the operator-facing shape).

import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSysCpUptimeRoute } from '../src/routes/sys-cp-uptime.js';

const JWT_SECRET = 'a-test-secret-of-at-least-16-bytes';

interface FakeGateway {
  getUptime: ReturnType<typeof vi.fn>;
}

function makeFakeGateway(): FakeGateway {
  return { getUptime: vi.fn() };
}

async function buildApp(gateway: FakeGateway): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await registerSysCpUptimeRoute(app, { gateway: gateway as any });
  await app.ready();
  return app;
}

function authHeader(app: FastifyInstance): string {
  const token = app.jwt.sign({ sub: 'tester' });
  return `Bearer ${token}`;
}

describe('GET /sys/charge-points/:cp_id/uptime', () => {
  let gateway: FakeGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    gateway = makeFakeGateway();
    app = await buildApp(gateway);
  });

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/uptime?from=2026-04-01T00:00:00Z&to=2026-05-01T00:00:00Z',
    });
    expect(res.statusCode).toBe(401);
    expect(gateway.getUptime).not.toHaveBeenCalled();
  });

  it('returns 400 when from is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/uptime?to=2026-05-01T00:00:00Z',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(400);
    expect(gateway.getUptime).not.toHaveBeenCalled();
  });

  it('returns 400 when to is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/uptime?from=2026-04-01T00:00:00Z',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('forwards from + to verbatim and surfaces the upstream body', async () => {
    const upstream = {
      cp_id: 'cp_a',
      uptime_pct: 99.72,
      offline_seconds_total: 7200,
      online_seconds_total: 2_584_800,
      intervals: [
        {
          went_offline_at: '2026-04-15T10:00:00Z',
          came_online_at: '2026-04-15T12:00:00Z',
          offline_seconds: 7200,
          prior_reason: 'clean',
        },
      ],
      window: {
        from: '2026-04-01T00:00:00Z',
        to: '2026-05-01T00:00:00Z',
        seconds: 2_592_000,
      },
      request_id: 'req-1',
    };
    gateway.getUptime.mockResolvedValue(upstream);

    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/uptime?from=2026-04-01T00:00:00Z&to=2026-05-01T00:00:00Z',
      headers: { authorization: authHeader(app) },
    });

    expect(res.statusCode).toBe(200);
    expect(gateway.getUptime).toHaveBeenCalledWith('cp_a', {
      from: '2026-04-01T00:00:00Z',
      to: '2026-05-01T00:00:00Z',
    });
    // Pass-through: the proxy doesn't rename or drop fields.
    expect(res.json()).toEqual(upstream);
  });

  it('forwards upstream error envelopes unchanged', async () => {
    // The gateway returns 404 UNKNOWN_CP_ID for chargers that haven't
    // booted yet. The proxy must surface that as-is so the UI can
    // distinguish it from a Console-side network failure.
    const err = new Error('upstream') as Error & { status: number; body: string };
    err.status = 404;
    err.body = JSON.stringify({
      error: 'unknown cp_id',
      error_code: 'UNKNOWN_CP_ID',
      request_id: 'req-x',
    });
    gateway.getUptime.mockRejectedValue(err);

    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/UNKNOWN/uptime?from=2026-04-01T00:00:00Z&to=2026-05-01T00:00:00Z',
      headers: { authorization: authHeader(app) },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: 'unknown cp_id',
      error_code: 'UNKNOWN_CP_ID',
      request_id: 'req-x',
    });
  });

  it('returns a 502 envelope on non-JSON upstream failures', async () => {
    gateway.getUptime.mockRejectedValue(new Error('network down'));

    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/uptime?from=2026-04-01T00:00:00Z&to=2026-05-01T00:00:00Z',
      headers: { authorization: authHeader(app) },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body).toMatchObject({ error: 'gateway-unavailable', detail: 'network down' });
  });
});
