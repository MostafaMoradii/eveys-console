// Tests for the Console-side runtime overrides admin route.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../src/config.js';
import { registerSysConsoleAdminConfigRoute } from '../src/routes/sys-console-admin-config.js';
import { OverrideStore } from '../src/store/override-store.js';

const JWT_SECRET = 'a-test-secret-of-at-least-16-bytes';

function fakeConfig(): Config {
  return {
    HOST: '0.0.0.0',
    PORT: 8090,
    LOG_LEVEL: 'info',
    LOG_PRETTY: false,
    JWT_SECRET: 'real-secret-do-not-leak',
    JWT_AUDIENCE: 'eveys-console',
    JWT_ISSUER: 'eveys-console',
    JWT_TTL_SECONDS: 28800,
    CONSOLE_USERS: '',
    AUTH_POW_DIFFICULTY: 16,
    AUTH_POW_TTL_SECONDS: 120,
    AUTH_LOGIN_MAX_PER_MIN: 5,
    ALLOWED_ORIGINS: [],
    GATEWAY_BASE_URL: 'http://localhost:8080',
    GATEWAY_TOKEN: 'dev-token',
    ALERTMANAGER_URL: undefined,
    ALERTMANAGER_CONFIG_PATH: './data/alertmanager-managed.yml',
    PROMETHEUS_URL: undefined,
    ALERTS_RULES_CONFIG_PATH: './data/alerts-managed.yml',
    PROMTOOL_PATH: 'promtool',
    KAFKA_BROKERS: ['localhost:9092'],
    KAFKA_CLIENT_ID: 'eveys-console',
    KAFKA_GROUP_ID: 'eveys-console',
    KAFKA_TOPICS_BOOT: 'cp.boot',
    KAFKA_TOPICS_STATUS: 'cp.status',
    KAFKA_TOPICS_METER: 'cp.meter',
    KAFKA_TOPICS_TX_STARTED: 'tx.started',
    WS_MAX_SUBSCRIPTIONS_PER_CONN: 50,
    WS_PING_INTERVAL_MS: 30000,
    WS_IDLE_TIMEOUT_MS: 120000,
    DIAGNOSTICS_DATA_DIR: './data',
    DIAGNOSTICS_UPLOAD_TTL_SECONDS: 3600,
    DIAGNOSTICS_MAX_UPLOAD_BYTES: 50 * 1024 * 1024,
    CONSOLE_PUBLIC_BASE_URL: undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

let app: FastifyInstance;
let store: OverrideStore;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'console-admin-'));
  store = new OverrideStore(join(dir, 'console-overrides.json'));
  await store.load();

  app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  await registerSysConsoleAdminConfigRoute(app, { config: fakeConfig(), overrideStore: store });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

function authHeader(): string {
  return `Bearer ${app.jwt.sign({ sub: 'tester' })}`;
}

describe('GET /sys/admin/console-config', () => {
  it('returns 401 without a JWT', async () => {
    const res = await app.inject({ method: 'GET', url: '/sys/admin/console-config' });
    expect(res.statusCode).toBe(401);
  });

  it('returns entries with overridable_keys', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/admin/console-config',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      entries: Array<{ key: string; overridable: boolean; source: string }>;
      overridable_keys: string[];
    };
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.overridable_keys).toContain('LOG_LEVEL');
    expect(body.overridable_keys).not.toContain('HOST');
    // The LOG_LEVEL entry should be marked overridable + come from env (default).
    const logLevel = body.entries.find((e) => e.key === 'LOG_LEVEL');
    expect(logLevel?.overridable).toBe(true);
  });

  it('reflects an active override with source=override', async () => {
    await store.set('LOG_LEVEL', 'debug');
    const res = await app.inject({
      method: 'GET',
      url: '/sys/admin/console-config',
      headers: { authorization: authHeader() },
    });
    const body = res.json() as { entries: Array<{ key: string; value: string; source: string }> };
    const logLevel = body.entries.find((e) => e.key === 'LOG_LEVEL');
    expect(logLevel?.source).toBe('override');
    expect(logLevel?.value).toBe('debug');
  });
});

describe('POST /sys/admin/console-config', () => {
  it('rejects an invalid body shape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sys/admin/console-config',
      headers: { authorization: authHeader() },
      payload: { not_key: 'X' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-allowlisted key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sys/admin/console-config',
      headers: { authorization: authHeader() },
      payload: { key: 'JWT_SECRET', value: 'tampered' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'not_overridable' });
  });

  it('sets an allowlisted key and persists', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sys/admin/console-config',
      headers: { authorization: authHeader() },
      payload: { key: 'LOG_LEVEL', value: 'debug' },
    });
    expect(res.statusCode).toBe(200);
    expect(store.get('LOG_LEVEL')).toBe('debug');
  });

  it('rejects an invalid value for a schema-typed key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sys/admin/console-config',
      headers: { authorization: authHeader() },
      payload: { key: 'LOG_LEVEL', value: 'wat' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /sys/admin/console-config/overrides/:key', () => {
  it('rejects a non-allowlisted key', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/sys/admin/console-config/overrides/JWT_SECRET',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(400);
  });

  it('clears the override', async () => {
    await store.set('LOG_LEVEL', 'debug');
    const res = await app.inject({
      method: 'DELETE',
      url: '/sys/admin/console-config/overrides/LOG_LEVEL',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(store.get('LOG_LEVEL')).toBeUndefined();
  });
});
