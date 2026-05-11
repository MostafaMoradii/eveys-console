// Proxies the gateway's `GET /api/v1/sys/kpis` so the browser only ever
// talks to the Console server. JWT auth on this side; the upstream call
// uses the GATEWAY_TOKEN. One round-trip from the browser, a single
// fan-in on the gateway side.
//
// Fail-soft envelope: when the gateway is unavailable we return a
// 200 with `{ ..., unavailable: true }` so the dashboard tiles can
// render em-dashes instead of an error toast. The gateway may not
// have been deployed with the /sys/kpis endpoint yet — surfacing a
// hard 502 would break the dashboard for the duration of a deploy.

import type { GatewayClient } from '../rest/gateway-client.js';

interface RouteDeps {
  gateway: GatewayClient;
}

interface KpisResponse {
  online_count: number | null;
  total_count: number | null;
  active_tx_count: number | null;
  tx_today_count: number | null;
  faulted_count: number | null;
  energy_24h_wh: number | null;
  unavailable: boolean;
}

const EMPTY: KpisResponse = {
  online_count: null,
  total_count: null,
  active_tx_count: null,
  tx_today_count: null,
  faulted_count: null,
  energy_24h_wh: null,
  unavailable: true,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerSysKpisRoute(app: any, deps: RouteDeps) {
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

  app.get('/sys/kpis', { preHandler: requireAuth }, async (): Promise<KpisResponse> => {
    try {
      const raw = (await deps.gateway.sysKpis()) as Partial<KpisResponse>;
      return {
        online_count: numOrNull(raw.online_count),
        total_count: numOrNull(raw.total_count),
        active_tx_count: numOrNull(raw.active_tx_count),
        tx_today_count: numOrNull(raw.tx_today_count),
        faulted_count: numOrNull(raw.faulted_count),
        energy_24h_wh: numOrNull(raw.energy_24h_wh),
        unavailable: false,
      };
    } catch {
      return EMPTY;
    }
  });
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}
