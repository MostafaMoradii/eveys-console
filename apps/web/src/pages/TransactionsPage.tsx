// Audit-grade transactions list. Backed by GET /sys/transactions
// (umbrella #188 / PR A1). The page replaces the old WS-broker-fed
// "active only" view; operators can now filter on status (active /
// finished / all), cp_id, id_tag, and a date range, and page through
// the result via cursor pagination.
//
// Why REST instead of the WS broker: the broker only knows about
// currently-running transactions. Finished sessions live in the
// gateway database, and the audit use case ("what charged yesterday?")
// is the operator-relevant view we were missing.
//
// Filter state is URL-backed (`/inspect/transactions?status=…&cp_id=…`)
// so a paste-link round-trips and the back button works. Same pattern
// FleetEventsPage uses. Cursor stack is local (React state) — the
// browser back button doesn't try to replay cursors; that's
// intentional, replay would confuse "Previous" semantics.

import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Radio, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchTransactions,
  type TransactionRow,
  type TransactionStatusFilter,
} from '@/api/transactions-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useSubscription } from '@/hooks/use-subscription';
import { useIsBelow } from '@/lib/use-breakpoint';
import { useConsoleClient } from '@/lib/ws-context';

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
const DEFAULT_PAGE_SIZE: PageSize = 20;
const DEFAULT_STATUS: TransactionStatusFilter = 'all';

export interface TransactionsPageSearch {
  status?: TransactionStatusFilter;
  cp_id?: string;
  id_tag?: string;
  from?: string;
  to?: string;
  page_size?: PageSize;
  /** Opt-in "Live" toggle. When on (and no date range is set), the page
   *  subscribes to the `transactions-active` WS query and refetches on
   *  every delta so freshly-started sessions surface within ~100ms. */
  live?: boolean;
}

export function validateTransactionsPageSearch(
  raw: Record<string, unknown>,
): TransactionsPageSearch {
  const out: TransactionsPageSearch = {};
  if (raw.status === 'active' || raw.status === 'finished' || raw.status === 'all') {
    out.status = raw.status;
  }
  if (typeof raw.cp_id === 'string' && raw.cp_id) out.cp_id = raw.cp_id;
  if (typeof raw.id_tag === 'string' && raw.id_tag) out.id_tag = raw.id_tag;
  if (typeof raw.from === 'string' && raw.from) out.from = raw.from;
  if (typeof raw.to === 'string' && raw.to) out.to = raw.to;
  if (
    typeof raw.page_size === 'number' &&
    (PAGE_SIZE_OPTIONS as readonly number[]).includes(raw.page_size)
  ) {
    out.page_size = raw.page_size as PageSize;
  }
  // Accept truthy strings + a real boolean so `?live=true` from a typed
  // <Link> and pasted URLs both work. The page hides the toggle when a
  // date range is set, so the URL form is the only entry point in that
  // case.
  if (raw.live === true || raw.live === 'true' || raw.live === '1') {
    out.live = true;
  }
  return out;
}

