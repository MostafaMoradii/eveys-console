// Read-only configuration introspection. Backed by GET /sys/config on the
// BaaS. Sensitive values arrive already masked.

import { BAAS_BASE_URL as BASE } from '@/lib/baas-url';

export type RestartImpact = 'none' | 'baas' | 'gateway' | 'both';
export type ValueSource = 'env' | 'default' | 'computed';

export interface ConfigEntry {
  key: string;
  /** Stringified current value, or the mask when sensitive. */
  value: string;
  sensitive: boolean;
  default: string;
  source: ValueSource;
  description: string;
  mutable: boolean;
  restart: RestartImpact;
  range: string;
}

export interface SysConfig {
  entries: ConfigEntry[];
  scope: 'baas';
  loaded_at: string;
}

export async function fetchSysConfig(token: string): Promise<SysConfig> {
  const res = await fetch(`${BASE}/sys/config`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sys/config ${res.status}`);
  return (await res.json()) as SysConfig;
}
