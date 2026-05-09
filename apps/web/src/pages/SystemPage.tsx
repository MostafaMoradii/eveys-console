import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  HardDrive,
  Loader2,
  Network,
  Server,
} from 'lucide-react';

import { fetchSysStatus, type ComponentStatus, type SysStatus } from '@/api/sys-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConsoleClient } from '@/lib/ws-context';
import { cn } from '@/lib/utils';

export function SystemPage() {
  const { token } = useConsoleClient();
  const q = useQuery({
    queryKey: ['sys-status'],
    queryFn: () => fetchSysStatus(token!),
    refetchInterval: 5_000,
    enabled: !!token,
  });

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading system status…
      </div>
    );
  }
  if (q.error || !q.data) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>System status unavailable</AlertTitle>
        <AlertDescription>
          {q.error instanceof Error ? q.error.message : 'unknown error'}
        </AlertDescription>
      </Alert>
    );
  }

  const s = q.data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">System status</h2>
        <p className="text-sm text-muted-foreground">Live; refreshes every 5 seconds.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ComponentCard
          icon={<Server className="h-4 w-4" />}
          title="Console BaaS"
          status={{ ok: true }}
          stats={[
            ['uptime', formatUptime(s.baas.uptime_seconds)],
            ['started', formatDate(s.baas.started_at)],
            ['websockets', String(s.connections.websockets)],
          ]}
        />

        <ComponentCard
          icon={<Activity className="h-4 w-4" />}
          title="OCPP Gateway"
          status={s.gateway}
          stats={[
            ['version', s.gateway.version ?? 'unknown'],
            ['probe latency', s.gateway.latency_ms != null ? `${s.gateway.latency_ms} ms` : '—'],
            ...(s.gateway.detail ? [['detail', s.gateway.detail] as [string, string]] : []),
          ]}
        />

        {gatewayComponentEntries(s).map(([name, status]) => {
          const cs: ComponentStatus = { ok: status === 'ok' };
          if (status !== 'ok') cs.detail = status;
          return (
            <ComponentCard
              key={`gw-${name}`}
              icon={iconForComponent(name)}
              title={`Gateway · ${name}`}
              status={cs}
            />
          );
        })}

        <ComponentCard
          icon={<Network className="h-4 w-4" />}
          title="Kafka tail"
          status={s.kafka}
          stats={[
            ['consumer', s.kafka.consumer_running ? 'running' : 'stopped'],
            ['topics', (s.kafka.topics ?? []).join(', ') || '—'],
          ]}
        />
      </div>
    </div>
  );
}

interface ComponentCardProps {
  icon: React.ReactNode;
  title: string;
  status: ComponentStatus;
  stats?: [string, string][];
}

function ComponentCard({ icon, title, status, stats }: ComponentCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </CardTitle>
        <StatusBadge ok={status.ok} />
      </CardHeader>
      <CardContent>
        {stats && stats.length > 0 ? (
          <dl className="space-y-1 text-sm">
            {stats.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className={cn('truncate font-mono text-xs')} title={v}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        ) : status.detail ? (
          <p className="text-sm text-muted-foreground">{status.detail}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ ok }: { ok: boolean }) {
  if (ok) {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        ok
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertCircle className="h-3 w-3" />
      down
    </Badge>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86_400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  return `${d}d ${h}h`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function gatewayComponentEntries(s: SysStatus): [string, string][] {
  const components = s.gateway.components;
  if (!components) return [];
  return Object.entries(components);
}

function iconForComponent(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes('postgres') || lower.includes('database'))
    return <Database className="h-4 w-4" />;
  if (lower.includes('redis')) return <HardDrive className="h-4 w-4" />;
  return <Activity className="h-4 w-4" />;
}
