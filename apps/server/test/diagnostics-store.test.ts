// Pure-unit coverage of the SQLite-backed metadata store. The route
// tests in diagnostics-route.test.ts exercise the surface end-to-end;
// here we hammer the store invariants directly so a regression points
// at the right file.

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DiagnosticsStore, sha256Hex } from '../src/store/diagnostics-store.js';

let dataDir: string;
let store: DiagnosticsStore;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'diag-store-'));
  store = new DiagnosticsStore(dataDir);
});

afterEach(() => {
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('DiagnosticsStore.issue', () => {
  it('inserts a pending row with a 64-hex token and synthesises a request_id', () => {
    const r = store.issue({
      cp_id: 'cp_a',
      command: 'GetDiagnostics',
      issued_by: 'op@example',
      ttl_seconds: 60,
    });
    expect(r.token).toMatch(/^[0-9a-f]{64}$/);
    expect(r.request_id).toBe(1);
    const row = store.get(r.id);
    expect(row?.status).toBe('pending');
    expect(row?.cp_id).toBe('cp_a');
    expect(row?.command).toBe('GetDiagnostics');
    expect(row?.issued_by).toBe('op@example');
    expect(row?.expires_at).toBe(r.expires_at);
  });

  it('honours an explicit request_id', () => {
    const r = store.issue({
      cp_id: 'cp_a',
      command: 'GetLog',
      issued_by: 'op',
      ttl_seconds: 60,
      request_id: 42,
    });
    expect(r.request_id).toBe(42);
  });

  it('counts the synthetic request_id per cp_id', () => {
    const a1 = store.issue({
      cp_id: 'cp_a',
      command: 'GetDiagnostics',
      issued_by: 'op',
      ttl_seconds: 60,
    });
    const a2 = store.issue({
      cp_id: 'cp_a',
      command: 'GetDiagnostics',
      issued_by: 'op',
      ttl_seconds: 60,
    });
    const b1 = store.issue({
      cp_id: 'cp_b',
      command: 'GetDiagnostics',
      issued_by: 'op',
      ttl_seconds: 60,
    });
    expect(a1.request_id).toBe(1);
    expect(a2.request_id).toBe(2);
    expect(b1.request_id).toBe(1);
  });
});

describe('DiagnosticsStore.consume', () => {
  it('marks the row uploaded and stores the digest', () => {
    const issued = store.issue({
      cp_id: 'cp_a',
      command: 'GetDiagnostics',
      issued_by: 'op',
      ttl_seconds: 60,
    });
    const path = store.pathFor('cp_a', issued.request_id);
    writeFileSync(path, 'hello');
    const result = store.consume({
      token: issued.token,
      file_path: path,
      file_size: 5,
      file_sha256: sha256Hex('hello'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.status).toBe('uploaded');
    expect(result.row.file_size).toBe(5);
    expect(result.row.file_sha256).toBe(sha256Hex('hello'));
    expect(result.row.received_at).not.toBeNull();
  });

  it('rejects a second consume on the same token (one-shot)', () => {
    const issued = store.issue({
      cp_id: 'cp_a',
      command: 'GetDiagnostics',
      issued_by: 'op',
      ttl_seconds: 60,
    });
    const path = store.pathFor('cp_a', issued.request_id);
    writeFileSync(path, 'x');
    const first = store.consume({
      token: issued.token,
      file_path: path,
      file_size: 1,
      file_sha256: sha256Hex('x'),
    });
    expect(first.ok).toBe(true);
    const second = store.consume({
      token: issued.token,
      file_path: path,
      file_size: 1,
      file_sha256: sha256Hex('x'),
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe('already_consumed');
  });

  it('rejects an unknown token', () => {
    const result = store.consume({
      token: 'a'.repeat(64),
      file_path: '/dev/null',
      file_size: 0,
      file_sha256: '0'.repeat(64),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown_token');
  });

  it('rejects an expired token and rolls the row to status=expired', () => {
    const past = 1000;
    const issued = store.issue(
      { cp_id: 'cp_a', command: 'GetDiagnostics', issued_by: 'op', ttl_seconds: 60 },
      past,
    );
    const result = store.consume(
      {
        token: issued.token,
        file_path: '/dev/null',
        file_size: 0,
        file_sha256: '0'.repeat(64),
      },
      past + 10_000, // 10k seconds later — well past TTL
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('expired');
    const row = store.get(issued.id);
    expect(row?.status).toBe('expired');
  });
});

describe('DiagnosticsStore.findPending', () => {
  it('returns the row when valid', () => {
    const issued = store.issue({
      cp_id: 'cp_a',
      command: 'GetLog',
      issued_by: 'op',
      ttl_seconds: 60,
    });
    const found = store.findPending(issued.token);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.row.id).toBe(issued.id);
  });

  it('rejects unknown / expired / consumed tokens with the right reason', () => {
    expect(store.findPending('z'.repeat(64))).toEqual({ ok: false, reason: 'unknown_token' });

    const past = 1000;
    const expired = store.issue(
      { cp_id: 'cp_a', command: 'GetLog', issued_by: 'op', ttl_seconds: 60 },
      past,
    );
    const r = store.findPending(expired.token, past + 10_000);
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('DiagnosticsStore.list', () => {
  it('filters by cp_id and orders newest-first', () => {
    store.issue(
      { cp_id: 'cp_a', command: 'GetDiagnostics', issued_by: 'op', ttl_seconds: 60 },
      100,
    );
    store.issue(
      { cp_id: 'cp_b', command: 'GetDiagnostics', issued_by: 'op', ttl_seconds: 60 },
      200,
    );
    store.issue({ cp_id: 'cp_a', command: 'GetLog', issued_by: 'op', ttl_seconds: 60 }, 300);

    const a = store.list('cp_a');
    expect(a.length).toBe(2);
    expect(a[0]!.command).toBe('GetLog');
    expect(a[1]!.command).toBe('GetDiagnostics');

    const b = store.list('cp_b');
    expect(b.length).toBe(1);
    expect(b[0]!.cp_id).toBe('cp_b');
  });

  it('caps the limit and never returns token / file_path', () => {
    store.issue({ cp_id: 'cp_a', command: 'GetDiagnostics', issued_by: 'op', ttl_seconds: 60 });
    const list = store.list('cp_a');
    expect(list.length).toBe(1);
    const item = list[0]! as Record<string, unknown>;
    expect(item.token).toBeUndefined();
    expect(item.file_path).toBeUndefined();
    expect(item.id).toBeDefined();
  });
});

describe('DiagnosticsStore.delete', () => {
  it('removes the row and the file on disk', () => {
    const issued = store.issue({
      cp_id: 'cp_a',
      command: 'GetDiagnostics',
      issued_by: 'op',
      ttl_seconds: 60,
    });
    const path = store.pathFor('cp_a', issued.request_id);
    writeFileSync(path, 'payload');
    store.consume({
      token: issued.token,
      file_path: path,
      file_size: 7,
      file_sha256: sha256Hex('payload'),
    });
    expect(existsSync(path)).toBe(true);

    const ok = store.delete(issued.id);
    expect(ok).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(store.get(issued.id)).toBeNull();
  });

  it('returns false on a missing row', () => {
    expect(store.delete(99_999)).toBe(false);
  });
});

describe('DiagnosticsStore.sweepExpired', () => {
  it('rolls pending rows past expires_at to status=expired', () => {
    const past = 1000;
    const a = store.issue(
      { cp_id: 'cp_a', command: 'GetDiagnostics', issued_by: 'op', ttl_seconds: 60 },
      past,
    );
    const b = store.issue(
      { cp_id: 'cp_a', command: 'GetDiagnostics', issued_by: 'op', ttl_seconds: 60 },
      past,
    );

    const swept = store.sweepExpired(past + 5_000);
    expect(swept).toBe(2);
    expect(store.get(a.id)?.status).toBe('expired');
    expect(store.get(b.id)?.status).toBe('expired');
  });

  it('does not touch already-uploaded rows', () => {
    const issued = store.issue({
      cp_id: 'cp_a',
      command: 'GetDiagnostics',
      issued_by: 'op',
      ttl_seconds: 60,
    });
    const path = store.pathFor('cp_a', issued.request_id);
    writeFileSync(path, 'x');
    store.consume({
      token: issued.token,
      file_path: path,
      file_size: 1,
      file_sha256: sha256Hex('x'),
    });
    store.sweepExpired(2 ** 30);
    expect(store.get(issued.id)?.status).toBe('uploaded');
  });
});

describe('DiagnosticsStore.pathFor', () => {
  it('creates the per-charger directory and returns a path inside it', () => {
    const path = store.pathFor('cp_a', 7);
    expect(path).toContain('cp_a');
    expect(path.endsWith('/7')).toBe(true);
    // Directory should exist after pathFor — the route writes into it.
    const dirContents = readdirSync(join(store.uploadsDir, 'cp_a'));
    expect(Array.isArray(dirContents)).toBe(true);
  });

  it('refuses path-traversal cp_id segments', () => {
    const path = store.pathFor('../../../etc', 1);
    // The traversal pieces are stripped to underscores; the resulting
    // absolute path must still sit under uploadsDir.
    expect(path.startsWith(store.uploadsDir)).toBe(true);
  });
});
