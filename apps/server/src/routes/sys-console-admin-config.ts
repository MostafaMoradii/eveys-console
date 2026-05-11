// Console-side runtime overrides: read + mutate the allowlisted
// keys without bouncing the process. Mirrors the existing
// sys-gateway-admin-config route shape but writes to the local
// override store rather than forwarding upstream.
//
// All three endpoints JWT-gated. Set / delete operations log via
// the structured logger so an SRE can trace who flipped what.

import { z } from 'zod';

import { configSchema, type Config } from '../config.js';
import { describeConfig } from '../config-meta.js';
import {
  OVERRIDABLE_KEYS,
  isOverridable,
  type OverridableKey,
  type OverrideStore,
} from '../store/override-store.js';

interface RouteDeps {
  config: Config;
  overrideStore: OverrideStore;
  logger?: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerSysConsoleAdminConfigRoute(app: any, deps: RouteDeps) {
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
    '/sys/admin/console-config',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async () => {
      return {
        entries: describeConfig(deps.config, process.env, deps.overrideStore),
        overridable_keys: OVERRIDABLE_KEYS,
      };
    },
  );

  const setBody = z.object({
    key: z.string().min(1),
    value: z.string(),
  });

  app.post(
    '/sys/admin/console-config',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      const parsed = setBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.flatten() });
      }
      const { key, value } = parsed.data;
      if (!isOverridable(key)) {
        return reply.code(400).send({ error: 'not_overridable', detail: { key } });
      }

      // Validate by running the value through the schema for this
      // key. Re-build the env env with the override slotted in and
      // ask zod to parse — if it passes, we know the override is
      // syntactically valid (e.g. JWT_TTL_SECONDS coerces to int,
      // ALERTMANAGER_URL is a URL).
      const candidate = {
        ...process.env,
        ...deps.overrideStore.snapshot().overrides,
        [key]: value,
      };
      const result = configSchema.safeParse(candidate);
      if (!result.success) {
        // Filter the zod errors to only those touching the changed
        // key — the candidate env might have unrelated missing keys
        // when the calling process bypassed loadConfig().
        const relevant = result.error.issues.filter((i) => i.path[0] === key);
        if (relevant.length > 0) {
          return reply.code(400).send({
            error: 'invalid_value',
            detail: { key, issues: relevant },
          });
        }
      }

      await deps.overrideStore.set(key as OverridableKey, value);
      deps.logger?.info({ key, source: 'override' }, 'console-config.override.set');
      // Re-render the rows so the UI doesn't need a follow-up GET.
      return reply.code(200).send({
        entries: describeConfig(deps.config, process.env, deps.overrideStore),
      });
    },
  );

  app.delete(
    '/sys/admin/console-config/overrides/:key',
    { preHandler: requireAuth },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      const rawKey = req.params?.key;
      if (typeof rawKey !== 'string' || !isOverridable(rawKey)) {
        return reply.code(400).send({ error: 'not_overridable', detail: { key: rawKey } });
      }
      await deps.overrideStore.clear(rawKey);
      deps.logger?.info({ key: rawKey }, 'console-config.override.cleared');
      return reply.code(200).send({
        entries: describeConfig(deps.config, process.env, deps.overrideStore),
      });
    },
  );
}
