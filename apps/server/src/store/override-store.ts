// Console-side runtime override store. Mirrors the gateway's
// runtime_overrides allowlist: a small set of Console config keys
// the operator can change from /sys/config without bouncing the
// process.
//
// Persisted as a flat JSON file at OVERRIDES_PATH. Atomic write
// via tmpfile+rename. Loaded on boot; mutations go to disk
// synchronously so an immediate process restart preserves the
// override.
//
// The override store does NOT validate values — that's the route
// layer's job (zod against the key's schema). The store just holds
// strings keyed by config-key names.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Config } from '../config.js';

/** Allowlist of Console config keys that can be overridden at runtime.
 *
 *  Excluded by design:
 *  - HOST / PORT — bind-time, would need a process restart anyway
 *  - JWT_SECRET / JWT_AUDIENCE / JWT_ISSUER — changing invalidates
 *    every active session
 *  - CONSOLE_USERS — separate flow (the hash-password script)
 *  - KAFKA_* — kafkajs consumer state is built at boot; runtime
 *    change wouldn't propagate without rebuilding the consumer
 *  - DIAGNOSTICS_DATA_DIR / ALERTMANAGER_CONFIG_PATH / ALERTS_RULES_CONFIG_PATH —
 *    paths bound to filesystem mounts at boot
 *  - PROMTOOL_PATH — set at boot when the store is constructed
 */
export const OVERRIDABLE_KEYS = [
  'LOG_LEVEL',
  'LOG_PRETTY',
  'JWT_TTL_SECONDS',
  'AUTH_POW_DIFFICULTY',
  'AUTH_POW_TTL_SECONDS',
  'AUTH_LOGIN_MAX_PER_MIN',
  'ALLOWED_ORIGINS',
  'GATEWAY_BASE_URL',
  'GATEWAY_TOKEN',
  'ALERTMANAGER_URL',
  'PROMETHEUS_URL',
  'WS_MAX_SUBSCRIPTIONS_PER_CONN',
  'WS_PING_INTERVAL_MS',
  'WS_IDLE_TIMEOUT_MS',
  'DIAGNOSTICS_UPLOAD_TTL_SECONDS',
  'DIAGNOSTICS_MAX_UPLOAD_BYTES',
] as const;

export type OverridableKey = (typeof OVERRIDABLE_KEYS)[number];

export function isOverridable(key: string): key is OverridableKey {
  return (OVERRIDABLE_KEYS as readonly string[]).includes(key);
}

/** Effective value for a given key. The route layer uses this when
 *  rendering the config list so the UI reflects current state, not
 *  the boot-time env. */
export interface OverrideStoreSnapshot {
  overrides: Record<string, string>;
}

export class OverrideStore {
  private overrides: Record<string, string> = {};

  constructor(private readonly path: string) {}

  /** Load the persisted overrides on boot. Missing file = empty
   *  state; corrupt file logs + resets to empty so the Console can
   *  always start. */
  async load(): Promise<void> {
    try {
      const text = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        const candidate = obj.overrides;
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          for (const [k, v] of Object.entries(candidate)) {
            if (typeof v === 'string' && isOverridable(k)) {
              this.overrides[k] = v;
            }
          }
        }
      }
    } catch (err) {
      if (!isNoEntry(err)) {
        // Log + continue with empty state. The route layer surfaces
        // this via the existing /healthz path; we don't refuse to
        // boot.
        // eslint-disable-next-line no-console
        console.warn('[override-store] failed to load, starting empty:', err);
      }
    }
  }

  /** Atomic write of the current state. */
  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify({ overrides: this.overrides }, null, 2), 'utf8');
    await rename(tmp, this.path);
  }

  /** Read the current override for a key, or undefined when unset. */
  get(key: OverridableKey): string | undefined {
    return this.overrides[key];
  }

  /** Snapshot for callers that want the full set (e.g. the
   *  describe-config route). */
  snapshot(): OverrideStoreSnapshot {
    return { overrides: { ...this.overrides } };
  }

  /** Set an override; persists immediately. */
  async set(key: OverridableKey, value: string): Promise<void> {
    this.overrides[key] = value;
    await this.persist();
  }

  /** Drop an override; persists immediately. No-op if unset. */
  async clear(key: OverridableKey): Promise<void> {
    if (!(key in this.overrides)) return;
    delete this.overrides[key];
    await this.persist();
  }
}

/** Resolve the effective value for a Console config key:
 *  override (parsed by the schema) > env-loaded value.
 *
 *  Returns the value as `string` because all consumers stringify it
 *  through stringify() in config-meta. Numeric / boolean keys are
 *  parsed by the schema validator at write time (route layer) so we
 *  trust the override is already type-correct when read. */
export function getEffective<K extends keyof Config>(
  cfg: Config,
  store: OverrideStore | undefined,
  key: K,
): Config[K] {
  if (!store || !isOverridable(String(key))) return cfg[key];
  const raw = store.get(key as OverridableKey);
  if (raw === undefined) return cfg[key];
  // Numbers / booleans / lists need parsing; we mirror the zod schema.
  return parseForKey(key, raw, cfg[key]);
}

function parseForKey<K extends keyof Config>(key: K, raw: string, fallback: Config[K]): Config[K] {
  const sample = fallback as unknown;
  if (typeof sample === 'number') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n as unknown as Config[K];
    return fallback;
  }
  if (typeof sample === 'boolean') {
    return (raw === 'true' || raw === '1') as unknown as Config[K];
  }
  if (Array.isArray(sample)) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as unknown as Config[K];
  }
  return raw as unknown as Config[K];
}

function isNoEntry(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  );
}
