import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useMemo } from 'react';

import type { ChargePointSummary, TransactionSummary } from '@eveys-console/protocol';

import { fetchSysStatus } from '@/api/sys-client';
import { ActiveSilencesPanel } from '@/components/ActiveSilencesPanel';
import { AlertsPanel } from '@/components/AlertsPanel';
import { FiringAlertsPanel } from '@/components/FiringAlertsPanel';
import { MetricTile } from '@/components/MetricTile';
import { ServiceStatusPills } from '@/components/ServiceStatusPills';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useFiringAlerts } from '@/hooks/use-firing-alerts';
import { useSilences } from '@/hooks/use-silences';
import { useSubscription } from '@/hooks/use-subscription';
import { computeAlerts } from '@/lib/alerts';
import { countFaults } from '@/lib/fault';
import { useConsoleClient } from '@/lib/ws-context';

// Layout note: the operator's resting question on this page is "is
// anything on fire?" — so alerts come first at full width, then the
// four headline counts, then the small service-status pills. The old
// 3-column tile grid pushed a variable-length alerts list into a
// fixed-size cell, which broke as soon as more than a couple of
// alerts fired.
//
// Two alert panels, stacked: the Alertmanager-backed "Firing alerts"
// panel on top (durable; survives the operator closing the tab) and
// the client-derived "Active alerts" below it (zero-infrastructure;
// derived from the data already on the page). Kept independent on
// purpose so the source of each row is visible — the two panels
// answer different questions on different time horizons.
//
// Recent-activity section intentionally omitted in v1. We don't have
// an aggregated event-log subscription today; the closest derivation
// (sort chargers by last_heartbeat_at) would be misleading because it
// confuses "heartbeat received" with "lifecycle event happened". When
// we add a server-side event tail we'll wire it in here. Tracked in
// issue #63.

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

      <FiringAlertsPanel
        alerts={firing.alerts}
        unavailable={firing.unavailable}
        loading={firing.loading}
      />

      <ActiveSilencesPanel
        silences={silences.silences}
        unavailable={silences.unavailable}
        loading={silences.loading}
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
