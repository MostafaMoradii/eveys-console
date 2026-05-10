// Proxies the gateway's `GET /api/v1/charge-points/{cp_id}/transactions`
// so the browser only ever talks to the Console server. Same shape and
// query params as the upstream — `active`, `limit`, `cursor` — passed
// through verbatim. JWT-authed at the Console; the upstream call uses
// the GATEWAY_TOKEN.
//
// Mirrors the pattern used by the other gateway proxies (sys-gateway-config
// etc.): unauth → 401, upstream error → status + envelope unchanged when
// the upstream returned a JSON envelope, otherwise a generic 502.

import type { GatewayClient } from '../rest/gateway-client.js';

interface RouteDeps {
  gateway: GatewayClient;
}

interface ListQuery {
  active?: string;
  limit?: string;
  cursor?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerSysChargePointTransactionsRoute(app: any, deps: RouteDeps) {
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
    '/sys/charge-points/:cp_id/transactions',
    { preHandler: requireAuth },
    async (
      req: { params: { cp_id: string }; query: ListQuery },
      reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    ) => {
      const { cp_id } = req.params;
      if (!cp_id) {
        return reply.code(400).send({ error: 'bad-request', detail: 'cp_id required' });
      }
      const params: { active?: boolean; limit?: number; cursor?: string } = {};
      if (req.query?.active !== undefined) {
        // The upstream accepts only boolean; coerce strictly. Anything
        // else falls through as undefined (no filter).
        if (req.query.active === 'true') params.active = true;
        else if (req.query.active === 'false') params.active = false;
      }
      if (req.query?.limit !== undefined) {
        const n = Number.parseInt(req.query.limit, 10);
        if (Number.isFinite(n) && n > 0) params.limit = n;
      }
      if (req.query?.cursor) params.cursor = req.query.cursor;

      try {
        return await deps.gateway.listChargePointTransactions(cp_id, params);
      } catch (err) {
        return handleGatewayError(err, reply);
      }
    },
  );
}
