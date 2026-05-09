// Proxies the gateway's `GET /api/v1/sys/config` so the browser only ever
// talks to the Console server. JWT auth on this side; the upstream call uses
// the GATEWAY_TOKEN. Sensitive values are already masked at the gateway.

import type { GatewayClient } from '../rest/gateway-client.js';

interface RouteDeps {
  gateway: GatewayClient;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerSysGatewayConfigRoute(app: any, deps: RouteDeps) {
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

  app.get(
    '/sys/gateway-config',
    { preHandler: requireAuth },
    async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
      try {
        return await deps.gateway.sysConfig();
      } catch (err) {
        const status = (err as { status?: number }).status ?? 502;
        return reply.code(status).send({
          error: 'gateway-unavailable',
          detail: err instanceof Error ? err.message : 'unknown',
        });
      }
    },
  );
}
