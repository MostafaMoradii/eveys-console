# ADR-0006 — Re-fetch from gateway REST on every event (vs in-memory snapshot store)

- **Status**: Accepted (revisit at Phase 3)
- **Date**: 2026-05-09
- **Author**: Eveys engineering

## Context

The `charge-points` and `charge-point` resolvers need to deliver a
full `ChargePointSummary` row to subscribers when a charger boots or
changes status. The gateway's Kafka payload for `cp.boot` / `cp.status`
only carries a slice of the row (the fields relevant to the specific
event), not the whole entity.

Two ways to bridge the gap:

1. **Re-fetch.** On every `cp.boot` / `cp.status` event, the resolver
   calls the gateway's `GET /api/v1/charge-points/{cp_id}` and uses
   the full response.
2. **In-memory snapshot store.** The Console holds a `Map<cp_id, ChargePointSummary>`,
   seeds it once at boot via `GET /charge-points`, and updates it
   incrementally from the Kafka stream. Resolvers read from the
   map; no per-event round-trip.

Option (2) is more correct at scale; option (1) is dramatically
simpler.

## Decision

**Re-fetch on every event.** Live for the v1 traffic profile (small
fleet, low event rate). Documented in the resolver comments.
Phase 3 swaps to the in-memory snapshot store when load justifies it.

## Alternatives considered

- **In-memory snapshot store**, as above. Defers to Phase 3 because
  the snapshot store needs a consistency story (what happens to a
  delta that arrives between the seed read and the first Kafka
  event?), and we don't have load yet to justify designing it.
- **Embed the full row in the gateway's Kafka payload.** Move the
  cost upstream: the gateway publishes the complete
  `ChargePointSummary` on every `cp.boot` / `cp.status`. Rejected
  because it doubles the size of one of the gateway's hottest
  topics for a small win (saves us one round-trip per event); a
  gateway change for a console-side concern is the wrong direction.
- **Delta-only deltas.** Resolver emits a partial-row delta with
  just the changed fields; the client merges. Rejected because the
  protocol's `op: 'upsert'` semantic is "the row is now this", not
  "merge these fields into the row" — adding a merge op fragments
  the delta vocabulary.

## Consequences

### Positive

- Trivially correct. The full row always reflects the gateway's
  authoritative state.
- No consistency window between the Console's view and the gateway's.
- The broker is genuinely stateless except for the per-connection
  subscription map.

### Negative / costs

- One HTTP round-trip per `cp.boot` / `cp.status` event per
  subscriber pod. At ~1 status event per charger per minute and N
  subscribed pods, the gateway's `/charge-points/{id}` endpoint
  takes (chargers × subscribers) RPS.
- Adds gateway latency to every delta. Sub-100 ms today; would be a
  real concern at hundreds of chargers and tens of subscribers.

### Risks

- **Gateway flooding.** A reconnect storm (Phase 3 scenario in the
  gateway repo) could trigger a thundering herd of `cp.boot` re-
  fetches. Mitigation: when the snapshot store lands, this risk
  goes away; until then, the low charger count makes it tolerable.
- **Stale data on gateway slowness.** If the gateway is slow,
  deltas are slow. Acceptable as long as snapshot reads work too.

### Reversibility

Reversible. The snapshot store is a strict superset: you'd add a
`Map<cp_id, ChargePointSummary>` populated from the seed read and
the Kafka tail, then change the resolver to read from the map. The
re-fetch can stay as a fallback for cache-miss cases.

## References

- `apps/server/src/broker/queries.ts` — resolver implementation.
- `docs/06-roadmap.md` Phase 3 — in-memory snapshot store.
- ADR-0005 — async resolver API that this depends on.