export function TransactionsPage() {
  const { token } = useConsoleClient();
  const isPhone = useIsBelow('sm');
  const search = useSearch({ from: '/inspect/transactions' }) as TransactionsPageSearch;
  const navigate = useNavigate({ from: '/inspect/transactions' });

  const status: TransactionStatusFilter = search.status ?? DEFAULT_STATUS;
  const cpId = search.cp_id ?? '';
  const idTag = search.id_tag ?? '';
  const from = search.from ?? '';
  const to = search.to ?? '';
  const pageSize = search.page_size ?? DEFAULT_PAGE_SIZE;
  // Live overlay is meaningful only over an open-ended window. If the
  // operator sets a date range, the "live" stream would arrive outside
  // it — auto-disable rather than show misleading updates.
  const liveAllowed = !from && !to;
  const live = liveAllowed && (search.live ?? false);

  // Local text-input state so typing doesn't fire a request per
  // keystroke. Committed on Enter / Search button / blur. Mirrors the
  // pattern FleetEventsPage uses.
  const [cpIdInput, setCpIdInput] = useState(cpId);
  const [idTagInput, setIdTagInput] = useState(idTag);
  useEffect(() => setCpIdInput(cpId), [cpId]);
  useEffect(() => setIdTagInput(idTag), [idTag]);

  const setSearch = (next: Partial<TransactionsPageSearch>) =>
    void navigate({
      search: (prev: Record<string, unknown>) => {
        const out: TransactionsPageSearch = {
          ...(prev as TransactionsPageSearch),
          ...next,
        };
        // Clear defaults so paste-links stay compact and back-button
        // history doesn't accumulate identical entries.
        if (out.status === DEFAULT_STATUS) delete out.status;
        if (!out.cp_id) delete out.cp_id;
        if (!out.id_tag) delete out.id_tag;
        if (!out.from) delete out.from;
        if (!out.to) delete out.to;
        if (out.page_size === DEFAULT_PAGE_SIZE) delete out.page_size;
        if (!out.live) delete out.live;
        return out;
      },
      replace: true,
    });

  // Cursor stack for pagination. The current page's cursor is at the
  // top; Previous pops; Next pushes the response's `next_cursor`.
  // Reset whenever any filter changes (so we don't carry stale cursors
  // into a new query window).
  const cursorStack = useRef<string[]>([]);
  const filterKey = `${status}|${cpId}|${idTag}|${from}|${to}|${pageSize}`;
  const prevFilterKeyRef = useRef(filterKey);
  if (prevFilterKeyRef.current !== filterKey) {
    cursorStack.current = [];
    prevFilterKeyRef.current = filterKey;
  }
  const currentCursor =
    cursorStack.current.length > 0
      ? cursorStack.current[cursorStack.current.length - 1]
      : undefined;

  const query = useQuery({
    queryKey: ['sys-transactions', filterKey, currentCursor],
    queryFn: () => {
      if (!token) throw new Error('not signed in');
      const params: Parameters<typeof fetchTransactions>[1] = {
        status,
        limit: pageSize,
      };
      if (cpId) params.cp_id = cpId;
      if (idTag) params.id_tag = idTag;
      if (from) params.from = from;
      if (to) params.to = to;
      if (currentCursor) params.cursor = currentCursor;
      return fetchTransactions(token, params);
    },
    enabled: !!token,
    // Don't refetch on window focus — operators paginating an audit
    // result expect the page to stay stable while they read it.
    refetchOnWindowFocus: false,
  });

  const goNext = () => {
    const cur = query.data?.next_cursor;
    if (!cur) return;
    cursorStack.current = [...cursorStack.current, cur];
    // Force a re-render so the new currentCursor takes effect.
    setNudge((n) => n + 1);
  };
  const goPrev = () => {
    if (cursorStack.current.length === 0) return;
    cursorStack.current = cursorStack.current.slice(0, -1);
    setNudge((n) => n + 1);
  };
  // Cheap nudge so pagination actions trigger a render without
  // mirroring the stack into React state (which would re-trigger the
  // filter-changed reset).
  const [, setNudge] = useState(0);

  const pageNumber = cursorStack.current.length + 1;
  const hasPrev = cursorStack.current.length > 0;
  const hasNext = Boolean(query.data?.next_cursor);
  const rows = query.data?.transactions ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Transactions</h2>
        <p className="text-sm text-muted-foreground">
          Audit list. Active and finished sessions across the fleet.
        </p>
      </div>

      <FilterRow
        status={status}
        cpIdInput={cpIdInput}
        idTagInput={idTagInput}
        from={from}
        to={to}
        pageSize={pageSize}
        live={live}
        liveAllowed={liveAllowed}
        onStatusChange={(v) => setSearch({ status: v })}
        onCpIdInputChange={setCpIdInput}
        onIdTagInputChange={setIdTagInput}
        onCpIdCommit={() => setSearch({ cp_id: cpIdInput.trim() })}
        onIdTagCommit={() => setSearch({ id_tag: idTagInput.trim() })}
        onFromChange={(v) => setSearch({ from: v })}
        onToChange={(v) => setSearch({ to: v })}
        onPageSizeChange={(v) => setSearch({ page_size: v })}
        onLiveChange={(v) => setSearch({ live: v })}
      />

      {live ? <LiveTailRefetcher filterKey={filterKey} /> : null}

      {query.error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&rsquo;t load transactions</AlertTitle>
          <AlertDescription>
            {query.error instanceof Error ? query.error.message : 'unknown error'}
          </AlertDescription>
        </Alert>
      ) : query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading transactions…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {isPhone ? <TransactionsCards rows={rows} /> : <TransactionsTable rows={rows} />}
          <Pagination
            pageNumber={pageNumber}
            pageSize={pageSize}
            rowsOnPage={rows.length}
            hasPrev={hasPrev}
            hasNext={hasNext}
            onPrev={goPrev}
            onNext={goNext}
          />
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Filter row
// ----------------------------------------------------------------------------

function FilterRow({
  status,
  cpIdInput,
  idTagInput,
  from,
  to,
  pageSize,
  live,
  liveAllowed,
  onStatusChange,
  onCpIdInputChange,
  onIdTagInputChange,
  onCpIdCommit,
  onIdTagCommit,
  onFromChange,
  onToChange,
  onPageSizeChange,
  onLiveChange,
}: {
  status: TransactionStatusFilter;
  cpIdInput: string;
  idTagInput: string;
  from: string;
  to: string;
  pageSize: PageSize;
  live: boolean;
  liveAllowed: boolean;
  onStatusChange: (v: TransactionStatusFilter) => void;
  onCpIdInputChange: (v: string) => void;
  onIdTagInputChange: (v: string) => void;
  onCpIdCommit: () => void;
  onIdTagCommit: () => void;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onPageSizeChange: (v: PageSize) => void;
  onLiveChange: (v: boolean) => void;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-3 rounded-md border bg-card p-3 sm:grid-cols-6"
      data-testid="transactions-filter-row"
    >
      <FilterField label="Status">
        <Select
          value={status}
          onChange={(e) => onStatusChange(e.currentTarget.value as TransactionStatusFilter)}
          data-testid="transactions-filter-status"
        >
          <option value="all">All</option>
          <option value="active">Active only</option>
          <option value="finished">Finished only</option>
        </Select>
      </FilterField>

      <FilterField label="Charge point">
        <div className="flex gap-1">
          <Input
            value={cpIdInput}
            onChange={(e) => onCpIdInputChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCpIdCommit();
            }}
            onBlur={onCpIdCommit}
            placeholder="cp_…"
            data-testid="transactions-filter-cp-id"
          />
          <Button
            size="icon"
            variant="ghost"
            type="button"
            onClick={onCpIdCommit}
            aria-label="Apply cp_id filter"
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
        </div>
      </FilterField>

      <FilterField label="id_tag">
        <div className="flex gap-1">
          <Input
            value={idTagInput}
            onChange={(e) => onIdTagInputChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onIdTagCommit();
            }}
            onBlur={onIdTagCommit}
            placeholder="TAG…"
            data-testid="transactions-filter-id-tag"
          />
          <Button
            size="icon"
            variant="ghost"
            type="button"
            onClick={onIdTagCommit}
            aria-label="Apply id_tag filter"
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
        </div>
      </FilterField>

      <FilterField label="From">
        <Input
          type="datetime-local"
          value={toLocalInput(from)}
          onChange={(e) => onFromChange(fromLocalInput(e.currentTarget.value))}
          data-testid="transactions-filter-from"
        />
      </FilterField>

      <FilterField label="To">
        <Input
          type="datetime-local"
          value={toLocalInput(to)}
          onChange={(e) => onToChange(fromLocalInput(e.currentTarget.value))}
          data-testid="transactions-filter-to"
        />
      </FilterField>

      <FilterField label="Page size">
        <Select
          value={String(pageSize)}
          onChange={(e) => onPageSizeChange(Number(e.currentTarget.value) as PageSize)}
          data-testid="transactions-filter-page-size"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </FilterField>

      <div className="sm:col-span-6">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => onLiveChange(e.currentTarget.checked)}
            disabled={!liveAllowed}
            data-testid="transactions-filter-live"
            className="h-3.5 w-3.5"
          />
          <Radio
            className={`h-3.5 w-3.5 ${live ? 'animate-pulse text-success' : 'text-muted-foreground'}`}
          />
          <span>
            Live updates
            {!liveAllowed ? (
              <span className="ml-1 text-[10px]">(disabled while a date range is set)</span>
            ) : null}
          </span>
        </label>
      </div>
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

