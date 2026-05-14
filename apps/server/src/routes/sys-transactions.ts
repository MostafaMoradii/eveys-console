// Proxies the gateway's transactions surface so the browser only ever
// talks to the Console server. Three endpoints, each mapped 1:1 to the
// gateway:
//
//   GET /sys/transactions?status=&cp_id=&id_tag=&from=&to=&cursor=&limit=
//       → GET /api/v1/transactions?... (audit list, PR A1 of #188)
//
//   GET /sys/transactions/:tx_id
//       → GET /api/v1/transactions/{transaction_id}
//
//   GET /sys/charge-points/:cp_id/meter-values?from=...&to=...&measurand=...
//       → GET /api/v1/charge-points/{cp_id}/meter-values?...
//
// Why a proxy and not a direct browser-to-gateway call: same-origin keeps
// auth simple (Console JWT, same as every other surface), keeps the
// gateway token server-side, and avoids a second CORS surface for the
// browser. Single Console origin is the rule everywhere here.

import type { GatewayClient } from '../rest/gateway-client.js';

interface RouteDeps {
  gateway: GatewayClient;
}

interface ListQuery {
  status?: string;
  cp_id?: string;
  id_tag?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: string;
}

interface MeterValuesQuery {
  from?: string;
  to?: string;
  measurand?: string;
  connector_id?: string;
  limit?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerSysTransactionsRoute(app: any, deps: RouteDeps) {
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
        /* fall through to the generic envelope */
      }
    }
    return reply.code(status).send({
      error: 'gateway-unavailable',
      detail: err instanceof Error ? err.message : 'unknown',
    });
  };

  app.get(
    '/sys/transactions',
    { preHandler: requireAuth },
    async (
      req: { query: ListQuery },
      reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    ) => {
      const q = req.query ?? {};
      const params: Parameters<typeof deps.gateway.listTransactions>[0] = {};

      // `status` is a closed enum on the UI side: active | finished |
      // all. The gateway only knows `active=true|false|absent`, so we
      // translate. Anything else (incl. empty / typo) is a hard 400 —
      // silently mapping unknown values to "all" would mask UI bugs.
      if (q.status !== undefined && q.status !== '') {
        if (q.status === 'active') params.active = true;
        else if (q.status === 'finished') params.active = false;
        else if (q.status === 'all') {
          /* leave active unset */
        } else {
          return reply.code(400).send({
            error: 'bad-request',
            detail: 'status must be active|finished|all',
          });
        }
      }

      if (q.cp_id) params.cp_id = q.cp_id;
      if (q.id_tag) params.id_tag = q.id_tag;
      if (q.from) params.from = q.from;
      if (q.to) params.to = q.to;
      if (q.cursor) params.cursor = q.cursor;

      if (q.limit !== undefined && q.limit !== '') {
        const n = Number(q.limit);
        if (!Number.isInteger(n) || n <= 0 || n > 1000) {
          return reply.code(400).send({ error: 'bad-request', detail: 'limit must be 1..1000' });
        }
        params.limit = n;
      }

      try {
        return await deps.gateway.listTransactions(params);
      } catch (err) {
        return handleGatewayError(err, reply);
      }
    },
  );

  app.get(
    '/sys/transactions/:tx_id',
    { preHandler: requireAuth },
    async (
      req: { params: { tx_id: string } },
      reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    ) => {
      const raw = req.params.tx_id;
      const txId = Number(raw);
      if (!Number.isInteger(txId) || txId <= 0) {
        return reply
          .code(400)
          .send({ error: 'bad-request', detail: 'tx_id must be a positive integer' });
      }
      try {
        return await deps.gateway.getTransaction(txId);
      } catch (err) {
        return handleGatewayError(err, reply);
      }
    },
  );

  app.get(
    '/sys/charge-points/:cp_id/meter-values',
    { preHandler: requireAuth },
    async (
      req: { params: { cp_id: string }; query: MeterValuesQuery },
      reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    ) => {
      const { cp_id } = req.params;
      const { from, to, measurand, connector_id, limit } = req.query ?? {};
      if (!from || !to) {
        return reply.code(400).send({ error: 'bad-request', detail: 'from and to are required' });
      }
      const params: Parameters<GatewayClient['listMeterValues']>[1] = { from, to };
      if (measurand) params.measurand = measurand;
      if (connector_id !== undefined) {
        const n = Number(connector_id);
        if (!Number.isInteger(n) || n < 0) {
          return reply
            .code(400)
            .send({ error: 'bad-request', detail: 'connector_id must be an integer' });
        }
        params.connector_id = n;
      }
      if (limit !== undefined) {
        const n = Number(limit);
        if (!Number.isInteger(n) || n <= 0 || n > 10_000) {
          return reply.code(400).send({ error: 'bad-request', detail: 'limit must be 1..10000' });
        }
        params.limit = n;
      }
      try {
        return await deps.gateway.listMeterValues(cp_id, params);
      } catch (err) {
        return handleGatewayError(err, reply);
      }
    },
  );
}
