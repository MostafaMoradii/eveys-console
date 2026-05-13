// Route test for the fleet-wide status-history proxy. Pass-through;
// we verify JWT enforcement, required from/to, that repeated
// `status` / `cp_id` query params survive as arrays into the
// gateway call, and that upstream error envelopes come through
// unchanged.

import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSysFleetStatusHistoryRoute } from '../src/routes/sys-fleet-status-history.js';

const JWT_SECRET = 'a-test-secret-of-at-least-16-bytes';

interface FakeGateway {
  listFleetStatusHistory: ReturnType<typeof vi.fn>;
}

function makeFakeGateway(): FakeGateway {
  return { listFleetStatusHistory: vi.fn() };
}

async function buildApp(gateway: FakeGateway): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await registerSysFleetStatusHistoryRoute(app, { gateway: gateway as any });
  await app.ready();
  return app;
}

function authHeader(app: FastifyInstance): string {
  const token = app.jwt.sign({ sub: 'tester' });
  return `Bearer ${token}`;
}

describe('GET /sys/fleet/status-history', () => {
  let gateway: FakeGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    gateway = makeFakeGateway();
    app = await buildApp(gateway);
  });

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/fleet/status-history?from=2026-05-12T00:00:00Z&to=2026-05-13T00:00:00Z',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when from or to is missing', async () => {
    const r1 = await app.inject({
      method: 'GET',
      url: '/sys/fleet/status-history?to=2026-05-13T00:00:00Z',
      headers: { authorization: authHeader(app) },
    });
    expect(r1.statusCode).toBe(400);
    const r2 = await app.inject({
      method: 'GET',
      url: '/sys/fleet/status-history?from=2026-05-12T00:00:00Z',
      headers: { authorization: authHeader(app) },
    });
    expect(r2.statusCode).toBe(400);
  });

  it('forwards a single status filter as a one-element array', async () => {
    gateway.listFleetStatusHistory.mockResolvedValue({ events: [], request_id: 'req' });
    await app.inject({
      method: 'GET',
      url: '/sys/fleet/status-history?from=2026-05-12T00:00:00Z&to=2026-05-13T00:00:00Z&status=Faulted',
      headers: { authorization: authHeader(app) },
    });
    expect(gateway.listFleetStatusHistory).toHaveBeenCalledWith({
      from: '2026-05-12T00:00:00Z',
      to: '2026-05-13T00:00:00Z',
      status: ['Faulted'],
    });
  });

  it('forwards repeated status + cp_id params as arrays', async () => {
    gateway.listFleetStatusHistory.mockResolvedValue({ events: [], request_id: 'req' });
    await app.inject({
      method: 'GET',
      url: '/sys/fleet/status-history?from=2026-05-12T00:00:00Z&to=2026-05-13T00:00:00Z&status=Faulted&status=Unavailable&cp_id=A&cp_id=B&limit=50',
      headers: { authorization: authHeader(app) },
    });
    expect(gateway.listFleetStatusHistory).toHaveBeenCalledWith({
      from: '2026-05-12T00:00:00Z',
      to: '2026-05-13T00:00:00Z',
      status: ['Faulted', 'Unavailable'],
      cp_id: ['A', 'B'],
      limit: 50,
    });
  });

  it('returns the upstream body verbatim on success', async () => {
    const upstream = {
      events: [
        {
          event_id: 'e1',
          occurred_at: '2026-05-12T10:00:00Z',
          cp_id: 'CP_A',
          connector_id: 1,
          status: 'Faulted',
          error_code: 'GroundFailure',
          info: null,
          vendor_id: null,
          vendor_error_code: null,
          charger_reported_at: '2026-05-12T10:00:00Z',
        },
      ],
      request_id: 'req-1',
    };
    gateway.listFleetStatusHistory.mockResolvedValue(upstream);

    const res = await app.inject({
      method: 'GET',
      url: '/sys/fleet/status-history?from=2026-05-12T00:00:00Z&to=2026-05-13T00:00:00Z',
      headers: { authorization: authHeader(app) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(upstream);
  });

  it('forwards upstream WINDOW_TOO_LARGE 400 unchanged', async () => {
    const err = new Error('upstream') as Error & { status: number; body: string };
    err.status = 400;
    err.body = JSON.stringify({
      error: 'window too large',
      error_code: 'WINDOW_TOO_LARGE',
      request_id: 'req-x',
    });
    gateway.listFleetStatusHistory.mockRejectedValue(err);

    const res = await app.inject({
      method: 'GET',
      url: '/sys/fleet/status-history?from=2026-04-01T00:00:00Z&to=2026-05-13T00:00:00Z',
      headers: { authorization: authHeader(app) },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'window too large',
      error_code: 'WINDOW_TOO_LARGE',
      request_id: 'req-x',
    });
  });
});
