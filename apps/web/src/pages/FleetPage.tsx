import { Link } from '@tanstack/react-router';
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Grid3x3,
  List as ListIcon,
  Loader2,
  Plug,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { ChargePointSummary } from '@eveys-console/protocol';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
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
import { cn } from '@/lib/utils';

type ViewMode = 'table' | 'grid';
type OnlineFilter = 'all' | 'online' | 'offline';

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

const VIEW_KEY = 'eveys-console.fleet-view';

export function FleetPage() {
  const isPhone = useIsBelow('sm');

  // Persist the user's view-mode pick across navigations. Below
  // `sm` we force grid (the table doesn't fit on a phone) but
  // we don't overwrite the stored preference — when the user
  // resizes back up to desktop, their chosen view returns.
  const [savedView, setSavedView] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_KEY) as ViewMode) ?? 'table',
  );
  useEffect(() => {
    localStorage.setItem(VIEW_KEY, savedView);
  }, [savedView]);
  const view: ViewMode = isPhone ? 'grid' : savedView;

  // Server-side filters — pushed into the subscription params.
  const [onlineFilter, setOnlineFilter] = useState<OnlineFilter>('all');
  const [vendorFilter, setVendorFilter] = useState<string>('');
  const [pageSize, setPageSize] = useState<number>(100);
  // Cursor stack so Previous can pop. The server's pagination is
  // forward-only (cursor-based, no total), so we record where each
  // page started.
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const currentCursor = cursorStack[cursorStack.length - 1] ?? null;

  // Client-side filters — applied to the loaded page only.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]>('all');

  // Build subscription params. Re-subscribes when any of these change
  // (use-subscription stringifies params and uses that as a dep).
  const subParams = useMemo<Record<string, string | number | boolean>>(() => {
    const p: Record<string, string | number | boolean> = { limit: pageSize };
    if (onlineFilter === 'online') p.online = true;
    if (onlineFilter === 'offline') p.online = false;
    if (vendorFilter.trim()) p.vendor = vendorFilter.trim();
    if (currentCursor) p.cursor = currentCursor;
    return p;
  }, [onlineFilter, vendorFilter, pageSize, currentCursor]);

  const sub = useSubscription('charge-points', subParams);

  // Apply the latest delta on top of the snapshot. Server-side
  // filters keep the page focused; client-side filters (search,
  // status) cut further within the loaded page.
  const { allRows, nextCursor } = useMemo<{
    allRows: ChargePointSummary[];
    nextCursor: string | null;
  }>(() => {
    if (!sub.snapshot || sub.snapshot.kind !== 'charge-points') {
      return { allRows: [], nextCursor: null };
    }
    const byId = new Map<string, ChargePointSummary>(
      sub.snapshot.rows.map((r) => [r.cp_id, r]),
    );
    if (sub.lastDelta && sub.lastDelta.kind === 'charge-points') {
      const d = sub.lastDelta;
      if (d.op === 'upsert' && d.row) byId.set(d.row.cp_id, d.row);
      if (d.op === 'remove' && d.cp_id) byId.delete(d.cp_id);
    }
    return {
      allRows: Array.from(byId.values()).sort((a, b) => a.cp_id.localeCompare(b.cp_id)),
      nextCursor:
        'next_cursor' in sub.snapshot ? (sub.snapshot.next_cursor ?? null) : null,
    };
  }, [sub.snapshot, sub.lastDelta]);

  // Vendor list for the autocomplete (datalist) — sourced from the
  // current page so it doesn't require a separate distinct query.
  const knownVendors = useMemo(
    () =>
      Array.from(
        new Set(allRows.map((r) => r.vendor).filter((v): v is string => !!v)),
      ).sort(),
    [allRows],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (term) {
        const haystack = (
          (r.cp_id ?? '') +
          ' ' +
          (r.vendor ?? '') +
          ' ' +
          (r.model ?? '') +
          ' ' +
          (r.serial_number ?? '')
        ).toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (statusFilter !== 'all' && r.last_status !== statusFilter) return false;
      return true;
    });
  }, [allRows, search, statusFilter]);

  const onApplyFilters = () => {
    // Any server-side filter change resets the cursor stack to page 1.
    setCursorStack([null]);
  };

  if (sub.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load charge points</AlertTitle>
        <AlertDescription>{sub.error}</AlertDescription>
      </Alert>
    );
  }
  if (sub.loading || !sub.snapshot) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading charge points…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            Charge points — {rows.length}
            {rows.length !== allRows.length ? ` of ${allRows.length}` : ''} shown
          </h2>
          <p className="text-sm text-muted-foreground">
            Live; updates on every BootNotification and StatusNotification.
          </p>
        </div>
        {/* View toggle hidden below `sm` — phones force grid mode
            because the table needs columns we can't render at that
            width. The stored pref still survives. */}
        {!isPhone ? <ViewToggle view={view} onChange={setSavedView} /> : null}
      </div>

      <FilterBar
        isPhone={isPhone}
        onlineFilter={onlineFilter}
        onOnlineChange={(v) => {
          setOnlineFilter(v);
          onApplyFilters();
        }}
        vendorFilter={vendorFilter}
        onVendorChange={setVendorFilter}
        onVendorCommit={onApplyFilters}
        knownVendors={knownVendors}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        search={search}
        onSearchChange={setSearch}
      />

      {view === 'table' ? <FleetTable rows={rows} /> : <FleetGrid rows={rows} />}

      <Pagination
        pageSize={pageSize}
        onPageSizeChange={(n) => {
          setPageSize(n);
          onApplyFilters();
        }}
        canGoBack={cursorStack.length > 1}
        onBack={() => setCursorStack((s) => s.slice(0, -1))}
        canGoNext={!!nextCursor}
        onNext={() => (nextCursor ? setCursorStack((s) => [...s, nextCursor]) : undefined)}
        pageNumber={cursorStack.length}
      />
    </div>
  );
}

