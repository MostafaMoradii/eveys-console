// Route tests for the per-charger events search endpoint. The route
// is a thin shim over searchEvents; the value-add here is verifying
// JWT auth, query parsing, and the body shape the UI consumes.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EventLogWriter } from '../src/event-log/writer.js';
import type { KafkaEvent } from '../src/kafka/tail.js';
import type { Logger } from '../src/logger.js';
import { registerSysCpEventsRoute } from '../src/routes/sys-cp-events.js';

const JWT_SECRET = 'a-test-secret-of-at-least-16-bytes';

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
let app: FastifyInstance;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'evlog-route-'));
  writer = new EventLogWriter({ root, fsyncIntervalMs: 0, logger });
  app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  await registerSysCpEventsRoute(app, { eventLogRoot: root });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await writer.close();
  await fs.rm(root, { recursive: true, force: true });
});

function authHeader(): string {
  const token = app.jwt.sign({ sub: 'tester' });
  return `Bearer ${token}`;
}

function statusEvent(
  iso: string,
  cpId = 'CP_A',
  payload: Record<string, unknown> = {},
): KafkaEvent {
  return {
    topic: 'cp.status',
    cpId,
    cursor: `k:cp.status:0:${iso}`,
    timestamp: new Date(iso),
    payload: { connectorId: 1, status: 'Charging', errorCode: 'NoError', ...payload },
  };
}

async function seed(events: KafkaEvent[]): Promise<void> {
  for (const e of events) await writer.appendFromKafka(e);
  await writer.flush();
}

describe('GET /sys/charge-points/:cp_id/events', () => {
  it('rejects without JWT', async () => {
    const res = await app.inject({ method: 'GET', url: '/sys/charge-points/CP_A/events' });
    expect(res.statusCode).toBe(401);
  });

  it('returns events newest-first with the default 7-day window', async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.valueOf() - 60 * 60 * 1000);
    await seed([
      statusEvent(oneHourAgo.toISOString()),
      statusEvent(new Date(now.valueOf() - 30 * 60 * 1000).toISOString()),
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/CP_A/events',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: { at: string }[]; next_cursor: string | null };
    expect(body.events).toHaveLength(2);
    expect(body.events[0]!.at >= body.events[1]!.at).toBe(true);
  });

  it('filters by substring query', async () => {
    await seed([
      statusEvent('2026-05-11T12:00:00Z', 'CP_A', { status: 'Available' }),
      statusEvent('2026-05-11T12:01:00Z', 'CP_A', {
        status: 'Faulted',
        errorCode: 'GroundFailure',
      }),
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/CP_A/events?from=2026-05-11T00:00:00Z&to=2026-05-12T00:00:00Z&q=ground',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });

  it('rejects bad time range with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/CP_A/events?from=2026-05-12T00:00:00Z&to=2026-05-11T00:00:00Z',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns next_cursor when there is more', async () => {
    const events: KafkaEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push(statusEvent(`2026-05-11T12:00:${String(i).padStart(2, '0')}Z`));
    }
    await seed(events);
    const res = await app.inject({
      method: 'GET',
      url: '/sys/charge-points/CP_A/events?from=2026-05-11T00:00:00Z&to=2026-05-12T00:00:00Z&limit=10',
      headers: { authorization: authHeader() },
    });
    const body = res.json() as { events: unknown[]; next_cursor: string | null };
    expect(body.events).toHaveLength(10);
    expect(body.next_cursor).not.toBeNull();
  });
});
