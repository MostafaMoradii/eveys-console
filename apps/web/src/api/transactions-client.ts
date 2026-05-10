// REST clients for the transactions surfaces.
//
// Two surfaces today:
//
//   - fetchChargePointTransactions(token, cpId, params)
//       → GET /sys/charge-points/:cp_id/transactions?active=…&limit=…&cursor=…
//     The row is leaner than a full TransactionDetail (no telemetry /
//     meter-value join). Pagination is cursor-based: the client treats
//     `next_cursor` as opaque and pushes/pops it onto a stack to power
//     Previous/Next.
//
//   - fetchTransaction(token, txId) + fetchMeterValues(token, cpId, params)
//       → GET /sys/transactions/:tx_id
//       → GET /sys/charge-points/:cp_id/meter-values
//     Per-transaction detail + meter-values time-series. Both call the
//     Console's REST proxy (single origin); the gateway token never
//     leaves the server. The detail page polls these via TanStack Query
//     — there is no WS broker query for single-tx detail.

import { CONSOLE_BASE_URL as BASE } from '@/lib/console-url';

export interface PhaseSnapshot {
  voltage_v: number | null;
  current_a: number | null;
  power_w: number | null;
  power_factor: number | null;
  occurred_at: string | null;
}

export interface SocSummary {
  start: number | null;
  last: number | null;
  delta: number | null;
}

export interface TransactionTelemetry {
  soc: SocSummary;
  // Keyed by phase label (typically 'L1' / 'L2' / 'L3'). 1-phase chargers
  // populate only one entry; some report 'N' or omit phase entirely —
  // the page renders only the entries actually present.
  phases: Record<string, PhaseSnapshot>;
}

export interface TransactionDetail {
  transaction_id: number;
  cp_id: string;
  connector_id: number;
  id_tag: string;
  meter_start_wh: number;
  meter_stop_wh: number | null;
  started_at: string;
  stopped_at: string | null;
  stop_reason: string | null;
  open: boolean;
  telemetry: TransactionTelemetry | null;
}

export interface MeterValueSample {
  cp_id: string;
  connector_id: number;
  transaction_id: number | null;
  occurred_at: string;
  // OCPP wire form: 'Power.Active.Import', 'Energy.Active.Import.Register',
  // 'Voltage', 'Current.Import', 'SoC', 'Temperature', etc.
  measurand: string;
  // 'L1' / 'L2' / 'L3' / 'N' / null. Per-phase samples have the phase
  // label; aggregate samples (no phase reported by the charger) are null.
  phase: string | null;
  // 'W' / 'kW' / 'V' / 'A' / 'Wh' / 'kWh' / '%' / 'Celsius' etc.
  unit: string;
  value: number;
}

export interface MeterValuesResponse {
  meter_values: MeterValueSample[];
  next_cursor: string | null;
}

export interface MeterValuesParams {
  from: string;
  to: string;
  measurand?: string;
  connector_id?: number;
  limit?: number;
}

export interface TransactionRow {
  transaction_id: number;
  cp_id: string;
  connector_id: number;
  id_tag: string;
  /** Wh integer at session start. */
  meter_start_wh: number;
  /** ISO-8601 string. */
  started_at: string;
  /** Wh integer at session stop, or null while the session is open. */
  meter_stop_wh: number | null;
  /** ISO-8601 string, or null while the session is open. */
  stopped_at: string | null;
  /** OCPP `Reason` enum value if the charger sent one, else null. */
  stop_reason: string | null;
  /** Convenience flag the gateway already computes. */
  open: boolean;
}

export interface TransactionsList {
  transactions: TransactionRow[];
  next_cursor: string | null;
}

export interface ListParams {
  active?: boolean;
  limit?: number;
  cursor?: string;
}

export async function fetchTransaction(token: string, txId: number): Promise<TransactionDetail> {
  const res = await fetch(`${BASE}/sys/transactions/${encodeURIComponent(String(txId))}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sys/transactions/${txId} ${res.status}`);
  return (await res.json()) as TransactionDetail;
}

export async function fetchMeterValues(
  token: string,
  cpId: string,
  params: MeterValuesParams,
): Promise<MeterValuesResponse> {
  const qs = new URLSearchParams();
  qs.set('from', params.from);
  qs.set('to', params.to);
  if (params.measurand) qs.set('measurand', params.measurand);
  if (params.connector_id !== undefined) qs.set('connector_id', String(params.connector_id));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  const url = `${BASE}/sys/charge-points/${encodeURIComponent(cpId)}/meter-values?${qs.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sys/charge-points/${cpId}/meter-values ${res.status}`);
  return (await res.json()) as MeterValuesResponse;
}

export async function fetchChargePointTransactions(
  token: string,
  cpId: string,
  params: ListParams = {},
): Promise<TransactionsList> {
  const qs = new URLSearchParams();
  if (params.active !== undefined) qs.set('active', String(params.active));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);
  const suffix = qs.toString() ? `?${qs}` : '';
  const url = `${BASE}/sys/charge-points/${encodeURIComponent(cpId)}/transactions${suffix}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sys/charge-points/${cpId}/transactions ${res.status}`);
  return (await res.json()) as TransactionsList;
}
