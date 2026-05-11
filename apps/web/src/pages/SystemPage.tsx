import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertCircle, BellRing, Loader2 } from 'lucide-react';
import { useMemo } from 'react';

import type { ChargePointSummary, TransactionSummary } from '@eveys-console/protocol';

import { fetchSysStatus } from '@/api/sys-client';
import { AlertsPanel } from '@/components/AlertsPanel';
import { MetricTile } from '@/components/MetricTile';
import { ServiceStatusPills } from '@/components/ServiceStatusPills';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { useFiringAlerts } from '@/hooks/use-firing-alerts';
import { useSilences } from '@/hooks/use-silences';
import { useSubscription } from '@/hooks/use-subscription';
import { computeAlerts } from '@/lib/alerts';
import { countFaults } from '@/lib/fault';
import { useConsoleClient } from '@/lib/ws-context';

// Layout note: the operator's resting question on this page is "is
// anything on fire?" — so an alerts summary card comes first, then the
// four headline counts, then the small service-status pills. The
// detailed firing-alerts list and silences management moved to the
// dedicated /sys/alerts page; the dashboard keeps its scannable shape.
//
// The client-derived AlertsPanel (computed from charge-points data
// already on this page) stays here because it answers a different
// question: "what would I notice if Alertmanager were down?" — and
// because it costs nothing extra to render given the data is loaded.
//
// Recent-activity section intentionally omitted in v1 — no aggregated
// event-log subscription, and synthesising from last_heartbeat_at
// would conflate heartbeats with lifecycle events.

export function SystemPage() {
  const { token } = useConsoleClient();
  const sysQuery = useQuery({
    queryKey: ['sys-status'],
    queryFn: () => fetchSysStatus(token!),
    refetchInterval: 5_000,
    enabled: !!token,
  });

  // Re-use the same charge-points subscription FleetPage uses so the
  // numbers on this page agree with what an operator would see if
  // they switched tabs. 500 is the cap FaultsCard used in the old
  // layout — plenty of headroom for current deployments.
  const cpSub = useSubscription('charge-points', { limit: 500 });
  const cpRows: ChargePointSummary[] =
    cpSub.snapshot && cpSub.snapshot.kind === 'charge-points' ? cpSub.snapshot.rows : [];

  const txSub = useSubscription('transactions-active', {});
  const activeTxRows: TransactionSummary[] =
    txSub.snapshot && txSub.snapshot.kind === 'transactions-active' ? txSub.snapshot.rows : [];

  const alerts = useMemo(
    () => computeAlerts({ charge_points: cpRows, sys_status: sysQuery.data ?? null }),
    [cpRows, sysQuery.data],
  );

  const firing = useFiringAlerts();
  const silences = useSilences();

  if (sysQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading system status…
      </div>
    );
  }
  if (sysQuery.error || !sysQuery.data) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>System status unavailable</AlertTitle>
        <AlertDescription>
          {sysQuery.error instanceof Error ? sysQuery.error.message : 'unknown error'}
        </AlertDescription>
      </Alert>
    );
  }

  const sys = sysQuery.data;

  const onlineCount = cpRows.filter((cp) => cp.online).length;
  const totalCount = cpRows.length;
  const faults = countFaults(cpRows);
  const activeSessions = activeTxRows.length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">System status</h2>
        <p className="text-sm text-muted-foreground">Live; refreshes every 5 seconds.</p>
      </div>

      <AlertsSummaryCard
        firingCount={firing.alerts.length}
        silencedCount={silences.silences.length}
        unavailable={firing.unavailable}
        loading={firing.loading}
      />

      <AlertsPanel alerts={alerts} loading={cpSub.loading} error={cpSub.error ?? null} />

      <section
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="metrics-row"
      >
        <MetricTile
          testId="metric-chargers"
          label="Chargers online"
          value={cpSub.loading ? '…' : String(onlineCount)}
          hint={cpSub.loading ? 'loading…' : `of ${totalCount} known`}
          tone={!cpSub.loading && totalCount > 0 && onlineCount === 0 ? 'warning' : 'default'}
          to="/inspect/charge-points"
        />
        <MetricTile
          testId="metric-sessions"
          label="Active sessions"
          value={txSub.loading ? '…' : String(activeSessions)}
          hint={
            txSub.loading
              ? 'loading…'
              : activeSessions === 1
                ? '1 charger charging'
                : `${activeSessions} chargers charging`
          }
          tone={!txSub.loading && activeSessions > 0 ? 'success' : 'default'}
          to="/inspect/transactions"
        />
        <MetricTile
          testId="metric-faults"
          label="Faults"
          value={cpSub.loading ? '…' : String(faults.fault)}
          hint={
            cpSub.loading
              ? 'loading…'
              : faults.advisory > 0
                ? `${faults.advisory} advisory`
                : 'no advisories'
          }
          tone={faults.fault > 0 ? 'danger' : faults.advisory > 0 ? 'warning' : 'default'}
          to="/inspect/charge-points"
          search={{ faults: true }}
        />
        <MetricTile
          testId="metric-energy"
          label="24h energy"
          // We don't have a fleet-wide aggregate endpoint yet, and the
          // active-tx subscription only knows in-flight sessions —
          // not the closed ones that dominate a 24 h window. Rendering
          // a real-but-wrong number would be worse than not rendering
          // one, so we show the dash and an honest hint. Tracked in
          // issue #63 for a follow-up once the gateway exposes a
          // rollup.
          value="—"
          hint="data not available yet"
        />
      </section>

      <section className="space-y-2" data-testid="service-status-row">
        <h3 className="text-sm font-medium text-muted-foreground">Services</h3>
        <ServiceStatusPills sys={sys} />
      </section>
    </div>
  );
}

// Compact at-a-glance summary card linking to /sys/alerts for detail.
// Two numbers — firing, silenced — both pulled from the same hooks the
// alerts page uses, so the counts stay in sync within a poll cycle.
// When Alertmanager isn't configured we render a softer "not
// configured" hint rather than 0 / 0 (which would imply healthy).
function AlertsSummaryCard({
  firingCount,
  silencedCount,
  unavailable,
  loading,
}: {
  firingCount: number;
  silencedCount: number;
  unavailable: boolean;
  loading: boolean;
}) {
  return (
    <Link
      to="/sys/alerts"
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="alerts-summary-card"
    >
      <Card className="transition-colors hover:border-primary/40 hover:bg-muted/40">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <BellRing
              className={firingCount > 0 && !unavailable ? 'h-5 w-5 text-destructive' : 'h-5 w-5'}
            />
            <div>
              <p className="text-sm font-medium">Alertmanager</p>
              <p className="text-xs text-muted-foreground">
                {loading
                  ? 'loading…'
                  : unavailable
                    ? 'not configured'
                    : firingCount === 0 && silencedCount === 0
                      ? 'all clear — no alerts firing'
                      : `${firingCount} firing · ${silencedCount} silenced`}
              </p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">Open alerts →</span>
        </CardContent>
      </Card>
    </Link>
  );
}
