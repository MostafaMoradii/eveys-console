// Route test for the per-charger reservations proxy. The proxy is a
// thin pass-through over the gateway client; the value-add is
// confirming (a) JWT auth, (b) query param coercion, (c) the upstream
// body passes through unchanged, and (d) a structured upstream error
// envelope survives.

import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSysCpReservationsRoute } from '../src/routes/sys-cp-reservations.js';

const JWT_SECRET = 'a-test-secret-of-at-least-16-bytes';

interface FakeGateway {
  listChargePointReservations: ReturnType<typeof vi.fn>;
}

function makeFakeGateway(): FakeGateway {
  return { listChargePointReservations: vi.fn() };
}

async function buildApp(gateway: FakeGateway): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await registerSysCpReservationsRoute(app, { gateway: gateway as any });
  await app.ready();
  return app;
}

function authHeader(app: FastifyInstance): string {
  const token = app.jwt.sign({ sub: 'tester' });
  return `Bearer ${token}`;
}

describe('GET /sys/charge-points/:cp_id/reservations', () => {
  let gateway: FakeGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    gateway = makeFakeGateway();
    app = await buildApp(gateway);
  });

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/reservations',
    });
    expect(res.statusCode).toBe(401);
    expect(gateway.listChargePointReservations).not.toHaveBeenCalled();
  });

  it('passes the upstream body through unchanged', async () => {
    const upstream = {
      reservations: [
        {
          reservation_id: 42,
          connector_id: 1,
          id_tag: 'TAG_A',
          parent_id_tag: null,
          expiry_date: '2026-05-12T10:00:00+00:00',
          status: 'Active',
          created_at: '2026-05-12T09:00:00+00:00',
          updated_at: '2026-05-12T09:00:00+00:00',
        },
      ],
      next_cursor: null,
      request_id: 'rid-1',
    };
    gateway.listChargePointReservations.mockResolvedValue(upstream);
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/reservations',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(upstream);
    expect(gateway.listChargePointReservations).toHaveBeenCalledWith('cp_a', {});
  });

  it('forwards active / status / id_tag / limit query params', async () => {
    gateway.listChargePointReservations.mockResolvedValue({ reservations: [] });
    await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/reservations?active=true&status=Active&id_tag=TAG&limit=20',
      headers: { authorization: authHeader(app) },
    });
    expect(gateway.listChargePointReservations).toHaveBeenCalledWith('cp_a', {
      active: true,
      status: 'Active',
      id_tag: 'TAG',
      limit: 20,
    });
  });

  it('coerces active=false and drops garbage values', async () => {
    gateway.listChargePointReservations.mockResolvedValue({ reservations: [] });
    await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/reservations?active=false',
      headers: { authorization: authHeader(app) },
    });
    expect(gateway.listChargePointReservations).toHaveBeenLastCalledWith('cp_a', {
      active: false,
    });

    await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/reservations?active=banana&limit=zero',
      headers: { authorization: authHeader(app) },
    });
    expect(gateway.listChargePointReservations).toHaveBeenLastCalledWith('cp_a', {});
  });

  it('translates an upstream error envelope to the same status', async () => {
    const err = Object.assign(new Error('upstream'), {
      status: 503,
      body: JSON.stringify({ error: 'upstream-down' }),
    });
    gateway.listChargePointReservations.mockRejectedValue(err);

    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/cp_a/reservations',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'upstream-down' });
  });
});
