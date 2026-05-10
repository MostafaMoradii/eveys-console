import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { AlertCircle, Eye, EyeOff, Loader2, Search, Settings } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ConfigEntry, ConfigScope, RestartImpact, SysConfig } from '@/api/config-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useConsoleClient } from '@/lib/ws-context';
import { cn } from '@/lib/utils';

// Shared rendering for the Console-config and Gateway-config pages.
// The two pages differ in (1) data source — fetchConsoleConfig vs
// fetchGatewayConfig — and (2) which restart-impact filter buttons make
// sense to show. Everything else is identical.

export interface ConfigViewProps {
  /** What scope this view represents. Drives the page heading and the
   * "to apply a change" hint copy. */
  scope: ConfigScope;
  /** Plain title shown at the top of the page. */
  title: string;
  /** Cache key used for the underlying useQuery. */
  queryKey: string;
  /** Fetcher that returns the SysConfig response. The token comes from
   * the auth context. */
  fetcher: (token: string) => Promise<SysConfig>;
  /** Restart-impact filter buttons to render (in order). 'all' should
   * always be first. */
  filters: Array<RestartImpact | 'all'>;
}

const FILTER_LABELS: Record<RestartImpact | 'all', string> = {
  all: 'All',
  none: 'Live',
  console: 'Console',
  gateway: 'Gateway',
  both: 'Both',
};

export function ConfigView({ scope, title, queryKey, fetcher, filters }: ConfigViewProps) {
  const { token } = useConsoleClient();
  const [search, setSearch] = useState('');
  const [restartFilter, setRestartFilter] = useState<RestartImpact | 'all'>('all');
  const [revealed, setRevealed] = useState(false);

  const q: UseQueryResult<SysConfig> = useQuery({
    queryKey: [queryKey],
    queryFn: () => fetcher(token!),
    enabled: !!token,
  });

  const entries = q.data?.entries ?? [];

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (restartFilter !== 'all' && e.restart !== restartFilter) return false;
      if (!needle) return true;
      return e.key.toLowerCase().includes(needle) || e.description.toLowerCase().includes(needle);
    });
  }, [entries, search, restartFilter]);

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading configuration…
      </div>
    );
  }
  if (q.error || !q.data) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Configuration unavailable</AlertTitle>
        <AlertDescription>
          {q.error instanceof Error ? q.error.message : 'unknown error'}
        </AlertDescription>
      </Alert>
    );
  }

  const sensitiveKeys = entries.filter((e) => e.sensitive).map((e) => e.key);
  const sourceCopy = scope === 'gateway' ? 'gateway process' : 'Console server';
  const sensitiveCopy =
    scope === 'gateway'
      ? 'These keys carry secret material and arrive masked from the gateway. The reveal toggle unmasks the placeholder text only — the underlying secret never leaves the gateway.'
      : 'These keys carry secret material and arrive masked from the Console server. The reveal toggle unmasks the placeholder text only — the underlying secret never leaves the Console.';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Settings className="h-5 w-5" />
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">
          Read-only. Values were loaded by the {sourceCopy} at{' '}
          <span className="font-mono">{q.data.loaded_at}</span>. To change a key, edit the relevant
          env var and restart the process indicated by its <em>restart</em> column.
        </p>
      </div>

      {sensitiveKeys.length > 0 ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>
            {sensitiveKeys.length} sensitive key{sensitiveKeys.length === 1 ? '' : 's'} masked
          </AlertTitle>
          <AlertDescription>
            <span className="font-mono text-xs">{sensitiveKeys.join(', ')}</span>
            <span className="mt-1 block">{sensitiveCopy}</span>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by key or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            aria-label="Search configuration"
          />
        </div>
        <RestartFilter value={restartFilter} onChange={setRestartFilter} options={filters} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRevealed((v) => !v)}
          aria-pressed={revealed}
        >
          {revealed ? (
            <>
              <EyeOff className="mr-1 h-4 w-4" /> Hide sensitive
            </>
          ) : (
            <>
              <Eye className="mr-1 h-4 w-4" /> Show sensitive placeholder
            </>
          )}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
          No keys match the current filter.
        </p>
      ) : (
        <GroupedEntries entries={filtered} revealed={revealed} />
      )}
    </div>
  );
}

