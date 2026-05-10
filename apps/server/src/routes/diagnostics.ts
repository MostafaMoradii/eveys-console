// Diagnostics upload receiver + history.
//
// Five endpoints, two trust boundaries:
//
//   - POST   /sys/diagnostics/issue            (JWT)  — mint a one-use URL
//   - PUT|POST /uploads/diag/:token            (none) — chargers post here
//   - GET    /sys/diagnostics?cp_id=...        (JWT)  — per-charger history
//   - GET    /sys/diagnostics/:id/download     (JWT)  — fetch the artefact bytes
//   - DELETE /sys/diagnostics/:id              (JWT)  — drop row + file
//
// The upload endpoint has no JWT — chargers don't carry our auth. Their
// auth is "I have the unique token in the URL we just minted for them".
// One use, short TTL, sweep on every issue/upload.
//
// Chargers in the wild send PUT or POST and a variety of content-types;
// we accept both methods and read the body as a raw stream.
//
// Body limit is enforced per-route (Fastify's `bodyLimit` option) so the
// 50 MB cap on uploads doesn't bleed into other routes.

import { createHash } from 'node:crypto';
import { writeFileSync, rmSync } from 'node:fs';

import { z } from 'zod';

import type { Config } from '../config.js';
import type {
  DiagnosticsArtifact,
  DiagnosticsCommand,
  DiagnosticsStore,
} from '../store/diagnostics-store.js';

interface RouteDeps {
  store: DiagnosticsStore;
}

const issueBody = z.object({
  cp_id: z.string().min(1).max(256),
  command: z.enum(['GetDiagnostics', 'GetLog']),
  /** Optional explicit request_id (operators issuing GetLog often have
   *  one in mind). When omitted the store synthesises a per-cp counter. */
  request_id: z.number().int().nonnegative().optional(),
});

