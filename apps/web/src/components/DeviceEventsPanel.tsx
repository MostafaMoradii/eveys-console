// Live event feed for a single charger. Subscribes to `device-events`
// for the given cp_id and prepends each delta to an in-memory ring
// (cap 200, oldest dropped). The ring lives in the component because
// the operator-facing contract is "events from when you opened this
// page" — there's no shared global state to invalidate when the page
// unmounts.
//
// Row layout: kind chip + summary + relative time, with an optional
// "Show detail" toggle that expands the `detail` record as a small
// key/value list. The chip palette mirrors the connector status one
// in ChargerDetailPage (success/warning/secondary/default) so the
// page feels visually consistent without inventing a new variant.

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { DeviceEvent } from '@eveys-console/protocol';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSubscription } from '@/hooks/use-subscription';
import { formatRelativeTime } from '@/lib/time';

const RING_CAP = 200;

type ChipVariant = 'success' | 'warning' | 'secondary' | 'default';

// One mapping table, used in two places (chip variant + chip label),
// so the labels never drift from the keys.
const KIND_META: Record<DeviceEvent['kind'], { variant: ChipVariant; label: string }> = {
  boot: { variant: 'success', label: 'boot' },
  status: { variant: 'warning', label: 'status' },
  meter: { variant: 'secondary', label: 'meter' },
  'tx-started': { variant: 'default', label: 'tx-started' },
};

export interface DeviceEventsPanelProps {
  cpId: string;
}

export function DeviceEventsPanel({ cpId }: DeviceEventsPanelProps) {
  const sub = useSubscription('device-events', { cp_id: cpId });
  const [events, setEvents] = useState<DeviceEvent[]>([]);

  // Reset on cp_id change. Subscription itself is re-created by the
  // hook because params changed, but the local ring needs an explicit
  // wipe — otherwise the operator sees stale events from the previous
  // charger.
  useEffect(() => {
    setEvents([]);
  }, [cpId]);

  useEffect(() => {
    const delta = sub.lastDelta;
    if (!delta || delta.kind !== 'device-events') return;
    setEvents((prev) => {
      const next = [delta.append, ...prev];
      return next.length > RING_CAP ? next.slice(0, RING_CAP) : next;
    });
  }, [sub.lastDelta]);

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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Live events</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Live events since you opened this page. Capped at {RING_CAP}.
        </p>
        {events.length === 0 ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="device-events-empty"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Waiting for events…
          </div>
        ) : (
          <ul className="divide-y" data-testid="device-events-list">
            {events.map((ev, idx) => (
              <DeviceEventRow key={`${ev.at}-${idx}`} event={ev} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DeviceEventRow({ event }: { event: DeviceEvent }) {
  const [open, setOpen] = useState(false);
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
        <div>
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            data-testid="device-events-toggle"
          >
            {open ? 'Hide detail' : 'Show detail'}
          </button>
          {open ? (
            <dl
              className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs"
              data-testid="device-events-detail"
            >
              {detailEntries.map(([k, v]) => (
                <DetailRow key={k} k={k} v={v} />
              ))}
            </dl>
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
