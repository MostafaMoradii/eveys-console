// Static analytics dashboard for completed transactions. Backed by
// the gateway's `GET /api/v1/transactions/aggregate` endpoint (PR B1
// of eveys-console#192 → gateway #228), proxied through the Console
// at `/sys/transactions/aggregate`.
//
// Three charts on a single page:
//   1. Sessions by day — bar count per day.
//   2. Energy by day — bar kWh per day.
//   3. Top-N chargers — horizontal bar of sessions per cp_id over the
//      full window.
//
// Charts (1) and (2) come from one aggregate call with
// `bucket=day, group_by=none`. Chart (3) comes from a second call
// with `bucket=day, group_by=cp_id`; we sum across days client-side
// to keep the gateway responses generic. Two calls is cheap enough
// for the operator-facing static view; consolidating into a single
// response shape would force the gateway to know the page's layout,
// which is the wrong split.
//
// URL-backed filters: `from`, `to`. Defaults to last-30-days when
// either is absent. Same `validateSearch` pattern as FleetEventsPage
// + TransactionsPage so paste-links round-trip.

import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from 'recharts';

import {
  fetchAggregate,
  type AnalyticsBucket,
  type AggregateResponse,
} from '@/api/analytics-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { useConsoleClient } from '@/lib/ws-context';

const DEFAULT_WINDOW_DAYS = 30;
const TOP_N = 10;
const BRAND_ORANGE = '#F04E1F';
const BRAND_GREEN = '#22C55E';

export interface AnalyticsPageSearch {
  from?: string;
  to?: string;
}

export function validateAnalyticsPageSearch(raw: Record<string, unknown>): AnalyticsPageSearch {
  const out: AnalyticsPageSearch = {};
  if (typeof raw.from === 'string' && raw.from) out.from = raw.from;
  if (typeof raw.to === 'string' && raw.to) out.to = raw.to;
  return out;
}

