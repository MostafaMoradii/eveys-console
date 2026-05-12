// Tail tests: returns the newest N events in reverse-chronological
// order across one or two month files, honours from/before bounds,
// returns [] when the CP has never been written to. Drives the
// writer to set up fixtures (no hand-rolled NDJSON in tests so the
// on-disk format stays in one place).

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EventLogWriter } from '../../src/event-log/writer.js';
import type { KafkaEvent } from '../../src/kafka/tail.js';
import type { Logger } from '../../src/logger.js';
import { tailLastN } from '../../src/event-log/tail.js';

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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'evlog-tail-'));
  writer = new EventLogWriter({ root, fsyncIntervalMs: 0, logger });
});
afterEach(async () => {
  await writer.close();
  await fs.rm(root, { recursive: true, force: true });
});

function statusAt(iso: string, cpId = 'CP_A'): KafkaEvent {
  return {
    topic: 'cp.status',
    cpId,
    cursor: `k:cp.status:0:${iso}`,
    timestamp: new Date(iso),
    payload: { connectorId: 1, status: 'Charging', errorCode: 'NoError' },
  };
}

async function seed(events: KafkaEvent[]): Promise<void> {
  for (const e of events) {
    await writer.appendFromKafka(e);
  }
  await writer.flush();
}

describe('tailLastN', () => {
  it('returns the newest N events from a single month, newest first', async () => {
    await seed([
      statusAt('2026-05-11T12:00:00Z'),
      statusAt('2026-05-11T12:00:01Z'),
      statusAt('2026-05-11T12:00:02Z'),
      statusAt('2026-05-11T12:00:03Z'),
    ]);
    const out = await tailLastN(root, 'CP_A', { limit: 2 });
    expect(out).toHaveLength(2);
    expect(out[0]!.at).toBe('2026-05-11T12:00:03.000Z');
    expect(out[1]!.at).toBe('2026-05-11T12:00:02.000Z');
  });

  it('walks back to the previous month if the latest does not satisfy limit', async () => {
    await seed([statusAt('2026-04-30T23:59:00Z'), statusAt('2026-05-01T00:01:00Z')]);
    const out = await tailLastN(root, 'CP_A', { limit: 5 });
    expect(out.map((e) => e.at)).toEqual(['2026-05-01T00:01:00.000Z', '2026-04-30T23:59:00.000Z']);
  });

  it('returns [] when the cp_id has never been written', async () => {
    const out = await tailLastN(root, 'CP_UNKNOWN', { limit: 10 });
    expect(out).toEqual([]);
  });

  it('honours fromIso and beforeIso bounds', async () => {
    await seed([
      statusAt('2026-05-11T11:00:00Z'),
      statusAt('2026-05-11T12:00:00Z'),
      statusAt('2026-05-11T13:00:00Z'),
    ]);
    const out = await tailLastN(root, 'CP_A', {
      limit: 10,
      fromIso: '2026-05-11T11:30:00Z',
      beforeIso: '2026-05-11T12:30:00Z',
    });
    expect(out.map((e) => e.at)).toEqual(['2026-05-11T12:00:00.000Z']);
  });

  it('survives a large file (>64 KB) reading from the end', async () => {
    // ~200 lines at ~300 bytes each ≈ 60 KB, plus boundary cases.
    const events: KafkaEvent[] = [];
    for (let i = 0; i < 400; i++) {
      events.push(
        statusAt(
          `2026-05-11T12:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
        ),
      );
    }
    await seed(events);
    const out = await tailLastN(root, 'CP_A', { limit: 10 });
    expect(out).toHaveLength(10);
    // newest-first across chunk boundaries
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1]!.at >= out[i]!.at).toBe(true);
    }
  });
});
