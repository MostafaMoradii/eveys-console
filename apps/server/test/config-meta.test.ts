import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { describeConfig, __forTest } from '../src/config-meta.js';

const { MASK } = __forTest;

const baseEnv: NodeJS.ProcessEnv = {
  JWT_SECRET: 'a-secret-of-at-least-16-bytes-long',
  GATEWAY_BASE_URL: 'http://localhost:8080',
  GATEWAY_TOKEN: 'dev-token',
  KAFKA_BROKERS: 'broker1:9092,broker2:9092',
};

describe('describeConfig', () => {
  it('emits an entry for every config key', () => {
    const cfg = loadConfig(baseEnv);
    const entries = describeConfig(cfg, baseEnv);
    const keys = entries.map((e) => e.key).sort();
    expect(keys).toContain('PORT');
    expect(keys).toContain('JWT_SECRET');
    expect(keys).toContain('KAFKA_BROKERS');
    // Sanity-check that all 26 keys we have today are present.
    expect(entries.length).toBe(Object.keys(cfg).length);
  });

  it('masks sensitive values when set', () => {
    const cfg = loadConfig(baseEnv);
    const entries = describeConfig(cfg, baseEnv);

    const jwt = entries.find((e) => e.key === 'JWT_SECRET');
    expect(jwt).toBeDefined();
    expect(jwt!.sensitive).toBe(true);
    expect(jwt!.value).toBe(MASK);
    expect(jwt!.value).not.toContain('a-secret-of'); // not leaked

    const token = entries.find((e) => e.key === 'GATEWAY_TOKEN');
    expect(token!.value).toBe(MASK);
  });

  it('does not mask sensitive values when empty (renders as empty string)', () => {
    const cfg = loadConfig(baseEnv);
    const entries = describeConfig(cfg, baseEnv);
    // CONSOLE_USERS is sensitive and defaults to ''.
    const users = entries.find((e) => e.key === 'CONSOLE_USERS');
    expect(users!.sensitive).toBe(true);
    expect(users!.value).toBe('');
  });

  it('reports source=env for keys that came from the environment', () => {
    const cfg = loadConfig(baseEnv);
    const entries = describeConfig(cfg, baseEnv);
    const url = entries.find((e) => e.key === 'GATEWAY_BASE_URL');
    expect(url!.source).toBe('env');
  });

  it('reports source=default for keys that fell back to the schema default', () => {
    const cfg = loadConfig(baseEnv);
    const entries = describeConfig(cfg, baseEnv);
    const port = entries.find((e) => e.key === 'PORT');
    expect(port!.source).toBe('default');
    expect(port!.default).toBe('8090');
    expect(port!.value).toBe('8090');
  });

  it('renders array values as CSV', () => {
    const cfg = loadConfig(baseEnv);
    const entries = describeConfig(cfg, baseEnv);
    const brokers = entries.find((e) => e.key === 'KAFKA_BROKERS');
    expect(brokers!.value).toBe('broker1:9092,broker2:9092');
  });

  it('every entry carries description / category / range / mutable / restart', () => {
    const cfg = loadConfig(baseEnv);
    const entries = describeConfig(cfg, baseEnv);
    for (const entry of entries) {
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.category.length).toBeGreaterThan(0);
      expect(entry.range.length).toBeGreaterThan(0);
      expect(typeof entry.mutable).toBe('boolean');
      expect(['none', 'console', 'gateway', 'both']).toContain(entry.restart);
    }
  });

  it('topic keys mark restart=console (Console-side change; gateway-side has its own copy)', () => {
    const cfg = loadConfig(baseEnv);
    const entries = describeConfig(cfg, baseEnv);
    const topicKeys = entries.filter((e) => e.key.startsWith('KAFKA_TOPICS_'));
    expect(topicKeys.length).toBeGreaterThan(0);
    for (const entry of topicKeys) {
      expect(entry.restart).toBe('console');
    }
  });

  it('groups keys into the expected categories', () => {
    const cfg = loadConfig(baseEnv);
    const entries = describeConfig(cfg, baseEnv);
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e.category]));

    // Spot-check the expected category for each prefix family.
    expect(byKey.HOST).toBe('network');
    expect(byKey.PORT).toBe('network');
    expect(byKey.LOG_LEVEL).toBe('logging');
    expect(byKey.JWT_SECRET).toBe('auth');
    expect(byKey.AUTH_POW_DIFFICULTY).toBe('auth');
    expect(byKey.CONSOLE_USERS).toBe('auth');
    expect(byKey.ALLOWED_ORIGINS).toBe('auth');
    expect(byKey.GATEWAY_BASE_URL).toBe('gateway');
    expect(byKey.KAFKA_BROKERS).toBe('kafka');
    expect(byKey.KAFKA_TOPICS_BOOT).toBe('kafka');
    expect(byKey.WS_PING_INTERVAL_MS).toBe('websocket');
  });
});
