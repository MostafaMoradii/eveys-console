// Read-only configuration introspection. Backed by GET /sys/config on the
// Console server, and GET /sys/gateway-config (proxied to the gateway's
// /api/v1/sys/config). Sensitive values arrive already masked.

import { CONSOLE_BASE_URL as BASE } from '@/lib/console-url';

export type RestartImpact = 'none' | 'console' | 'gateway' | 'both';
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
  /** Gateway-only fields. Empty string when reading the Console-side
   * endpoint, which doesn't carry these. */
  impact?: string;
  category?: string;
  stability?: string;
}

export type ConfigScope = 'console' | 'gateway';

export interface SysConfig {
  entries: ConfigEntry[];
  scope: ConfigScope;
  loaded_at: string;
}

export async function fetchConsoleConfig(token: string): Promise<SysConfig> {
  const res = await fetch(`${BASE}/sys/config`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sys/config ${res.status}`);
  return (await res.json()) as SysConfig;
}

export async function fetchGatewayConfig(token: string): Promise<SysConfig> {
  const res = await fetch(`${BASE}/sys/gateway-config`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sys/gateway-config ${res.status}`);
  return (await res.json()) as SysConfig;
}
