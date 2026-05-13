// REST client for the per-charger reservations history.
//
// Proxies through `GET /sys/charge-points/:cp_id/reservations`, which
// forwards to the gateway's matching endpoint. Returns every status
// the gateway has stored (Pending / Active / Cancelled); callers
// filter on `status` or `active` when they only want one slice.

import type { Reservation } from '@eveys-console/protocol';

import { CONSOLE_BASE_URL as BASE } from '@/lib/console-url';

export interface ReservationsListParams {
  active?: boolean;
  status?: string;
  id_tag?: string;
  limit?: number;
}

export interface ReservationsList {
  reservations: Reservation[];
  next_cursor?: string | null;
}

export async function fetchChargePointReservations(
  token: string,
  cpId: string,
  params: ReservationsListParams = {},
): Promise<ReservationsList> {
  const qs = new URLSearchParams();
  if (params.active !== undefined) qs.set('active', String(params.active));
  if (params.status) qs.set('status', params.status);
  if (params.id_tag) qs.set('id_tag', params.id_tag);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  const url = `${BASE}/sys/charge-points/${encodeURIComponent(cpId)}/reservations${suffix}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sys/charge-points/${cpId}/reservations ${res.status}`);
  const body = (await res.json()) as unknown;
  // The gateway returns either `{ reservations: [...] }` or a bare
  // array depending on the build; normalise here so callers don't
  // have to care which one they hit.
  if (Array.isArray(body)) return { reservations: body as Reservation[] };
  if (
    body &&
    typeof body === 'object' &&
    Array.isArray((body as { reservations?: unknown }).reservations)
  ) {
    return body as ReservationsList;
  }
  return { reservations: [] };
}
