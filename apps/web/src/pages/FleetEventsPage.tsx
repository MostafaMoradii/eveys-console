// Fleet Events search page.
//
// Cross-charger StatusNotification search backed by the gateway's
// /api/v1/status-history route (via /sys/fleet/status-history).
// Operators reach for this when they need to answer questions like
// "show me every charger that flipped to Faulted last week" without
// loading a detail page per charger.
//
// Filters are URL-backed (?status=...&from=...&to=...) so a deep-
// link is shareable. Range defaults to "last 24h" because that's
// the most common investigation window and the gateway caps the
// total span at 7 days regardless.

import { useNavigate, useSearch } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import { Filter, Loader2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  fetchFleetStatusHistory,
  type FleetStatusEvent,
  type FleetStatusResponse,
} from '@/api/fleet-status-history-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useConsoleClient } from '@/lib/ws-context';
import { cn } from '@/lib/utils';

// OCPP 1.6 §3.1.1 enum plus a sentinel for "any". Anything matching
// this set goes through to the gateway as `?status=...`; the gateway
// itself accepts free-form for forward-compat with future vendors.
const STATUSES = [
  'all',
  'Available',
  'Preparing',
  'Charging',
  'SuspendedEV',
  'SuspendedEVSE',
  'Finishing',
  'Reserved',
  'Unavailable',
  'Faulted',
] as const;
type StatusValue = (typeof STATUSES)[number];

const RANGE_OPTIONS = [
  { hours: 1, label: '1h' },
  { hours: 6, label: '6h' },
  { hours: 24, label: '24h' },
  { hours: 24 * 7, label: '7d' },
] as const;
type RangeHours = (typeof RANGE_OPTIONS)[number]['hours'];

export interface FleetEventsSearch {
  status?: StatusValue;
  hours?: RangeHours;
  cp_id?: string;
}

