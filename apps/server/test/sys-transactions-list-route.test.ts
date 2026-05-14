// Tests for `GET /sys/transactions` — the audit-list proxy (PR A1 of
// eveys-console#188). Confirms (a) JWT auth, (b) the `status` enum
// translation to the gateway's `active=…` bool, (c) every other filter
// forwards verbatim, (d) `limit` is bounded, (e) cursor pagination
// round-trips, (f) a structured upstream error envelope survives.

import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSysTransactionsRoute } from '../src/routes/sys-transactions.js';

const JWT_SECRET = 'a-test-secret-of-at-least-16-bytes';

interface FakeGateway {
  listTransactions: ReturnType<typeof vi.fn>;
  getTransaction: ReturnType<typeof vi.fn>;
  listMeterValues: ReturnType<typeof vi.fn>;
}

function makeFakeGateway(): FakeGateway {
  return {
    listTransactions: vi.fn(),
    getTransaction: vi.fn(),
    listMeterValues: vi.fn(),
  };
}

async function buildApp(gateway: FakeGateway): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await registerSysTransactionsRoute(app, { gateway: gateway as any });
  await app.ready();
  return app;
}

function authHeader(app: FastifyInstance): string {
  const token = app.jwt.sign({ sub: 'tester' });
  return `Bearer ${token}`;
}

describe('GET /sys/transactions', () => {
  let gateway: FakeGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    gateway = makeFakeGateway();
    app = await buildApp(gateway);
  });

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({ method: 'GET', url: '/sys/transactions' });
    expect(res.statusCode).toBe(401);
    expect(gateway.listTransactions).not.toHaveBeenCalled();
  });

  it('passes the upstream body through unchanged on a no-filter call', async () => {
    const upstream = {
      transactions: [{ transaction_id: 1, cp_id: 'cp_a' }],
      next_cursor: null,
      request_id: 'req-1',
    };
    gateway.listTransactions.mockResolvedValue(upstream);
    const res = await app.inject({
      method: 'GET',
      url: '/sys/transactions',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(upstream);
    expect(gateway.listTransactions).toHaveBeenCalledWith({});
  });

  it('translates status=active → active:true', async () => {
    gateway.listTransactions.mockResolvedValue({ transactions: [] });
    await app.inject({
      method: 'GET',
      url: '/sys/transactions?status=active',
      headers: { authorization: authHeader(app) },
    });
    expect(gateway.listTransactions).toHaveBeenLastCalledWith({ active: true });
  });

  it('translates status=finished → active:false', async () => {
    gateway.listTransactions.mockResolvedValue({ transactions: [] });
    await app.inject({
      method: 'GET',
      url: '/sys/transactions?status=finished',
      headers: { authorization: authHeader(app) },
    });
    expect(gateway.listTransactions).toHaveBeenLastCalledWith({ active: false });
  });

  it('leaves active unset for status=all (gateway returns both)', async () => {
    gateway.listTransactions.mockResolvedValue({ transactions: [] });
    await app.inject({
      method: 'GET',
      url: '/sys/transactions?status=all',
      headers: { authorization: authHeader(app) },
    });
    // `active` MUST NOT be on the params; an explicit `undefined`
    // would still translate to a `?active=undefined` query on the
    // upstream and the gateway would 400.
    expect(gateway.listTransactions).toHaveBeenLastCalledWith({});
  });

  it('rejects an unknown status with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/transactions?status=banana',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad-request' });
    expect(gateway.listTransactions).not.toHaveBeenCalled();
  });

  it('forwards cp_id / id_tag / from / to / cursor verbatim', async () => {
    gateway.listTransactions.mockResolvedValue({ transactions: [] });
    await app.inject({
      method: 'GET',
      url:
        '/sys/transactions?cp_id=cp_a&id_tag=TAG_X' +
        '&from=2026-05-01T00:00:00Z&to=2026-05-13T00:00:00Z&cursor=opaque-c',
      headers: { authorization: authHeader(app) },
    });
    expect(gateway.listTransactions).toHaveBeenLastCalledWith({
      cp_id: 'cp_a',
      id_tag: 'TAG_X',
      from: '2026-05-01T00:00:00Z',
      to: '2026-05-13T00:00:00Z',
      cursor: 'opaque-c',
    });
  });

  it('parses + bounds limit (1..1000)', async () => {
    gateway.listTransactions.mockResolvedValue({ transactions: [] });
    await app.inject({
      method: 'GET',
      url: '/sys/transactions?limit=50',
      headers: { authorization: authHeader(app) },
    });
    expect(gateway.listTransactions).toHaveBeenLastCalledWith({ limit: 50 });

    const tooBig = await app.inject({
      method: 'GET',
      url: '/sys/transactions?limit=10000',
      headers: { authorization: authHeader(app) },
    });
    expect(tooBig.statusCode).toBe(400);

    const zero = await app.inject({
      method: 'GET',
      url: '/sys/transactions?limit=0',
      headers: { authorization: authHeader(app) },
    });
    expect(zero.statusCode).toBe(400);

    const garbage = await app.inject({
      method: 'GET',
      url: '/sys/transactions?limit=zero',
      headers: { authorization: authHeader(app) },
    });
    expect(garbage.statusCode).toBe(400);
  });

  it('passes through a structured upstream 503 envelope', async () => {
    const err = Object.assign(new Error('upstream'), {
      status: 503,
      body: JSON.stringify({ error: 'upstream-down', error_code: 'SERVICE_UNAVAILABLE' }),
    });
    gateway.listTransactions.mockRejectedValue(err);
    const res = await app.inject({
      method: 'GET',
      url: '/sys/transactions',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'upstream-down', error_code: 'SERVICE_UNAVAILABLE' });
  });

  it('does not collide with GET /sys/transactions/:tx_id (the detail route)', async () => {
    // The detail route uses the existing getTransaction client method.
    // Confirm a numeric path segment dispatches there, not to the list.
    gateway.getTransaction.mockResolvedValue({ transaction_id: 42 });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/transactions/42',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(gateway.getTransaction).toHaveBeenCalledWith(42);
    expect(gateway.listTransactions).not.toHaveBeenCalled();
  });
});
