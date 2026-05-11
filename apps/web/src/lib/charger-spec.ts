// Small parser that extracts AC/DC kind + power rating from a charger's
// vendor-supplied model string. The gateway doesn't expose these as
// separate fields; vendors embed them in the model name (e.g.
// 'Eveys-22kW-AC', 'Eveys-100kW-DC'). The FleetPage and ChargerDetailPage
// surface them as compact chips so an operator can triage a mixed fleet
// at a glance.
//
// Defensive by design: when the model string doesn't match a known shape,
// the matching field stays null and the UI renders nothing — never a
// guess. The only thing worse than missing the AC/DC distinction is
// labelling a DC unit as AC.

export interface ChargerSpec {
  kind: 'AC' | 'DC' | null;
  power_kw: number | null;
}

const EMPTY: ChargerSpec = { kind: null, power_kw: null };

const KIND_RE = /\b(AC|DC)\b/i;
const POWER_RE = /(\d+(?:\.\d+)?)\s*kW\b/i;

/**
 * Parse the model string for AC/DC kind and power rating in kW.
 *
 * Matches anywhere in the string, case-insensitive. Tested against the
 * canonical Eveys patterns (Eveys-22kW-AC, Eveys-100kW-DC) and graceful
 * fallback for unknown shapes.
 */
export function parseChargerSpec(model: string | null | undefined): ChargerSpec {
  if (!model) return EMPTY;
  const kindMatch = KIND_RE.exec(model);
  const powerMatch = POWER_RE.exec(model);
  return {
    kind: kindMatch ? (kindMatch[1]!.toUpperCase() as 'AC' | 'DC') : null,
    power_kw: powerMatch ? Number(powerMatch[1]) : null,
  };
}

/**
 * Format the kW value for display. Integer kW renders as `100 kW`;
 * fractional rounds to one decimal (`7.4 kW`). Returns null when
 * power_kw is null, so the caller can skip rendering.
 */
export function formatPowerKw(power_kw: number | null): string | null {
  if (power_kw === null) return null;
  if (Number.isInteger(power_kw)) return `${power_kw} kW`;
  return `${power_kw.toFixed(1)} kW`;
}
