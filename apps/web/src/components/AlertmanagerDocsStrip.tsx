// Page-level Alertmanager docs strip for /sys/alerts. Sits above the
// tabs so it's visible from any tab (Firing / Silences / Channels /
// Rules) — answers the "what does any of this mean?" question once,
// in one place, instead of scattering hints across four panels.
//
// Collapsed by default so it doesn't eat vertical space for operators
// who already know the model. Expanded state is intentionally not
// persisted — every visit is fresh, low surprise.

import { BookOpen, ExternalLink } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

export function AlertmanagerDocsStrip() {
  const [open, setOpen] = useState(false);
  return (
    <Alert variant="default" data-testid="alertmanager-docs-strip">
      <BookOpen className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between gap-2">
        <span>About this page · Alertmanager</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-normal underline-offset-2 hover:underline"
          data-testid="alertmanager-docs-toggle"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </AlertTitle>
      <AlertDescription className={open ? 'space-y-3 text-xs' : 'hidden'}>
        <p>
          <strong>Alertmanager</strong> turns Prometheus alert states into actual notifications.
          Prometheus evaluates rules and pushes firing alerts to Alertmanager, which groups them,
          honours silences, then routes each one to a receiver (Slack, email, webhook). The Console
          proxies its REST API so the browser never has to hold an Alertmanager token.
        </p>

        <div>
          <p className="mb-1 font-medium">What each tab does</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              <strong>Firing</strong> — alerts currently above their threshold. Click into one to
              see the operator's starting context.
            </li>
            <li>
              <strong>Silences</strong> — mute a noisy alert for a planned maintenance window. A
              silence matches by label; it does not delete the rule.
            </li>
            <li>
              <strong>Channels</strong> — where to send notifications. Slack webhook URLs, SMTP
              hosts, or HTTP receivers. Mark one as default; alerts whose route doesn't match
              anything else land there.
            </li>
            <li>
              <strong>Rules</strong> — Prometheus rule definitions. Console-managed rules can be
              edited inline; bundled rules from{' '}
              <code className="font-mono">deploy/observability/alerts.yml</code> are shown but
              read-only.
            </li>
          </ul>
        </div>

        <div>
          <p className="mb-1 font-medium">Severity ladder (matches what the rule labels emit)</p>
          <p className="space-x-1">
            <Badge variant="destructive" className="text-[10px]">
              critical
            </Badge>
            <span>= page someone now ·</span>
            <Badge variant="warning" className="text-[10px]">
              warning
            </Badge>
            <span>= investigate in business hours ·</span>
            <Badge variant="secondary" className="text-[10px]">
              info
            </Badge>
            <span>= informational, no action expected.</span>
          </p>
        </div>

        <div>
          <p className="mb-1 font-medium">First-time setup</p>
          <ol className="ml-4 list-decimal space-y-1">
            <li>
              Set <code className="font-mono">ALERTMANAGER_URL</code> on the Console (System →
              Config) so this page can talk to Alertmanager.
            </li>
            <li>
              Add at least one Channel and mark it default — without one, alerts fire but go
              nowhere.
            </li>
            <li>
              Install rules from the Rules tab's <em>Recommended</em> section, or write your own.
            </li>
            <li>
              Hit the <strong>Test</strong> button on a Channel to verify Alertmanager can actually
              deliver before you wait for a real alert.
            </li>
          </ol>
        </div>

        <p className="text-muted-foreground">
          Need the upstream docs?{' '}
          <a
            href="https://prometheus.io/docs/alerting/latest/alertmanager/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:no-underline"
          >
            prometheus.io/docs/alerting <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </AlertDescription>
    </Alert>
  );
}
