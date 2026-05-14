// REST client for `/sys/transactions/aggregate` — bucketed analytics
// over completed sessions. Backs the /inspect/analytics page (PR B2 of
// eveys-console#192).
//
// Why a separate file: the transactions-client.ts surface is for the
// audit list + per-transaction detail; the aggregate is conceptually
// distinct (totals over a window, not row data) and uses a different
// query-param set. Mixing them would muddle the type contract.

import { CONSOLE_BASE_URL as BASE } from '@/lib/console-url';

export type AggregateBucket = 'hour' | 'day';
export type AggregateGroupBy = 'none' | 'cp_id' | 'id_tag';

export interface AnalyticsBucket {
  /** ISO-8601 (UTC) — `toStartOfHour` / `toStartOfDay` boundary. */
  bucket_at: string;
  /** Present when group_by != 'none'; absent otherwise. */
  group?: string;
  session_count: number;
  consumed_wh_total: number;
  duration_seconds_total: number;
}

export interface AnalyticsWindow {
  from: string;
  to: string;
  seconds: number;
  bucket: AggregateBucket;
  group_by: AggregateGroupBy;
}

export interface AggregateResponse {
  buckets: AnalyticsBucket[];
  window: AnalyticsWindow;
}

export interface AggregateParams {
  from: string;
  to: string;
  bucket?: AggregateBucket;
  group_by?: AggregateGroupBy;
}

export async function fetchAggregate(
  token: string,
  params: AggregateParams,
): Promise<AggregateResponse> {
  const qs = new URLSearchParams();
  qs.set('from', params.from);
  qs.set('to', params.to);
  if (params.bucket) qs.set('bucket', params.bucket);
  if (params.group_by) qs.set('group_by', params.group_by);
  const url = `${BASE}/sys/transactions/aggregate?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sys/transactions/aggregate ${res.status}`);
  return (await res.json()) as AggregateResponse;
}