interface FilterBarProps {
  isPhone: boolean;
  onlineFilter: OnlineFilter;
  onOnlineChange: (v: OnlineFilter) => void;
  vendorFilter: string;
  onVendorChange: (v: string) => void;
  onVendorCommit: () => void;
  knownVendors: string[];
  statusFilter: (typeof STATUSES)[number];
  onStatusChange: (v: (typeof STATUSES)[number]) => void;
  search: string;
  onSearchChange: (v: string) => void;
}

function FilterBar(props: FilterBarProps) {
  const activeCount = countActiveFilters(props);

  if (props.isPhone) {
    return (
      <div className="flex items-center gap-2">
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2"
              aria-label="Open filters"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {activeCount > 0 ? (
                <Badge variant="secondary" className="ml-0.5 h-5 px-1.5 text-[10px]">
                  {activeCount}
                </Badge>
              ) : null}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
            <SheetHeader className="pb-2">
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-3 pt-2">
              <FilterFields {...props} stretch />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border bg-card/40 p-3">
      <FilterFields {...props} />
    </div>
  );
}

function countActiveFilters(p: FilterBarProps): number {
  let n = 0;
  if (p.search.trim()) n++;
  if (p.onlineFilter !== 'all') n++;
  if (p.vendorFilter.trim()) n++;
  if (p.statusFilter !== 'all') n++;
  return n;
}

// Renders the four filter fields. `stretch` makes each field
// `w-full` for the mobile sheet layout; the desktop bar uses fixed
// widths so the row remains compact.
function FilterFields({
  onlineFilter,
  onOnlineChange,
  vendorFilter,
  onVendorChange,
  onVendorCommit,
  knownVendors,
  statusFilter,
  onStatusChange,
  search,
  onSearchChange,
  stretch = false,
}: FilterBarProps & { stretch?: boolean }) {
  const fieldFull = stretch ? 'w-full' : '';
  return (
    <>
      <FilterField label="Search" hint="cp_id, vendor, model, serial" stretch={stretch}>
        <div className={cn('relative', fieldFull)}>
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.currentTarget.value)}
            placeholder="filter loaded page…"
            className={cn('h-9 pl-8', stretch ? 'w-full' : 'w-[260px]')}
          />
        </div>
      </FilterField>

      <FilterField label="Online" hint="server-side" stretch={stretch}>
        <Select
          value={onlineFilter}
          onChange={(e) => onOnlineChange(e.currentTarget.value as OnlineFilter)}
          className={cn(stretch ? 'w-full' : 'w-[120px]')}
        >
          <option value="all">All</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
        </Select>
      </FilterField>

      <FilterField label="Vendor" hint="server-side" stretch={stretch}>
        <Input
          list="vendor-options"
          value={vendorFilter}
          onChange={(e) => onVendorChange(e.currentTarget.value)}
          onBlur={onVendorCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onVendorCommit();
          }}
          placeholder="any"
          className={cn('h-9', stretch ? 'w-full' : 'w-[160px]')}
        />
        <datalist id="vendor-options">
          {knownVendors.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </FilterField>

      <FilterField label="Status" hint="loaded page" stretch={stretch}>
        <Select
          value={statusFilter}
          onChange={(e) =>
            onStatusChange(e.currentTarget.value as (typeof STATUSES)[number])
          }
          className={cn(stretch ? 'w-full' : 'w-[160px]')}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'Any' : s}
            </option>
          ))}
        </Select>
      </FilterField>
    </>
  );
}

