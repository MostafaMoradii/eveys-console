import { useParams } from '@tanstack/react-router';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Play,
  RotateCcw,
  Square,
  Wrench,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ChargePointSummary } from '@eveys-console/protocol';

import { ChargerSpecChips } from '@/components/ChargerSpecChips';
import { TimeAgo } from '@/components/TimeAgo';
import { CommandsDrawer } from '@/components/CommandsDrawer';
import { DeviceEventsPanel } from '@/components/DeviceEventsPanel';
import { DiagnosticsHistory } from '@/components/DiagnosticsHistory';
import { StatisticsCard } from '@/components/StatisticsCard';
import { TransactionsHistory } from '@/components/TransactionsHistory';
import { canRemoteStart, canRemoteStop, canReset } from '@/lib/charger-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { chargePointFaultLevel, connectorFaultLevel, faultedConnectors } from '@/lib/fault';
import { describeErrorCode } from '@/lib/ocpp-errors';
import { formatUptime } from '@/lib/time';
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
  // Merge the most recent delta into the rendered row so a
  // BootNotification or StatusNotification visibly updates the page
  // without waiting for the next snapshot refresh. The resolver
  // re-fetches the full row from the gateway on each `cp.boot` /
  // `cp.status` event (see apps/server/src/broker/queries.ts).
  const cp = useMemo<ChargePointSummary | null>(() => {
    if (!sub.snapshot || sub.snapshot.kind !== 'charge-point') return null;
    if (sub.lastDelta && sub.lastDelta.kind === 'charge-point') {
      return sub.lastDelta.row;
    }
    return sub.snapshot.row;
  }, [sub.snapshot, sub.lastDelta]);

  if (sub.loading || !cp) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading charger…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Header cp={cp} />

      <FaultBanner cp={cp} />

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

      <StatisticsCard cpId={cp.cp_id} />

      <DeviceEventsPanel cpId={cp.cp_id} />

      <TransactionsHistory cpId={cp.cp_id} />

      <DiagnosticsHistory cpId={cp.cp_id} />
    </div>
  );
}

// Banner above the Commands card whenever any connector reports a non-ok
// fault level. One section per faulted connector — error code, friendly
// label, what it means, suggested action, vendor info if present, and
// how long ago the status flipped. Critical/Faulted variant is destructive
// (red); advisory uses the default Alert.
function FaultBanner({ cp }: { cp: ChargePointSummary }) {
  const connectors = faultedConnectors(cp);
  if (connectors.length === 0) return null;
  const overall = chargePointFaultLevel(cp);
  const variant = overall === 'fault' ? 'destructive' : 'default';
  return (
    <Alert variant={variant}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {overall === 'fault'
          ? `Faulted — ${connectors.length} connector${connectors.length === 1 ? '' : 's'}`
          : `Advisory — ${connectors.length} connector${connectors.length === 1 ? '' : 's'} reporting an error`}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        {connectors.map((c) => {
          const info = describeErrorCode(c.error_code);
          const level = connectorFaultLevel(c);
          return (
            <div key={c.connector_id} className="space-y-1">
              <p className="font-medium">
                <span className="font-mono text-xs">connector_id={c.connector_id}</span>
                {' · '}
                <span className="font-mono text-xs">status={c.status}</span>
                {' · '}
                <span className="font-mono text-xs">error_code={c.error_code ?? 'NoError'}</span>
                {' · '}
                <span
                  className={cn(
                    'rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                    level === 'fault'
                      ? 'bg-destructive text-destructive-foreground'
                      : 'bg-amber-500/20 text-amber-900 dark:text-amber-200',
                  )}
                >
                  {info.label}
                </span>
              </p>
              <p className="text-xs">{info.description}</p>
              <p className="text-xs">
                <span className="font-semibold">Suggested action:</span> {info.suggestedAction}
              </p>
              {c.vendor_error_code ? (
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">vendor_error_code: {c.vendor_error_code}</span>
                  {c.info ? <span className="ml-2 italic">{c.info}</span> : null}
                </p>
              ) : c.info ? (
                <p className="text-xs italic text-muted-foreground">{c.info}</p>
              ) : null}
              <p className="text-[10px] text-muted-foreground">
                since <TimeAgo iso={c.last_changed_at} />
              </p>
            </div>
          );
        })}
      </AlertDescription>
    </Alert>
  );
}

