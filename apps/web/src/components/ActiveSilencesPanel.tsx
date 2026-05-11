// Active silences panel. Companion to FiringAlertsPanel. Lists every
// active and pending silence reported by Alertmanager via the
// Console's `/sys/alerts/silences` proxy. Each row shows the matcher
// summary, the optional comment, who created the silence, the
// remaining duration, and an "Expire now" button that hits the
// DELETE route immediately (no confirm — expiring is recoverable, the
// operator can recreate within seconds).
//
// Visual language mirrors FiringAlertsPanel deliberately so the two
// panels read as one section. If those drift apart it's a UX
// decision, not a copy-paste fix; pull the shared header layout to a
// util at that point.

import { BellOff, CheckCircle2, Info, Loader2, Undo2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useExpireSilence } from '@/hooks/use-silence-mutations';
import type { Silence, SilenceMatcher } from '@/api/alerts-client';
import { formatRemaining } from '@/lib/duration';

interface Props {
  silences: Silence[];
  unavailable: boolean;
  loading?: boolean;
}

export function ActiveSilencesPanel({ silences, unavailable, loading }: Props) {
  const showCount = !loading && !unavailable && silences.length > 0;
  return (
    <Card data-testid="active-silences-panel">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex flex-col">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <BellOff className="h-4 w-4" />
            Active silences
          </CardTitle>
          <p className="text-xs text-muted-foreground">from Alertmanager</p>
        </div>
        {showCount ? (
          <Badge variant="secondary" data-testid="active-silences-count">
            {silences.length}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="active-silences-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading silences...
          </div>
        ) : unavailable ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="active-silences-unavailable"
          >
            <Info className="h-4 w-4" aria-label="info" />
            Alertmanager not configured.
          </div>
        ) : silences.length === 0 ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="active-silences-empty"
          >
            <CheckCircle2 className="h-4 w-4" />
            No active silences.
          </div>
        ) : (
          <ul className="space-y-2">
            {silences.map((s) => (
              <SilenceRow key={s.id} silence={s} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// Compact one-line summary of the matchers — "alertname=ConsoleDown"
// is the most common shape; for fingerprint matchers we shorten the
// hex to the first 8 chars because the operator only needs enough to
// identify, not the full hash.
function summarizeMatcher(m: SilenceMatcher): string {
  const op = m.is_regex ? (m.is_equal ? '=~' : '!~') : m.is_equal ? '=' : '!=';
  const value =
    m.name === 'fingerprint' && m.value.length > 8 ? `${m.value.slice(0, 8)}...` : m.value;
  return `${m.name}${op}"${value}"`;
}

function SilenceRow({ silence }: { silence: Silence }) {
  const mutation = useExpireSilence();
  const now = Date.now();
  const endsMs = new Date(silence.ends_at).getTime();
  const startsMs = new Date(silence.starts_at).getTime();
  const remainingLabel = (() => {
    if (silence.status === 'pending') {
      const delta = startsMs - now;
      return delta > 0 ? `starts in ${formatRemaining(delta)}` : 'starting...';
    }
    const delta = endsMs - now;
    return delta > 0 ? `expires in ${formatRemaining(delta)}` : 'expiring...';
  })();

  return (
    <li
      data-testid="active-silences-row"
      data-silence-id={silence.id}
      data-status={silence.status}
      className="flex gap-3 rounded-md bg-muted/30 px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-mono text-sm leading-tight" data-testid="active-silences-matchers">
            {silence.matchers.map(summarizeMatcher).join(', ')}
          </span>
          <span className="text-xs text-muted-foreground" data-testid="active-silences-remaining">
            {remainingLabel}
          </span>
          {silence.status === 'pending' ? (
            <Badge variant="outline" className="text-[10px]">
              pending
            </Badge>
          ) : null}
        </div>
        {silence.comment ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{silence.comment}</p>
        ) : null}
        {silence.created_by ? (
          <p className="mt-0.5 text-xs text-muted-foreground">Created by {silence.created_by}</p>
        ) : null}
      </div>
      <div className="ml-auto flex shrink-0 items-start">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(silence.id)}
          data-testid="expire-silence-button"
        >
          {mutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Undo2 className="h-3.5 w-3.5" />
          )}
          Expire now
        </Button>
      </div>
    </li>
  );
}
