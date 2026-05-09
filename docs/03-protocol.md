# 03 — Protocol (WebSocket envelope)

The `@eveys-console/protocol` package defines the wire format. Both
apps import it; both apps validate every message via the same zod
schemas. Adding a new envelope type means changing this package, not
server-then-client.

## Versioning

Every message carries `v: 1`. Future incompatible changes bump to
`v: 2` and the server can negotiate down on subscribe. Today: single
version, no negotiation, hard-drop on mismatch.

## Subprotocol

The browser opens the WebSocket with two `Sec-WebSocket-Protocol`
tokens:

```
eveys-console-v1
bearer.<jwt>
```

The first marks the protocol; the second carries the JWT (the only
way browsers can authenticate a `new WebSocket()` without cookies).
The server picks `eveys-console-v1` as the negotiated subprotocol;
the JWT is parsed out of the second token and verified.

## Client → server

```ts
// Subscribe to a named query.
{ v: 1, id: "r-1", type: "subscribe",
  query: "charge-points", params: { online: true } }

// Cancel a subscription.
{ v: 1, id: "r-2", type: "unsubscribe", subscriptionId: "s-abc" }

// Issue a command. Routes to the gateway's REST.
{ v: 1, id: "r-3", type: "rpc",
  method: "remote-start",
  params: { cp_id: "CP_42", id_tag: "OPERATOR" } }

// Heartbeat. Server replies with `pong`.
{ v: 1, id: "r-4", type: "ping" }
```

`id` is a client-chosen request ID. The server echoes it back in
replies as `inReplyTo`.

## Server → client

```ts
// Subscription accepted, returns the server-assigned subscriptionId.
{ v: 1, type: "subscription.accepted",
  inReplyTo: "r-1", subscriptionId: "s-abc" }

// First message after acceptance: the snapshot.
{ v: 1, type: "snapshot", subscriptionId: "s-abc",
  snapshot: { kind: "charge-points", rows: [...] },
  cursor: "gw:cp-list:1700000000" }

// Subsequent: zero or more deltas.
{ v: 1, type: "delta", subscriptionId: "s-abc",
  delta: { kind: "charge-points", op: "upsert", row: {...} },
  cursor: "k:cp.status:0:42" }

// RPC result.
{ v: 1, type: "rpc.result", inReplyTo: "r-3", result: {...} }

// Errors. May or may not have `inReplyTo`.
{ v: 1, type: "error", inReplyTo: "r-1",
  error: { code: "unknown_query", message: "..." } }

// Heartbeat.
{ v: 1, type: "pong", inReplyTo: "r-4",
  serverTime: "2026-05-09T20:00:00.000Z" }
```

## Cursors

`cursor` is opaque and informational. Clients should treat it as a
black box. Two formats are emitted today:

- `k:<topic>:<partition>:<offset>` — derived from the Kafka offset
  of the event that produced the delta.
- `gw:<source>:<wallclock-ms>` — for snapshots fetched from the
  gateway, where the gateway doesn't expose offsets.

Don't parse them. Don't depend on their format. They become
authoritative when we add resumable subscriptions in a future
version.

## Delta shapes

Two patterns:

**Collection mutation** — for `charge-points` and `transactions-active`:

```ts
{ kind: "charge-points", op: "upsert", row: ChargePointSummary }
{ kind: "charge-points", op: "remove", cp_id: string }
```

The client maintains a `Map<id, row>` keyed by the entity's primary
ID and applies the op.

**Append-only stream** — for `meter-history` and `status-history`:

```ts
{ kind: "meter-history", append: MeterSample }
```

The client appends to an array. Bounded by client-side retention
(usually "last N samples" or "last 24 h").

**Entity replace** — for the singleton `charge-point`:

```ts
{ kind: "charge-point", row: ChargePointSummary }
```

The client replaces the whole entity.

## Error codes

| Code | Meaning |
|---|---|
| `unauthenticated` | JWT missing or invalid; close 4401. |
| `forbidden` | Authenticated but not authorised. |
| `invalid_message` | Envelope failed validation; usually a client bug. |
| `unknown_query` | `query` field not in the enum. |
| `unknown_subscription` | `unsubscribe` for a stale or wrong subscriptionId. |
| `rate_limited` | Subscription cap or per-connection rate limit hit. |
| `upstream_unavailable` | Gateway REST or Kafka is not reachable. |
| `internal_error` | Catch-all; bug or unexpected exception. |
