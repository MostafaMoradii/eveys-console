// Live event feed for a single charger. Subscribes to `device-events`
// for the given cp_id and prepends each delta to an in-memory ring
// (cap 500, oldest dropped). The ring lives in the component because
// the operator-facing contract is "events from when you opened this
// page" — there's no shared global state to invalidate when the page
// unmounts.
//
// Controls:
//   - Pause / Resume — buffers events while paused so resuming
//     replays the missed window (no event loss, but the ring still
//     applies once they're flushed in).
//   - Clear — wipes the visible list without unsubscribing.
//   - Kind chips — toggles per-kind visibility. AND with the search.
//   - Search — case-insensitive substring over summary + detail values.
//   - JSON toggle per row — switches the detail render between the
//     friendly key/value list and a raw JSON dump (for copying).

import { Loader2, Pause, Play, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { DeviceEvent } from '@eveys-console/protocol';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSubscription } from '@/hooks/use-subscription';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

const RING_CAP = 500;

type ChipVariant = 'success' | 'warning' | 'secondary' | 'default';

const KIND_META: Record<DeviceEvent['kind'], { variant: ChipVariant; label: string }> = {
  boot: { variant: 'success', label: 'boot' },
  status: { variant: 'warning', label: 'status' },
  meter: { variant: 'secondary', label: 'meter' },
  'tx-started': { variant: 'default', label: 'tx-started' },
  'tx-stopped': { variant: 'secondary', label: 'tx-stopped' },
};
const ALL_KINDS = Object.keys(KIND_META) as DeviceEvent['kind'][];

export interface DeviceEventsPanelProps {
  cpId: string;
}