function FilterField({
  label,
  hint,
  children,
  stretch = false,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  stretch?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-1', stretch && 'w-full')}>
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
        {hint ? (
          <span className="ml-1 normal-case text-muted-foreground/60">· {hint}</span>
        ) : null}
      </span>
      {children}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-md border bg-background p-0.5">
      <Button
        variant={view === 'table' ? 'secondary' : 'ghost'}
        size="sm"
        onClick={() => onChange('table')}
        aria-label="Table view"
        aria-pressed={view === 'table'}
        className="h-7 px-2"
      >
        <ListIcon className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant={view === 'grid' ? 'secondary' : 'ghost'}
        size="sm"
        onClick={() => onChange('grid')}
        aria-label="Grid view"
        aria-pressed={view === 'grid'}
        className="h-7 px-2"
      >
        <Grid3x3 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function FleetTable({ rows }: { rows: ChargePointSummary[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (cp: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cp)) next.delete(cp);
      else next.add(cp);
      return next;
    });

  if (rows.length === 0) return <EmptyState />;

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40px]"></TableHead>
            <TableHead>cp_id</TableHead>
            <TableHead>online</TableHead>
            <TableHead>last status</TableHead>
            <TableHead>connectors</TableHead>
            <TableHead>vendor / model</TableHead>
            <TableHead>firmware</TableHead>
            <TableHead>last heartbeat</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <FleetTableRow
              key={row.cp_id}
              row={row}
              isOpen={expanded.has(row.cp_id)}
              onToggle={() => toggle(row.cp_id)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function FleetTableRow({
  row,
  isOpen,
  onToggle,
}: {
  row: ChargePointSummary;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow>
        <TableCell className="w-[40px]">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className="h-6 w-6 p-0"
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            <Plug
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                isOpen ? 'rotate-90 text-primary' : 'text-muted-foreground',
              )}
            />
          </Button>
        </TableCell>
        <TableCell>
          <Link
            to="/inspect/charge-points/$cpId"
            params={{ cpId: row.cp_id } as never}
            className="font-mono text-xs text-primary underline-offset-2 hover:underline"
          >
            {row.cp_id}
          </Link>
        </TableCell>
        <TableCell>
          <Badge variant={row.online ? 'success' : 'muted'}>
            {row.online ? 'online' : 'offline'}
          </Badge>
        </TableCell>
        <TableCell>
          <StatusPill status={row.last_status} />
        </TableCell>
        <TableCell>
          <ConnectorsSummary connectors={row.connectors} />
        </TableCell>
        <TableCell className="text-sm">
          {row.vendor ?? '—'}
          {row.model ? <span className="text-muted-foreground"> / {row.model}</span> : null}
        </TableCell>
        <TableCell className="font-mono text-xs">{row.firmware_version ?? '—'}</TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {formatRelativeTime(row.last_heartbeat_at)}
        </TableCell>
      </TableRow>
      {isOpen ? (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={8} className="p-0">
            <ConnectorDetail connectors={row.connectors} cpId={row.cp_id} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function FleetGrid({ rows }: { rows: ChargePointSummary[] }) {
  if (rows.length === 0) return <EmptyState />;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rows.map((row) => (
        <FleetCard key={row.cp_id} row={row} />
      ))}
    </div>
  );
}

function FleetCard({ row }: { row: ChargePointSummary }) {
  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <Link
            to="/inspect/charge-points/$cpId"
            params={{ cpId: row.cp_id } as never}
            className="block min-w-0 flex-1 truncate font-mono text-xs text-primary underline-offset-2 hover:underline"
            title={row.cp_id}
          >
            {row.cp_id}
          </Link>
          <Badge variant={row.online ? 'success' : 'muted'} className="shrink-0">
            {row.online ? 'online' : 'offline'}
          </Badge>
        </div>

        <div>
          <StatusPill status={row.last_status} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {row.connectors.length === 0 ? (
            <span className="text-xs text-muted-foreground">no connectors reported</span>
          ) : (
            row.connectors.map((c) => <ConnectorDot key={c.connector_id} connector={c} />)
          )}
        </div>

        <dl className="space-y-1 text-xs text-muted-foreground">
          <Row k="vendor" v={`${row.vendor ?? '—'}${row.model ? ' · ' + row.model : ''}`} />
          <Row k="firmware" v={row.firmware_version ?? '—'} />
          <Row k="heartbeat" v={formatRelativeTime(row.last_heartbeat_at)} />
        </dl>
      </CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{k}</dt>
      <dd className="truncate font-mono text-foreground/80" title={v}>
        {v}
      </dd>
    </div>
  );
}

function StatusPill({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const variant: 'success' | 'warning' | 'destructive' | 'secondary' | 'muted' = (() => {
    switch (status) {
      case 'Charging':
      case 'Available':
        return 'success';
      case 'Preparing':
      case 'Finishing':
      case 'Reserved':
        return 'warning';
      case 'Faulted':
        return 'destructive';
      case 'Unavailable':
        return 'muted';
      default:
        return 'secondary';
    }
  })();
  return <Badge variant={variant}>{status}</Badge>;
}

function ConnectorsSummary({ connectors }: { connectors: ChargePointSummary['connectors'] }) {
  if (connectors.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {connectors.map((c) => (
        <ConnectorDot key={c.connector_id} connector={c} />
      ))}
    </div>
  );
}

function ConnectorDot({
  connector,
}: {
  connector: ChargePointSummary['connectors'][number];
}) {
  const tone: 'destructive' | 'success' | 'warning' | 'info' | 'muted' = (() => {
    if (connector.error_code && connector.error_code !== 'NoError') return 'destructive';
    switch (connector.status) {
      case 'Charging':
        return 'info';
      case 'Available':
        return 'success';
      case 'Preparing':
      case 'Finishing':
      case 'Reserved':
        return 'warning';
      case 'Faulted':
        return 'destructive';
      default:
        return 'muted';
    }
  })();
  const Icon =
    tone === 'destructive'
      ? CircleAlert
      : tone === 'success' || tone === 'info'
        ? CircleCheck
        : CircleDashed;
  const colour =
    tone === 'destructive'
      ? 'text-destructive'
      : tone === 'info'
        ? 'text-info'
        : tone === 'success'
          ? 'text-success'
          : tone === 'warning'
            ? 'text-amber-500'
            : 'text-muted-foreground';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]',
        colour,
      )}
      title={`${connector.status}${
        connector.error_code && connector.error_code !== 'NoError'
          ? ' · ' + connector.error_code
          : ''
      }`}
    >
      <Icon className="h-2.5 w-2.5" />
      <span className="font-mono">{connector.connector_id}</span>
      <span className="font-medium">{connector.status}</span>
    </span>
  );
}

