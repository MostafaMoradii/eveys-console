// Proxies the gateway's `GET /api/v1/status-history` so the browser
// only ever talks to the Console server. JWT-authed; the upstream
// call uses the GATEWAY_TOKEN.
//
// Fleet-wide StatusNotification search — back-end for the Fleet
// Events page. `from` / `to` required; `status` and `cp_id` are
// repeatable query params on both sides. The gateway already caps
// the window at 7 days; we don't re-validate here, just forward
// the 400 envelope when it complains.

import type { GatewayClient } from '../rest/gateway-client.js';

interface RouteDeps {
  gateway: GatewayClient;
}

/** Fastify v5 surfaces repeated query keys as `string[]` when the
 *  same key appears more than once. Normalise both shapes to an
 *  array so the gateway call doesn't accidentally drop "the second"
 *  one. */
function toArray(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v.filter((s) => s.length > 0);
  return v.length > 0 ? [v] : undefined;
}

interface SearchQuery {
  from?: string;
  to?: string;
  status?: string | string[];
  cp_id?: string | string[];
  limit?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerSysFleetStatusHistoryRoute(app: any, deps: RouteDeps) {
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

  const handleGatewayError = (
    err: unknown,
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    const status = (err as { status?: number }).status ?? 502;
    const body = (err as { body?: string }).body;
    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body) as unknown;
        return reply.code(status).send(parsed);
      } catch {
        /* fall through */
      }
    }
    return reply.code(status).send({
      error: 'gateway-unavailable',
      detail: err instanceof Error ? err.message : 'unknown',
    });
  };

  app.get(
    '/sys/fleet/status-history',
    { preHandler: requireAuth },
    async (
      req: { query: SearchQuery },
      reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    ) => {
      const { from, to, status, cp_id, limit } = req.query ?? {};
      if (!from || !to) {
        return reply
          .code(400)
          .send({ error: 'bad-request', detail: 'from and to query params are required' });
      }
      const params: Parameters<typeof deps.gateway.listFleetStatusHistory>[0] = { from, to };
      const statusArr = toArray(status);
      if (statusArr) params.status = statusArr;
      const cpIds = toArray(cp_id);
      if (cpIds) params.cp_id = cpIds;
      if (limit !== undefined) {
        const n = Number.parseInt(limit, 10);
        if (Number.isFinite(n) && n > 0) params.limit = n;
      }

      try {
        const upstream = await deps.gateway.listFleetStatusHistory(params);
        return upstream;
      } catch (err) {
        return handleGatewayError(err, reply);
      }
    },
  );
}
