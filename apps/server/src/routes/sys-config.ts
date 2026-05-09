// Configuration introspection. JWT-protected; returns the per-key metadata
// (description, range, mutable, restart impact) plus the effective value at
// boot. Sensitive keys (JWT_SECRET, GATEWAY_TOKEN, CONSOLE_USERS) are masked.
//
// Read-only by design: editing live config is out of scope for v1.
// To change a value: edit the relevant env var or .env file and restart the
// indicated process. The `restart` field on each entry tells you which.

import type { Config } from '../config.js';
import { describeConfig, type ConfigEntry } from '../config-meta.js';

interface RouteDeps {
  config: Config;
}

export interface SysConfigResponse {
  entries: ConfigEntry[];
  /** Static for now; future iterations may surface gateway-side keys here too. */
  scope: 'baas';
  /** ISO-8601 timestamp at which the BaaS process loaded this config. */
  loaded_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerSysConfigRoute(app: any, deps: RouteDeps) {
  const loadedAt = new Date().toISOString();

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

  app.get('/sys/config', { preHandler: requireAuth }, async (): Promise<SysConfigResponse> => {
    return {
      entries: describeConfig(deps.config),
      scope: 'baas',
      loaded_at: loadedAt,
    };
  });
}
