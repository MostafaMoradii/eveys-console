// Per-charger reservations history card. Renders every row the
// gateway has stored — `Pending`, `Active`, `Cancelled`. Operators
// use this for two things:
//   1. Reading off a `reservation_id` to hand to CancelReservation
//      when the inline dropdown on the Commands tab doesn't have the
//      row they care about (e.g. mass-cancel scenarios, audit).
//   2. Tracing "did this reservation become a session?" — the panel
//      joins each reservation against the charger's transactions
//      heuristically: same `id_tag`, transaction `started_at` ≥
//      reservation `created_at` AND ≤ `expiry_date` (or one minute
//      past, to catch StartTransaction frames the charger reported
//      slightly after expiry). The gateway has no FK between these
//      tables today, so the join lives client-side.
//
// Polls every 10s, mirroring TransactionsHistory's cadence — long
// enough that the panel is calm, short enough that a freshly-Accepted
// reservation appears without a manual refresh.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';

import type { Reservation } from '@eveys-console/protocol';

import { fetchChargePointReservations } from '@/api/reservations-client';
import {
  fetchAllChargePointTransactions,
  type TransactionRow,
} from '@/api/transactions-client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useConsoleClient } from '@/lib/ws-context';

interface Props {
  cpId: string;
}

const REFETCH_MS = 10_000;

export function ReservationsPanel({ cpId }: Props) {
  const { token } = useConsoleClient();

  const reservationsQ = useQuery({
    queryKey: ['cp-reservations', cpId],
    queryFn: () => {
      if (!token) throw new Error('not signed in');
      return fetchChargePointReservations(token, cpId, { limit: 200 });
    },
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  // Pull recent transactions to power the reservation → tx heuristic
  // join. Bounded so we don't drag the whole tx history every poll.
  const txQ = useQuery({
    queryKey: ['cp-transactions-for-reservation-join', cpId],
    queryFn: () => {
      if (!token) throw new Error('not signed in');
      return fetchAllChargePointTransactions(token, cpId, 1, 500);
    },
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const rows = reservationsQ.data?.reservations ?? [];
  const txs = txQ.data?.transactions ?? [];

  const joined = useMemo(() => rows.map((r) => ({ r, tx: matchTransaction(r, txs) })), [rows, txs]);

  if (reservationsQ.isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Reservations</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading reservations…
        </CardContent>
      </Card>
    );
  }

  if (reservationsQ.error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Reservations</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-destructive">
          Couldn&rsquo;t load reservations:{' '}
          {reservationsQ.error instanceof Error ? reservationsQ.error.message : 'unknown error'}
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Reservations</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No reservations on record for this charger. Send a <code>ReserveNow</code> from the
          Commands tab to allocate one.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="reservations-panel">
      <CardHeader className="pb-3">
        <CardTitle>
          Reservations
          <span className="ml-2 font-mono text-xs text-muted-foreground">{rows.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>reservation_id</TableHead>
              <TableHead>connector_id</TableHead>
              <TableHead>id_tag</TableHead>
              <TableHead>status</TableHead>
              <TableHead>expiry</TableHead>
              <TableHead>created</TableHead>
              <TableHead>transaction</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {joined.map(({ r, tx }) => (
              <TableRow key={r.reservation_id} data-testid={`reservation-row-${r.reservation_id}`}>
                <TableCell className="font-mono">{r.reservation_id}</TableCell>
                <TableCell className="font-mono">{r.connector_id}</TableCell>
                <TableCell className="font-mono text-xs">{r.id_tag}</TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {formatDate(r.expiry_date)}
                </TableCell>
                <TableCell className="font-mono text-xs">{formatDate(r.created_at)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {tx ? (
                    <Link
                      to="/inspect/transactions/$txId"
                      params={{ txId: String(tx.transaction_id) }}
                      className="text-primary hover:underline"
                    >
                      #{tx.transaction_id}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant: 'success' | 'warning' | 'destructive' | 'muted' =
    status === 'Active'
      ? 'success'
      : status === 'Pending'
        ? 'warning'
        : status === 'Cancelled'
          ? 'muted'
          : 'muted';
  return (
    <Badge variant={variant} className="text-[10px] uppercase tracking-wider">
      {status}
    </Badge>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Best-effort match: same `id_tag`, and the transaction started
 *  between the reservation's `created_at` and `expiry_date` (with a
 *  60-second forgiveness window past expiry to catch frames the
 *  charger reported a beat late). The gateway has no FK between
 *  reservations and transactions today, so this is the only join
 *  we can do client-side. Returns the first match — duplicate
 *  reservations on the same id_tag are vanishingly rare and the
 *  panel only needs one anchor row. */
export function matchTransaction(r: Reservation, txs: TransactionRow[]): TransactionRow | null {
  if (!r.created_at) return null;
  const start = Date.parse(r.created_at);
  if (Number.isNaN(start)) return null;
  const end = r.expiry_date ? Date.parse(r.expiry_date) + 60_000 : Number.POSITIVE_INFINITY;
  for (const tx of txs) {
    if (tx.id_tag !== r.id_tag) continue;
    const txStart = Date.parse(tx.started_at);
    if (Number.isNaN(txStart)) continue;
    if (txStart >= start && txStart <= end) return tx;
  }
  return null;
}