/** ISO-8601 ↔ <input type="datetime-local"> bridge. The native input
 *  works in local time without a TZ suffix; we store ISO with offset
 *  so the server sees an unambiguous instant. */
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

// ----------------------------------------------------------------------------
// Table + cards
// ----------------------------------------------------------------------------

function TransactionsTable({ rows }: { rows: TransactionRow[] }) {
  return (
    <div className="rounded-md border" data-testid="transactions-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>transaction_id</TableHead>
            <TableHead>cp_id</TableHead>
            <TableHead>id_tag</TableHead>
            <TableHead>started</TableHead>
            <TableHead>duration</TableHead>
            <TableHead className="text-right">energy</TableHead>
            <TableHead>status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.transaction_id} data-testid={`tx-row-${r.transaction_id}`}>
              <TableCell className="font-mono">
                <Link
                  to="/inspect/transactions/$txId"
                  params={{ txId: String(r.transaction_id) } as never}
                  className="underline-offset-2 hover:underline"
                >
                  {r.transaction_id}
                </Link>
              </TableCell>
              <TableCell className="font-mono text-xs">
                <Link
                  to="/inspect/charge-points/$cpId"
                  params={{ cpId: r.cp_id } as never}
                  className="underline-offset-2 hover:underline"
                >
                  {r.cp_id}
                </Link>
              </TableCell>
              <TableCell className="font-mono text-xs">{r.id_tag}</TableCell>
              <TableCell className="text-xs text-muted-foreground" title={r.started_at}>
                {formatRelativeTime(r.started_at)}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {formatDuration(r.started_at, r.stopped_at)}
              </TableCell>
              <TableCell className="text-right font-mono">{formatEnergy(r)}</TableCell>
              <TableCell>
                <StatusBadge open={r.open} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TransactionsCards({ rows }: { rows: TransactionRow[] }) {
  return (
    <ul className="divide-y rounded-md border" data-testid="transactions-cards">
      {rows.map((r) => (
        <li key={r.transaction_id} className="space-y-1.5 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <Link
              to="/inspect/transactions/$txId"
              params={{ txId: String(r.transaction_id) } as never}
            >
              <Badge variant="secondary" className="font-mono">
                tx {r.transaction_id}
              </Badge>
            </Link>
            <StatusBadge open={r.open} />
          </div>
          <dl className="space-y-0.5 text-xs">
            <CardField k="cp_id" v={r.cp_id} />
            <CardField k="id_tag" v={r.id_tag} />
            <CardField k="started" v={formatRelativeTime(r.started_at)} />
            <CardField k="duration" v={formatDuration(r.started_at, r.stopped_at)} />
            <CardField k="energy" v={formatEnergy(r)} />
          </dl>
        </li>
      ))}
    </ul>
  );
}

function CardField({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate font-mono text-foreground/80">{v}</dd>
    </div>
  );
}

function StatusBadge({ open }: { open: boolean }) {
  return (
    <Badge
      variant={open ? 'success' : 'muted'}
      className="text-[10px] uppercase tracking-wider"
      data-testid={open ? 'tx-status-active' : 'tx-status-finished'}
    >
      {open ? 'Active' : 'Finished'}
    </Badge>
  );
}

// ----------------------------------------------------------------------------
// Pagination
// ----------------------------------------------------------------------------

function Pagination({
  pageNumber,
  pageSize,
  rowsOnPage,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  pageNumber: number;
  pageSize: PageSize;
  rowsOnPage: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const first = (pageNumber - 1) * pageSize + 1;
  const last = first + rowsOnPage - 1;
  return (
    <div
      className="flex items-center justify-between text-xs text-muted-foreground"
      data-testid="transactions-pagination"
    >
      <span>
        Showing {first}–{last}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrev}
          disabled={!hasPrev}
          data-testid="transactions-prev"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={!hasNext}
          data-testid="transactions-next"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
      data-testid="transactions-empty"
    >
      No transactions match these filters.
    </div>
  );
}

// ----------------------------------------------------------------------------
// Formatters
// ----------------------------------------------------------------------------

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const deltaSec = Math.round((Date.now() - t) / 1000);
  if (deltaSec < 5) return 'now';
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)}m ago`;
  if (deltaSec < 86_400) return `${Math.round(deltaSec / 3600)}h ago`;
  return `${Math.round(deltaSec / 86_400)}d ago`;
}

function formatDuration(startedAt: string, stoppedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return '—';
  const end = stoppedAt ? new Date(stoppedAt).getTime() : Date.now();
  if (Number.isNaN(end) || end < start) return '—';
  const totalSec = Math.floor((end - start) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatEnergy(r: TransactionRow): string {
  // Active sessions show "—" because consumed_wh hasn't been computed
  // yet on the gateway side (it derives from meter_stop_wh — null
  // while running). The detail page polls meter-values for live
  // telemetry; this list view is the audit snapshot.
  const wh = r.meter_stop_wh != null ? r.meter_stop_wh - r.meter_start_wh : null;
  if (wh == null) return '—';
  const kWh = wh / 1000;
  return `${kWh.toFixed(3)} kWh`;
}

// ----------------------------------------------------------------------------
// Live tail
// ----------------------------------------------------------------------------
//
// Mounted only when `live=true && no date range filter`. Subscribes to
// the broker's `transactions-active` query and refetches the REST list
// whenever a tx-started / tx-stopped delta arrives. We refetch the
// authoritative gateway response rather than merge broker rows
// client-side: broker and REST disagree on field names + finished tx
// don't show on the broker at all, so trying to reconcile is brittle.
// Refetch is louder than necessary but produces correct results.

function LiveTailRefetcher({ filterKey }: { filterKey: string }) {
  const sub = useSubscription('transactions-active', {});
  const qc = useQueryClient();
  const lastSeenRef = useRef<unknown>(null);

  useEffect(() => {
    const delta = sub.lastDelta;
    if (!delta || delta.kind !== 'transactions-active') return;
    // Each delta is a fresh object from the WS layer; reference equality
    // dedupes against accidental re-runs from parent re-renders.
    if (lastSeenRef.current === delta) return;
    lastSeenRef.current = delta;
    void qc.refetchQueries({
      queryKey: ['sys-transactions', filterKey],
      type: 'active',
    });
  }, [sub.lastDelta, qc, filterKey]);

  return null;
}
