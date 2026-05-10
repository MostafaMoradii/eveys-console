// Firing alerts panel — renders alerts polled from the Console's
// `/sys/alerts/firing` proxy (which in turn talks to Alertmanager).
// Sits above the client-derived AlertsPanel on SystemPage; both panels
// render independently and the operator sees both sources, labelled.
//
// Composition decision (option b in the spec): kept as its own
// component rather than factoring a shared inner-row out of
// AlertsPanel. The header label, subtitle, empty-state copy, and
// "unavailable" hint differ enough that a shared inner would need
// flags for each one, and the duplication that remains is one
// `SEVERITY_STYLES` table and an AlertRow component — tolerable, and
// keeps each panel's branching local.

import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Info,
  Loader2,
  OctagonAlert,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Alert, AlertSeverity } from '@/lib/alerts';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

interface Props {
  alerts: Alert[];
  unavailable: boolean;
  loading?: boolean;
}

interface SeverityStyle {
  Icon: LucideIcon;
  iconClass: string;
  borderClass: string;
  label: string;
}

// Mirrors the AlertsPanel palette so the two panels read as one
// visual family. If those drift apart, that's a UX decision — not a
// reason to copy-paste-fix in two places. Pull both panels' styles
// to a shared util at that point.
const SEVERITY_STYLES: Record<AlertSeverity, SeverityStyle> = {
  critical: {
    Icon: OctagonAlert,
    iconClass: 'text-destructive',
    borderClass: 'border-l-4 border-l-destructive',
    label: 'critical',
  },
  warning: {
    Icon: AlertTriangle,
    iconClass: 'text-amber-600 dark:text-amber-400',
    borderClass: 'border-l-4 border-l-amber-500',
    label: 'warning',
  },
  info: {
    Icon: Info,
    iconClass: 'text-muted-foreground',
    borderClass: 'border-l-4 border-l-muted-foreground/40',
    label: 'info',
  },
};

export function FiringAlertsPanel({ alerts, unavailable, loading }: Props) {
  const showCount = !loading && !unavailable && alerts.length > 0;
  return (
    <Card data-testid="firing-alerts-panel">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex flex-col">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <BellRing className="h-4 w-4" />
            Firing alerts
          </CardTitle>
          <p className="text-xs text-muted-foreground">from Alertmanager</p>
        </div>
        {showCount ? (
          <Badge variant="secondary" data-testid="firing-alerts-count">
            {alerts.length}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="firing-alerts-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading firing alerts…
          </div>
        ) : unavailable ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="firing-alerts-unavailable"
          >
            <Info className="h-4 w-4" aria-label="info" />
            Alertmanager not configured.
          </div>
        ) : alerts.length === 0 ? (
          <div
            className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"
            data-testid="firing-alerts-empty"
          >
            <CheckCircle2 className="h-4 w-4" />
            No alerts firing.
          </div>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <FiringAlertRow key={a.id} alert={a} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FiringAlertRow({ alert }: { alert: Alert }) {
  const style = SEVERITY_STYLES[alert.severity];
  const { Icon } = style;
  return (
    <li
      data-testid="firing-alerts-row"
      data-severity={alert.severity}
      data-alert-id={alert.id}
      className={cn('flex gap-3 rounded-md bg-muted/30 px-3 py-2', style.borderClass)}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.iconClass)} aria-label={style.label} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm font-medium leading-tight">{alert.title}</span>
          {alert.since ? (
            <span className="text-xs text-muted-foreground">{formatRelativeTime(alert.since)}</span>
          ) : null}
          {alert.cp_id ? (
            <Link
              to="/inspect/charge-points/$cpId"
              params={{ cpId: alert.cp_id }}
              className="text-xs font-mono text-primary hover:underline"
              data-testid="firing-alerts-cp-link"
            >
              {alert.cp_id}
            </Link>
          ) : null}
        </div>
        {alert.detail ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{alert.detail}</p>
        ) : null}
      </div>
    </li>
  );
}
