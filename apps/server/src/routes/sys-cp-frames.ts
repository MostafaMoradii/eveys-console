// Proxies the gateway's `GET /api/v1/charge-points/{cp_id}/frames`
// so the browser only ever talks to the Console server. JWT-authed
// at the Console; the upstream call uses the GATEWAY_TOKEN.
//
// Pass-through: `from` / `to` (required), optional `direction`
// (inbound | outbound) and `action` (OCPP action name).
// No transformation — the gateway returns the operator-facing shape
// already (event_id, occurred_at, direction, action, raw_payload, …).
//
// Why a proxy instead of a broker query: the OCPP Log tab is a
// time-windowed lookup, not a live stream the way DeviceEvents is.
// Operators read the audit when investigating something specific;
// they don't want frames tailing in real time. Keeping it as a
// one-shot REST avoids growing the broker surface.

import type { GatewayClient } from '../rest/gateway-client.js';

interface RouteDeps {
  gateway: GatewayClient;
}

interface FramesQuery {
  from?: string;
  to?: string;
  direction?: string;
  action?: string;
  limit?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerSysCpFramesRoute(app: any, deps: RouteDeps) {
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
    '/sys/charge-points/:cp_id/frames',
    { preHandler: requireAuth },
    async (
      req: { params: { cp_id: string }; query: FramesQuery },
      reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    ) => {
      const { cp_id } = req.params;
      if (!cp_id) {
        return reply.code(400).send({ error: 'bad-request', detail: 'cp_id required' });
      }
      const { from, to, direction, action, limit } = req.query ?? {};
      if (!from || !to) {
        return reply
          .code(400)
          .send({ error: 'bad-request', detail: 'from and to query params are required' });
      }
      // Closed-set validation on direction so a stray value can't
      // pollute the metrics label cardinality further down. Anything
      // else falls through as "no filter" (upstream returns both).
      let normalisedDirection: 'inbound' | 'outbound' | undefined;
      if (direction === 'inbound' || direction === 'outbound') {
        normalisedDirection = direction;
      } else if (direction !== undefined && direction !== '') {
        return reply.code(400).send({
          error: 'bad-request',
          detail: 'direction must be inbound or outbound',
        });
      }
      const params: Parameters<typeof deps.gateway.listCpFrames>[1] = { from, to };
      if (normalisedDirection !== undefined) params.direction = normalisedDirection;
      if (action) params.action = action;
      if (limit !== undefined) {
        const n = Number.parseInt(limit, 10);
        if (Number.isFinite(n) && n > 0) params.limit = n;
      }

      try {
        const upstream = await deps.gateway.listCpFrames(cp_id, params);
        return upstream;
      } catch (err) {
        return handleGatewayError(err, reply);
      }
    },
  );
}
