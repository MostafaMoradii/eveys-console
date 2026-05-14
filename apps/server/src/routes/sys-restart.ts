// Restart endpoints. Two surfaces:
//
//   POST /sys/restart           — terminate the Console server. The
//                                 supervisor (pnpm dev / pm2 / systemd /
//                                 Docker) brings it back. Operator drives
//                                 from the Console-config page when a key
//                                 with restart=console was edited.
//   POST /sys/restart-gateway   — proxies to the gateway's
//                                 POST /api/v1/admin/restart. Same shape
//                                 (202 then SIGTERM-equivalent). When the
//                                 gateway hasn't opted in this returns
//                                 503 — the UI shows a meaningful "your
//                                 gateway has admin_restart_enabled=False"
//                                 message instead of a generic error.
//
// Both endpoints are JWT-authed (same posture as the rest of /sys/*) and
// gated behind a Console-side flag (`CONSOLE_RESTART_ENABLED`) so prod
// deploys can keep the surface closed.
//
// Debounce: a second call within CONSOLE_RESTART_DEBOUNCE_MS returns 202
// + `already_scheduled` but does NOT queue another exit. Mirrors the
// gateway-side guard so a double-click can't queue two exits.

import type { Config } from '../config.js';
import type { GatewayClient, GatewayError } from '../rest/gateway-client.js';

interface RouteDeps {
  config: Pick<Config, 'CONSOLE_RESTART_ENABLED' | 'CONSOLE_RESTART_DEBOUNCE_MS'>;
  gateway: GatewayClient;
  /** Indirection so tests can pass a fake exit hook without killing the
   *  Vitest worker. Defaults to the real `process.exit`. */
  exitProcess?: (code: number) => void;
  /** Wall-clock source — tests inject a fake to advance time without
   *  sleeping. Returns ms since epoch. */
  now?: () => number;
}

// Module-level debounce state. The Console runs single-process; this is
// safe. If we ever go multi-process we'll need to push this into Redis.
let lastConsoleRestartScheduledAt: number | null = null;
let lastGatewayRestartScheduledAt: number | null = null;

/** Vitest hook — pytest-equivalent reset for the module-level debounce
 *  state. Do NOT call this in production code. */
export function _resetRestartDebounceForTests(): void {
  lastConsoleRestartScheduledAt = null;
  lastGatewayRestartScheduledAt = null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerSysRestartRoute(app: any, deps: RouteDeps) {
  const exitProcess = deps.exitProcess ?? ((code: number) => process.exit(code));
  const now = deps.now ?? (() => Date.now());

  const requireAuth = async (
    req: { jwtVerify: () => Promise<unknown> },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    return undefined;
  };

  app.post(
    '/sys/restart',
    { preHandler: requireAuth },
    async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
      if (!deps.config.CONSOLE_RESTART_ENABLED) {
        return reply.code(503).send({
          error: 'service-unavailable',
          error_code: 'SERVICE_UNAVAILABLE',
          detail: 'console restart is disabled — set CONSOLE_RESTART_ENABLED=true to enable',
        });
      }

      const ts = now();
      if (
        lastConsoleRestartScheduledAt !== null &&
        ts - lastConsoleRestartScheduledAt < deps.config.CONSOLE_RESTART_DEBOUNCE_MS
      ) {
        return reply.code(202).send({
          status: 'already_scheduled',
          exits_in_ms: 0,
        });
      }

      lastConsoleRestartScheduledAt = ts;
      // 500ms gap mirrors the gateway behaviour — lets the 202 flush
      // before the process tears down.
      setTimeout(() => exitProcess(0), 500);
      return reply.code(202).send({
        status: 'scheduled',
        exits_in_ms: 500,
      });
    },
  );

  app.post(
    '/sys/restart-gateway',
    { preHandler: requireAuth },
    async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
      const ts = now();
      if (
        lastGatewayRestartScheduledAt !== null &&
        ts - lastGatewayRestartScheduledAt < deps.config.CONSOLE_RESTART_DEBOUNCE_MS
      ) {
        // Don't even round-trip to the gateway — the gateway has its own
        // debounce but we save an upstream RPC.
        return reply.code(202).send({
          status: 'already_scheduled',
          exits_in_ms: 0,
        });
      }

      try {
        const upstream = await deps.gateway.restartGateway();
        // Only record the timestamp on success. A 503 from the gateway
        // means "feature off upstream" — operator might enable it and
        // try again immediately; we shouldn't debounce that.
        lastGatewayRestartScheduledAt = ts;
        return reply.code(202).send(upstream);
      } catch (err) {
        const e = err as GatewayError;
        const status = e.status ?? 502;
        // Pass through the gateway's body when it's a structured envelope
        // (503 SERVICE_UNAVAILABLE for `admin_restart_enabled=false`) so
        // the UI can show the operator exactly what's wrong.
        if (typeof e.body === 'string') {
          try {
            const parsed = JSON.parse(e.body) as unknown;
            return reply.code(status).send(parsed);
          } catch {
            /* fall through */
          }
        }
        return reply.code(status).send({
          error: 'gateway-unavailable',
          detail: err instanceof Error ? err.message : 'unknown',
        });
      }
    },
  );
}
