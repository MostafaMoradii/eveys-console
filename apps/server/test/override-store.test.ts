// Tests for the runtime-override store + the getEffective helper.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OverrideStore, getEffective, isOverridable } from '../src/store/override-store.js';

let dir: string;
let path: string;
let store: OverrideStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'override-'));
  path = join(dir, 'console-overrides.json');
  store = new OverrideStore(path);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('OverrideStore — empty / load', () => {
  it('starts empty when no file exists', async () => {
    await store.load();
    expect(store.snapshot().overrides).toEqual({});
  });

  it('starts empty when the file is corrupt JSON', async () => {
    await writeFile(path, '{garbage', 'utf8');
    await store.load();
    expect(store.snapshot().overrides).toEqual({});
  });

  it('loads valid overrides from disk', async () => {
    await writeFile(
      path,
      JSON.stringify({ overrides: { LOG_LEVEL: 'debug', PROMETHEUS_URL: 'http://x' } }),
      'utf8',
    );
    await store.load();
    expect(store.get('LOG_LEVEL')).toBe('debug');
    expect(store.get('PROMETHEUS_URL')).toBe('http://x');
  });

  it('ignores keys not in the allowlist', async () => {
    await writeFile(
      path,
      JSON.stringify({ overrides: { JWT_SECRET: 'leaked', LOG_LEVEL: 'debug' } }),
      'utf8',
    );
    await store.load();
    expect(store.snapshot().overrides).toEqual({ LOG_LEVEL: 'debug' });
  });
});

describe('OverrideStore — set / clear', () => {
  it('set persists to disk atomically', async () => {
    await store.set('LOG_LEVEL', 'debug');
    expect(store.get('LOG_LEVEL')).toBe('debug');
    const text = await readFile(path, 'utf8');
    const parsed = JSON.parse(text) as { overrides: Record<string, string> };
    expect(parsed.overrides.LOG_LEVEL).toBe('debug');
  });

  it('clear removes the key + persists', async () => {
    await store.set('LOG_LEVEL', 'debug');
    await store.clear('LOG_LEVEL');
    expect(store.get('LOG_LEVEL')).toBeUndefined();
    const text = await readFile(path, 'utf8');
    const parsed = JSON.parse(text) as { overrides: Record<string, string> };
    expect(parsed.overrides.LOG_LEVEL).toBeUndefined();
  });

  it('clear is a no-op for unset keys', async () => {
    await store.clear('LOG_LEVEL');
    expect(store.snapshot().overrides).toEqual({});
  });

  it('overrides survive a fresh load() (per-process restart)', async () => {
    await store.set('PROMETHEUS_URL', 'http://my-prom:9090');
    const fresh = new OverrideStore(path);
    await fresh.load();
    expect(fresh.get('PROMETHEUS_URL')).toBe('http://my-prom:9090');
  });
});

describe('isOverridable', () => {
  it('says yes to allowlisted keys', () => {
    expect(isOverridable('LOG_LEVEL')).toBe(true);
    expect(isOverridable('PROMETHEUS_URL')).toBe(true);
    expect(isOverridable('GATEWAY_BASE_URL')).toBe(true);
  });

  it('says no to bind-time / secret keys', () => {
    expect(isOverridable('HOST')).toBe(false);
    expect(isOverridable('PORT')).toBe(false);
    expect(isOverridable('JWT_SECRET')).toBe(false);
    expect(isOverridable('JWT_AUDIENCE')).toBe(false);
    expect(isOverridable('CONSOLE_USERS')).toBe(false);
    expect(isOverridable('KAFKA_BROKERS')).toBe(false);
  });

  it('says no to nonsense keys', () => {
    expect(isOverridable('NOT_A_KEY')).toBe(false);
  });
});

describe('getEffective', () => {
  // Build a minimal Config-shaped fake; only the keys we touch
  // need to be representative.
  const cfg = {
    LOG_LEVEL: 'info',
    JWT_TTL_SECONDS: 28800,
    LOG_PRETTY: false,
    ALLOWED_ORIGINS: ['https://a.example.com'],
    PROMETHEUS_URL: undefined as string | undefined,
    JWT_SECRET: 'real-secret-do-not-leak',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as Parameters<typeof getEffective>[0] as any;

  it('returns env value when no override is set', () => {
    expect(getEffective(cfg, store, 'LOG_LEVEL')).toBe('info');
  });

  it('returns override when set for a string key', async () => {
    await store.set('LOG_LEVEL', 'debug');
    expect(getEffective(cfg, store, 'LOG_LEVEL')).toBe('debug');
  });

  it('parses override numeric correctly', async () => {
    await store.set('JWT_TTL_SECONDS', '3600');
    expect(getEffective(cfg, store, 'JWT_TTL_SECONDS')).toBe(3600);
  });

  it('parses override boolean correctly', async () => {
    await store.set('LOG_PRETTY', 'true');
    expect(getEffective(cfg, store, 'LOG_PRETTY')).toBe(true);
  });

  it('parses override list (csv) correctly', async () => {
    await store.set('ALLOWED_ORIGINS', 'https://x.example.com, https://y.example.com');
    expect(getEffective(cfg, store, 'ALLOWED_ORIGINS')).toEqual([
      'https://x.example.com',
      'https://y.example.com',
    ]);
  });

  it('refuses to read overrides for non-allowlisted keys', async () => {
    // Sanity: even if someone manually planted JWT_SECRET in the
    // file, isOverridable() at load-time should have filtered it.
    // But getEffective() also guards.
    expect(getEffective(cfg, store, 'JWT_SECRET')).toBe('real-secret-do-not-leak');
  });
});
