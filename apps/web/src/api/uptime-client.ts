// REST client for the per-charger uptime% aggregate.
//
//   fetchCpUptime(token, cpId, { from, to })
//     → GET /sys/charge-points/:cp_id/uptime?from=…&to=…
//
// Drives the Uptime chip on the detail page header. One-shot fetch
// (no live stream — the underlying data only updates on reconnect
// after an outage). Refetch triggered by:
//   - the operator changing the window
//   - the charger flipping online (a fresh `cp.connected` delta on
//     the charge-point subscription)

import { CONSOLE_BASE_URL as BASE } from '@/lib/console-url';

export interface UptimeInterval {
  went_offline_at: string;
  came_online_at: string;
  offline_seconds: number;
  prior_reason: string | null;
}

export interface UptimeResponse {
  cp_id: string;
  uptime_pct: number;
  offline_seconds_total: number;
  online_seconds_total: number;
  intervals: UptimeInterval[];
  window: { from: string; to: string; seconds: number };
}

export async function fetchCpUptime(
  token: string,
  cpId: string,
  params: { from: string; to: string },
): Promise<UptimeResponse> {
  const qs = new URLSearchParams({ from: params.from, to: params.to });
  const url = `${BASE}/sys/charge-points/${encodeURIComponent(cpId)}/uptime?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sys/charge-points/${cpId}/uptime ${res.status}`);
  return (await res.json()) as UptimeResponse;
}
