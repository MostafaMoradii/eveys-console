// REST client for the fleet-wide StatusNotification search.
//
//   fetchFleetStatusHistory(token, { from, to, status?, cp_id? })
//     → GET /sys/fleet/status-history?…
//
// Drives the Fleet Events search page. Backed by the gateway's
// cross-charger /api/v1/status-history route.

import { CONSOLE_BASE_URL as BASE } from '@/lib/console-url';

export interface FleetStatusEvent {
  event_id: string;
  occurred_at: string;
  cp_id: string;
  connector_id: number;
  status: string;
  error_code: string | null;
  info: string | null;
  vendor_id: string | null;
  vendor_error_code: string | null;
  charger_reported_at: string | null;
}

export interface FleetStatusResponse {
  events: FleetStatusEvent[];
  request_id?: string;
}

export interface FleetStatusParams {
  from: string;
  to: string;
  status?: readonly string[];
  cp_id?: readonly string[];
  limit?: number;
}

export async function fetchFleetStatusHistory(
  token: string,
  params: FleetStatusParams,
): Promise<FleetStatusResponse> {
  const qs = new URLSearchParams();
  qs.set('from', params.from);
  qs.set('to', params.to);
  for (const s of params.status ?? []) qs.append('status', s);
  for (const c of params.cp_id ?? []) qs.append('cp_id', c);
  if (params.limit != null) qs.set('limit', String(params.limit));
  const url = `${BASE}/sys/fleet/status-history?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sys/fleet/status-history ${res.status}`);
  return (await res.json()) as FleetStatusResponse;
}