// Group entries by `category` and render each group under a heading.
// The grouping is purely visual; ordering preserves the order categories
// first appear in the entry list (so the operator's familiar layout
// from the upstream metadata is preserved instead of alphabetised).
function GroupedEntries({ entries, revealed }: { entries: ConfigEntry[]; revealed: boolean }) {
  const groups: { category: string; entries: ConfigEntry[] }[] = [];
  const indexByCategory = new Map<string, number>();
  for (const entry of entries) {
    const cat = entry.category || 'other';
    let idx = indexByCategory.get(cat);
    if (idx === undefined) {
      idx = groups.length;
      indexByCategory.set(cat, idx);
      groups.push({ category: cat, entries: [] });
    }
    groups[idx]!.entries.push(entry);
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.category} aria-labelledby={`config-group-${group.category}`}>
          <h3
            id={`config-group-${group.category}`}
            className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {humanizeCategory(group.category)}{' '}
            <span className="ml-1 font-normal normal-case">({group.entries.length})</span>
          </h3>
          <div className="grid grid-cols-1 gap-3">
            {group.entries.map((entry) => (
              <ConfigCard key={entry.key} entry={entry} revealed={revealed} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// Cosmetic-only: turn snake_case category names into Title Case for
// the group heading. Underscores → spaces. Words that are well-known
// acronyms render in their canonical casing instead of plain Title
// Case ("WS" not "Ws"; "gRPC" not "Grpc"; "ClickHouse" not "Clickhouse").
const ACRONYMS: Record<string, string> = {
  ws: 'WS',
  websocket: 'WebSocket',
  grpc: 'gRPC',
  rest: 'REST',
  ocpp: 'OCPP',
  clickhouse: 'ClickHouse',
  jwt: 'JWT',
  ttl: 'TTL',
  url: 'URL',
  pod: 'Pod',
  tls: 'TLS',
  otlp: 'OTLP',
  dsn: 'DSN',
  api: 'API',
  http: 'HTTP',
  ip: 'IP',
};

function humanizeCategory(raw: string): string {
  if (!raw) return 'Other';
  return raw
    .split('_')
    .map((word) => {
      if (word.length === 0) return word;
      const lower = word.toLowerCase();
      return ACRONYMS[lower] ?? word[0]!.toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function ConfigCard({ entry, revealed }: { entry: ConfigEntry; revealed: boolean }) {
  const display =
    entry.sensitive && entry.value
      ? revealed
        ? entry.value
        : '•'.repeat(8)
      : entry.value || '<empty>';

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-mono text-sm">{entry.key}</CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <SourcePill source={entry.source} />
            <RestartPill restart={entry.restart} />
            {entry.sensitive ? <Badge variant="destructive">sensitive</Badge> : null}
            {!entry.mutable ? <Badge variant="secondary">read-only</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{entry.description}</p>
        {entry.impact ? (
          <p className="rounded border-l-2 border-muted bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider">Impact</span> · {entry.impact}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <KV label="Current value">
            <code
              className={cn(
                'block break-all rounded bg-muted px-2 py-1 font-mono text-xs',
                entry.sensitive && !revealed ? 'text-muted-foreground' : '',
              )}
              data-testid={`value-${entry.key}`}
            >
              {display}
            </code>
          </KV>
          <KV label="Default">
            <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-xs">
              {entry.default || '<none>'}
            </code>
          </KV>
          <KV label="Range">
            <span className="text-xs text-muted-foreground">{entry.range}</span>
          </KV>
        </div>
      </CardContent>
    </Card>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function SourcePill({ source }: { source: ConfigEntry['source'] }) {
  const variant = source === 'env' ? 'success' : 'secondary';
  return (
    <Badge variant={variant} className="text-[10px]">
      {source}
    </Badge>
  );
}

function RestartPill({ restart }: { restart: RestartImpact }) {
  if (restart === 'none') {
    return (
      <Badge variant="secondary" className="text-[10px]">
        live
      </Badge>
    );
  }
  const tone = restart === 'both' ? 'destructive' : 'warning';
  const label =
    restart === 'console'
      ? 'restart: Console'
      : restart === 'gateway'
        ? 'restart: gateway'
        : 'restart: Console + gateway';
  return (
    <Badge variant={tone} className="text-[10px]">
      {label}
    </Badge>
  );
}

function RestartFilter({
  value,
  onChange,
  options,
}: {
  value: RestartImpact | 'all';
  onChange: (v: RestartImpact | 'all') => void;
  options: Array<RestartImpact | 'all'>;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      role="group"
      aria-label="Filter by restart impact"
    >
      {options.map((opt) => (
        <Button
          key={opt}
          variant={value === opt ? 'default' : 'outline'}
          size="sm"
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
        >
          {FILTER_LABELS[opt]}
        </Button>
      ))}
    </div>
  );
}
