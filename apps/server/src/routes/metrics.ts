// Prometheus scrape endpoint. The only text/plain route in the server —
// all the others speak JSON.
//
// Deliberately UNAUTHENTICATED. Production deploys put a network-level ACL
// in front of :8090 the same way the gateway already does for its own
// `:9100/metrics`. Adding JWT here would break Prometheus, since the
// scraper has no token plumbing. If we ever need to split metrics onto a
// separate listener (e.g. :9090 bound to localhost), that's a Phase 2
// concern — for now it shares :8090.

import { register } from '../metrics/registry.js';

// Loose `app` type so this composes with any FastifyInstance regardless of
// how the parent app narrowed its generics — same pattern as the other
// route registrars in this directory.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerMetricsRoute(app: any) {
  app.get(
    '/metrics',
    async (
      _req: unknown,
      reply: { type: (t: string) => unknown; send: (b: string) => unknown },
    ) => {
      const body = await register.metrics();
      reply.type(register.contentType);
      return reply.send(body);
    },
  );
}
