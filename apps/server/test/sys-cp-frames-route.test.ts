// Route test for the OCPP-frames proxy. Pass-through to the gateway
// client; we verify JWT enforcement, validation of from/to and
// direction, and that the upstream body + error envelopes survive
// unchanged.

import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSysCpFramesRoute } from '../src/routes/sys-cp-frames.js';

const JWT_SECRET = 'a-test-secret-of-at-least-16-bytes';

interface FakeGateway {
  listCpFrames: ReturnType<typeof vi.fn>;
}

function makeFakeGateway(): FakeGateway {
  return { listCpFrames: vi.fn() };
}

async function buildApp(gateway: FakeGateway): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await registerSysCpFramesRoute(app, { gateway: gateway as any });
  await app.ready();
  return app;
}

function authHeader(app: FastifyInstance): string {
  const token = app.jwt.sign({ sub: 'tester' });
  return `Bearer ${token}`;
}

describe('GET /sys/charge-points/:cp_id/frames', () => {
  let gateway: FakeGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    gateway = makeFakeGateway();
    app = await buildApp(gateway);
  });

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/frames?from=2026-05-12T00:00:00Z&to=2026-05-12T01:00:00Z',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when from or to is missing', async () => {
    const r1 = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/frames?to=2026-05-12T01:00:00Z',
      headers: { authorization: authHeader(app) },
    });
    expect(r1.statusCode).toBe(400);
    const r2 = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/frames?from=2026-05-12T00:00:00Z',
      headers: { authorization: authHeader(app) },
    });
    expect(r2.statusCode).toBe(400);
  });

  it('rejects an invalid direction value', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/frames?from=2026-05-12T00:00:00Z&to=2026-05-12T01:00:00Z&direction=sideways',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(400);
    expect(gateway.listCpFrames).not.toHaveBeenCalled();
  });

  it('forwards direction + action verbatim and surfaces the upstream body', async () => {
    const upstream = {
      cp_id: 'cp_a',
      frames: [
        {
          event_id: 'evt-x',
          occurred_at: '2026-05-12T00:05:00Z',
          cp_id: 'cp_a',
          direction: 'inbound',
          action: 'MeterValues',
          message_type: 2,
          message_id: 'call-x',
          ocpp_version: 'ocpp1.6',
          transaction_id: 42,
          raw_payload: '[2,"call-x","MeterValues",{"transactionId":42}]',
        },
      ],
      request_id: 'req-1',
    };
    gateway.listCpFrames.mockResolvedValue(upstream);

    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/frames?from=2026-05-12T00:00:00Z&to=2026-05-12T01:00:00Z&direction=inbound&action=MeterValues&limit=50',
      headers: { authorization: authHeader(app) },
    });

    expect(res.statusCode).toBe(200);
    expect(gateway.listCpFrames).toHaveBeenCalledWith('cp_a', {
      from: '2026-05-12T00:00:00Z',
      to: '2026-05-12T01:00:00Z',
      direction: 'inbound',
      action: 'MeterValues',
      limit: 50,
    });
    expect(res.json()).toEqual(upstream);
  });

  it('passes through upstream error envelopes (e.g. 404 UNKNOWN_CP_ID)', async () => {
    const err = new Error('upstream') as Error & { status: number; body: string };
    err.status = 404;
    err.body = JSON.stringify({
      error: 'unknown cp_id',
      error_code: 'UNKNOWN_CP_ID',
      request_id: 'req-x',
    });
    gateway.listCpFrames.mockRejectedValue(err);

    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/UNKNOWN/frames?from=2026-05-12T00:00:00Z&to=2026-05-12T01:00:00Z',
      headers: { authorization: authHeader(app) },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: 'unknown cp_id',
      error_code: 'UNKNOWN_CP_ID',
      request_id: 'req-x',
    });
  });
});
