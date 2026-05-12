// Writer tests: an event landing on the Kafka tail produces one
// NDJSON line in `<root>/<cp_id>/<YYYY-MM>.ndjson`. Covers the
// month-rollover handle reuse, fsync coalescing (we set the
// interval to 0 here so each write is durable for assertions),
// and the empty-payload short-circuit.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KafkaEvent } from '../../src/kafka/tail.js';
import type { Logger } from '../../src/logger.js';
import { EventLogWriter } from '../../src/event-log/writer.js';

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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'evlog-'));
  writer = new EventLogWriter({ root, fsyncIntervalMs: 0, logger });
});

afterEach(async () => {
  await writer.close();
  await fs.rm(root, { recursive: true, force: true });
});

function statusEvent(over: Partial<KafkaEvent> = {}): KafkaEvent {
  return {
    topic: 'cp.status',
    cpId: 'CP_A',
    cursor: 'k:cp.status:0:1',
    timestamp: new Date('2026-05-11T12:00:00Z'),
    payload: { connectorId: 1, status: 'Charging', errorCode: 'NoError' },
    ...over,
  };
}

async function readFile(cpId: string, month: string): Promise<string> {
  const file = path.join(root, encodeURIComponent(cpId), `${month}.ndjson`);
  return fs.readFile(file, 'utf8');
}

describe('EventLogWriter', () => {
  it('writes one NDJSON line per event into the per-cp / per-month file', async () => {
    await writer.appendFromKafka(statusEvent());
    await writer.flush();
    const body = await readFile('CP_A', '2026-05');
    const lines = body.trim().split('\n');
    expect(lines).toHaveLength(1);
    const ev = JSON.parse(lines[0]!);
    expect(ev.kind).toBe('status');
    expect(ev.summary).toBe('Connector 1 → Charging');
  });

  it('appends multiple events to the same file, preserving order', async () => {
    await writer.appendFromKafka(statusEvent({ timestamp: new Date('2026-05-11T12:00:00Z') }));
    await writer.appendFromKafka(statusEvent({ timestamp: new Date('2026-05-11T12:00:01Z') }));
    await writer.appendFromKafka(statusEvent({ timestamp: new Date('2026-05-11T12:00:02Z') }));
    await writer.flush();
    const body = await readFile('CP_A', '2026-05');
    expect(body.trim().split('\n')).toHaveLength(3);
  });

  it('rolls to a new file when the month changes', async () => {
    await writer.appendFromKafka(statusEvent({ timestamp: new Date('2026-05-31T23:59:00Z') }));
    await writer.appendFromKafka(statusEvent({ timestamp: new Date('2026-06-01T00:01:00Z') }));
    await writer.flush();
    const may = await readFile('CP_A', '2026-05');
    const jun = await readFile('CP_A', '2026-06');
    expect(may.trim().split('\n')).toHaveLength(1);
    expect(jun.trim().split('\n')).toHaveLength(1);
  });

  it('separates events by cp_id into per-cp directories', async () => {
    await writer.appendFromKafka(statusEvent({ cpId: 'CP_A' }));
    await writer.appendFromKafka(statusEvent({ cpId: 'CP_B' }));
    await writer.flush();
    const a = await readFile('CP_A', '2026-05');
    const b = await readFile('CP_B', '2026-05');
    expect(a.trim().split('\n')).toHaveLength(1);
    expect(b.trim().split('\n')).toHaveLength(1);
  });

  it('skips events whose payload does not produce a DeviceEvent', async () => {
    await writer.appendFromKafka(
      statusEvent({ topic: 'cp.meter', payload: { sampledValues: [] } }),
    );
    await writer.flush();
    await expect(readFile('CP_A', '2026-05')).rejects.toThrow();
  });

  it('encodes cp_id so chargers with colon-prefixed ids get a safe path', async () => {
    await writer.appendFromKafka(statusEvent({ cpId: 'site/east:CP_99' }));
    await writer.flush();
    const file = path.join(root, encodeURIComponent('site/east:CP_99'), '2026-05.ndjson');
    const body = await fs.readFile(file, 'utf8');
    expect(body.trim().split('\n')).toHaveLength(1);
  });
});
