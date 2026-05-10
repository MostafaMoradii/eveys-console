// Light-touch route test: the proxy is a thin shim over the gateway
// client, so the value-add here is verifying (a) routes are wired at
// the expected paths, (b) JWT auth is enforced, (c) responses are
// passed through unchanged, (d) gateway errors are surfaced with the
// upstream envelope, and (e) the meter-values query params are
// forwarded verbatim. Heavier integration coverage lives in the
// gateway repo.

import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSysTransactionsRoute } from '../src/routes/sys-transactions.js';

const JWT_SECRET = 'a-test-secret-of-at-least-16-bytes';

interface FakeGateway {
  getTransaction: ReturnType<typeof vi.fn>;
  listMeterValues: ReturnType<typeof vi.fn>;
}

function makeFakeGateway(): FakeGateway {
  return {
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

describe('GET /sys/transactions/:tx_id', () => {
  let gateway: FakeGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    gateway = makeFakeGateway();
    app = await buildApp(gateway);
  });

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({ method: 'GET', url: '/sys/transactions/42' });
    expect(res.statusCode).toBe(401);
    expect(gateway.getTransaction).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric tx_id with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/transactions/abc',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(400);
    expect(gateway.getTransaction).not.toHaveBeenCalled();
  });

  it('forwards the tx_id (parsed to a number) and passes the response through', async () => {
    const body = {
      transaction_id: 42,
      cp_id: 'CP_A',
      connector_id: 1,
      id_tag: 'TAG1',
      meter_start_wh: 100,
      meter_stop_wh: 5500,
      started_at: '2026-05-10T12:00:00Z',
      stopped_at: '2026-05-10T13:00:00Z',
      stop_reason: 'Local',
      open: false,
      telemetry: null,
    };
    gateway.getTransaction.mockResolvedValue(body);

    const res = await app.inject({
      method: 'GET',
      url: '/sys/transactions/42',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(body);
    expect(gateway.getTransaction).toHaveBeenCalledWith(42);
  });

  it('surfaces a 404 from the gateway with the upstream envelope intact', async () => {
    const err = Object.assign(new Error('upstream'), {
      status: 404,
      body: JSON.stringify({ error: 'not-found', detail: 'unknown tx' }),
    });
    gateway.getTransaction.mockRejectedValue(err);
    const res = await app.inject({
      method: 'GET',
      url: '/sys/transactions/9999',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not-found', detail: 'unknown tx' });
  });
});

describe('GET /sys/charge-points/:cp_id/meter-values', () => {
  let gateway: FakeGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    gateway = makeFakeGateway();
    app = await buildApp(gateway);
  });

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/CP_A/meter-values?from=2026-05-10T12:00:00Z&to=2026-05-10T13:00:00Z',
    });
    expect(res.statusCode).toBe(401);
    expect(gateway.listMeterValues).not.toHaveBeenCalled();
  });

  it('rejects a request without from/to with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/CP_A/meter-values',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(400);
    expect(gateway.listMeterValues).not.toHaveBeenCalled();
  });

  it('forwards from/to/measurand to the gateway and passes the response through', async () => {
    const body = {
      meter_values: [
        {
          cp_id: 'CP_A',
          connector_id: 1,
          transaction_id: 42,
          occurred_at: '2026-05-10T12:00:30Z',
          measurand: 'Power.Active.Import',
          phase: 'L1',
          unit: 'W',
          value: 7400,
        },
      ],
      next_cursor: null,
    };
    gateway.listMeterValues.mockResolvedValue(body);

    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/CP_A/meter-values?from=2026-05-10T12:00:00Z&to=2026-05-10T13:00:00Z&measurand=Power.Active.Import',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(body);
    expect(gateway.listMeterValues).toHaveBeenCalledWith('CP_A', {
      from: '2026-05-10T12:00:00Z',
      to: '2026-05-10T13:00:00Z',
      measurand: 'Power.Active.Import',
    });
  });

  it('parses connector_id and limit as integers', async () => {
    gateway.listMeterValues.mockResolvedValue({ meter_values: [], next_cursor: null });
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/CP_A/meter-values?from=2026-05-10T12:00:00Z&to=2026-05-10T13:00:00Z&connector_id=2&limit=500',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(gateway.listMeterValues).toHaveBeenCalledWith('CP_A', {
      from: '2026-05-10T12:00:00Z',
      to: '2026-05-10T13:00:00Z',
      connector_id: 2,
      limit: 500,
    });
  });

  it('rejects a non-integer limit with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/CP_A/meter-values?from=2026-05-10T12:00:00Z&to=2026-05-10T13:00:00Z&limit=notanumber',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(400);
    expect(gateway.listMeterValues).not.toHaveBeenCalled();
  });

  it('translates a generic gateway error to 502', async () => {
    gateway.listMeterValues.mockRejectedValue(new Error('boom'));
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/CP_A/meter-values?from=2026-05-10T12:00:00Z&to=2026-05-10T13:00:00Z',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'gateway-unavailable' });
  });
});
