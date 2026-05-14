// Tests for the Console restart endpoints (POST /sys/restart and POST
// /sys/restart-gateway). The actual `process.exit` is patched with a
// spy so Vitest doesn't die mid-suite; the `now()` clock is injected
// so the debounce-replay test doesn't have to sleep real seconds.

import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetRestartDebounceForTests,
  registerSysRestartRoute,
} from '../src/routes/sys-restart.js';

const JWT_SECRET = 'a-test-secret-of-at-least-16-bytes';

interface FakeGateway {
  restartGateway: ReturnType<typeof vi.fn>;
}

function makeFakeGateway(): FakeGateway {
  return { restartGateway: vi.fn() };
}

interface BuildOpts {
  enabled?: boolean;
  debounceMs?: number;
  exitProcess?: (code: number) => void;
  now?: () => number;
}

async function buildApp(gateway: FakeGateway, opts: BuildOpts = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  await registerSysRestartRoute(app, {
    config: {
      CONSOLE_RESTART_ENABLED: opts.enabled ?? false,
      CONSOLE_RESTART_DEBOUNCE_MS: opts.debounceMs ?? 5000,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gateway: gateway as any,
    exitProcess: opts.exitProcess ?? (() => {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  await app.ready();
  return app;
}

function authHeader(app: FastifyInstance): string {
  const token = app.jwt.sign({ sub: 'tester' });
  return `Bearer ${token}`;
}

beforeEach(() => {
  _resetRestartDebounceForTests();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  _resetRestartDebounceForTests();
});

describe('POST /sys/restart', () => {
  it('returns 401 without a JWT', async () => {
    const gateway = makeFakeGateway();
    const exit = vi.fn();
    const app = await buildApp(gateway, { enabled: true, exitProcess: exit });
    const res = await app.inject({ method: 'POST', url: '/sys/restart' });
    expect(res.statusCode).toBe(401);
    expect(exit).not.toHaveBeenCalled();
  });

  it('returns 503 when CONSOLE_RESTART_ENABLED is false (default)', async () => {
    const gateway = makeFakeGateway();
    const exit = vi.fn();
    const app = await buildApp(gateway, { enabled: false, exitProcess: exit });
    const res = await app.inject({
      method: 'POST',
      url: '/sys/restart',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error_code).toBe('SERVICE_UNAVAILABLE');
    expect(res.json().detail).toContain('CONSOLE_RESTART_ENABLED');
    expect(exit).not.toHaveBeenCalled();
  });

  it('returns 202 and schedules process.exit(0) when enabled', async () => {
    const gateway = makeFakeGateway();
    const exit = vi.fn();
    const app = await buildApp(gateway, { enabled: true, exitProcess: exit });
    const res = await app.inject({
      method: 'POST',
      url: '/sys/restart',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'scheduled', exits_in_ms: 500 });
    // Exit hasn't been called yet — the 500ms timer is pending.
    expect(exit).not.toHaveBeenCalled();
    // Advance time and confirm the exit fires with code 0.
    vi.advanceTimersByTime(500);
    expect(exit).toHaveBeenCalledWith(0);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('debounces a second call within the window without firing a second exit', async () => {
    const gateway = makeFakeGateway();
    const exit = vi.fn();
    let t = 1000;
    const app = await buildApp(gateway, {
      enabled: true,
      debounceMs: 5000,
      exitProcess: exit,
      now: () => t,
    });
    const first = await app.inject({
      method: 'POST',
      url: '/sys/restart',
      headers: { authorization: authHeader(app) },
    });
    expect(first.json().status).toBe('scheduled');

    // Second call ~1s later — well inside the 5s debounce.
    t += 1000;
    const second = await app.inject({
      method: 'POST',
      url: '/sys/restart',
      headers: { authorization: authHeader(app) },
    });
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual({ status: 'already_scheduled', exits_in_ms: 0 });

    // Only the first call queued an exit timer.
    vi.advanceTimersByTime(500);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('honours a fresh call after the debounce window expires', async () => {
    const gateway = makeFakeGateway();
    const exit = vi.fn();
    let t = 1000;
    const app = await buildApp(gateway, {
      enabled: true,
      debounceMs: 100,
      exitProcess: exit,
      now: () => t,
    });
    const first = await app.inject({
      method: 'POST',
      url: '/sys/restart',
      headers: { authorization: authHeader(app) },
    });
    expect(first.json().status).toBe('scheduled');

    // Jump past the debounce.
    t += 200;
    const second = await app.inject({
      method: 'POST',
      url: '/sys/restart',
      headers: { authorization: authHeader(app) },
    });
    expect(second.json().status).toBe('scheduled');

    // Two exits queued — operator can re-trigger after the window.
    vi.advanceTimersByTime(500);
    expect(exit).toHaveBeenCalledTimes(2);
  });
});

describe('POST /sys/restart-gateway', () => {
  it('returns 401 without a JWT', async () => {
    const gateway = makeFakeGateway();
    const app = await buildApp(gateway);
    const res = await app.inject({ method: 'POST', url: '/sys/restart-gateway' });
    expect(res.statusCode).toBe(401);
    expect(gateway.restartGateway).not.toHaveBeenCalled();
  });

  it('proxies a successful 202 from the gateway through unchanged', async () => {
    const gateway = makeFakeGateway();
    gateway.restartGateway.mockResolvedValue({
      status: 'scheduled',
      exits_in_ms: 500,
      scope: 'per-pod',
      request_id: 'gw-123',
    });
    const app = await buildApp(gateway);
    const res = await app.inject({
      method: 'POST',
      url: '/sys/restart-gateway',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({
      status: 'scheduled',
      exits_in_ms: 500,
      scope: 'per-pod',
      request_id: 'gw-123',
    });
  });

  it('passes through the gateway 503 (admin_restart_enabled=false upstream)', async () => {
    // The gateway returns 503 + structured envelope when its own
    // admin_restart_enabled is false. The proxy passes the body
    // through so the UI can show a meaningful error.
    const gateway = makeFakeGateway();
    const upstreamErr = Object.assign(new Error('upstream'), {
      status: 503,
      body: JSON.stringify({
        error: 'admin restart disabled',
        error_code: 'SERVICE_UNAVAILABLE',
      }),
    });
    gateway.restartGateway.mockRejectedValue(upstreamErr);
    const app = await buildApp(gateway);
    const res = await app.inject({
      method: 'POST',
      url: '/sys/restart-gateway',
      headers: { authorization: authHeader(app) },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: 'admin restart disabled',
      error_code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('debounces a second call within the window without round-tripping to the gateway', async () => {
    const gateway = makeFakeGateway();
    gateway.restartGateway.mockResolvedValue({ status: 'scheduled', exits_in_ms: 500 });
    let t = 1000;
    const app = await buildApp(gateway, { debounceMs: 5000, now: () => t });
    await app.inject({
      method: 'POST',
      url: '/sys/restart-gateway',
      headers: { authorization: authHeader(app) },
    });
    expect(gateway.restartGateway).toHaveBeenCalledTimes(1);

    t += 1000;
    const second = await app.inject({
      method: 'POST',
      url: '/sys/restart-gateway',
      headers: { authorization: authHeader(app) },
    });
    expect(second.json()).toEqual({ status: 'already_scheduled', exits_in_ms: 0 });
    // No second upstream call — the debounce caught it without paying
    // for the RPC.
    expect(gateway.restartGateway).toHaveBeenCalledTimes(1);
  });

  it('does NOT debounce when the upstream returns 503 — operator might enable + retry', async () => {
    // Gateway says "I'm disabled" on the first call. The operator flips
    // EVEYS_OCPP_ADMIN_RESTART_ENABLED upstream and immediately retries.
    // The proxy must NOT have remembered the failed first attempt as
    // "already scheduled" — otherwise the retry is silently swallowed.
    const gateway = makeFakeGateway();
    const upstreamErr = Object.assign(new Error('upstream'), {
      status: 503,
      body: JSON.stringify({ error_code: 'SERVICE_UNAVAILABLE' }),
    });
    gateway.restartGateway
      .mockRejectedValueOnce(upstreamErr)
      .mockResolvedValueOnce({ status: 'scheduled', exits_in_ms: 500 });
    const app = await buildApp(gateway, { debounceMs: 5000 });

    const first = await app.inject({
      method: 'POST',
      url: '/sys/restart-gateway',
      headers: { authorization: authHeader(app) },
    });
    expect(first.statusCode).toBe(503);

    const second = await app.inject({
      method: 'POST',
      url: '/sys/restart-gateway',
      headers: { authorization: authHeader(app) },
    });
    expect(second.statusCode).toBe(202);
    expect(gateway.restartGateway).toHaveBeenCalledTimes(2);
  });
});
