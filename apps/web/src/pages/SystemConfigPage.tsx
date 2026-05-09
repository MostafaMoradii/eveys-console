import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Eye, EyeOff, Loader2, Search, Settings } from 'lucide-react';
import { useMemo, useState } from 'react';

import { fetchSysConfig, type ConfigEntry, type RestartImpact } from '@/api/config-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useConsoleClient } from '@/lib/ws-context';
import { cn } from '@/lib/utils';

// SRE-facing read-only view of the BaaS configuration. Shows every key the
// process loaded at boot, with description, current effective value, default,
// where the value came from (env vs schema default), accepted range, whether
// the operator can change it, and what needs to restart for a change to
// apply. Sensitive values arrive already masked from the server.

export function SystemConfigPage() {
  const { token } = useConsoleClient();
  const [search, setSearch] = useState('');
  const [restartFilter, setRestartFilter] = useState<RestartImpact | 'all'>('all');
  const [revealed, setRevealed] = useState(false);

  const q = useQuery({
    queryKey: ['sys-config'],
    queryFn: () => fetchSysConfig(token!),
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

  const sensitiveCount = entries.filter((e) => e.sensitive).length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Settings className="h-5 w-5" />
            Configuration
          </h2>
          <p className="text-sm text-muted-foreground">
            Read-only. Values were loaded at <span className="font-mono">{q.data.loaded_at}</span>.
            To change a key, edit the relevant env var and restart the process indicated by its{' '}
            <em>restart</em> column.
          </p>
        </div>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Sensitive values are masked</AlertTitle>
        <AlertDescription>
          {sensitiveCount} key{sensitiveCount === 1 ? '' : 's'} (
          {sensitiveCount > 0
            ? entries
                .filter((e) => e.sensitive)
                .map((e) => e.key)
                .join(', ')
            : 'none'}
          ) carry secret material and arrive masked from the server. The reveal toggle unmasks the
          placeholder text only — the underlying secret never leaves the BaaS.
        </AlertDescription>
      </Alert>

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
        <RestartFilter value={restartFilter} onChange={setRestartFilter} />
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
        <div className="grid grid-cols-1 gap-3">
          {filtered.map((entry) => (
            <ConfigCard key={entry.key} entry={entry} revealed={revealed} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConfigCard({ entry, revealed }: { entry: ConfigEntry; revealed: boolean }) {
  const display =
    entry.sensitive && entry.value
      ? revealed
        ? entry.value // still '••••••••' from the server; the UI just stops hiding it visually
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
  const tone = restart === 'baas' ? 'warning' : restart === 'gateway' ? 'warning' : 'destructive';
  const label =
    restart === 'baas'
      ? 'restart: BaaS'
      : restart === 'gateway'
        ? 'restart: gateway'
        : 'restart: BaaS + gateway';
  return (
    <Badge variant={tone} className="text-[10px]">
      {label}
    </Badge>
  );
}

function RestartFilter({
  value,
  onChange,
}: {
  value: RestartImpact | 'all';
  onChange: (v: RestartImpact | 'all') => void;
}) {
  const options: Array<{ v: RestartImpact | 'all'; label: string }> = [
    { v: 'all', label: 'All' },
    { v: 'baas', label: 'BaaS' },
    { v: 'gateway', label: 'Gateway' },
    { v: 'both', label: 'Both' },
    { v: 'none', label: 'Live' },
  ];
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      role="group"
      aria-label="Filter by restart impact"
    >
      {options.map((o) => (
        <Button
          key={o.v}
          variant={value === o.v ? 'default' : 'outline'}
          size="sm"
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
