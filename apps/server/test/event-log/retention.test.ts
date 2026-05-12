// Retention tests: deletes month files older than the configured
// retention, leaves newer ones alone, is idempotent, tolerates a
// CP directory disappearing mid-run.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Logger } from '../../src/logger.js';
import { pruneEventLog } from '../../src/event-log/retention.js';

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

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'evlog-retn-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function makeFile(cpId: string, monthKey: string): Promise<string> {
  const dir = path.join(root, encodeURIComponent(cpId));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${monthKey}.ndjson`);
  await fs.writeFile(file, '{"at":"2026-01-01T00:00:00Z","kind":"status"}\n');
  return file;
}

describe('pruneEventLog', () => {
  it('removes files older than retentionMonths, keeps newer ones', async () => {
    const old1 = await makeFile('CP_A', '2025-01');
    const old2 = await makeFile('CP_A', '2025-04');
    const kept = await makeFile('CP_A', '2025-06');
    const current = await makeFile('CP_A', '2026-05');

    const result = await pruneEventLog({
      root,
      retentionMonths: 12,
      now: new Date('2026-05-12T03:00:00Z'),
      logger,
    });
    expect(result.removed.map((r) => r.month).sort()).toEqual(['2025-01', '2025-04']);
    expect(result.errors).toEqual([]);
    await expect(fs.access(old1)).rejects.toThrow();
    await expect(fs.access(old2)).rejects.toThrow();
    await expect(fs.access(kept)).resolves.toBeUndefined();
    await expect(fs.access(current)).resolves.toBeUndefined();
  });

  it('is idempotent', async () => {
    await makeFile('CP_A', '2025-01');
    await makeFile('CP_A', '2026-05');
    const first = await pruneEventLog({
      root,
      retentionMonths: 12,
      now: new Date('2026-05-12T03:00:00Z'),
      logger,
    });
    const second = await pruneEventLog({
      root,
      retentionMonths: 12,
      now: new Date('2026-05-12T03:00:00Z'),
      logger,
    });
    expect(first.removed).toHaveLength(1);
    expect(second.removed).toHaveLength(0);
  });

  it('returns empty result when the root does not exist', async () => {
    await fs.rm(root, { recursive: true, force: true });
    const result = await pruneEventLog({
      root,
      retentionMonths: 12,
      now: new Date('2026-05-12T03:00:00Z'),
      logger,
    });
    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('decodes cp_id directory names back to the original cp_id', async () => {
    await makeFile('site/east:CP_99', '2025-01');
    const result = await pruneEventLog({
      root,
      retentionMonths: 12,
      now: new Date('2026-05-12T03:00:00Z'),
      logger,
    });
    expect(result.removed[0]!.cpId).toBe('site/east:CP_99');
  });

  it('ignores non-NDJSON files in the cp directory', async () => {
    const dir = path.join(root, encodeURIComponent('CP_A'));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'note.txt'), 'not a log file');
    await fs.writeFile(path.join(dir, '2026-13-bad.ndjson'), '');
    await makeFile('CP_A', '2025-01');
    const result = await pruneEventLog({
      root,
      retentionMonths: 12,
      now: new Date('2026-05-12T03:00:00Z'),
      logger,
    });
    expect(result.removed.map((r) => r.month)).toEqual(['2025-01']);
    await expect(fs.access(path.join(dir, 'note.txt'))).resolves.toBeUndefined();
  });
});
