// Read paths for the device-event log.
//
//   tailLastN(root, cp_id, limit)
//     → reads the latest month file from the end, walks back through
//       earlier months if needed, returns up to `limit` events in
//       reverse chronological order. Used by the `device-events`
//       resolver to bootstrap the panel on page open.
//
// We don't keep an index; the file is read in tail-friendly chunks
// (64 KB at a time, from the end). At our line lengths a single
// chunk usually contains the whole tail we want. The implementation
// is dumb on purpose — easy to reason about, no caching layer to
// invalidate.

import fs from 'node:fs/promises';
import path from 'node:path';

import type { DeviceEvent } from '@eveys-console/protocol';

import { cpDirFor, monthFromFilename } from './paths.js';

const READ_CHUNK = 64 * 1024;

export interface TailOptions {
  limit: number;
  /** Inclusive lower bound; events older than this are ignored. */
  fromIso?: string;
  /** Exclusive upper bound; events at-or-after this are ignored. */
  beforeIso?: string;
}

export async function tailLastN(
  root: string,
  cpId: string,
  opts: TailOptions,
): Promise<DeviceEvent[]> {
  if (opts.limit <= 0) return [];
  const months = await listMonthsDescending(root, cpId);
  const out: DeviceEvent[] = [];

  for (const month of months) {
    const file = path.join(cpDirFor(root, cpId), `${month}.ndjson`);
    const remaining = opts.limit - out.length;
    if (remaining <= 0) break;
    const fromFile = await tailFromFile(file, remaining, opts.fromIso, opts.beforeIso);
    // tailFromFile already returns newest-first within its file.
    out.push(...fromFile);
  }
  // Sort newest-first across months as a belt-and-braces guarantee.
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return out.slice(0, opts.limit);
}

/** Lists all `<YYYY-MM>.ndjson` filenames under `<root>/<cp_id>/`
 *  in descending month order. Returns `[]` if the directory does
 *  not exist (first-event-for-this-cp case). */
export async function listMonthsDescending(root: string, cpId: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(cpDirFor(root, cpId));
  } catch (err: unknown) {
    if (isENoEnt(err)) return [];
    throw err;
  }
  const months: string[] = [];
  for (const name of entries) {
    const m = monthFromFilename(name);
    if (m) months.push(m);
  }
  months.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return months;
}

async function tailFromFile(
  file: string,
  limit: number,
  fromIso: string | undefined,
  beforeIso: string | undefined,
): Promise<DeviceEvent[]> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(file, 'r');
  } catch (err: unknown) {
    if (isENoEnt(err)) return [];
    throw err;
  }
  try {
    const stat = await handle.stat();
    const size = stat.size;
    let pos = size;
    let leftover = '';
    const collected: DeviceEvent[] = [];

    while (pos > 0 && collected.length < limit) {
      const take = Math.min(READ_CHUNK, pos);
      pos -= take;
      const buf = Buffer.alloc(take);
      await handle.read(buf, 0, take, pos);
      const chunk = buf.toString('utf8') + leftover;
      const lines = chunk.split('\n');
      // If we didn't start at byte 0, the first slice may be a
      // partial line — hold it back for the next chunk.
      leftover = pos > 0 ? (lines.shift() ?? '') : '';
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!;
        if (line === '') continue;
        const ev = safeParse(line);
        if (!ev) continue;
        if (fromIso && ev.at < fromIso) continue;
        if (beforeIso && ev.at >= beforeIso) continue;
        collected.push(ev);
        if (collected.length >= limit) break;
      }
    }
    return collected;
  } finally {
    await handle.close();
  }
}

function safeParse(line: string): DeviceEvent | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.at !== 'string' || typeof obj.kind !== 'string') return null;
    return parsed as DeviceEvent;
  } catch {
    return null;
  }
}

function isENoEnt(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';
}
