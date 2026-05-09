import { useParams } from '@tanstack/react-router';
import { ChevronDown, ChevronUp, Loader2, Play, RotateCcw, Square } from 'lucide-react';
import { useState } from 'react';

import type { ChargePointSummary } from '@eveys-console/protocol';

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
import { useIsBelow } from '@/lib/use-breakpoint';
import { useConsoleClient } from '@/lib/ws-context';
import { cn } from '@/lib/utils';

type Connector = ChargePointSummary['connectors'][number];

export function ChargerDetailPage() {
  const { cpId } = useParams({ strict: false }) as { cpId: string };
  const { client } = useConsoleClient();
  const { toast } = useToast();
  const isPhone = useIsBelow('sm');
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
      <Header cp={cp} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Commands</CardTitle>
        </CardHeader>
        <CardContent>
          <Commands cp={cp} runRpc={runRpc} isPhone={isPhone} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Connectors</CardTitle>
        </CardHeader>
        <CardContent className={isPhone ? 'p-0' : undefined}>
          {isPhone ? (
            <ConnectorCards connectors={cp.connectors} />
          ) : (
            <ConnectorTable connectors={cp.connectors} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Header({ cp }: { cp: ChargePointSummary }) {
  // Title row with metadata under it, status badges below the title
  // — wraps cleanly at any width without the right edge competing
  // with the title.
  return (
    <div className="space-y-2">
      <div>
        <h2 className="break-all font-mono text-lg font-semibold sm:text-xl">{cp.cp_id}</h2>
        <p className="text-sm text-muted-foreground">
          {cp.vendor ?? '—'} / {cp.model ?? '—'} · firmware {cp.firmware_version ?? '?'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={cp.online ? 'success' : 'muted'}>
          {cp.online ? 'online' : 'offline'}
        </Badge>
        <Badge variant="secondary" className="font-mono text-xs">
          last_status: {cp.last_status ?? '—'}
        </Badge>
      </div>
    </div>
  );
}

interface CommandsProps {
  cp: ChargePointSummary;
  runRpc: (method: string, params: Record<string, unknown>) => Promise<void>;
  isPhone: boolean;
}

// On phone the buttons stack full-width and RemoteStart is hidden
// behind a "More" disclosure. RemoteStart on a touch screen is the
// most likely misclick (it would start a session on someone's car);
// the disclosure adds a deliberate second tap. Stop and Reset stay
// one tap away because they're the actions an on-call engineer
// actually needs from a phone.
function Commands({ cp, runRpc, isPhone }: CommandsProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const showRemoteStart = !isPhone || moreOpen;

  return (
    <div className={cn('flex gap-2', isPhone ? 'flex-col' : 'flex-wrap')}>
      <Button
        variant="destructive"
        onClick={() => runRpc('remote-stop', { cp_id: cp.cp_id, transaction_id: 0 })}
        className={isPhone ? 'w-full' : undefined}
      >
        <Square className="h-4 w-4" /> RemoteStop
      </Button>
      <Button
        variant="outline"
        onClick={() => runRpc('reset', { cp_id: cp.cp_id, type: 'Soft' })}
        className={isPhone ? 'w-full' : undefined}
      >
        <RotateCcw className="h-4 w-4" /> Soft Reset
      </Button>
      {showRemoteStart ? (
        <Button
          onClick={() => runRpc('remote-start', { cp_id: cp.cp_id, id_tag: 'OPERATOR' })}
          className={isPhone ? 'w-full' : undefined}
        >
          <Play className="h-4 w-4" /> RemoteStart
        </Button>
      ) : null}
      {isPhone ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMoreOpen((v) => !v)}
          className="w-full text-xs text-muted-foreground"
          aria-expanded={moreOpen}
        >
          {moreOpen ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" /> Hide RemoteStart
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" /> More commands
            </>
          )}
        </Button>
      ) : null}
    </div>
  );
}

function ConnectorTable({ connectors }: { connectors: Connector[] }) {
  if (connectors.length === 0) {
    return <p className="text-sm text-muted-foreground">No connectors reported.</p>;
  }
  return (
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
        {connectors.map((c) => (
          <TableRow key={c.connector_id}>
            <TableCell className="font-mono">{c.connector_id}</TableCell>
            <TableCell>{c.status}</TableCell>
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
  );
}

function ConnectorCards({ connectors }: { connectors: Connector[] }) {
  if (connectors.length === 0) {
    return (
      <p className="px-4 pb-4 text-sm text-muted-foreground">No connectors reported.</p>
    );
  }
  // Vertical stack of mini-cards; each shows the same fields the
  // table does, but in a single-column layout that fits 360 px wide.
  return (
    <ul className="divide-y">
      {connectors.map((c) => (
        <li key={c.connector_id} className="space-y-1.5 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm">connector {c.connector_id}</span>
            <Badge variant={connectorVariant(c)} className="text-xs">
              {c.status}
            </Badge>
          </div>
          <dl className="space-y-0.5 text-xs">
            <Field
              k="error_code"
              v={
                c.error_code && c.error_code !== 'NoError' ? (
                  <span className="text-destructive">{c.error_code}</span>
                ) : (
                  <span className="text-muted-foreground">{c.error_code ?? '—'}</span>
                )
              }
            />
            <Field k="last_changed_at" v={c.last_changed_at ?? '—'} />
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

function connectorVariant(c: Connector): 'success' | 'warning' | 'destructive' | 'muted' {
  if (c.error_code && c.error_code !== 'NoError') return 'destructive';
  switch (c.status) {
    case 'Charging':
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
}
