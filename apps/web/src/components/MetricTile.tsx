// Headline metric tile for the SystemPage dashboard. One number, one
// label, optional sub-label/hint, optional click-through.
//
// We keep this very small (no severity logic, no icon registry): the
// SystemPage builds 4 of them with hand-picked styling, and pushing
// that into the tile would just move the conditionals one file over.

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Props {
  label: string;
  value: ReactNode;
  /** Small hint shown beneath the value. Use for "X / Y" denominators,
   *  "data not available" notes, etc. */
  hint?: ReactNode;
  /** Optional severity-tint on the big number. Defaults to none. */
  tone?: 'default' | 'success' | 'warning' | 'danger';
  /** When set, the whole tile becomes a Link to this route. */
  to?: string;
  /** Test/inspection hook so SystemPage tests can grab the tile. */
  testId?: string;
}

const TONE_CLASS: Record<NonNullable<Props['tone']>, string> = {
  default: 'text-foreground',
  success: 'text-emerald-700 dark:text-emerald-400',
  warning: 'text-amber-700 dark:text-amber-400',
  danger: 'text-destructive',
};

export function MetricTile({ label, value, hint, tone = 'default', to, testId }: Props) {
  const body = (
    <Card
      className={cn(
        'h-full transition-colors',
        to ? 'hover:border-primary/40 hover:bg-muted/40' : null,
      )}
      data-testid={testId}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className={cn('text-3xl font-semibold leading-none', TONE_CLASS[tone])}>{value}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );

  if (!to) return body;
  return (
    <Link to={to} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  );
}
