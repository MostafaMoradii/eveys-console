// REST client for the OCPP frame audit. Two variants:
//
//   fetchCpFrames(token, cpId, { from, to, direction?, action?, limit? })
//     → GET /sys/charge-points/:cp_id/frames?…
//   fetchTxFrames(token, txId, { limit? })
//     → GET /sys/transactions/:tx_id/frames?…
//
// Per-charger is window-bounded — the audit can be very large for a
// busy site, so the operator picks a window. Per-transaction is
// already bounded by the session itself (Start + Stop + MeterValues
// in between) so no window is needed; we just cap `limit`.
//
// One-shot fetch — the OCPP Log surfaces are for investigation, not
// live tailing. (Live activity is on the Events tab.) Refetch on
// every filter change or explicit refresh.

import { CONSOLE_BASE_URL as BASE } from '@/lib/console-url';

export interface OcppFrame {
  event_id: string;
  occurred_at: string;
  cp_id: string;
  direction: 'inbound' | 'outbound';
  action: string;
  message_type: number; // 2 = CALL, 3 = CALLRESULT, 4 = CALLERROR
  message_id: string;
  ocpp_version: string;
  transaction_id: number | null;
  raw_payload: string;
}

export interface CpFramesParams {
  from: string;
  to: string;
  direction?: 'inbound' | 'outbound';
  action?: string;
  limit?: number;
}

export interface CpFramesResponse {
  cp_id: string;
  frames: OcppFrame[];
  request_id?: string;
}

export async function fetchCpFrames(
  token: string,
  cpId: string,
  params: CpFramesParams,
): Promise<CpFramesResponse> {
  const qs = new URLSearchParams({ from: params.from, to: params.to });
  if (params.direction) qs.set('direction', params.direction);
  if (params.action) qs.set('action', params.action);
  if (params.limit != null) qs.set('limit', String(params.limit));
  const url = `${BASE}/sys/charge-points/${encodeURIComponent(cpId)}/frames?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sys/charge-points/${cpId}/frames ${res.status}`);
  return (await res.json()) as CpFramesResponse;
}

export interface TxFramesParams {
  limit?: number;
}

export interface TxFramesResponse {
  transaction_id: number;
  frames: OcppFrame[];
  request_id?: string;
}

export async function fetchTxFrames(
  token: string,
  txId: number,
  params: TxFramesParams = {},
): Promise<TxFramesResponse> {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const url = `${BASE}/sys/transactions/${encodeURIComponent(String(txId))}/frames${suffix}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sys/transactions/${txId}/frames ${res.status}`);
  return (await res.json()) as TxFramesResponse;
}
