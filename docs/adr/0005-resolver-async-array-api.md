# ADR-0005 — Resolver API: `deltasFromEvent → Promise<Delta[]>`

- **Status**: Accepted
- **Date**: 2026-05-09
- **Author**: Eveys engineering

## Context

The broker's job is to turn one Kafka event into the right deltas
for the right subscribers. The original API was sync, single-delta:

```ts
deltaFromEvent(params, event): Delta | null
```

Two real workloads break that shape:

1. One OCPP `MeterValues` event carries `sampledValues[]` with N
   measurements. The natural mapping is one delta per sample, not
   one delta per event.
2. The `charge-points` and `charge-point` resolvers need the _full_
   `ChargePointSummary` row, but the gateway's Kafka payload
   (`cp.boot` / `cp.status`) only carries a slice. The resolver
   needs to re-fetch the full row from the gateway's REST — async.

The sync, single-delta shape forced us to either drop information
(emit one delta per event with the first sample only) or lie about
the row shape (cast a partial payload to `ChargePointSummary` and
ship rows with empty fields).

## Decision

Change the resolver API to:

```ts
deltasFromEvent(params, event, gateway): Promise<Delta[]>
```

Async, array-returning. The broker runs each subscription's resolver
in parallel, awaits the array, and delivers each delta in order.
Resolver failures are caught per-subscription and logged so one bad
resolver doesn't block peer subscriptions.

## Alternatives considered

- **Keep sync, but emit `Delta[]` instead of `Delta | null`**. Solves
  fan-out (one event → N deltas) but not the async re-fetch. Would
  push the gateway round-trip into a separate "enrichment" phase
  upstream of the resolver, splitting the resolver's logic across
  two places. Rejected.
- **Async, single-delta** (`Promise<Delta | null>`). Solves the
  re-fetch but not the fan-out. Same split-logic complaint. Rejected.
- **Streaming resolver** (`AsyncIterable<Delta>`). More flexible
  than an array. Rejected because no current use case needs deltas
  that arrive over time after the event; we always know up front
  how many there are. Adds API surface for no benefit.

## Consequences

### Positive

- One Kafka event can fan out to N deltas naturally.
- Resolvers can do their own gateway round-trips when they need
  the full row.
- Each resolver is a single function with one shape. No
  "enrichment phase" plumbing.
- Per-resolver failure isolation: if `meter-history`'s gateway
  re-fetch hangs, `charge-points` still delivers.

### Negative / costs

- A buggy resolver that returns a never-resolving Promise stalls
  that one subscription forever. Mitigation: server-side per-
  resolver timeout (TODO; not yet wired).
- Slightly more allocation per event (one array + N deltas vs one
  delta or null). Cheap; not on any hot path.

### Risks

- **N+1 round-trips.** `charge-points` re-fetches the full row on
  every `cp.boot`/`cp.status`. Acceptable while load is low; will
  become an in-memory snapshot store in Phase 3 (see ADR-0006).

### Reversibility

Trivially reversible — the API is contained to two files
(`broker.ts`, `queries.ts`). The previous sync/single-delta shape
could be reinstated with one search-and-replace, at the cost of
re-introducing the empty-row problem.

## References

- `apps/server/src/broker/queries.ts` — all resolvers.
- `apps/server/src/broker/broker.ts` — fan-out plumbing.
- ADR-0006 — re-fetch policy for `charge-points`.
