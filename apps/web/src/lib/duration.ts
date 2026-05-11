// Parse a compact human duration string (`30m`, `2h`, `1d`, `45s`) into
// a millisecond offset. Strict: rejects empty / zero / negative /
// fractional / out-of-range / unknown-unit. Returns null on rejection.
//
// Used by the "Custom..." silence form so the operator types a short
// string instead of a date-time picker — silencing is a temporary
// action, the time the silence ends is rarely an aesthetic choice.

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

const UNITS_MS: Record<string, number> = {
  s: MS_PER_SECOND,
  m: MS_PER_MINUTE,
  h: MS_PER_HOUR,
  d: MS_PER_DAY,
};

// Cap at 30 days. Anything longer is almost certainly a mistake — and
// the operator can always re-silence.
const MAX_MS = 30 * MS_PER_DAY;

const PATTERN = /^(\d+)(s|m|h|d)$/;

export function parseDurationMs(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  const m = PATTERN.exec(trimmed);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2]!;
  const factor = UNITS_MS[unit];
  if (factor === undefined) return null;
  const total = n * factor;
  if (total > MAX_MS) return null;
  return total;
}

/** Render a millisecond-precision remaining duration as the same
 *  compact "Xd Yh" / "Xh Ym" / "Xm" / "Xs" style as `formatUptime`,
 *  but anchored to a future endpoint instead of a past one.
 *  Returns 'expired' when the offset is non-positive. */
export function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'expired';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86_400) {
    const h = Math.floor(sec / 3600);
    const rm = Math.floor((sec % 3600) / 60);
    return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  }
  const d = Math.floor(sec / 86_400);
  const rh = Math.floor((sec % 86_400) / 3600);
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}
