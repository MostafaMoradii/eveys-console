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
  /** Optional search-param object to attach to the link. Lets the
   *  caller deep-link into a destination route's pre-filtered state
   *  (e.g. the Faults tile lands on `/inspect/charge-points?faults=1`). */
  search?: Record<string, unknown>;
  /** Test/inspection hook so SystemPage tests can grab the tile. */
  testId?: string;
}

const TONE_CLASS: Record<NonNullable<Props['tone']>, string> = {
  default: 'text-foreground',
  success: 'text-emerald-700 dark:text-emerald-400',
  warning: 'text-amber-700 dark:text-amber-400',
  danger: 'text-destructive',
};

export function MetricTile({ label, value, hint, tone = 'default', to, search, testId }: Props) {
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
  // TanStack's Link is typed off the route tree. The MetricTile is a
  // small primitive used across several destination routes; rather than
  // bind it to a discriminated union of search shapes we cast through
  // `any` here. The route's `validateSearch` still gates what the
  // destination actually accepts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LinkAny = Link as any;
  return (
    <LinkAny
      to={to}
      {...(search ? { search } : {})}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </LinkAny>
  );
}
