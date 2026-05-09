import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSubscription } from '@/hooks/use-subscription';

export function TransactionsPage() {
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

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">
        Active transactions — {sub.snapshot.rows.length}
      </h2>
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
            {sub.snapshot.rows.map((r) => (
              <TableRow key={r.transaction_id}>
                <TableCell>{r.transaction_id}</TableCell>
                <TableCell>{r.cp_id}</TableCell>
                <TableCell>{r.id_tag}</TableCell>
                <TableCell>{r.start_at}</TableCell>
                <TableCell>{r.energy_delivered_wh ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
