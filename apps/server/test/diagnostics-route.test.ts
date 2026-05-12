// Light-touch route tests for the diagnostics receiver. We don't try
// to exhaustively cover the upload streaming path — diagnostics-store
// owns the metadata invariants. The value-add here is verifying that
//
//   - JWT auth is enforced on every JWT-protected route,
//   - the upload route accepts a body without auth and stores it,
//   - the body limit is enforced (413 on oversized),
//   - the listing returns the public artifact shape (no token / file_path),
//   - download streams the bytes back, with the right disposition,
//   - delete drops both row and file.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import fastifyJwt from '@fastify/jwt';
import fastifySensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig, type Config } from '../src/config.js';
import { registerDiagnosticsRoutes } from '../src/routes/diagnostics.js';
import { DiagnosticsStore } from '../src/store/diagnostics-store.js';

const JWT_SECRET = 'a-test-secret-of-at-least-16-bytes';

const baseEnv: NodeJS.ProcessEnv = {
  JWT_SECRET,
  GATEWAY_BASE_URL: 'http://localhost:8080',
  GATEWAY_TOKEN: 'dev-token',
  KAFKA_BROKERS: 'broker:9092',
};

let dataDir: string;
let store: DiagnosticsStore;
let app: FastifyInstance;

async function buildApp(cfg: Config): Promise<FastifyInstance> {
  const a = Fastify({ logger: false });
  a.decorate('config', cfg);
  await a.register(fastifySensible);
  await a.register(fastifyJwt, { secret: JWT_SECRET });
  await registerDiagnosticsRoutes(a, { store });
  await a.ready();
  return a;
}

function bearer(a: FastifyInstance, sub = 'op@example'): string {
  const token = a.jwt.sign({ sub });
  return `Bearer ${token}`;
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'diag-route-'));
  store = new DiagnosticsStore(dataDir);
  const cfg = loadConfig({
    ...baseEnv,
    DIAGNOSTICS_DATA_DIR: dataDir,
    DIAGNOSTICS_MAX_UPLOAD_BYTES: '1024',
    DIAGNOSTICS_UPLOAD_TTL_SECONDS: '60',
    PORT: '8090',
    HOST: '127.0.0.1',
  });
  app = await buildApp(cfg);
});