export function DeviceEventsPanel({ cpId }: DeviceEventsPanelProps) {
  const sub = useSubscription('device-events', { cp_id: cpId });
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [paused, setPaused] = useState(false);
  // Buffer events that arrive while paused so resuming replays the
  // missed window. Buffer respects the same ring cap as the visible
  // list so a long pause can't blow up memory.
  const pauseBufferRef = useRef<DeviceEvent[]>([]);
  // Last-seen lastDelta reference so the effect doesn't double-append
  // when it re-runs (e.g. when `paused` toggles but `sub.lastDelta`
  // hasn't moved). Each delta is a new object from the subscription
  // hook, so reference identity is the right dedupe key.
  const lastSeenDeltaRef = useRef<DeviceEvent | null>(null);
  // Track which kinds are enabled. Default: all on.
  const [enabledKinds, setEnabledKinds] = useState<Set<DeviceEvent['kind']>>(
    () => new Set(ALL_KINDS),
  );
  const [search, setSearch] = useState('');

  // Reset on cp_id change.
  useEffect(() => {
    setEvents([]);
    pauseBufferRef.current = [];
    lastSeenDeltaRef.current = null;
  }, [cpId]);

  useEffect(() => {
    const delta = sub.lastDelta;
    if (!delta || delta.kind !== 'device-events') return;
    // Same delta instance as last run? Skip — happens when `paused`
    // toggles without a new subscription event.
    if (lastSeenDeltaRef.current === delta.append) return;
    lastSeenDeltaRef.current = delta.append;
    if (paused) {
      const buf = pauseBufferRef.current;
      buf.unshift(delta.append);
      if (buf.length > RING_CAP) buf.length = RING_CAP;
      return;
    }
    setEvents((prev) => {
      const next = [delta.append, ...prev];
      return next.length > RING_CAP ? next.slice(0, RING_CAP) : next;
    });
  }, [sub.lastDelta, paused]);

  const onResume = () => {
    // Flush whatever buffered up while paused, then resume live append.
    const buffered = pauseBufferRef.current;
    pauseBufferRef.current = [];
    setPaused(false);
    if (buffered.length > 0) {
      setEvents((prev) => {
        const next = [...buffered, ...prev];
        return next.length > RING_CAP ? next.slice(0, RING_CAP) : next;
      });
    }
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return events.filter((ev) => {
      if (!enabledKinds.has(ev.kind)) return false;
      if (!term) return true;
      if (ev.summary.toLowerCase().includes(term)) return true;
      if (ev.detail) {
        for (const v of Object.values(ev.detail)) {
          if (v !== null && String(v).toLowerCase().includes(term)) return true;
        }
      }
      return false;
    });
  }, [events, enabledKinds, search]);

  const toggleKind = (k: DeviceEvent['kind']) =>
    setEnabledKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  if (sub.error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Live events</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Couldn't subscribe: {sub.error}</p>
        </CardContent>
      </Card>
    );
  }

  const bufferedCount = pauseBufferRef.current.length;

  return (
    <Card>
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">
            Live events
            <span
              className="ml-2 font-mono text-xs text-muted-foreground"
              data-testid="device-events-count"
            >
              {visible.length}
              {visible.length !== events.length ? `/${events.length}` : ''}
            </span>
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {paused ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={onResume}
                data-testid="device-events-resume"
              >
                <Play className="h-3.5 w-3.5" /> Resume
                {bufferedCount > 0 ? (
                  <Badge variant="muted" className="ml-1 text-[10px]">
                    +{bufferedCount}
                  </Badge>
                ) : null}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => setPaused(true)}
                data-testid="device-events-pause"
              >
                <Pause className="h-3.5 w-3.5" /> Pause
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setEvents([])}
              data-testid="device-events-clear"
              disabled={events.length === 0}
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {ALL_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => toggleKind(k)}
              data-testid={`device-events-kind-${k}`}
              aria-pressed={enabledKinds.has(k)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors',
                enabledKinds.has(k)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-muted-foreground hover:bg-accent',
              )}
            >
              {KIND_META[k].label}
            </button>
          ))}
          <Input
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="search events…"
            className="ml-auto h-7 w-[200px] text-xs"
            data-testid="device-events-search"
          />
        </div>
      </CardHeader>

      <CardContent>
        {events.length === 0 ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="device-events-empty"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Waiting for events…
          </div>
        ) : visible.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="device-events-no-match">
            No events match the current filter.
          </p>
        ) : (
          <ul className="divide-y" data-testid="device-events-list">
            {visible.map((ev, idx) => (
              <DeviceEventRow key={`${ev.at}-${idx}`} event={ev} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DeviceEventRow({ event }: { event: DeviceEvent }) {
  const [mode, setMode] = useState<'closed' | 'block' | 'json'>('closed');
  const meta = KIND_META[event.kind];
  const detailEntries = event.detail ? Object.entries(event.detail) : [];
  const hasDetail = detailEntries.length > 0;

  return (
    <li className="space-y-1 py-2" data-testid="device-events-row">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={meta.variant} data-testid="device-events-chip">
          {meta.label}
        </Badge>
        <span className="font-medium" data-testid="device-events-summary">
          {event.summary}
        </span>
        <span
          className="ml-auto text-xs text-muted-foreground"
          title={event.at}
          data-testid="device-events-time"
        >
          {formatRelativeTime(event.at)}
        </span>
      </div>
      {hasDetail ? (
        <div className="space-x-2">
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setMode(mode === 'block' ? 'closed' : 'block')}
            aria-pressed={mode === 'block'}
            data-testid="device-events-toggle"
          >
            {mode === 'block' ? 'Hide detail' : 'Show detail'}
          </button>
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setMode(mode === 'json' ? 'closed' : 'json')}
            aria-pressed={mode === 'json'}
            data-testid="device-events-toggle-json"
          >
            {mode === 'json' ? 'Hide JSON' : 'Show JSON'}
          </button>
          {mode === 'block' ? (
            <dl
              className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs"
              data-testid="device-events-detail"
            >
              {detailEntries.map(([k, v]) => (
                <DetailRow key={k} k={k} v={v} />
              ))}
            </dl>
          ) : null}
          {mode === 'json' ? (
            <pre
              className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 font-mono text-[11px]"
              data-testid="device-events-json"
            >
              {JSON.stringify(event, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function DetailRow({ k, v }: { k: string; v: string | number | boolean | null }) {
  return (
    <>
      <dt className="font-mono text-muted-foreground">{k}</dt>
      <dd className="font-mono text-foreground/80">{v === null ? '—' : String(v)}</dd>
    </>
  );
}
