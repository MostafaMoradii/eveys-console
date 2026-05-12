// Retention: delete `<YYYY-MM>.ndjson` files whose month is older
// than `retentionMonths` months ago.
//
// "Older than N months" is measured against the first day of the
// file's month. A 12-month retention on 2026-05-12 keeps any file
// whose month starts at or after 2025-05-01.
//
// Idempotent: running twice in the same day is a no-op the second
// time because the files are already gone. Per-file errors don't
// abort the whole run — we log and continue, so one bad permission
// doesn't strand the rest.

import fs from 'node:fs/promises';
import path from 'node:path';

import type { Logger } from '../logger.js';
import { monthFromFilename, monthStart } from './paths.js';

export interface PruneOpts {
  root: string;
  retentionMonths: number;
  /** For tests: pretend "now" is this date instead of `new Date()`. */
  now?: Date;
  logger: Logger;
}

export interface PruneResult {
  removed: { cpId: string; month: string; bytes: number }[];
  errors: { path: string; err: unknown }[];
}

export async function pruneEventLog(opts: PruneOpts): Promise<PruneResult> {
  const now = opts.now ?? new Date();
  const cutoff = monthStart(monthKeyOffset(now, -opts.retentionMonths));
  const out: PruneResult = { removed: [], errors: [] };

  let cpDirs: string[];
  try {
    cpDirs = await fs.readdir(opts.root);
  } catch (err: unknown) {
    if (isENoEnt(err)) return out;
    throw err;
  }

  for (const cpDir of cpDirs) {
    const cpPath = path.join(opts.root, cpDir);
    let entries: string[];
    try {
      const stat = await fs.stat(cpPath);
      if (!stat.isDirectory()) continue;
      entries = await fs.readdir(cpPath);
    } catch (err: unknown) {
      out.errors.push({ path: cpPath, err });
      continue;
    }
    const cpId = decodeURIComponent(cpDir);
    for (const entry of entries) {
      const monthKey = monthFromFilename(entry);
      if (!monthKey) continue;
      if (monthStart(monthKey) >= cutoff) continue;
      const file = path.join(cpPath, entry);
      try {
        const stat = await fs.stat(file);
        await fs.unlink(file);
        out.removed.push({ cpId, month: monthKey, bytes: stat.size });
      } catch (err: unknown) {
        if (isENoEnt(err)) continue;
        out.errors.push({ path: file, err });
        opts.logger.warn({ err, file }, 'event-log.retention_unlink_failed');
      }
    }
  }
  return out;
}

function monthKeyOffset(from: Date, deltaMonths: number): string {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth(); // 0-based
  const total = y * 12 + m + deltaMonths;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  return `${ny.toString().padStart(4, '0')}-${(nm + 1).toString().padStart(2, '0')}`;
}

function isENoEnt(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';
}
