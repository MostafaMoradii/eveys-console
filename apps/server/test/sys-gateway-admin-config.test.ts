// Light-touch route test: the proxy is a thin shim over the gateway
// client, so the value-add here is verifying (a) the routes are wired
// at the expected paths, (b) auth is enforced on each, (c) the bodies
// are forwarded to the gateway 1:1 and responses are passed through
// unchanged. Heavier integration coverage lives in the gateway repo.

import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSysGatewayAdminConfigRoute } from '../src/routes/sys-gateway-admin-config.js';

const JWT_SECRET = 'a-test-secret-of-at-least-16-bytes';

interface FakeGateway {
  adminConfig: ReturnType<typeof vi.fn>;
  patchAdminConfig: ReturnType<typeof vi.fn>;
  deleteAdminConfigOverride: ReturnType<typeof vi.fn>;
}

function makeFakeGateway(): FakeGateway {
  return {
    adminConfig: vi.fn(),
    patchAdminConfig: vi.fn(),
    deleteAdminConfigOverride: vi.fn(),
  };
}

async function buildApp(gateway: FakeGateway): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await registerSysGatewayAdminConfigRoute(app, { gateway: gateway as any });
  await app.ready();
  return app;
}

function authHeader(app: FastifyInstance): string {
  // Minimal payload — the route just calls req.jwtVerify(), no audience check.
  const token = app.jwt.sign({ sub: 'tester' });
  return `Bearer ${token}`;
}

describe('GET /sys/gateway-admin-config', () => {
  let gateway: FakeGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    gateway = makeFakeGateway();
    app = await buildApp(gateway);
  });

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({ method: 'GET', url: '/sys/gateway-admin-config' });
    expect(res.statusCode).toBe(401);
    expect(gateway.adminConfig).not.toHaveBeenCalled();
  });

  it('forwards the gateway response on success', async () => {
    const body = {
      scope: 'gateway',
      overrides: { log_level: 'DEBUG' },
      allowlist: { log_level: 'desc' },
    };
    gateway.adminConfig.mockResolvedValue(body);

    const res = await app.inject({
      method: 'GET',
      url: '/sys/gateway-admin-config',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(body);
  });

  it('translates a gateway error to 502 with the upstream envelope', async () => {
    const err = Object.assign(new Error('upstream'), {
      status: 503,
      body: JSON.stringify({ error: 'upstream-down' }),
    });
    gateway.adminConfig.mockRejectedValue(err);

    const res = await app.inject({
      method: 'GET',
      url: '/sys/gateway-admin-config',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'upstream-down' });
  });
});

describe('POST /sys/gateway-admin-config', () => {
  let gateway: FakeGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    gateway = makeFakeGateway();
    app = await buildApp(gateway);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sys/gateway-admin-config',
      payload: { updates: { log_level: 'INFO' } },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a body without an updates object', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sys/gateway-admin-config',
      headers: { authorization: authHeader(app) },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(gateway.patchAdminConfig).not.toHaveBeenCalled();
  });

  it('forwards updates to the gateway and passes the response through', async () => {
    gateway.patchAdminConfig.mockResolvedValue({
      scope: 'gateway',
      overrides: { log_level: 'DEBUG' },
      allowlist: { log_level: 'desc' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/sys/gateway-admin-config',
      headers: { authorization: authHeader(app) },
      payload: { updates: { log_level: 'DEBUG' } },
    });
    expect(res.statusCode).toBe(200);
    expect(gateway.patchAdminConfig).toHaveBeenCalledWith({ log_level: 'DEBUG' });
  });
});

describe('DELETE /sys/gateway-admin-config/overrides/:key', () => {
  let gateway: FakeGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    gateway = makeFakeGateway();
    app = await buildApp(gateway);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/sys/gateway-admin-config/overrides/log_level',
    });
    expect(res.statusCode).toBe(401);
  });

  it('forwards the key to the gateway', async () => {
    gateway.deleteAdminConfigOverride.mockResolvedValue({
      scope: 'gateway',
      overrides: {},
      allowlist: { log_level: 'desc' },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/sys/gateway-admin-config/overrides/log_level',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(gateway.deleteAdminConfigOverride).toHaveBeenCalledWith('log_level');
  });
});
