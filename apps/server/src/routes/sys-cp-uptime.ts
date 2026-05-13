// Proxies the gateway's `GET /api/v1/charge-points/{cp_id}/uptime`
// so the browser only ever talks to the Console server. JWT-authed
// at the Console; the upstream call uses the GATEWAY_TOKEN.
//
// The route is a pass-through: required `from` + `to`, no
// transformation. The gateway already returns the operator-facing
// shape (uptime_pct + offline_seconds_total + intervals[]).
//
// Why a proxy instead of a broker query: uptime is a one-shot
// aggregation, not a live stream. The detail page renders the chip
// from a single fetch and refetches on a manual control or when
// the cp comes back online. Keeping it as a REST call avoids
// adding a snapshot/delta shape for a query that has nothing to
// delta from.

import type { GatewayClient } from '../rest/gateway-client.js';

interface RouteDeps {
  gateway: GatewayClient;
}

interface UptimeQuery {
  from?: string;
  to?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerSysCpUptimeRoute(app: any, deps: RouteDeps) {
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
    '/sys/charge-points/:cp_id/uptime',
    { preHandler: requireAuth },
    async (
      req: { params: { cp_id: string }; query: UptimeQuery },
      reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    ) => {
      const { cp_id } = req.params;
      if (!cp_id) {
        return reply.code(400).send({ error: 'bad-request', detail: 'cp_id required' });
      }
      const { from, to } = req.query ?? {};
      if (!from || !to) {
        return reply
          .code(400)
          .send({ error: 'bad-request', detail: 'from and to query params are required' });
      }

      try {
        const upstream = await deps.gateway.getUptime(cp_id, { from, to });
        return upstream;
      } catch (err) {
        return handleGatewayError(err, reply);
      }
    },
  );
}
