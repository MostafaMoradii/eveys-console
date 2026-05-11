// "Recommended rules" section at the top of the Rules tab. Each row
// shows one of the curated rules from src/lib/recommended-rules.ts with
// an Install / Uninstall button. Install posts the rule to the managed
// store; Uninstall deletes by name. Both go through the same hooks the
// hand-add flow uses, so a recommended install is indistinguishable
// from a manual one after the fact — the operator can still edit it
// later from the Managed-rules section below.

import { BookOpen, CheckCircle2, Download, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toaster';
import {
  useCreateManagedRule,
  useDeleteManagedRule,
  useManagedRules,
} from '@/hooks/use-managed-rules';
import { isInstalled, RECOMMENDED_RULES, type RecommendedRule } from '@/lib/recommended-rules';
import { cn } from '@/lib/utils';

export function RecommendedRulesPanel() {
  const { rules: installed, loading } = useManagedRules();
  const installedCount = RECOMMENDED_RULES.filter((r) => isInstalled(r.name, installed)).length;

  return (
    <Card data-testid="recommended-rules-panel">
      <CardHeader className="space-y-1 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-medium">Recommended rules</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A curated starter pack of alerts. Install the ones that match your environment; tune
              thresholds later in the Managed-rules section below.
            </p>
          </div>
          <Badge variant="muted" className="text-[10px]" data-testid="recommended-rules-count">
            {installedCount} / {RECOMMENDED_RULES.length} installed
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        <ul className="divide-y rounded-md border">
          {RECOMMENDED_RULES.map((rule) => (
            <RecommendedRow
              key={rule.name}
              rule={rule}
              installed={isInstalled(rule.name, installed)}
              busy={loading}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function RecommendedRow({
  rule,
  installed,
  busy,
}: {
  rule: RecommendedRule;
  installed: boolean;
  busy: boolean;
}) {
  const create = useCreateManagedRule();
  const remove = useDeleteManagedRule();
  const { toast } = useToast();
  const inFlight = create.isPending || remove.isPending;

  const onInstall = () => {
    create.mutate(
      {
        name: rule.name,
        expr: rule.expr,
        duration: rule.duration,
        severity: rule.severity,
        summary: rule.summary,
        description: rule.description,
      },
      {
        onSuccess: () => toast({ title: `Installed ${rule.name}` }),
        onError: (err) =>
          toast({
            variant: 'destructive',
            title: `Couldn't install ${rule.name}`,
            description: err.message,
          }),
      },
    );
  };

  const onUninstall = () => {
    remove.mutate(rule.name, {
      onSuccess: () => toast({ title: `Removed ${rule.name}` }),
      onError: (err) =>
        toast({
          variant: 'destructive',
          title: `Couldn't remove ${rule.name}`,
          description: err.message,
        }),
    });
  };

  return (
    <li
      className="space-y-1.5 px-3 py-2.5"
      data-testid="recommended-rule-row"
      data-rule-name={rule.name}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{rule.name}</span>
            <Badge variant={severityVariant(rule.severity)} className="text-[10px]">
              {rule.severity}
            </Badge>
            {rule.duration ? (
              <Badge variant="muted" className="font-mono text-[10px]">
                for: {rule.duration}
              </Badge>
            ) : null}
            {installed ? (
              <Badge
                variant="success"
                className="gap-1 text-[10px]"
                data-testid="recommended-rule-installed"
              >
                <CheckCircle2 className="h-3 w-3" /> installed
              </Badge>
            ) : null}
          </div>
          <p className="text-xs">{rule.summary}</p>
          <p className="text-xs text-muted-foreground">{rule.rationale}</p>
          <pre className="overflow-x-auto rounded bg-muted/40 p-2 font-mono text-[11px] text-foreground/90">
            {rule.expr}
          </pre>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {installed ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-destructive hover:bg-destructive/10"
              onClick={onUninstall}
              disabled={inFlight || busy}
              data-testid="uninstall-recommended-rule"
            >
              {remove.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Remove
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={onInstall}
              disabled={inFlight || busy}
              data-testid="install-recommended-rule"
            >
              {create.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Install
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

function severityVariant(s: string): 'destructive' | 'warning' | 'secondary' | 'muted' {
  if (s === 'critical') return 'destructive';
  if (s === 'warning') return 'warning';
  if (s === 'info') return 'secondary';
  return 'muted';
}

// ---------------------------------------------------------------------------
// On-page docs strip
// ---------------------------------------------------------------------------
// Operators on this tab need three things explained: how alerts flow,
// what severity each level means, and where to look when a rule fires.
// Render once at the top of the tab so the explanation is permanent
// rather than tucked into a tooltip.

export function RulesDocsStrip() {
  const [open, setOpen] = useState(false);
  return (
    <Alert variant="default" data-testid="rules-docs-strip">
      <BookOpen className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between gap-2">
        <span>How alerts work here</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-normal underline-offset-2 hover:underline"
          data-testid="rules-docs-toggle"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </AlertTitle>
      <AlertDescription className={cn('space-y-2 text-xs', !open && 'hidden')}>
        <p>
          A rule is a PromQL expression Prometheus evaluates on every scrape. When the expression is
          true for the rule's <code className="font-mono">for:</code> duration, Prometheus pushes an
          alert to Alertmanager, which forwards it to the receiver matching the alert's{' '}
          <code className="font-mono">severity</code> label (Channels tab).
        </p>
        <p className="space-x-1">
          <strong>Severity ladder:</strong>
          <Badge variant="destructive" className="text-[10px]">
            critical
          </Badge>
          <span>= page someone now ·</span>
          <Badge variant="warning" className="text-[10px]">
            warning
          </Badge>
          <span>= look at this in business hours ·</span>
          <Badge variant="secondary" className="text-[10px]">
            info
          </Badge>
          <span>= informational, no action expected.</span>
        </p>
        <p>
          When a rule fires, jump to the <strong>Firing</strong> tab to see it with the operator's
          starting context. Use <strong>Silences</strong> to mute a known-noisy alert during a
          maintenance window. Use <strong>Channels</strong> to set where each severity is delivered
          (Slack, email, webhook).
        </p>
        <p className="text-muted-foreground">
          Console-managed rules are persisted to{' '}
          <code className="font-mono">alerts-managed.yml</code>; bundled rules from{' '}
          <code className="font-mono">deploy/observability/alerts.yml</code> also load but aren't
          editable from here.
        </p>
      </AlertDescription>
    </Alert>
  );
}
