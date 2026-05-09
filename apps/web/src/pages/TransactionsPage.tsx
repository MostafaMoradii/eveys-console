import { Loader2 } from 'lucide-react';

import type { TransactionSummary } from '@eveys-console/protocol';

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
import { useIsBelow } from '@/lib/use-breakpoint';

export function TransactionsPage() {
  const isPhone = useIsBelow('sm');
  const sub = useSubscription('transactions-active', {});

  if (sub.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load transactions</AlertTitle>
        <AlertDescription>{sub.error}</AlertDescription>
      </Alert>
    );
  }
  if (sub.loading || !sub.snapshot || sub.snapshot.kind !== 'transactions-active') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading transactions…
      </div>
    );
  }

  const rows = sub.snapshot.rows;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Active transactions — {rows.length}</h2>
      {rows.length === 0 ? (
        <EmptyState />
      ) : isPhone ? (
        <TransactionsCards rows={rows} />
      ) : (
        <TransactionsTable rows={rows} />
      )}
    </div>
  );
}

function TransactionsTable({ rows }: { rows: TransactionSummary[] }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>transaction_id</TableHead>
            <TableHead>cp_id</TableHead>
            <TableHead>id_tag</TableHead>
            <TableHead>started</TableHead>
            <TableHead>energy (Wh)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.transaction_id}>
              <TableCell className="font-mono">{r.transaction_id}</TableCell>
              <TableCell className="font-mono text-xs">{r.cp_id}</TableCell>
              <TableCell className="font-mono text-xs">{r.id_tag}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {r.started_reported_at}
              </TableCell>
              <TableCell className="font-mono">{r.consumed_wh ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TransactionsCards({ rows }: { rows: TransactionSummary[] }) {
  // Vertical stack of mini-cards — same fields as the table, single
  // column, fits 360 px wide. The transaction_id badge is the
  // anchor; cp_id is right-aligned because it's the next thing the
  // operator scans.
  return (
    <ul className="divide-y rounded-md border">
      {rows.map((r) => (
        <li key={r.transaction_id} className="space-y-1.5 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary" className="font-mono">
              tx {r.transaction_id}
            </Badge>
            <span className="truncate font-mono text-xs text-foreground/80" title={r.cp_id}>
              {r.cp_id}
            </span>
          </div>
          <dl className="space-y-0.5 text-xs">
            <Field k="id_tag" v={r.id_tag} />
            <Field k="started" v={formatRelativeTime(r.started_reported_at)} />
            <Field k="energy" v={r.consumed_wh != null ? `${r.consumed_wh} Wh` : '—'} />
          </dl>
        </li>
      ))}
    </ul>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate font-mono text-foreground/80">{v}</dd>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      No active transactions right now.
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
