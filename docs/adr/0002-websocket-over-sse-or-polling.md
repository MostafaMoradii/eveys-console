# ADR-0002 — WebSocket as the live transport (vs SSE or polling)

- **Status**: Accepted
- **Date**: 2026-05-09
- **Author**: Eveys engineering

## Context

The console needs to deliver live updates to operator browsers as
chargers boot, change status, emit meter values, and transactions
start. It also needs to issue OCPP commands (RemoteStart, etc.) on
operator action. Three browser-friendly shapes are common:

- **Polling** — periodic `GET /api/...` from the browser.
- **Server-Sent Events (SSE)** — browser opens an `EventSource`,
  server pushes one-way; browser-to-server traffic still goes over
  separate HTTP requests.
- **WebSocket** — full-duplex, single long-lived connection,
  arbitrary message types in either direction.

Forces:

- Operators keep the console open all day; long-lived connections
  are the right shape for that workload.
- The console issues commands on click. Same-connection request/reply
  keeps latency low and simplifies retry/backoff logic.
- Multiple per-page subscriptions need to multiplex (one tab might
  watch the fleet list and a charger detail simultaneously).
- Per-connection auth is simpler than per-request auth at scale.

## Decision

**WebSocket**. One connection per browser tab. Subscriptions, RPCs,
heartbeats, and errors all share the same envelope. Schema versioned
(`v: 1`); zod-validated on both sides via `@eveys-console/protocol`.

## Alternatives considered

- **Polling** — simplest. Rejected because pages stay open for
  hours and polling cadence is a poor proxy for actual change
  rates: too slow for `cp.status`, too fast for `cp.boot`, costs
  network on every interval forever.
- **SSE** — half the complexity of WebSocket; native `EventSource`.
  Rejected because the console _also_ sends messages to the server
  (subscribe, unsubscribe, RPC); SSE forces a parallel HTTP path
  for those, doubling the auth and reconnect logic.
- **gRPC-Web with bidi streams** — typed, schema-first. Rejected
  because gRPC-Web requires a translating proxy in front of the
  BaaS, and the proxy adds operational weight far out of proportion
  to the v1 user count.

## Consequences

### Positive

- One connection, one auth handshake, one reconnect loop. The
  client code is small.
- Multiplexing subscriptions over one connection is natural; each
  carries a server-assigned `subscription_id`.
- RPC results return on the same connection; no separate HTTP path.

### Negative / costs

- WebSocket-aware load balancers required in production. Sticky
  routing isn't strictly necessary today (subscriptions are pod-
  local), but reverse proxies need WS upgrade support.
- Browsers can't set arbitrary headers on `new WebSocket()`; auth
  has to ride the subprotocol (see ADR-0007). HttpOnly cookie auth
  for the WS handshake is a future hardening.
- Some debugging tools handle WS less gracefully than REST. Mitigated
  by every message being JSON with a discriminated `type` field.

### Risks

- **Per-pod connection cap.** Node + `ws` handles a few thousand
  WS per process easily; beyond that, fan-out should be moved to a
  per-pod consumer-group model (already on the roadmap for Phase 3).
- **Reconnect storms after a deploy.** Mitigated by client-side
  exponential backoff with jitter; documented in
  `docs/02-architecture.md`.

### Reversibility

Reversible to SSE for the read path with moderate effort. The
client-side `ConsoleClient` abstracts the transport; swapping
`new WebSocket()` for `new EventSource()` and routing RPCs through
a separate `fetch` is doable, though it doubles the auth surface.

## References

- `docs/03-protocol.md` — full envelope spec.
- ADR-0007 — JWT carriage in the WS subprotocol header.
