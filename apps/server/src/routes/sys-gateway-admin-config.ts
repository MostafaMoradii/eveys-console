// Proxies the gateway's `/api/v1/admin/config` surface so the browser
// only ever talks to the Console server. Three endpoints, mapped 1:1
// to the gateway:
//
//   GET    /sys/gateway-admin-config             → GET    /admin/config
//   POST   /sys/gateway-admin-config             → PATCH  /admin/config
//   DELETE /sys/gateway-admin-config/overrides/:key
//                                                → DELETE /admin/config/overrides/:key
//
// We use POST instead of PATCH on the Console side to avoid a CORS
// preflight in the browser; the proxy translates to PATCH upstream.
// Each request is JWT-authed at the Console; the upstream uses the
// shared GATEWAY_TOKEN.

import type { GatewayClient } from '../rest/gateway-client.js';

interface RouteDeps {
  gateway: GatewayClient;
}

interface UpdatesBody {
  updates?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerSysGatewayAdminConfigRoute(app: any, deps: RouteDeps) {
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
    // Try to surface the gateway's structured error envelope unchanged.
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
    '/sys/gateway-admin-config',
    { preHandler: requireAuth },
    async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
      try {
        return await deps.gateway.adminConfig();
      } catch (err) {
        return handleGatewayError(err, reply);
      }
    },
  );

  app.post(
    '/sys/gateway-admin-config',
    { preHandler: requireAuth },
    async (
      req: { body?: UpdatesBody },
      reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    ) => {
      const updates = req.body?.updates;
      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        return reply.code(400).send({ error: 'bad-request', detail: 'updates object required' });
      }
      try {
        return await deps.gateway.patchAdminConfig(updates);
      } catch (err) {
        return handleGatewayError(err, reply);
      }
    },
  );

  app.delete(
    '/sys/gateway-admin-config/overrides/:key',
    { preHandler: requireAuth },
    async (
      req: { params: { key: string } },
      reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    ) => {
      const { key } = req.params;
      if (!key) {
        return reply.code(400).send({ error: 'bad-request', detail: 'key required' });
      }
      try {
        return await deps.gateway.deleteAdminConfigOverride(key);
      } catch (err) {
        return handleGatewayError(err, reply);
      }
    },
  );
}