function ConnectorDetail({
  connectors,
  cpId,
}: {
  connectors: ChargePointSummary['connectors'];
  cpId: string;
}) {
  if (connectors.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        No connectors reported for {cpId} yet.
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-[10px] uppercase">connector_id</TableHead>
            <TableHead className="text-[10px] uppercase">status</TableHead>
            <TableHead className="text-[10px] uppercase">error_code</TableHead>
            <TableHead className="text-[10px] uppercase">last_changed_at</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {connectors.map((c) => (
            <TableRow key={c.connector_id}>
              <TableCell className="font-mono">{c.connector_id}</TableCell>
              <TableCell>
                <StatusPill status={c.status} />
              </TableCell>
              <TableCell className="font-mono text-xs">
                {c.error_code && c.error_code !== 'NoError' ? (
                  <span className="text-destructive">{c.error_code}</span>
                ) : (
                  <span className="text-muted-foreground">{c.error_code ?? '—'}</span>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {c.last_changed_at ?? '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface PaginationProps {
  pageSize: number;
  onPageSizeChange: (n: number) => void;
  canGoBack: boolean;
  onBack: () => void;
  canGoNext: boolean;
  onNext: () => void;
  pageNumber: number;
}

function Pagination({
  pageSize,
  onPageSizeChange,
  canGoBack,
  onBack,
  canGoNext,
  onNext,
  pageNumber,
}: PaginationProps) {
  // Stacks vertically below `sm` so each row gets enough horizontal
  // space; horizontal at sm+ to keep the desktop layout compact.
  return (
    <div className="flex flex-col items-stretch gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center justify-between gap-2 sm:justify-start">
        <span>Rows per page</span>
        <Select
          value={String(pageSize)}
          onChange={(e) => onPageSizeChange(Number(e.currentTarget.value))}
          className="h-9 w-[80px] text-xs sm:h-7"
        >
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="250">250</option>
          <option value="500">500</option>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <span>Page {pageNumber}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            disabled={!canGoBack}
            className="h-9 sm:h-7"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onNext}
            disabled={!canGoNext}
            className="h-9 sm:h-7"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-sm text-muted-foreground">
      <span>No charge points match the current filters.</span>
    </div>
  );
}

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
