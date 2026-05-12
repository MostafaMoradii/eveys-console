// REST client for the per-charger device-event search.
//
//   fetchCpEvents(token, cpId, { from, to, q?, limit?, cursor? })
//     → GET /sys/charge-points/:cp_id/events?…
//
// Powers the panel's "search history" mode and the "Load older"
// pagination. The live append continues to come through the WS
// subscription; this is the durable-store fallback.

import type { DeviceEvent } from '@eveys-console/protocol';

import { CONSOLE_BASE_URL as BASE } from '@/lib/console-url';

export interface CpEventsParams {
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface CpEventsResponse {
  events: DeviceEvent[];
  next_cursor: string | null;
}

export async function fetchCpEvents(
  token: string,
  cpId: string,
  params: CpEventsParams = {},
): Promise<CpEventsResponse> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.q) qs.set('q', params.q);
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);
  const suffix = qs.toString() ? `?${qs}` : '';
  const url = `${BASE}/sys/charge-points/${encodeURIComponent(cpId)}/events${suffix}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sys/charge-points/${cpId}/events ${res.status}`);
  return (await res.json()) as CpEventsResponse;
}
