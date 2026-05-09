# ADR-0001 — Console as a separate service that consumes the gateway, not modifies it

- **Status**: Accepted
- **Date**: 2026-05-09
- **Author**: Eveys engineering

## Context

The OCPP gateway (`eveys-mobility/OCPP`) already exposes a stable
contract: REST endpoints under `/api/v1/...` for read state and
commands, Kafka topics for live events, and a versioned event-
envelope proto schema. An operator console needs both — REST for
"what is this charger right now?" and Kafka for "tell me when it
changes".

Two extreme shapes for the console are possible:

1. Add console concerns directly into the gateway. The gateway
   already terminates OCPP and persists state; adding a console
   route or a session table is a small change.
2. Build the console as a separate service that depends on the
   gateway only through its existing public contract.

Pressure toward (2): the gateway is multi-pod, has its own SLO and
release cadence, and serves machine-to-machine traffic with strict
ordering guarantees. Adding human-operator concerns to it widens the
blast radius of every console change. Console UX experiments would
have to ride gateway releases.

## Decision

Build the console as a **separate service** that consumes the
gateway through its existing Kafka topics + REST API + event-envelope
proto schema. No gateway code change is required for any console
feature. If a feature genuinely needs a new gateway capability, that
is a separate gateway PR with its own review.

## Alternatives considered

- **Embed the console in the gateway**. Faster shipping for the
  first feature; one less repo. Rejected because the gateway is
  hot-path for machine traffic and adding a human-facing UI to it
  multiplies the surface area at risk during deploys. Also conflates
  release cadences — the gateway moves slowly on purpose.

- **Console-side database mirroring the gateway's Postgres**.
  Replicates the gateway's data into the console's own store via
  Kafka. Avoids per-event REST round-trips. Rejected because
  maintaining a parallel store that must stay consistent with the
  gateway is more work than it is worth at the current scale, and
  it duplicates a problem the gateway has already solved.

## Consequences

### Positive

- Clean release decoupling. Console deploys without re-running
  gateway tests.
- The same dependency contract enforces good gateway-side
  discipline: anything the console needs has to be exposed through
  the proper REST surface, which improves the contract for other
  consumers too.
- The gateway can be substituted later with any service that
  implements the same Kafka envelope and REST shape.

### Negative / costs

- The console pays one HTTP round-trip per `cp.boot`/`cp.status`
  event for the charge-points / charge-point resolvers, since the
  gateway's Kafka payload only carries a slice of
  `ChargePointSummary` (see ADR-0006).
- Two repos to keep in sync: when the gateway evolves the event
  schema, the console must follow.

### Risks

- **Schema drift between the gateway's Kafka payload and the
  console's expectations.** Mitigated by a vendored copy of the
  gateway's `events.proto` (`apps/server/proto/events/v1/`) and
  wire-shape regression fixtures
  (`packages/protocol/test/wire-shapes.test.ts`) that parse real
  gateway responses.

### Reversibility

Reversible at the seam. Switching to an embedded-in-gateway model
would mean folding the Console routes into the gateway's FastAPI app
and the React app into a static asset served by the gateway. Painful
but bounded.

## References

- `docs/00-overview.md` — what the console is and isn't.
- `docs/02-architecture.md` — component diagram.
- ADR-0006 — re-fetch on event vs in-memory snapshot store.
