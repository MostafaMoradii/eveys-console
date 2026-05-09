# 03 — Protocol

Two surfaces between the web app and the BaaS:

1. **REST** — login (`/auth/challenge`, `/auth/login`) and system
   status (`/sys/status`). Plain HTTP/JSON.
2. **WebSocket** — subscriptions and RPCs. Versioned envelope,
   zod-validated on both sides via `@eveys-console/protocol`.

Both surfaces speak JSON. Adding a new WS envelope type means
changing the protocol package, not server-then-client.

## Auth (REST)

```
client → server  : POST /auth/challenge
                   (no body)
server → client  : { challenge, difficulty, expires_at }

(client computes a SHA-256 leading-zero-bits solution against
 challenge with at least `difficulty` bits)

client → server  : POST /auth/login
                   { username, password, challenge, solution }
server → client  : 200 { token, expires_at }
              or : 400 { error: "pow_invalid" | ... }
              or : 401 { error: "invalid_credentials" }
              or : 429 (rate limited; per-IP)
              or : 503 { error: "login_disabled" }  // no users configured
```

The challenge is an HMAC-signed payload `{nonce, difficulty,
issuedAt}` (signed with `JWT_SECRET` so the BaaS doesn't need
server-side state to verify the solution). The PoW threshold is
`AUTH_POW_DIFFICULTY` (default 16, ≈50 ms in a real browser; bumps
quickly into the 100s of ms at 18-20).

Tokens are HS256 JWTs with audience `JWT_AUDIENCE`, issuer
`JWT_ISSUER`, TTL `JWT_TTL_SECONDS` (default 8 h). The web stores
them in `localStorage`; see `docs/07-security.md` for the production
posture and the path to RS256 + JWKS.

## System status (REST)

```
client → server  : GET /sys/status
                   Authorization: Bearer <jwt>
server → client  : { baas: {uptime_seconds, started_at},
                     gateway: {ok, version, components, latency_ms},
                     kafka: {ok, consumer_running, topics},
                     connections: {websockets} }
```

Polled by SystemPage every 5 s. Cheap; one HTTP probe to the gateway
plus in-memory state.

## WebSocket envelope

### Versioning

Every WebSocket message carries `v: 1`. Future incompatible changes
bump to `v: 2` and the server can negotiate down on subscribe.
Today: single version, no negotiation, hard-drop on mismatch.

### Subprotocol

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

### Client → server

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

### Server → client

```ts
// Subscription accepted, returns the server-assigned subscriptionId.
{ v: 1, type: "subscription.accepted",
  inReplyTo: "r-1", subscriptionId: "s-abc" }

// First message after acceptance: the snapshot.
// `charge-points` snapshots also carry `next_cursor` (nullable) for
// forward pagination — pass it back as the `cursor` param on the
// next subscribe to load the next page.
{ v: 1, type: "snapshot", subscriptionId: "s-abc",
  snapshot: { kind: "charge-points", rows: [...], next_cursor: "eyJpZCI6NjF9" },
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

### Cursors

`cursor` is opaque and informational. Clients should treat it as a
black box. Two formats are emitted today:

- `k:<topic>:<partition>:<offset>` — derived from the Kafka offset
  of the event that produced the delta.
- `gw:<source>:<wallclock-ms>` — for snapshots fetched from the
  gateway, where the gateway doesn't expose offsets.

Don't parse them. Don't depend on their format. They become
authoritative when we add resumable subscriptions in a future
version.

### Delta shapes

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

### Subscription params

Each named query takes its own param shape. Unknown params are
ignored, missing required params return an `error` envelope with
`invalid_message`.

| Query                 | Required         | Optional                                                                                                                  |
| --------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `charge-points`       | —                | `online` (bool), `vendor` (string, exact match), `limit` (1–10000), `cursor` (opaque from prior snapshot's `next_cursor`) |
| `charge-point`        | `cp_id` (string) | —                                                                                                                         |
| `transactions-active` | —                | (none yet — server returns the gateway's full active list)                                                                |
| `meter-history`       | `cp_id` (string) | —                                                                                                                         |
| `status-history`      | `cp_id` (string) | —                                                                                                                         |

`charge-points` server-side filters (`online`, `vendor`) cut the
loaded page on the gateway. Any other UI filter (e.g. status enum,
free-text search across `cp_id`/`vendor`/`model`/`serial`) is
client-side over the loaded page only.

### Error codes

| Code                   | Meaning                                            |
| ---------------------- | -------------------------------------------------- |
| `unauthenticated`      | JWT missing or invalid; close 4401.                |
| `forbidden`            | Authenticated but not authorised.                  |
| `invalid_message`      | Envelope failed validation; usually a client bug.  |
| `unknown_query`        | `query` field not in the enum.                     |
| `unknown_subscription` | `unsubscribe` for a stale or wrong subscriptionId. |
| `rate_limited`         | Subscription cap or per-connection rate limit hit. |
| `upstream_unavailable` | Gateway REST or Kafka is not reachable.            |
| `internal_error`       | Catch-all; bug or unexpected exception.            |

## Wire shapes

The collection rows mirror the gateway's REST response shape so
there's no translation layer. Authoritative definitions are in
`packages/protocol/src/queries.ts`. Every entity uses
`.passthrough()` so adding fields server-side doesn't reject old
clients.

`ChargePointSummary` — fields the gateway returns from
`GET /api/v1/charge-points`: `cp_id`, `online`, `pod_id`, `vendor`,
`model`, `firmware_version`, `serial_number`, `last_boot_at`,
`last_heartbeat_at`, `last_status`, `last_diagnostics_status`,
`last_firmware_status`, `connectors[]`. Timestamps are ISO 8601 with
either `Z` or `±HH:MM` (Python isoformat output).

`TransactionSummary` — fields the gateway returns from
`GET /api/v1/transactions`: `transaction_id`, `cp_id`, `connector_id`,
`id_tag`, `meter_start_wh`, `meter_stop_wh`, `consumed_wh`,
`started_reported_at`, `started_received_at`, `stopped_reported_at`,
`stopped_received_at`, `stop_reason`. Stopped fields are null while
the transaction is active.

`MeterSample` and `StatusEvent` — server-side projections from the
broker resolvers (Kafka payloads → wire shape). See
`docs/02-architecture.md`.
