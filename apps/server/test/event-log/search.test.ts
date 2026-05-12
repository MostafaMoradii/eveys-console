// Search tests: substring match across summary + detail, range
// filter, pagination by cursor. Same fixture approach as tail —
// seed via the writer so the format stays in one place.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EventLogWriter } from '../../src/event-log/writer.js';
import type { KafkaEvent } from '../../src/kafka/tail.js';
import type { Logger } from '../../src/logger.js';
import { searchEvents } from '../../src/event-log/search.js';

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return logger;
  },
} as unknown as Logger;

let root = '';
let writer: EventLogWriter;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'evlog-search-'));
  writer = new EventLogWriter({ root, fsyncIntervalMs: 0, logger });
});
afterEach(async () => {
  await writer.close();
  await fs.rm(root, { recursive: true, force: true });
});

function statusEvent(
  over: Partial<KafkaEvent> & { iso: string; payload?: Record<string, unknown> },
): KafkaEvent {
  return {
    topic: 'cp.status',
    cpId: 'CP_A',
    cursor: `k:cp.status:0:${over.iso}`,
    timestamp: new Date(over.iso),
    payload: { connectorId: 1, status: 'Charging', errorCode: 'NoError', ...(over.payload ?? {}) },
  };
}

async function seed(events: KafkaEvent[]): Promise<void> {
  for (const e of events) await writer.appendFromKafka(e);
  await writer.flush();
}

describe('searchEvents', () => {
  it('matches a substring against summary case-insensitively', async () => {
    await seed([
      statusEvent({ iso: '2026-05-11T12:00:00Z', payload: { status: 'Available' } }),
      statusEvent({ iso: '2026-05-11T12:01:00Z', payload: { status: 'Charging' } }),
      statusEvent({
        iso: '2026-05-11T12:02:00Z',
        payload: { status: 'Faulted', errorCode: 'EVSEFailure' },
      }),
    ]);
    const out = await searchEvents(root, 'CP_A', {
      from: new Date('2026-05-11T00:00:00Z'),
      to: new Date('2026-05-12T00:00:00Z'),
      q: 'charging',
      limit: 10,
    });
    expect(out.events).toHaveLength(1);
    expect(out.events[0]!.summary.toLowerCase()).toContain('charging');
  });

  it('matches against detail values too', async () => {
    await seed([
      statusEvent({ iso: '2026-05-11T12:00:00Z', payload: { errorCode: 'GroundFailure' } }),
      statusEvent({ iso: '2026-05-11T12:01:00Z', payload: { errorCode: 'NoError' } }),
    ]);
    const out = await searchEvents(root, 'CP_A', {
      from: new Date('2026-05-11T00:00:00Z'),
      to: new Date('2026-05-12T00:00:00Z'),
      q: 'groundfailure',
      limit: 10,
    });
    expect(out.events).toHaveLength(1);
  });

  it('honours the [from, to) bound', async () => {
    await seed([
      statusEvent({ iso: '2026-05-10T11:00:00Z' }),
      statusEvent({ iso: '2026-05-11T11:00:00Z' }),
      statusEvent({ iso: '2026-05-12T11:00:00Z' }),
    ]);
    const out = await searchEvents(root, 'CP_A', {
      from: new Date('2026-05-11T00:00:00Z'),
      to: new Date('2026-05-12T00:00:00Z'),
      limit: 10,
    });
    expect(out.events.map((e) => e.at)).toEqual(['2026-05-11T11:00:00.000Z']);
  });

  it('paginates with a cursor, no duplicates, no gaps', async () => {
    const events: KafkaEvent[] = [];
    for (let i = 0; i < 25; i++) {
      const sec = String(i).padStart(2, '0');
      events.push(statusEvent({ iso: `2026-05-11T12:00:${sec}Z` }));
    }
    await seed(events);

    const args = {
      from: new Date('2026-05-11T00:00:00Z'),
      to: new Date('2026-05-12T00:00:00Z'),
      limit: 10,
    };

    const page1 = await searchEvents(root, 'CP_A', args);
    expect(page1.events).toHaveLength(10);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await searchEvents(root, 'CP_A', { ...args, cursor: page1.nextCursor! });
    expect(page2.events).toHaveLength(10);

    const page3 = await searchEvents(root, 'CP_A', { ...args, cursor: page2.nextCursor! });
    expect(page3.events).toHaveLength(5);
    expect(page3.nextCursor).toBeNull();

    // No overlap, no missing rows.
    const seen = new Set<string>();
    for (const p of [page1, page2, page3]) {
      for (const e of p.events) {
        expect(seen.has(e.at)).toBe(false);
        seen.add(e.at);
      }
    }
    expect(seen.size).toBe(25);
  });

  it('returns [] when no files exist', async () => {
    const out = await searchEvents(root, 'CP_UNKNOWN', {
      from: new Date('2026-05-11T00:00:00Z'),
      to: new Date('2026-05-12T00:00:00Z'),
      limit: 10,
    });
    expect(out.events).toEqual([]);
    expect(out.nextCursor).toBeNull();
  });

  it('walks across month boundaries when range spans two months', async () => {
    await seed([
      statusEvent({ iso: '2026-04-30T23:59:00Z' }),
      statusEvent({ iso: '2026-05-01T00:01:00Z' }),
    ]);
    const out = await searchEvents(root, 'CP_A', {
      from: new Date('2026-04-29T00:00:00Z'),
      to: new Date('2026-05-02T00:00:00Z'),
      limit: 10,
    });
    expect(out.events.map((e) => e.at)).toEqual([
      '2026-05-01T00:01:00.000Z',
      '2026-04-30T23:59:00.000Z',
    ]);
  });
});
