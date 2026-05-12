// Path scheme for the device-event log on disk.
//
//   <root>/<cp_id>/<YYYY-MM>.ndjson
//
// One file per CP per month. Append-only. The month component is
// derived from the event's wall-clock month in UTC — same axis used
// by the retention prune. CP IDs are URL-encoded so unusual
// characters (we've seen `:`, `/`) can't escape the per-CP
// directory.

import path from 'node:path';

const MONTH_FILE_RE = /^(\d{4})-(\d{2})\.ndjson$/;

export function encodeCpId(cpId: string): string {
  return encodeURIComponent(cpId);
}

export function monthKeyForDate(at: Date): string {
  const y = at.getUTCFullYear().toString().padStart(4, '0');
  const m = (at.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

export function cpDirFor(root: string, cpId: string): string {
  return path.join(root, encodeCpId(cpId));
}

export function fileFor(root: string, cpId: string, at: Date): string {
  return path.join(cpDirFor(root, cpId), `${monthKeyForDate(at)}.ndjson`);
}

/** Returns null when the filename is not a `YYYY-MM.ndjson` member. */
export function monthFromFilename(name: string): string | null {
  const m = MONTH_FILE_RE.exec(name);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

/** Date for "first day of this month UTC", used for retention math. */
export function monthStart(monthKey: string): Date {
  const [yStr, mStr] = monthKey.split('-');
  return new Date(Date.UTC(Number(yStr), Number(mStr) - 1, 1));
}
