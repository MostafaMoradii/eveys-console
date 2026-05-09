import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';

import type { ChargePointSummary } from '@eveys-console/protocol';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSubscription } from '@/hooks/use-subscription';

export function FleetPage() {
  const sub = useSubscription('charge-points', {});

  // Apply the latest delta on top of the snapshot. For v1 we keep the whole
  // table client-side and reduce on every render — fine up to a few thousand
  // chargers. For larger fleets, switch to a useReducer that mutates a Map.
  const rows = useMemo<ChargePointSummary[]>(() => {
    if (!sub.snapshot || sub.snapshot.kind !== 'charge-points') return [];
    const byId = new Map<string, ChargePointSummary>(
      sub.snapshot.rows.map((r) => [r.cp_id, r]),
    );
    if (sub.lastDelta && sub.lastDelta.kind === 'charge-points') {
      const d = sub.lastDelta;
      if (d.op === 'upsert' && d.row) byId.set(d.row.cp_id, d.row);
      if (d.op === 'remove' && d.cp_id) byId.delete(d.cp_id);
    }
    return Array.from(byId.values()).sort((a, b) => a.cp_id.localeCompare(b.cp_id));
  }, [sub.snapshot, sub.lastDelta]);

  if (sub.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load fleet</AlertTitle>
        <AlertDescription>{sub.error}</AlertDescription>
      </Alert>
    );
  }
  if (sub.loading || !sub.snapshot) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading fleet…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <h2 className="text-xl font-semibold">Fleet — {rows.length} chargers</h2>
        <p className="text-sm text-muted-foreground">
          Live; updates as chargers connect, change status, or boot.
        </p>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>cp_id</TableHead>
              <TableHead>online</TableHead>
              <TableHead>last status</TableHead>
              <TableHead>vendor / model</TableHead>
              <TableHead>last heartbeat</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <FleetRow key={row.cp_id} row={row} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function FleetRow({ row }: { row: ChargePointSummary }) {
  return (
    <TableRow>
      <TableCell>
        <Link
          to="/charge-points/$cpId"
          params={{ cpId: row.cp_id } as never}
          className="text-primary underline-offset-2 hover:underline"
        >
          {row.cp_id}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant={row.online ? 'success' : 'muted'}>
          {row.online ? 'online' : 'offline'}
        </Badge>
      </TableCell>
      <TableCell>{row.last_status ?? '—'}</TableCell>
      <TableCell>
        {row.vendor ?? '—'} / {row.model ?? '—'}
      </TableCell>
      <TableCell>{row.last_heartbeat_at ?? '—'}</TableCell>
    </TableRow>
  );
}
