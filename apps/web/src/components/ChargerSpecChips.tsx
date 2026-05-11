// Compact "AC · 22 kW" chip pair derived from the charger's model
// string. Used wherever the operator needs to triage a fleet of mixed
// AC + DC kit at a glance — the FleetPage table/grid and the
// ChargerDetailPage header.
//
// Renders nothing when the model can't be parsed (rather than
// guessing). See parseChargerSpec for what the parser accepts.

import { Badge } from '@/components/ui/badge';
import { formatPowerKw, parseChargerSpec, type ChargerSpec } from '@/lib/charger-spec';
import { cn } from '@/lib/utils';

interface Props {
  model: string | null | undefined;
  /** When true, drops to a single tighter inline form (no gap between
   *  the chips, smaller text). Used in dense table cells where the
   *  default chip spacing competes with the row. */
  compact?: boolean;
}

export function ChargerSpecChips({ model, compact }: Props) {
  const spec = parseChargerSpec(model);
  if (spec.kind === null && spec.power_kw === null) return null;
  const size = compact ? 'text-[10px] px-1.5 py-0' : 'text-xs';
  return (
    <span
      className={cn('inline-flex items-center', compact ? 'gap-1' : 'gap-1.5')}
      data-testid="charger-spec-chips"
    >
      {spec.kind ? (
        <Badge
          variant="outline"
          className={cn(size, kindClass(spec.kind))}
          title={spec.kind === 'AC' ? 'Alternating current' : 'Direct current (DC fast charging)'}
        >
          {spec.kind}
        </Badge>
      ) : null}
      {spec.power_kw !== null ? (
        <Badge
          variant="outline"
          className={cn(size, 'font-mono')}
          title={`Rated power ${spec.power_kw} kW`}
        >
          {formatPowerKw(spec.power_kw)}
        </Badge>
      ) : null}
    </span>
  );
}

function kindClass(kind: NonNullable<ChargerSpec['kind']>): string {
  // AC: cool blue tint, lower visual weight (these are the majority
  // in a typical mixed fleet, no need to shout). DC: brand-orange to
  // signal "fast" — matches the EV-charge palette without conflicting
  // with the destructive/warning tones used for fault states.
  return kind === 'AC'
    ? 'border-sky-500/40 text-sky-700 dark:text-sky-300'
    : 'border-orange-500/50 text-orange-700 dark:text-orange-300';
}
