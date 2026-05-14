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
  aggregateTransactions: ReturnType<typeof vi.fn>;
  listTransactionFrames: ReturnType<typeof vi.fn>;
}

function makeFakeGateway(): FakeGateway {
  return {
    listTransactions: vi.fn(),
    getTransaction: vi.fn(),
    listMeterValues: vi.fn(),
    aggregateTransactions: vi.fn(),
    listTransactionFrames: vi.fn(),
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

describe('GET /sys/transactions/aggregate', () => {
  let gateway: FakeGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    gateway = makeFakeGateway();
    app = await buildApp(gateway);
  });

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/transactions/aggregate?from=2026-05-01T00:00:00Z&to=2026-05-10T00:00:00Z',
    });
    expect(res.statusCode).toBe(401);
    expect(gateway.aggregateTransactions).not.toHaveBeenCalled();
  });

  it('rejects when from or to is missing', async () => {
    const r1 = await app.inject({
      method: 'GET',
      url: '/sys/transactions/aggregate?to=2026-05-10T00:00:00Z',
      headers: { authorization: authHeader(app) },
    });
    expect(r1.statusCode).toBe(400);
    const r2 = await app.inject({
      method: 'GET',
      url: '/sys/transactions/aggregate?from=2026-05-01T00:00:00Z',
      headers: { authorization: authHeader(app) },
    });
    expect(r2.statusCode).toBe(400);
    expect(gateway.aggregateTransactions).not.toHaveBeenCalled();
  });

  it('forwards from/to verbatim with default bucket/group_by', async () => {
    gateway.aggregateTransactions.mockResolvedValue({ buckets: [], window: {} });
    await app.inject({
      method: 'GET',
      url: '/sys/transactions/aggregate?from=2026-05-01T00:00:00Z&to=2026-05-10T00:00:00Z',
      headers: { authorization: authHeader(app) },
    });
    expect(gateway.aggregateTransactions).toHaveBeenLastCalledWith({
      from: '2026-05-01T00:00:00Z',
      to: '2026-05-10T00:00:00Z',
    });
  });

  it('forwards bucket and group_by when valid', async () => {
    gateway.aggregateTransactions.mockResolvedValue({ buckets: [], window: {} });
    await app.inject({
      method: 'GET',
      url:
        '/sys/transactions/aggregate?from=2026-05-01T00:00:00Z&to=2026-05-10T00:00:00Z' +
        '&bucket=hour&group_by=cp_id',
      headers: { authorization: authHeader(app) },
    });
    expect(gateway.aggregateTransactions).toHaveBeenLastCalledWith({
      from: '2026-05-01T00:00:00Z',
      to: '2026-05-10T00:00:00Z',
      bucket: 'hour',
      group_by: 'cp_id',
    });
  });

  it('rejects unknown bucket / group_by', async () => {
    const badBucket = await app.inject({
      method: 'GET',
      url:
        '/sys/transactions/aggregate?from=2026-05-01T00:00:00Z&to=2026-05-10T00:00:00Z' +
        '&bucket=year',
      headers: { authorization: authHeader(app) },
    });
    expect(badBucket.statusCode).toBe(400);

    const badGroup = await app.inject({
      method: 'GET',
      url:
        '/sys/transactions/aggregate?from=2026-05-01T00:00:00Z&to=2026-05-10T00:00:00Z' +
        '&group_by=color',
      headers: { authorization: authHeader(app) },
    });
    expect(badGroup.statusCode).toBe(400);
    expect(gateway.aggregateTransactions).not.toHaveBeenCalled();
  });

  it('passes through a structured upstream 400 envelope', async () => {
    const err = Object.assign(new Error('upstream'), {
      status: 400,
      body: JSON.stringify({ error: 'window-too-large', error_code: 'WINDOW_TOO_LARGE' }),
    });
    gateway.aggregateTransactions.mockRejectedValue(err);
    const res = await app.inject({
      method: 'GET',
      url: '/sys/transactions/aggregate?from=2025-01-01T00:00:00Z&to=2026-05-10T00:00:00Z',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'window-too-large',
      error_code: 'WINDOW_TOO_LARGE',
    });
  });
});

describe('GET /sys/transactions/:tx_id/frames', () => {
  let gateway: FakeGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    gateway = makeFakeGateway();
    app = await buildApp(gateway);
  });

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({ method: 'GET', url: '/sys/transactions/42/frames' });
    expect(res.statusCode).toBe(401);
    expect(gateway.listTransactionFrames).not.toHaveBeenCalled();
  });

  it('forwards the upstream body unchanged', async () => {
    const upstream = {
      transaction_id: 42,
      frames: [
        {
          event_id: 'evt-1',
          occurred_at: '2026-05-14T10:00:00Z',
          cp_id: 'CP_A',
          direction: 'inbound',
          action: 'StartTransaction',
          message_type: 2,
          message_id: 'm1',
          ocpp_version: '1.6',
          transaction_id: 42,
          raw_payload: '[2,"m1","StartTransaction",{}]',
        },
      ],
      request_id: 'req-1',
    };
    gateway.listTransactionFrames.mockResolvedValue(upstream);
    const res = await app.inject({
      method: 'GET',
      url: '/sys/transactions/42/frames',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(upstream);
    expect(gateway.listTransactionFrames).toHaveBeenCalledWith(42, {});
  });

  it('forwards limit when present and bounds it', async () => {
    gateway.listTransactionFrames.mockResolvedValue({ transaction_id: 42, frames: [] });
    await app.inject({
      method: 'GET',
      url: '/sys/transactions/42/frames?limit=250',
      headers: { authorization: authHeader(app) },
    });
    expect(gateway.listTransactionFrames).toHaveBeenLastCalledWith(42, { limit: 250 });

    const tooBig = await app.inject({
      method: 'GET',
      url: '/sys/transactions/42/frames?limit=20000',
      headers: { authorization: authHeader(app) },
    });
    expect(tooBig.statusCode).toBe(400);

    const zero = await app.inject({
      method: 'GET',
      url: '/sys/transactions/42/frames?limit=0',
      headers: { authorization: authHeader(app) },
    });
    expect(zero.statusCode).toBe(400);
  });

  it('rejects a non-integer tx_id with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/transactions/banana/frames',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(400);
    expect(gateway.listTransactionFrames).not.toHaveBeenCalled();
  });

  it('passes through a 404 from upstream when tx is unknown', async () => {
    const err = Object.assign(new Error('upstream'), {
      status: 404,
      body: JSON.stringify({ error: 'unknown-tx', error_code: 'UNKNOWN_TRANSACTION_ID' }),
    });
    gateway.listTransactionFrames.mockRejectedValue(err);
    const res = await app.inject({
      method: 'GET',
      url: '/sys/transactions/9999999/frames',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: 'unknown-tx',
      error_code: 'UNKNOWN_TRANSACTION_ID',
    });
  });

  it('does NOT collide with GET /sys/transactions/:tx_id (the detail route)', async () => {
    // The two routes differ by the trailing `/frames` segment. Confirm
    // detail still works after the frames route is registered.
    gateway.getTransaction.mockResolvedValue({ transaction_id: 42 });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/transactions/42',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(gateway.getTransaction).toHaveBeenCalledWith(42);
    expect(gateway.listTransactionFrames).not.toHaveBeenCalled();
  });
});
