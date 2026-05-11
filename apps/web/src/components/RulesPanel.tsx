// Rules tab on /sys/alerts. Read-only display of Prometheus's loaded
// rule definitions, sourced from /api/v1/rules through the Console
// proxy.
//
// Rules are edited in deploy/observability/alerts.yml — the operator
// applies changes by reloading Prometheus. This panel exists so an
// SRE can answer "is the rule I just edited actually loaded?" and
// "is it firing right now?" without opening Prometheus' own UI.

import { AlertCircle, Info, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';

import type { RuleEntry, RuleGroup } from '@/api/alerts-client';
import { TimeAgo } from '@/components/TimeAgo';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRules } from '@/hooks/use-rules';
import { cn } from '@/lib/utils';

export function RulesPanel() {
  const { groups, unavailable, loading, error } = useRules();

  return (
    <Card data-testid="rules-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Rules</CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Loaded Prometheus alert rules. Edit in deploy/observability/alerts.yml.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="rules-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" /> Loading rules…
          </div>
        ) : unavailable ? (
          <div
            className="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
            data-testid="rules-unavailable"
          >
            <p>Prometheus not configured.</p>
            <p className="mt-1 text-xs">
              Set PROMETHEUS_URL on the Console so the Rules tab can list loaded definitions.
            </p>
          </div>
        ) : error ? (
          <Alert variant="destructive" data-testid="rules-error">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load rules</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : groups.length === 0 ? (
          <div
            className="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
            data-testid="rules-empty"
          >
            No rules loaded.
          </div>
        ) : (
          <div className="space-y-4" data-testid="rules-list">
            {groups.map((g) => (
              <RuleGroupCard key={`${g.file}:${g.name}`} group={g} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RuleGroupCard({ group }: { group: RuleGroup }) {
  return (
    <div className="rounded-md border" data-testid="rule-group" data-group-name={group.name}>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <div>
          <span className="text-sm font-medium">{group.name}</span>
          {group.file ? (
            <span className="ml-2 font-mono text-[11px] text-muted-foreground">{group.file}</span>
          ) : null}
        </div>
        <Badge variant="muted" className="text-[10px]">
          {group.rules.length} rule{group.rules.length === 1 ? '' : 's'}
        </Badge>
      </div>
      <ul className="divide-y">
        {group.rules.map((r) => (
          <RuleRow key={r.name} rule={r} />
        ))}
      </ul>
    </div>
  );
}

function RuleRow({ rule }: { rule: RuleEntry }) {
  const stateTone = stateToneFor(rule.state);
  return (
    <li
      className="space-y-1.5 px-3 py-2.5"
      data-testid="rule-row"
      data-rule-name={rule.name}
      data-rule-state={rule.state}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm">{rule.name}</span>
        {rule.severity ? (
          <Badge
            variant={
              rule.severity === 'critical' || rule.severity === 'page'
                ? 'destructive'
                : rule.severity === 'warning'
                  ? 'warning'
                  : 'secondary'
            }
            className="text-[10px]"
          >
            {rule.severity}
          </Badge>
        ) : null}
        <Badge variant={stateTone.variant} className="text-[10px] gap-1">
          <stateTone.Icon className="h-3 w-3" />
          {rule.state}
        </Badge>
        {rule.duration ? (
          <Badge variant="muted" className="font-mono text-[10px]">
            for: {rule.duration}
          </Badge>
        ) : null}
      </div>
      {rule.summary ? <p className="text-xs">{rule.summary}</p> : null}
      <pre
        className={cn(
          'overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[11px] text-foreground/90',
        )}
        data-testid="rule-expr"
      >
        {rule.expr}
      </pre>
      {rule.last_evaluation ? (
        <p className="text-[10px] text-muted-foreground">
          last evaluated <TimeAgo iso={rule.last_evaluation} />
        </p>
      ) : null}
    </li>
  );
}

function stateToneFor(state: string): {
  variant: 'success' | 'warning' | 'destructive' | 'muted';
  Icon: typeof ShieldCheck;
} {
  switch (state) {
    case 'firing':
      return { variant: 'destructive', Icon: ShieldAlert };
    case 'pending':
      return { variant: 'warning', Icon: ShieldAlert };
    case 'inactive':
      return { variant: 'muted', Icon: ShieldCheck };
    case 'ok':
      return { variant: 'success', Icon: ShieldCheck };
    default:
      return { variant: 'muted', Icon: Info };
  }
}
