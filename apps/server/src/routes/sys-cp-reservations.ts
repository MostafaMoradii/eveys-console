// Proxies the gateway's `GET /api/v1/charge-points/{cp_id}/reservations`.
// JWT-authed; pass-through on the optional `active`/`status`/`id_tag`/
// `limit` query params. The detail page's Reservations tab reads from
// this and joins client-side against the transactions list to surface
// "this reservation became transaction N".

import type { GatewayClient } from '../rest/gateway-client.js';

interface RouteDeps {
  gateway: GatewayClient;
}

interface ListQuery {
  active?: string;
  status?: string;
  id_tag?: string;
  limit?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerSysCpReservationsRoute(app: any, deps: RouteDeps) {
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
    '/sys/charge-points/:cp_id/reservations',
    { preHandler: requireAuth },
    async (
      req: { params: { cp_id: string }; query: ListQuery },
      reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    ) => {
      const { cp_id } = req.params;
      if (!cp_id) {
        return reply.code(400).send({ error: 'bad-request', detail: 'cp_id required' });
      }
      const params: Parameters<typeof deps.gateway.listChargePointReservations>[1] = {};
      if (req.query?.active !== undefined) {
        if (req.query.active === 'true') params.active = true;
        else if (req.query.active === 'false') params.active = false;
      }
      if (req.query?.status) params.status = req.query.status;
      if (req.query?.id_tag) params.id_tag = req.query.id_tag;
      if (req.query?.limit !== undefined) {
        const n = Number.parseInt(req.query.limit, 10);
        if (Number.isFinite(n) && n > 0) params.limit = n;
      }

      try {
        const upstream = await deps.gateway.listChargePointReservations(cp_id, params);
        return upstream;
      } catch (err) {
        return handleGatewayError(err, reply);
      }
    },
  );
}