function Header({ cp }: { cp: ChargePointSummary }) {
  // Title row with metadata under it, status badges below the title
  // — wraps cleanly at any width without the right edge competing
  // with the title.
  return (
    <div className="space-y-2">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="break-all font-mono text-lg font-semibold sm:text-xl">{cp.cp_id}</h2>
          <ChargerSpecChips model={cp.model} />
        </div>
        <p className="text-sm text-muted-foreground">
          {cp.vendor ?? '—'} / {cp.model ?? '—'} · firmware {cp.firmware_version ?? '?'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={cp.online ? 'success' : 'muted'}>{cp.online ? 'online' : 'offline'}</Badge>
        <Badge variant="secondary" className="font-mono text-xs">
          last_status: {cp.last_status ?? '—'}
        </Badge>
        {cp.last_heartbeat_at ? (
          <Badge variant="secondary" className="font-mono text-xs" data-testid="header-heartbeat">
            heartbeat: <TimeAgo iso={cp.last_heartbeat_at} className="ml-1" />
          </Badge>
        ) : null}
        {cp.pod_id ? (
          <Badge variant="secondary" className="font-mono text-xs" title={cp.pod_id}>
            pod: {cp.pod_id.length > 12 ? `${cp.pod_id.slice(0, 12)}…` : cp.pod_id}
          </Badge>
        ) : null}
        {cp.online && cp.last_boot_at ? (
          <Badge
            variant="secondary"
            className="font-mono text-xs"
            title={`booted at ${cp.last_boot_at}`}
          >
            uptime: {formatUptime(cp.last_boot_at)}
          </Badge>
        ) : null}
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
//
// Hard Reset is gated behind an AlertDialog because it terminates any
// active transaction without storing the final meter value — the click
// must be deliberate. Soft Reset stays one-tap because it's recoverable.
//
// RemoteStart requires an id_tag — the operator types/pastes the value
// that's allow-listed in the backend. No fake default; the button is
// disabled until something's typed.
function Commands({ cp, runRpc, isPhone }: CommandsProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [hardResetOpen, setHardResetOpen] = useState(false);
  const [idTag, setIdTag] = useState('');
  const showRemoteStart = !isPhone || moreOpen;

  // Button availability is derived from connector state — no point
  // letting the operator send RemoteStop when nothing is charging,
  // or RemoteStart when every connector is already in a session.
  const stopAv = canRemoteStop(cp);
  const startAv = canRemoteStart(cp);
  const resetAv = canReset(cp);
  const trimmedTag = idTag.trim();
  const remoteStartReady = startAv.enabled && trimmedTag.length > 0;
  const remoteStartTitle = !startAv.enabled
    ? startAv.reason
    : trimmedTag.length === 0
      ? 'Type an authorised id_tag to enable'
      : undefined;

  return (
    <div className={cn('flex gap-2', isPhone ? 'flex-col' : 'flex-wrap')}>
      <Button
        variant="destructive"
        onClick={() => runRpc('remote-stop', { cp_id: cp.cp_id, transaction_id: 0 })}
        disabled={!stopAv.enabled}
        title={stopAv.reason}
        className={isPhone ? 'w-full' : undefined}
      >
        <Square className="h-4 w-4" /> RemoteStop
      </Button>
      <Button
        variant="outline"
        onClick={() => runRpc('reset', { cp_id: cp.cp_id, type: 'Soft' })}
        disabled={!resetAv.enabled}
        title={resetAv.reason}
        className={isPhone ? 'w-full' : undefined}
      >
        <RotateCcw className="h-4 w-4" /> Soft Reset
      </Button>
      <Button
        variant="outline"
        onClick={() => setHardResetOpen(true)}
        disabled={!resetAv.enabled}
        title={resetAv.reason}
        className={isPhone ? 'w-full' : undefined}
        data-testid="hard-reset-button"
      >
        <RotateCcw className="h-4 w-4" /> Hard Reset
      </Button>
      {showRemoteStart ? (
        <div className={cn('flex gap-2', isPhone ? 'flex-col' : 'flex-row items-center')}>
          <Input
            value={idTag}
            onChange={(e) => setIdTag(e.currentTarget.value)}
            placeholder="id_tag"
            aria-label="id_tag for RemoteStart"
            className={cn('font-mono text-xs', isPhone ? 'w-full' : 'h-9 w-[140px]')}
            data-testid="remote-start-idtag"
          />
          <Button
            onClick={() => runRpc('remote-start', { cp_id: cp.cp_id, id_tag: trimmedTag })}
            disabled={!remoteStartReady}
            title={remoteStartTitle}
            className={isPhone ? 'w-full' : undefined}
            data-testid="remote-start-button"
          >
            <Play className="h-4 w-4" /> RemoteStart
          </Button>
        </div>
      ) : null}
      <CommandsDrawer
        cpId={cp.cp_id}
        trigger={
          <Button variant="outline" className={isPhone ? 'w-full' : undefined}>
            <Wrench className="h-4 w-4" /> All commands
          </Button>
        }
      />
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

      <AlertDialog open={hardResetOpen} onOpenChange={setHardResetOpen}>
        <AlertDialogContent data-testid="hard-reset-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Hard Reset {cp.cp_id}?</AlertDialogTitle>
            <AlertDialogDescription>
              The charger will power-cycle immediately. Any active transaction is terminated without
              storing the final meter value. Use this only when Soft Reset has failed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setHardResetOpen(false);
                void runRpc('reset', { cp_id: cp.cp_id, type: 'Hard' });
              }}
              data-testid="hard-reset-confirm"
            >
              Hard Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
              <TimeAgo iso={c.last_changed_at} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ConnectorCards({ connectors }: { connectors: Connector[] }) {
  if (connectors.length === 0) {
    return <p className="px-4 pb-4 text-sm text-muted-foreground">No connectors reported.</p>;
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
            <Field k="last_changed_at" v={<TimeAgo iso={c.last_changed_at} />} />
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