export function AnalyticsPage() {
  const { token } = useConsoleClient();
  const search = useSearch({ from: '/inspect/analytics' }) as AnalyticsPageSearch;
  const navigate = useNavigate({ from: '/inspect/analytics' });

  // Default window: last 30 days, computed once. Storing in state
  // (not derived per-render) so a stale clock doesn't shift the
  // axes mid-session.
  const [defaultRange] = useState<{ from: string; to: string }>(() => {
    const now = new Date();
    const from = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);
    return { from: from.toISOString(), to: now.toISOString() };
  });

  const from = search.from ?? defaultRange.from;
  const to = search.to ?? defaultRange.to;

  const [fromInput, setFromInput] = useState(from);
  const [toInput, setToInput] = useState(to);
  useEffect(() => setFromInput(from), [from]);
  useEffect(() => setToInput(to), [to]);

  const setRange = (next: Partial<AnalyticsPageSearch>) =>
    void navigate({
      search: (prev: Record<string, unknown>) => {
        const merged: AnalyticsPageSearch = {
          ...(prev as AnalyticsPageSearch),
          ...next,
        };
        if (!merged.from) delete merged.from;
        if (!merged.to) delete merged.to;
        return merged;
      },
      replace: true,
    });

  // Two queries. Both keyed on the same (from, to) window so a filter
  // edit invalidates both. We don't combine into one queryFn because
  // a partial failure shouldn't drop both charts.
  const byDayQuery = useQuery({
    queryKey: ['analytics-aggregate', from, to, 'day', 'none'],
    queryFn: () => fetchAggregate(token!, { from, to, bucket: 'day', group_by: 'none' }),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const byCpQuery = useQuery({
    queryKey: ['analytics-aggregate', from, to, 'day', 'cp_id'],
    queryFn: () => fetchAggregate(token!, { from, to, bucket: 'day', group_by: 'cp_id' }),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const error = byDayQuery.error || byCpQuery.error;
  const isLoading = byDayQuery.isLoading || byCpQuery.isLoading;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Analytics</h2>
        <p className="text-sm text-muted-foreground">
          Completed sessions across the fleet. Static; pick a date range to refresh.
        </p>
      </div>

      <RangeRow
        fromInput={fromInput}
        toInput={toInput}
        onFromChange={setFromInput}
        onToChange={setToInput}
        onCommitFrom={() => setRange({ from: fromInput })}
        onCommitTo={() => setRange({ to: toInput })}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&rsquo;t load analytics</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : 'unknown error'}
          </AlertDescription>
        </Alert>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading analytics…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SessionsByDayCard data={byDayQuery.data} />
          <EnergyByDayCard data={byDayQuery.data} />
          <div className="lg:col-span-2">
            <TopChargersCard data={byCpQuery.data} />
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Range row
// ----------------------------------------------------------------------------

function RangeRow({
  fromInput,
  toInput,
  onFromChange,
  onToChange,
  onCommitFrom,
  onCommitTo,
}: {
  fromInput: string;
  toInput: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onCommitFrom: () => void;
  onCommitTo: () => void;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-3 rounded-md border bg-card p-3 sm:grid-cols-2"
      data-testid="analytics-range-row"
    >
      <FilterField label="From">
        <Input
          type="datetime-local"
          value={toLocalInput(fromInput)}
          onChange={(e) => onFromChange(fromLocalInput(e.currentTarget.value))}
          onBlur={onCommitFrom}
          data-testid="analytics-from"
        />
      </FilterField>
      <FilterField label="To">
        <Input
          type="datetime-local"
          value={toLocalInput(toInput)}
          onChange={(e) => onToChange(fromLocalInput(e.currentTarget.value))}
          onBlur={onCommitTo}
          data-testid="analytics-to"
        />
      </FilterField>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Charts
// ----------------------------------------------------------------------------

function SessionsByDayCard({ data }: { data: AggregateResponse | undefined }) {
  const rows = useMemo(() => {
    if (!data) return [];
    return data.buckets.map((b) => ({
      day: formatBucketLabel(b.bucket_at),
      sessions: b.session_count,
    }));
  }, [data]);
  return (
    <Card data-testid="analytics-sessions-by-day">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Sessions per day</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState />
        ) : (
          <ChartContainer>
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="sessions" fill={BRAND_ORANGE} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function EnergyByDayCard({ data }: { data: AggregateResponse | undefined }) {
  const rows = useMemo(() => {
    if (!data) return [];
    return data.buckets.map((b) => ({
      day: formatBucketLabel(b.bucket_at),
      kwh: b.consumed_wh_total / 1000,
    }));
  }, [data]);
  return (
    <Card data-testid="analytics-energy-by-day">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Energy delivered per day (kWh)</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState />
        ) : (
          <ChartContainer>
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [v.toFixed(3), 'kWh']} />
              <Bar dataKey="kwh" fill={BRAND_GREEN} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function TopChargersCard({ data }: { data: AggregateResponse | undefined }) {
  const rows = useMemo(() => {
    if (!data) return [];
    // Sum across days per cp_id, then pick top-N.
    const byCp = new Map<string, number>();
    for (const b of data.buckets) {
      if (!b.group) continue;
      byCp.set(b.group, (byCp.get(b.group) ?? 0) + b.session_count);
    }
    const all = Array.from(byCp.entries()).map(([cp_id, sessions]) => ({ cp_id, sessions }));
    all.sort((a, b) => b.sessions - a.sessions);
    return all.slice(0, TOP_N);
  }, [data]);
  return (
    <Card data-testid="analytics-top-chargers">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Top {TOP_N} chargers by sessions</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState />
        ) : (
          <ChartContainer height={Math.max(180, rows.length * 28)}>
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 8, right: 16, left: 80, bottom: 0 }}
            >
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="cp_id" tick={{ fontSize: 11 }} width={120} />
              <Tooltip />
              <Bar dataKey="sessions" fill={BRAND_ORANGE} radius={[0, 2, 2, 0]}>
                {rows.map((entry) => (
                  <Cell key={entry.cp_id} fill={BRAND_ORANGE} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <p className="text-sm text-muted-foreground" data-testid="analytics-empty">
      No completed sessions in this window.
    </p>
  );
}

// ----------------------------------------------------------------------------
// Formatters / bridges
// ----------------------------------------------------------------------------

/** Compact day-bucket label: "May 13". The gateway returns full
 *  ISO-8601 so the bucket key is unambiguous; rendering uses the
 *  shorter form to keep the X axis legible. */
function formatBucketLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function toLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

// Suppress an unused-import lint on `AnalyticsBucket` — kept in the
// re-export contract so callers can type the chart inputs externally
// without re-importing from the client module.
export type { AnalyticsBucket };