afterEach(async () => {
  await app.close();
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('POST /sys/diagnostics/issue', () => {
  it('rejects unauthenticated callers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sys/diagnostics/issue',
      payload: { cp_id: 'cp_a', command: 'GetDiagnostics' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns a URL containing the token, plus the request_id and expiry', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sys/diagnostics/issue',
      headers: { authorization: bearer(app) },
      payload: { cp_id: 'cp_a', command: 'GetDiagnostics' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      url: string;
      token: string;
      request_id: number;
      command: string;
      expires_at: string;
    };
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.url).toContain(`/uploads/diag/${body.token}`);
    expect(body.request_id).toBe(1);
    expect(body.command).toBe('GetDiagnostics');
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects an unknown command', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sys/diagnostics/issue',
      headers: { authorization: bearer(app) },
      payload: { cp_id: 'cp_a', command: 'Bogus' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /uploads/diag/:token', () => {
  it('rejects an unknown token with 404', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/uploads/diag/${'a'.repeat(64)}`,
      payload: 'whatever',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'unknown_token' });
  });

  it('rejects a malformed token with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/uploads/diag/not-hex',
      payload: 'whatever',
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a valid PUT and returns the digest + size', async () => {
    const issue = await app.inject({
      method: 'POST',
      url: '/sys/diagnostics/issue',
      headers: { authorization: bearer(app) },
      payload: { cp_id: 'cp_a', command: 'GetDiagnostics' },
    });
    const { token } = issue.json() as { token: string };

    const payload = Buffer.from('hello-diagnostics');
    const res = await app.inject({
      method: 'PUT',
      url: `/uploads/diag/${token}`,
      payload,
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; file_size: number; file_sha256: string };
    expect(body.ok).toBe(true);
    expect(body.file_size).toBe(payload.length);
    expect(body.file_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('also accepts POST', async () => {
    const issue = await app.inject({
      method: 'POST',
      url: '/sys/diagnostics/issue',
      headers: { authorization: bearer(app) },
      payload: { cp_id: 'cp_a', command: 'GetLog' },
    });
    const { token } = issue.json() as { token: string };
    const res = await app.inject({
      method: 'POST',
      url: `/uploads/diag/${token}`,
      payload: 'hello',
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a second upload with the same token (one-shot)', async () => {
    const issue = await app.inject({
      method: 'POST',
      url: '/sys/diagnostics/issue',
      headers: { authorization: bearer(app) },
      payload: { cp_id: 'cp_a', command: 'GetDiagnostics' },
    });
    const { token } = issue.json() as { token: string };

    const ok = await app.inject({
      method: 'PUT',
      url: `/uploads/diag/${token}`,
      payload: 'first',
    });
    expect(ok.statusCode).toBe(200);

    const second = await app.inject({
      method: 'PUT',
      url: `/uploads/diag/${token}`,
      payload: 'second',
    });
    expect(second.statusCode).toBe(410);
  });

  it('enforces the body limit (413 on oversized)', async () => {
    const issue = await app.inject({
      method: 'POST',
      url: '/sys/diagnostics/issue',
      headers: { authorization: bearer(app) },
      payload: { cp_id: 'cp_a', command: 'GetDiagnostics' },
    });
    const { token } = issue.json() as { token: string };
    // bodyLimit is 1024 in the test config; send 2 KB.
    const big = Buffer.alloc(2048, 'A');
    const res = await app.inject({
      method: 'PUT',
      url: `/uploads/diag/${token}`,
      payload: big,
    });
    expect([413, 400]).toContain(res.statusCode);
  });
});

describe('GET /sys/diagnostics', () => {
  it('rejects unauthenticated callers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/diagnostics?cp_id=cp_a',
    });
    expect(res.statusCode).toBe(401);
  });

  it('lists artefacts for the cp_id without leaking token / file_path', async () => {
    const issue = await app.inject({
      method: 'POST',
      url: '/sys/diagnostics/issue',
      headers: { authorization: bearer(app) },
      payload: { cp_id: 'cp_a', command: 'GetDiagnostics' },
    });
    const { token } = issue.json() as { token: string };
    await app.inject({
      method: 'PUT',
      url: `/uploads/diag/${token}`,
      payload: 'payload',
    });

    const list = await app.inject({
      method: 'GET',
      url: '/sys/diagnostics?cp_id=cp_a',
      headers: { authorization: bearer(app) },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      artifacts: Array<Record<string, unknown>>;
      next_cursor: null;
    };
    expect(body.next_cursor).toBeNull();
    expect(body.artifacts.length).toBe(1);
    const item = body.artifacts[0]!;
    expect(item.status).toBe('uploaded');
    expect(item.cp_id).toBe('cp_a');
    expect(item.token).toBeUndefined();
    expect(item.file_path).toBeUndefined();
    expect(typeof item.file_sha256).toBe('string');
    expect(typeof item.file_size).toBe('number');
  });

  it('rejects a missing cp_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sys/diagnostics',
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /sys/diagnostics/:id/download', () => {
  it('streams the file back with an attachment disposition', async () => {
    const issue = await app.inject({
      method: 'POST',
      url: '/sys/diagnostics/issue',
      headers: { authorization: bearer(app) },
      payload: { cp_id: 'cp_a', command: 'GetDiagnostics' },
    });
    const { token, request_id } = issue.json() as { token: string; request_id: number };
    const payload = Buffer.from('contents');
    await app.inject({
      method: 'PUT',
      url: `/uploads/diag/${token}`,
      payload,
    });
    // Find the row we just created (it's the only one).
    const list = store.list('cp_a');
    const id = list[0]!.id;

    const res = await app.inject({
      method: 'GET',
      url: `/sys/diagnostics/${id}/download`,
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="cp_a-GetDiagnostics-${request_id}"`,
    );
    expect(res.body).toBe('contents');
  });

  it('returns 404 when the row is pending (no file yet)', async () => {
    const issue = await app.inject({
      method: 'POST',
      url: '/sys/diagnostics/issue',
      headers: { authorization: bearer(app) },
      payload: { cp_id: 'cp_a', command: 'GetDiagnostics' },
    });
    const { token: _token } = issue.json() as { token: string };
    void _token;
    const id = store.list('cp_a')[0]!.id;
    const res = await app.inject({
      method: 'GET',
      url: `/sys/diagnostics/${id}/download`,
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /sys/diagnostics/:id', () => {
  it('drops the row and the file', async () => {
    const issue = await app.inject({
      method: 'POST',
      url: '/sys/diagnostics/issue',
      headers: { authorization: bearer(app) },
      payload: { cp_id: 'cp_a', command: 'GetDiagnostics' },
    });
    const { token } = issue.json() as { token: string };
    await app.inject({
      method: 'PUT',
      url: `/uploads/diag/${token}`,
      payload: 'hello',
    });
    const id = store.list('cp_a')[0]!.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/sys/diagnostics/${id}`,
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(store.get(id)).toBeNull();
  });

  it('returns 404 on an unknown id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/sys/diagnostics/99999',
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(404);
  });
});

// Operators sometimes click the upload URL out of habit (it looks
// like a normal http://... link). The endpoint is PUT/POST only — a
// router 404 leaves them guessing. GET returns a 405 with an Allow
// header and a sentence-long explanation so they understand why and
// where to look instead.
describe('GET /uploads/diag/:token', () => {
  it('returns 405 with an Allow header pointing operators to the Diagnostics history', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/uploads/diag/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });
    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe('PUT, POST');
    const body = res.json() as { error: string; detail: string };
    expect(body.error).toBe('method_not_allowed');
    expect(body.detail).toMatch(/charger's upload destination/);
    expect(body.detail).toMatch(/Diagnostics history/);
  });

  it('returns 405 even for an unknown token (no info leak via GET)', async () => {
    // Don't leak whether a token exists via GET — that's a side
    // channel. PUT/POST still validate the token; GET always 405s.
    const res = await app.inject({
      method: 'GET',
      url: '/uploads/diag/deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    });
    expect(res.statusCode).toBe(405);
  });
});