export function FleetEventsPage() {
  const { token } = useConsoleClient();
  const search = useSearch({ from: '/inspect/fleet/events' }) as FleetEventsSearch;
  const navigate = useNavigate({ from: '/inspect/fleet/events' });

  const status: StatusValue =
    search.status && (STATUSES as readonly string[]).includes(search.status)
      ? search.status
      : 'Faulted';
  const hours: RangeHours =
    typeof search.hours === 'number' &&
    (RANGE_OPTIONS as readonly { hours: number }[]).some((o) => o.hours === search.hours)
      ? search.hours
      : 24;
  const cpId = typeof search.cp_id === 'string' ? search.cp_id : '';

  // Input state is local so typing doesn't fire a request per
  // keystroke; commit on Enter / blur / explicit Search button.
  const [cpIdInput, setCpIdInput] = useState(cpId);
  useEffect(() => setCpIdInput(cpId), [cpId]);

  const setSearch = (next: Partial<FleetEventsSearch>) =>
    void navigate({
      search: (prev: Record<string, unknown>) => {
        const out: FleetEventsSearch = { ...(prev as FleetEventsSearch), ...next };
        // Default values get cleared from the URL so a paste link
        // stays compact and the back button doesn't accumulate
        // identical history entries.
        if (out.status === 'Faulted') delete out.status;
        if (out.hours === 24) delete out.hours;
        if (!out.cp_id) delete out.cp_id;
        return out;
      },
      replace: true,
    });

  const window = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [hours]);

  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'ok'; data: FleetStatusResponse }
    | { phase: 'error'; detail: string }
  >({ phase: 'loading' });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setState({ phase: 'loading' });
    const params: Parameters<typeof fetchFleetStatusHistory>[1] = {
      from: window.from,
      to: window.to,
      limit: 500,
    };
    if (status !== 'all') params.status = [status];
    if (cpId.trim()) params.cp_id = [cpId.trim()];
    fetchFleetStatusHistory(token, params)
      .then((data) => {
        if (!cancelled) setState({ phase: 'ok', data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          phase: 'error',
          detail: err instanceof Error ? err.message : 'request failed',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [token, window, status, cpId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold sm:text-xl">Fleet events</h2>
          <p className="text-sm text-muted-foreground">
            Cross-charger StatusNotification search. ClickHouse-backed; up to 7 days.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-3 pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <FilterField label="Status">
              <Select
                value={status}
                onChange={(e) => setSearch({ status: e.currentTarget.value as StatusValue })}
                className="h-8 w-[160px]"
                aria-label="Status"
                data-testid="fleet-events-status"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s === 'all' ? 'Any' : s}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="Range">
              <div className="inline-flex rounded-md border bg-background p-0.5">
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.hours}
                    type="button"
                    onClick={() => setSearch({ hours: opt.hours })}
                    className={cn(
                      'rounded-sm px-2 py-1',
                      opt.hours === hours
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground',
                    )}
                    data-testid={`fleet-events-range-${opt.hours}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </FilterField>
            <FilterField label="Scope to a charger (optional)">
              <div className="relative">
                <Filter className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={cpIdInput}
                  onChange={(e) => setCpIdInput(e.currentTarget.value)}
                  onBlur={() => setSearch({ cp_id: cpIdInput.trim() })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setSearch({ cp_id: cpIdInput.trim() });
                    }
                  }}
                  placeholder="cp_id (exact match)"
                  className="h-8 w-[240px] pl-7 font-mono text-xs"
                  data-testid="fleet-events-cpid-input"
                />
                {cpIdInput ? (
                  <button
                    type="button"
                    aria-label="Clear cp_id filter"
                    onClick={() => {
                      setCpIdInput('');
                      setSearch({ cp_id: '' });
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            </FilterField>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {state.phase === 'loading' ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching…
            </div>
          ) : state.phase === 'error' ? (
            <Alert variant="destructive">
              <AlertTitle>Couldn&apos;t load fleet events</AlertTitle>
              <AlertDescription>{state.detail}</AlertDescription>
            </Alert>
          ) : state.data.events.length === 0 ? (
            <EmptyState status={status} hours={hours} cpId={cpId} />
          ) : (
            <ResultsTable events={state.data.events} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function EmptyState({
  status,
  hours,
  cpId,
}: {
  status: StatusValue;
  hours: RangeHours;
  cpId: string;
}) {
  // The empty-state copy tells the operator which filter probably
  // emptied the result so the next adjustment is obvious. The
  // ordering matches "most likely cause first": cp_id pin > status
  // > range.
  const parts: string[] = [];
  if (cpId) parts.push(`cp_id=${cpId}`);
  if (status !== 'all') parts.push(`status=${status}`);
  parts.push(`window=last ${hours}h`);
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
      <Search className="h-5 w-5" />
      <p>No StatusNotifications match these filters.</p>
      <p className="font-mono text-xs">{parts.join(' · ')}</p>
    </div>
  );
}

function ResultsTable({ events }: { events: FleetStatusEvent[] }) {
  return (
    <div className="overflow-x-auto" data-testid="fleet-events-results">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[160px]">occurred_at</TableHead>
            <TableHead className="w-[140px]">cp_id</TableHead>
            <TableHead className="w-[60px]">conn</TableHead>
            <TableHead className="w-[110px]">status</TableHead>
            <TableHead className="w-[140px]">error_code</TableHead>
            <TableHead>info / vendor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((ev) => (
            <TableRow key={ev.event_id}>
              <TableCell className="font-mono text-xs">{shortTime(ev.occurred_at)}</TableCell>
              <TableCell>
                <Link
                  to="/inspect/charge-points/$cpId"
                  params={{ cpId: ev.cp_id }}
                  className="font-mono text-xs underline-offset-2 hover:underline"
                >
                  {ev.cp_id}
                </Link>
              </TableCell>
              <TableCell className="font-mono text-xs">{ev.connector_id}</TableCell>
              <TableCell>
                <Badge variant={ev.status === 'Faulted' ? 'destructive' : 'secondary'}>
                  {ev.status}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">
                {ev.error_code && ev.error_code !== 'NoError' ? (
                  <span className="text-destructive">{ev.error_code}</span>
                ) : (
                  <span className="text-muted-foreground">{ev.error_code ?? '—'}</span>
                )}
              </TableCell>
              <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                {ev.info ? ev.info : null}
                {ev.vendor_error_code ? (
                  <span className="ml-1 font-mono">[{ev.vendor_error_code}]</span>
                ) : null}
                {!ev.info && !ev.vendor_error_code ? '—' : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function shortTime(iso: string): string {
  // YYYY-MM-DD HH:mm:ss — operator-friendly, fits the table column.
  return iso.replace('T', ' ').slice(0, 19);
}

// Used by the route layer to validate the search params.
export function validateFleetEventsSearch(raw: Record<string, unknown>): FleetEventsSearch {
  const out: FleetEventsSearch = {};
  if (typeof raw.status === 'string' && (STATUSES as readonly string[]).includes(raw.status)) {
    out.status = raw.status as StatusValue;
  }
  const hours = typeof raw.hours === 'number' ? raw.hours : Number(raw.hours);
  if (Number.isFinite(hours) && RANGE_OPTIONS.some((o) => o.hours === hours)) {
    out.hours = hours as RangeHours;
  }
  if (typeof raw.cp_id === 'string' && raw.cp_id.length > 0) out.cp_id = raw.cp_id;
  return out;
}
