// Light-touch route test for the per-charger transactions proxy. The
// proxy is a thin shim over the gateway client; the value-add here is
// verifying (a) the route is wired at the expected path, (b) JWT auth
// is enforced, (c) `active` / `limit` / `cursor` query params are
// forwarded verbatim, (d) the upstream body is passed through
// unchanged on success, and (e) a structured upstream error envelope
// survives unchanged.

import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSysChargePointTransactionsRoute } from '../src/routes/sys-charge-point-transactions.js';

const JWT_SECRET = 'a-test-secret-of-at-least-16-bytes';

interface FakeGateway {
  listChargePointTransactions: ReturnType<typeof vi.fn>;
}

function makeFakeGateway(): FakeGateway {
  return { listChargePointTransactions: vi.fn() };
}

async function buildApp(gateway: FakeGateway): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await registerSysChargePointTransactionsRoute(app, { gateway: gateway as any });
  await app.ready();
  return app;
}

function authHeader(app: FastifyInstance): string {
  const token = app.jwt.sign({ sub: 'tester' });
  return `Bearer ${token}`;
}

describe('GET /sys/charge-points/:cp_id/transactions', () => {
  let gateway: FakeGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    gateway = makeFakeGateway();
    app = await buildApp(gateway);
  });

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/transactions',
    });
    expect(res.statusCode).toBe(401);
    expect(gateway.listChargePointTransactions).not.toHaveBeenCalled();
  });

  it('forwards the gateway response on success', async () => {
    const body = {
      transactions: [
        {
          transaction_id: 1,
          cp_id: 'cp_a',
          connector_id: 1,
          id_tag: 'TAG',
          meter_start_wh: 0,
          started_at: '2026-05-10T00:00:00Z',
          meter_stop_wh: null,
          stopped_at: null,
          stop_reason: null,
          open: true,
        },
      ],
      next_cursor: null,
    };
    gateway.listChargePointTransactions.mockResolvedValue(body);

    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/transactions',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(body);
    expect(gateway.listChargePointTransactions).toHaveBeenCalledWith('cp_a', {});
  });

  it('passes active / limit / cursor through to the gateway', async () => {
    gateway.listChargePointTransactions.mockResolvedValue({
      transactions: [],
      next_cursor: null,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_b/transactions?active=true&limit=20&cursor=abc',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(gateway.listChargePointTransactions).toHaveBeenCalledWith('cp_b', {
      active: true,
      limit: 20,
      cursor: 'abc',
    });
  });

  it('coerces active=false correctly and ignores garbage values', async () => {
    gateway.listChargePointTransactions.mockResolvedValue({
      transactions: [],
      next_cursor: null,
    });
    await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/transactions?active=false',
      headers: { authorization: authHeader(app) },
    });
    expect(gateway.listChargePointTransactions).toHaveBeenLastCalledWith('cp_a', {
      active: false,
    });

    await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/transactions?active=banana&limit=zero',
      headers: { authorization: authHeader(app) },
    });
    // Garbage values are dropped; the call is made with no params.
    expect(gateway.listChargePointTransactions).toHaveBeenLastCalledWith('cp_a', {});
  });

  it('translates an upstream error envelope to the same status', async () => {
    const err = Object.assign(new Error('upstream'), {
      status: 503,
      body: JSON.stringify({ error: 'upstream-down' }),
    });
    gateway.listChargePointTransactions.mockRejectedValue(err);

    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/transactions',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'upstream-down' });
  });
});
