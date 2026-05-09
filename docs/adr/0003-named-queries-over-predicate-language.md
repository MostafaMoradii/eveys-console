# ADR-0003 — Named queries instead of a predicate-based subscription language

- **Status**: Accepted
- **Date**: 2026-05-09
- **Author**: Eveys engineering

## Context

The console needs to subscribe to live data: "all chargers", "this
specific charger", "active transactions", "meter samples for charger
X". Two API shapes are common for this:

- **Predicate / query language** — clients send something like
  `subscribe charge_points where online=true and site=$x order by
last_heartbeat`. The server compiles the predicate into Kafka
  filters + DB queries. This is the Hasura / Supabase Realtime /
  AppSync model.
- **Named queries** — the server pre-defines a finite set of
  subscribable views (`charge-points`, `charge-point`, `meter-history`,
  …); clients pass scalar params to a named view. Adding a new view
  is a server-side change.

Forces:

- The console has a small, fixed page tree (System / Charge points
  / Charger detail / Transactions). The set of subscribable views
  is bounded.
- Predicate languages need a security model: which fields are
  filterable, which are projectable, who can read what. We don't
  have multi-tenancy yet (see `docs/07-security.md`); a generic
  predicate API would have to anticipate the eventual ACL model.
- Predicate compilation needs a query planner per backing store.
  Our backing stores are heterogeneous (gateway REST, Kafka tail,
  later possibly ClickHouse). One compiler per store is a lot of
  code for the v1 scope.

## Decision

**Named queries only.** The server defines a finite enum
(`packages/protocol/src/queries.ts`); each name maps to a resolver
in `apps/server/src/broker/queries.ts` with a fixed param shape. New
views are added by extending the enum and adding a resolver — small,
reviewable, secured by construction.

## Alternatives considered

- **Hasura-style predicate API**. Maximally flexible. Rejected at
  the v1 scale: the security review surface alone would dwarf the
  rest of the BaaS, and we have ~5 named views to ship.
- **Generated subscriptions from the gateway's OpenAPI spec**.
  Auto-derive a `subscribe-to-{path}` for every GET endpoint.
  Rejected because subscriptions need delta semantics that the REST
  schema doesn't carry; the mapping would be lossy.
- **GraphQL subscriptions**. Mature ecosystem; types, predicates,
  selection sets. Rejected for the same reasons as predicate APIs:
  too much surface for the value at our scale.

## Consequences

### Positive

- Adding a query is two small files: one entry in the protocol
  enum, one resolver. Each resolver is independently testable.
- Authorisation can be per-query when role enforcement lands —
  trivial to write `requireRole('operator', 'charge-points')`.
- Cloudscape / Mantine-style table widgets pair naturally: the
  table mounts, subscribes by name, the snapshot is the initial
  rows, deltas update.
- The full set of subscribable surface is auditable from one file.

### Negative / costs

- Every new view needs a server change. Frontend can't add
  arbitrary live filters without backend support.
- Operator-side `<PropertyFilter>` UX (filter chips that combine
  arbitrarily) has to be implemented client-side over an already-
  loaded snapshot, not via the subscription API.

### Risks

- **Pressure to add named queries indefinitely.** As pages grow,
  the enum can balloon. Mitigation: review queries for whether
  they're really new shapes or could be parametrised onto an
  existing one.

### Reversibility

Reversible — the predicate path could be added as a new envelope
type alongside named queries. Existing clients keep working. We'd
revisit if multi-tenant operator personas need genuinely
client-defined filters.

## References

- `docs/02-architecture.md` — Five named queries table.
- `apps/server/src/broker/queries.ts` — implementation.
