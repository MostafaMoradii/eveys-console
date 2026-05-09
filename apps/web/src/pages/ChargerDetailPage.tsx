import { useParams } from '@tanstack/react-router';
import { Loader2, Play, RotateCcw, Square } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/toaster';
import { useSubscription } from '@/hooks/use-subscription';
import { useConsoleClient } from '@/lib/ws-context';

export function ChargerDetailPage() {
  const { cpId } = useParams({ strict: false }) as { cpId: string };
  const { client } = useConsoleClient();
  const { toast } = useToast();
  const sub = useSubscription('charge-point', { cp_id: cpId });

  const runRpc = async (method: string, params: Record<string, unknown>) => {
    try {
      await client.rpc(method, params);
      toast({ title: method, description: 'Command accepted by charger' });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: method,
        description: err instanceof Error ? err.message : 'Command failed',
      });
    }
  };

  if (sub.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load {cpId}</AlertTitle>
        <AlertDescription>{sub.error}</AlertDescription>
      </Alert>
    );
  }
  if (sub.loading || !sub.snapshot || sub.snapshot.kind !== 'charge-point') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading charger…
      </div>
    );
  }

  const cp = sub.snapshot.row;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-semibold">{cp.cp_id}</h2>
          <p className="text-sm text-muted-foreground">
            {cp.vendor ?? '—'} / {cp.model ?? '—'} · firmware {cp.firmware_version ?? '?'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={cp.online ? 'success' : 'muted'}>
            {cp.online ? 'online' : 'offline'}
          </Badge>
          <Badge variant="secondary">last_status: {cp.last_status ?? '—'}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Commands</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            onClick={() => runRpc('remote-start', { cp_id: cp.cp_id, id_tag: 'OPERATOR' })}
          >
            <Play className="h-4 w-4" /> RemoteStart
          </Button>
          <Button
            variant="destructive"
            onClick={() => runRpc('remote-stop', { cp_id: cp.cp_id, transaction_id: 0 })}
          >
            <Square className="h-4 w-4" /> RemoteStop
          </Button>
          <Button
            variant="outline"
            onClick={() => runRpc('reset', { cp_id: cp.cp_id, type: 'Soft' })}
          >
            <RotateCcw className="h-4 w-4" /> Soft Reset
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Connectors</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>connector_id</TableHead>
                <TableHead>status</TableHead>
                <TableHead>error_code</TableHead>
                <TableHead>last_changed_at</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cp.connectors.map((c) => (
                <TableRow key={c.connector_id}>
                  <TableCell>{c.connector_id}</TableCell>
                  <TableCell>{c.status}</TableCell>
                  <TableCell>{c.error_code ?? '—'}</TableCell>
                  <TableCell>{c.last_changed_at ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
