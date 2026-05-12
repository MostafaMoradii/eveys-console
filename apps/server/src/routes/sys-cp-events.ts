// GET /sys/charge-points/:cp_id/events
//
// Search across the on-disk device-event log for one charger.
// Query params:
//   from      ISO timestamp, inclusive lower bound (default: now - 7d)
//   to        ISO timestamp, exclusive upper bound (default: now)
//   q         optional substring (case-insensitive)
//   limit     1..500 (default 100)
//   cursor    continuation token returned by a prior page
//
// Response: { events: DeviceEvent[], next_cursor: string | null }.
// JWT-authed.

import type { DeviceEvent } from '@eveys-console/protocol';

import { searchEvents } from '../event-log/search.js';

interface RouteDeps {
  eventLogRoot: string;
}

interface EventsQuery {
  from?: string;
  to?: string;
  q?: string;
  limit?: string;
  cursor?: string;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerSysCpEventsRoute(app: any, deps: RouteDeps): Promise<void> {
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
    '/sys/charge-points/:cp_id/events',
    { preHandler: requireAuth },
    async (
      req: { params: { cp_id: string }; query: EventsQuery },
      reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    ): Promise<unknown> => {
      const { cp_id } = req.params;
      if (!cp_id) {
        return reply.code(400).send({ error: 'bad-request', detail: 'cp_id required' });
      }
      const parsed = parseQuery(req.query ?? {});
      if ('error' in parsed) {
        return reply.code(400).send({ error: 'bad-request', detail: parsed.error });
      }

      const result = await searchEvents(deps.eventLogRoot, cp_id, parsed);
      const body: { events: DeviceEvent[]; next_cursor: string | null } = {
        events: result.events,
        next_cursor: result.nextCursor,
      };
      return body;
    },
  );
}

interface ParsedQuery {
  from: Date;
  to: Date;
  limit: number;
  q?: string;
  cursor?: string;
}

export function parseQuery(q: EventsQuery): ParsedQuery | { error: string } {
  const now = new Date();
  let from: Date;
  let to: Date;

  if (q.from) {
    from = new Date(q.from);
    if (Number.isNaN(from.valueOf())) return { error: 'invalid `from`' };
  } else {
    from = new Date(now.valueOf() - DEFAULT_RANGE_MS);
  }
  if (q.to) {
    to = new Date(q.to);
    if (Number.isNaN(to.valueOf())) return { error: 'invalid `to`' };
  } else {
    to = now;
  }
  if (to <= from) return { error: '`to` must be greater than `from`' };

  let limit = DEFAULT_LIMIT;
  if (q.limit != null) {
    const n = Number.parseInt(q.limit, 10);
    if (!Number.isFinite(n) || n <= 0) return { error: 'invalid `limit`' };
    limit = Math.min(n, MAX_LIMIT);
  }

  const out: ParsedQuery = { from, to, limit };
  if (q.q && q.q.length > 0) out.q = q.q;
  if (q.cursor) out.cursor = q.cursor;
  return out;
}
