// Single-roundtrip rollup for the dashboard tiles. The server proxies
// the gateway's `GET /api/v1/sys/kpis`; on upstream failure the server
// returns `{...nulls, unavailable: true}` with HTTP 200 so the page
// renders em-dashes rather than surfacing an error toast for a
// transient backend hiccup.

import { CONSOLE_BASE_URL as BASE } from '@/lib/console-url';

export interface SysKpis {
  online_count: number | null;
  total_count: number | null;
  active_tx_count: number | null;
  tx_today_count: number | null;
  faulted_count: number | null;
  energy_24h_wh: number | null;
  unavailable: boolean;
}

export async function fetchSysKpis(token: string): Promise<SysKpis> {
  const res = await fetch(`${BASE}/sys/kpis`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    return {
      online_count: null,
      total_count: null,
      active_tx_count: null,
      tx_today_count: null,
      faulted_count: null,
      energy_24h_wh: null,
      unavailable: true,
    };
  }
  return (await res.json()) as SysKpis;
}
