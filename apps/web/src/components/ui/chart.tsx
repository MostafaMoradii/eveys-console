// Minimal shadcn-style wrapper around Recharts' ResponsiveContainer.
// The full shadcn chart adds CSS-variable-driven theming, custom
// tooltips, and a legend; we don't need the full set yet — a sized
// container that respects the parent's width and applies the
// foreground/muted text colours via Tailwind is enough for what the
// transaction-detail page renders.
//
// Pattern source: https://ui.shadcn.com/docs/components/chart

import { ResponsiveContainer } from 'recharts';

import { cn } from '@/lib/utils';

interface ChartContainerProps {
  children: React.ReactElement;
  className?: string;
  // Defaults to 240 px — comfortable on desktop, fits stacked cards on
  // phone without overwhelming. Override per chart when needed.
  height?: number;
}

export function ChartContainer({ children, className, height = 240 }: ChartContainerProps) {
  return (
    <div
      className={cn(
        'w-full text-xs text-muted-foreground [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid-horizontal_line]:stroke-border [&_.recharts-cartesian-grid-vertical_line]:stroke-border',
        className,
      )}
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}
