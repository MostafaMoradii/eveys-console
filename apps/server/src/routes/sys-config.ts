// Configuration introspection. JWT-protected; returns the per-key metadata
// (description, range, mutable, restart impact) plus the effective value.
// Sensitive keys (JWT_SECRET, GATEWAY_TOKEN, CONSOLE_USERS) are masked.
//
// Read-only display. Mutation goes through /sys/admin/console-config for
// allowlisted keys; non-allowlisted keys remain env/restart only.

import type { Config } from '../config.js';
import { describeConfig, type ConfigEntry } from '../config-meta.js';
import type { OverrideStore } from '../store/override-store.js';

interface RouteDeps {
  config: Config;
  /** Optional — older callers (tests) can omit. When present,
   *  rendered entries reflect any active overrides. */
  overrideStore?: OverrideStore;
}

export interface SysConfigResponse {
  entries: ConfigEntry[];
  /** Static for now; future iterations may surface gateway-side keys here too. */
  scope: 'console';
  /** ISO-8601 timestamp at which the Console process loaded this config. */
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
      entries: describeConfig(deps.config, process.env, deps.overrideStore),
      scope: 'console',
      loaded_at: loadedAt,
    };
  });
}