const listQuery = z.object({
  cp_id: z.string().min(1).max(256),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const idParam = z.object({
  id: z.coerce.number().int().positive(),
});

interface IssueResponse {
  url: string;
  token: string;
  request_id: number;
  command: DiagnosticsCommand;
  expires_at: string;
}

interface ListResponse {
  artifacts: DiagnosticsArtifact[];
  next_cursor: null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerDiagnosticsRoutes(app: any, deps: RouteDeps) {
  const cfg = app.config as Config;
  const store = deps.store;

  // Chargers send a variety of content-types (application/octet-stream,
  // application/zip, text/plain, sometimes nothing at all). Fastify
  // refuses any content-type for which no parser is registered (HTTP 415);
  // we register a no-op pass-through that simply hands req.raw to the
  // route. The route reads req.raw directly as a stream.
  app.addContentTypeParser(
    '*',
    { parseAs: 'buffer' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (_req: any, body: Buffer, done: (err: Error | null, body: Buffer) => void) => {
      done(null, body);
    },
  );

  const requireAuth = async (
    req: { jwtVerify: () => Promise<unknown>; user?: { sub?: string } },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    return undefined;
  };

  // ---- POST /sys/diagnostics/issue --------------------------------------
  app.post(
    '/sys/diagnostics/issue',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      const parsed = issueBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request', detail: parsed.error.message });
      }
      const { cp_id, command } = parsed.data;
      const issuedBy = (req.user?.sub as string | undefined) ?? 'unknown';

      const args: {
        cp_id: string;
        command: DiagnosticsCommand;
        issued_by: string;
        ttl_seconds: number;
        request_id?: number;
      } = {
        cp_id,
        command,
        issued_by: issuedBy,
        ttl_seconds: cfg.DIAGNOSTICS_UPLOAD_TTL_SECONDS,
      };
      if (parsed.data.request_id !== undefined) args.request_id = parsed.data.request_id;
      const issued = store.issue(args);

      const base = publicBaseUrl(cfg);
      const url = `${base}/uploads/diag/${issued.token}`;

      const body: IssueResponse = {
        url,
        token: issued.token,
        request_id: issued.request_id,
        command,
        expires_at: new Date(issued.expires_at * 1000).toISOString(),
      };
      req.log.info(
        {
          cp_id,
          command,
          request_id: issued.request_id,
          token_prefix: issued.token.slice(0, 8),
          issued_by: issuedBy,
        },
        'diagnostics.issue',
      );
      return reply.code(201).send(body);
    },
  );

  // ---- PUT|POST /uploads/diag/:token ------------------------------------
  // No JWT. The token in the URL is the auth. The catch-all content-type
  // parser registered above buffers the body up to bodyLimit; an
  // oversize body produces FST_ERR_CTP_BODY_TOO_LARGE which Fastify
  // serialises to 413 automatically. Buffering 50 MB in memory is fine
  // for v1 (single-pod, dev-only); the v2 follow-up that adds object
  // storage replaces this with a streaming sink.
  app.route({
    method: ['PUT', 'POST'],
    url: '/uploads/diag/:token',
    bodyLimit: cfg.DIAGNOSTICS_MAX_UPLOAD_BYTES,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: async (req: any, reply: any) => {
      const token = String(req.params?.token ?? '');
      if (!/^[0-9a-f]{64}$/.test(token)) {
        return reply.code(400).send({ error: 'invalid_token' });
      }

      const found = store.findPending(token);
      if (!found.ok) {
        const status = found.reason === 'unknown_token' ? 404 : 410;
        return reply.code(status).send({ error: found.reason });
      }
      const row = found.row;

      const body = req.body as Buffer | string | undefined;
      const buf =
        body === undefined
          ? Buffer.alloc(0)
          : Buffer.isBuffer(body)
            ? body
            : Buffer.from(String(body));

      const filePath = store.pathFor(row.cp_id, row.request_id);
      try {
        writeFileSync(filePath, buf);
      } catch (err) {
        req.log.error({ err, token_prefix: token.slice(0, 8) }, 'diagnostics.upload.write_failed');
        return reply.code(500).send({ error: 'upload_failed' });
      }
      const digest = createHash('sha256').update(buf).digest('hex');

      const consumed = store.consume({
        token,
        file_path: filePath,
        file_size: buf.length,
        file_sha256: digest,
      });
      if (!consumed.ok) {
        // Race: token was consumed/expired between our findPending and
        // the body finishing. Delete the just-written file; reject.
        try {
          rmSync(filePath, { force: true });
        } catch {
          /* ignore */
        }
        const status = consumed.reason === 'unknown_token' ? 404 : 410;
        return reply.code(status).send({ error: consumed.reason });
      }

      req.log.info(
        {
          cp_id: row.cp_id,
          request_id: row.request_id,
          file_size: buf.length,
          file_sha256: digest,
        },
        'diagnostics.upload.received',
      );
      return reply.code(200).send({
        ok: true,
        file_size: buf.length,
        file_sha256: digest,
      });
    },
  });

  // ---- GET /sys/diagnostics?cp_id=... -----------------------------------
  app.get(
    '/sys/diagnostics',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any): Promise<ListResponse | unknown> => {
      const parsed = listQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request', detail: parsed.error.message });
      }
      // Sweep before reading so the listing reflects current state.
      store.sweepExpired();
      const artifacts = store.list(parsed.data.cp_id, parsed.data.limit ?? 20);
      return { artifacts, next_cursor: null };
    },
  );

  // ---- GET /sys/diagnostics/:id/download --------------------------------
  // Auth lookup is two-stage: first the standard Authorization header,
  // then an `access_token` query param. `<a href>` clicks can't set a
  // header, and the artefact link is rendered for the operator already
  // signed in — equivalent surface, easier UX.
  const requireAuthOrQueryToken = async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reply: any,
  ) => {
    try {
      await req.jwtVerify();
      return undefined;
    } catch {
      const qt = (req.query?.access_token as string | undefined) ?? '';
      if (qt) {
        try {
          await app.jwt.verify(qt);
          // Mark as authenticated for downstream consumers.
          req.user = app.jwt.decode(qt);
          return undefined;
        } catch {
          /* fall through */
        }
      }
      return reply.code(401).send({ error: 'unauthenticated' });
    }
  };

  app.get(
    '/sys/diagnostics/:id/download',
    { preHandler: requireAuthOrQueryToken },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      const parsed = idParam.safeParse(req.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const row = store.get(parsed.data.id);
      if (!row || row.status !== 'uploaded' || !row.file_path) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const filename = `${row.cp_id}-${row.command}-${row.request_id}`;
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      if (row.file_size !== null) {
        reply.header('Content-Length', String(row.file_size));
      }
      const { createReadStream } = await import('node:fs');
      return reply.send(createReadStream(row.file_path));
    },
  );

  // ---- DELETE /sys/diagnostics/:id --------------------------------------
  app.delete(
    '/sys/diagnostics/:id',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      const parsed = idParam.safeParse(req.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const ok = store.delete(parsed.data.id);
      if (!ok) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.code(200).send({ ok: true });
    },
  );
}

function publicBaseUrl(cfg: Config): string {
  if (cfg.CONSOLE_PUBLIC_BASE_URL && cfg.CONSOLE_PUBLIC_BASE_URL.length > 0) {
    return cfg.CONSOLE_PUBLIC_BASE_URL.replace(/\/$/, '');
  }
  // For dev: 0.0.0.0 binds to all interfaces but isn't a sensible URL —
  // chargers / curl callers want a real host. Use 127.0.0.1 as the
  // loopback-friendly default.
  const host = cfg.HOST === '0.0.0.0' ? '127.0.0.1' : cfg.HOST;
  return `http://${host}:${cfg.PORT}`;
}
