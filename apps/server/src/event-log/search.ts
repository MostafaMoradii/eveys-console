// Search across the device-event log for a single CP.
//
//   searchEvents(root, cpId, { from, to, q?, limit, cursor? })
//     → scans the month files in [from, to] newest-first, returns
//       matching events plus an opaque continuation cursor.
//
// Match semantics: substring over a normalised JSON encoding of the
// event (kind, summary, detail values). Case-insensitive. No regex
// — operators search for things like "2003", "Charging", "MAC".
//
// The cursor is the `at` timestamp of the last returned event;
// resuming asks for events strictly older than that timestamp. This
// is byte-position-agnostic so it survives file growth between
// pages (the writer is append-only; new lines only land at the end
// and don't affect older lines).

import fs from 'node:fs/promises';
import path from 'node:path';

import type { DeviceEvent } from '@eveys-console/protocol';

import { cpDirFor, monthKeyForDate } from './paths.js';

export interface SearchArgs {
  from: Date;
  to: Date;
  q?: string;
  limit: number;
  /** Continuation token returned by a prior search call. */
  cursor?: string;
}

export interface SearchResult {
  events: DeviceEvent[];
  nextCursor: string | null;
}

const READ_CHUNK = 64 * 1024;

export async function searchEvents(
  root: string,
  cpId: string,
  args: SearchArgs,
): Promise<SearchResult> {
  if (args.limit <= 0) return { events: [], nextCursor: null };

  const needle = args.q ? args.q.toLowerCase() : null;
  const fromIso = args.from.toISOString();
  const toIso = args.to.toISOString();
  // Resume: events strictly older than the cursor's `at`. The
  // cursor stays inside [from, to) because the caller threads the
  // same from/to through every page.
  const cursorAt = args.cursor && isIsoDate(args.cursor) ? args.cursor : null;

  const months = monthsInRange(args.from, args.to);
  const out: DeviceEvent[] = [];

  for (const month of months) {
    if (out.length >= args.limit) break;
    const file = path.join(cpDirFor(root, cpId), `${month}.ndjson`);
    let stat: { size: number };
    try {
      stat = await fs.stat(file);
    } catch (err: unknown) {
      if (isENoEnt(err)) continue;
      throw err;
    }

    const handle = await fs.open(file, 'r');
    try {
      let pos = stat.size;
      let leftover = '';
      while (pos > 0 && out.length < args.limit) {
        const take = Math.min(READ_CHUNK, pos);
        pos -= take;
        const buf = Buffer.alloc(take);
        await handle.read(buf, 0, take, pos);
        const chunk = buf.toString('utf8') + leftover;
        const lines = chunk.split('\n');
        leftover = pos > 0 ? (lines.shift() ?? '') : '';
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i]!;
          if (line === '') continue;
          const ev = safeParse(line);
          if (!ev) continue;
          if (ev.at < fromIso || ev.at >= toIso) continue;
          if (cursorAt && ev.at >= cursorAt) continue;
          if (needle && !matches(ev, needle)) continue;
          out.push(ev);
          if (out.length >= args.limit) break;
        }
      }
    } finally {
      await handle.close();
    }
  }

  const last = out[out.length - 1];
  const nextCursor = out.length >= args.limit && last ? last.at : null;
  return { events: out, nextCursor };
}

function matches(ev: DeviceEvent, needle: string): boolean {
  const haystack = (
    ev.kind +
    ' ' +
    ev.summary +
    ' ' +
    (ev.detail == null ? '' : JSON.stringify(ev.detail))
  ).toLowerCase();
  return haystack.includes(needle);
}

function monthsInRange(from: Date, to: Date): string[] {
  const start = monthKeyForDate(from);
  const end = monthKeyForDate(to);
  const out: string[] = [];
  // Walk descending from `end` to `start`.
  let cursor = end;
  while (cursor >= start) {
    out.push(cursor);
    cursor = decrementMonth(cursor);
  }
  return out;
}

function decrementMonth(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('-');
  let y = Number(yStr);
  let m = Number(mStr);
  m -= 1;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}`;
}

function isIsoDate(s: string): boolean {
  const d = new Date(s);
  return !Number.isNaN(d.valueOf());
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
