// Active alerts panel. Pure render; the parent (SystemPage) does the
// data fetching + computeAlerts() call and hands us a sorted list.
//
// Severity drives both the icon and a left-border accent so the eye
// can scan at a glance. The empty state is loud-and-green-good — the
// operator's resting expectation.
//
// Scope: this is the v1 of alerting; it shows what `computeAlerts`
// derives from data the page already has. Durable on-call paging
// (Prometheus / Alertmanager) is the second-half PR.

import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  OctagonAlert,
  type LucideIcon,
} from 'lucide-react';

import { Alert as AlertBox, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Alert, AlertSeverity } from '@/lib/alerts';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

interface Props {
  alerts: Alert[];
  loading?: boolean;
  error?: string | null;
}

interface SeverityStyle {
  Icon: LucideIcon;
  iconClass: string;
  borderClass: string;
  label: string;
}

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

export function AlertsPanel({ alerts, loading, error }: Props) {
  return (
    <Card data-testid="alerts-panel">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" />
          Active alerts
        </CardTitle>
        {!loading && !error && alerts.length > 0 ? (
          <Badge variant="secondary" data-testid="alerts-count">
            {alerts.length}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="alerts-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading alerts…
          </div>
        ) : error ? (
          <AlertBox variant="destructive" data-testid="alerts-error">
            <AlertTitle>Couldn't compute alerts</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </AlertBox>
        ) : alerts.length === 0 ? (
          <div
            className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"
            data-testid="alerts-empty"
          >
            <CheckCircle2 className="h-4 w-4" />
            All clear — no alerts firing.
          </div>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <AlertRow key={a.id} alert={a} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  const style = SEVERITY_STYLES[alert.severity];
  const { Icon } = style;
  return (
    <li
      data-testid="alerts-row"
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
              data-testid="alerts-cp-link"
            >
              {alert.cp_id}
            </Link>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{alert.detail}</p>
      </div>
    </li>
  );
}
