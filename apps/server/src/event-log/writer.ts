// Append-only writer for the device-event log.
//
// Subscribes to the existing Kafka tail and writes one NDJSON line
// per DeviceEvent into `<root>/<cp_id>/<YYYY-MM>.ndjson`. Handles are
// cached per (cp_id, month) so writes are O(1) once warm; we fsync
// on a coalesced timer to bound the loss-on-crash window without
// paying a syscall per line.
//
// One writer is enough for single-replica Console. When we run
// multiple replicas (PR3 in the broader plan) we'll either pin the
// writer to one replica or shard by cp_id; deferred until needed.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type { DeviceEvent } from '@eveys-console/protocol';

import type { KafkaEvent, KafkaTail } from '../kafka/tail.js';
import type { Logger } from '../logger.js';
import { deviceEventFromKafka, type MappedEvent } from './from-kafka.js';
import { cpDirFor, fileFor, monthKeyForDate } from './paths.js';

export interface EventLogWriterOpts {
  root: string;
  /** Milliseconds between fsync calls. 0 disables coalescing (fsync
   *  per line — useful in tests). */
  fsyncIntervalMs: number;
  logger: Logger;
}

interface OpenHandle {
  fd: number;
  month: string;
  /** Has there been a write since the last successful fsync? */
  dirty: boolean;
}

export class EventLogWriter {
  private handles = new Map<string, OpenHandle>();
  private fsyncTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly opts: EventLogWriterOpts) {}

  /** Start consuming events. Returns the unsubscribe function so
   *  callers can disconnect cleanly on shutdown. */
  attach(tail: KafkaTail): () => void {
    if (this.unsubscribe) return this.unsubscribe;
    this.unsubscribe = tail.on((event) => {
      void this.handle(event);
    });
    this.startFsyncTimer();
    return this.unsubscribe;
  }

  /** Direct write entry point used by tests and by attach()'s
   *  Kafka listener. Returns once the line is written to the OS
   *  buffer; durability is delivered by the fsync timer. */
  async appendFromKafka(event: KafkaEvent): Promise<void> {
    const mapped = deviceEventFromKafka(event);
    if (!mapped) return;
    await this.append(mapped);
  }

  async append(mapped: MappedEvent): Promise<void> {
    if (this.stopped) return;
    const at = parseAt(mapped.event.at);
    const month = monthKeyForDate(at);
    const handle = await this.openFor(mapped.cpId, month);
    const line = JSON.stringify(mapped.event) + '\n';
    await new Promise<void>((resolve, reject) => {
      fs.write(handle.fd, line, (err) => (err ? reject(err) : resolve()));
    });
    handle.dirty = true;
  }

  /** Flush + close everything. Idempotent. */
  async close(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.fsyncTimer) {
      clearInterval(this.fsyncTimer);
      this.fsyncTimer = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    await this.flush();
    for (const [, h] of this.handles) {
      await new Promise<void>((resolve) => fs.close(h.fd, () => resolve()));
    }
    this.handles.clear();
  }

  async flush(): Promise<void> {
    const work: Promise<void>[] = [];
    for (const [, h] of this.handles) {
      if (!h.dirty) continue;
      h.dirty = false;
      work.push(
        new Promise<void>((resolve, reject) => {
          fs.fsync(h.fd, (err) => (err ? reject(err) : resolve()));
        }).catch((err: unknown) => {
          // Mark dirty again so a future flush retries.
          h.dirty = true;
          this.opts.logger.warn({ err }, 'event-log.fsync_failed');
        }),
      );
    }
    await Promise.all(work);
  }

  private async handle(event: KafkaEvent): Promise<void> {
    try {
      await this.appendFromKafka(event);
    } catch (err) {
      this.opts.logger.error({ err, topic: event.topic }, 'event-log.write_failed');
    }
  }

  private startFsyncTimer(): void {
    if (this.opts.fsyncIntervalMs <= 0) return;
    this.fsyncTimer = setInterval(() => {
      void this.flush();
    }, this.opts.fsyncIntervalMs);
    // Don't pin the event loop open just for the flush timer.
    this.fsyncTimer.unref?.();
  }

  private async openFor(cpId: string, month: string): Promise<OpenHandle> {
    const key = `${cpId}|${month}`;
    const existing = this.handles.get(key);
    if (existing) return existing;

    await fsp.mkdir(cpDirFor(this.opts.root, cpId), { recursive: true });
    const file = path.join(cpDirFor(this.opts.root, cpId), `${month}.ndjson`);
    const fd: number = await new Promise((resolve, reject) => {
      fs.open(
        file,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND,
        0o644,
        (err, fdNum) => (err ? reject(err) : resolve(fdNum)),
      );
    });
    const handle: OpenHandle = { fd, month, dirty: false };
    this.handles.set(key, handle);
    return handle;
  }
}

function parseAt(s: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.valueOf())) return new Date();
  return d;
}

/** Convenience for tests + main.ts when the caller doesn't have a
 *  KafkaTail handy (e.g. during shutdown). */
export function fileForCp(root: string, cpId: string, at: Date): string {
  return fileFor(root, cpId, at);
}
