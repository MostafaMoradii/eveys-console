# 02 — Architecture

> Decisions captured as ADRs in [`docs/adr/`](./adr/). Most relevant
> here: [ADR-0001](./adr/0001-baas-shape-consume-gateway.md)
> (consume gateway, don't modify),
> [ADR-0002](./adr/0002-websocket-over-sse-or-polling.md)
> (WebSocket transport),
> [ADR-0003](./adr/0003-named-queries-over-predicate-language.md)
> (named queries),
> [ADR-0005](./adr/0005-resolver-async-array-api.md) (resolver API),
> [ADR-0006](./adr/0006-refetch-instead-of-snapshot-store.md)
> (re-fetch policy).

```
                     Browser (React app)
                            │
                            │  POST /auth/{challenge,login}  (PoW + bcrypt)
                            │  GET  /sys/status              (JWT)
                            │  WS   /ws                      (subprotocol-bearer JWT)
                            ▼
            ┌────────────────────────────────────┐
            │  Realtime BaaS (apps/server)       │
            │                                    │
            │  ┌────────┐                        │
            │  │  auth  │  POW + bcrypt + JWT    │
            │  └────────┘                        │
            │  ┌──────────────────┐              │
            │  │ ws route +       │              │
            │  │ subscription     │              │
            │  │ broker (state)   │              │
            │  └────────┬─────────┘              │
            │           │                        │
            │   ┌───────┴────────┐               │
            │   │                │               │
            │  ┌┴───────┐  ┌─────┴────┐  ┌────┐  │
            │  │ kafka  │  │ rest     │  │sys-│  │
            │  │ tail + │  │ proxy +  │  │stat│  │
            │  │ proto  │  │ commands │  │us  │  │
            │  │ decode │  │          │  │    │  │
            │  └────┬───┘  └────┬─────┘  └─┬──┘  │
            └───────┼───────────┼──────────┼─────┘
                    ▼           ▼          ▼
            ┌────────────────────────────────────┐
            │ eveys-mobility/OCPP                │
            │ Kafka topics + REST + /health      │
            │ (unmodified)                       │
            └────────────────────────────────────┘
                            │
                            │ OCPP-J
                            ▼
                        Chargers
```

## Components

**Auth** (`apps/server/src/auth/`, `apps/server/src/routes/auth.ts`).
Three pieces: a bcrypt user store seeded from `CONSOLE_USERS`, a
proof-of-work CAPTCHA verifier, and the `/auth/challenge` and
`/auth/login` routes. Login returns an HS256 JWT signed with
`JWT_SECRET`. Per-IP rate limit on `/auth/login` via
`@fastify/rate-limit`.

**WS server** (`apps/server/src/routes/ws.ts`). Terminates the
browser connection. Validates the JWT carried in the WS subprotocol
(the browser's only way to authenticate `new WebSocket()` without
cookies). Owns the per-connection lifecycle: heartbeat, dispatch,
graceful close.

**Broker** (`apps/server/src/broker/`). The only stateful component.
Holds a map of `connectionId → { subscriptions: Map<id, Subscription> }`.
On every Kafka event, runs each subscription's resolver in parallel
and delivers any deltas the resolver produces. Resolver failures are
logged and isolated — one bad resolver doesn't block peer
subscriptions.

**Query resolvers** (`apps/server/src/broker/queries.ts`). One per
named query. Each implements `deltasFromEvent(params, event,
gateway): Promise<Delta[]>` — async because some resolvers re-fetch
from the gateway's REST, returning an array because one Kafka event
can fan out (e.g. one `cp.meter` report with N samples → N appends).
The same module also owns the snapshot fetch.

**Kafka tail** (`apps/server/src/kafka/tail.ts`). One consumer per
BaaS process. Subscribes to `cp.boot`, `cp.status`, `cp.meter`,
`tx.started`. Each message is a protobuf `eveys.events.v1.EventEnvelope`;
`event-decoder.ts` parses it via `protobufjs` against the vendored
`.proto` at `apps/server/proto/events/v1/events.proto`. Listeners
receive a typed `KafkaEvent { topic, cpId, cursor, payload, timestamp }`
where `payload` is the decoded oneof branch.

**REST proxy** (`apps/server/src/rest/gateway-client.ts`). Typed
client for the gateway's `/api/v1/...`. Used by:
- Snapshot fetches in resolvers.
- The WS layer's RPC dispatch (RemoteStart, RemoteStop, Reset, …).
- The `charge-points` and `charge-point` resolvers' delta path —
  they re-fetch the full row from `GET /charge-points/{cp_id}` on
  every `cp.boot`/`cp.status` event because the protobuf payload only
  carries a slice of `ChargePointSummary`.
- The `/sys/status` route's gateway-health probe.

**Sys-status route** (`apps/server/src/routes/sys-status.ts`).
Aggregates BaaS uptime + WS connection count + gateway `/health`
probe + Kafka tail state into one JSON-Schema'd response. Polled by
the SystemPage every 5 s.

**Web client** (`apps/web/src/api/ws-client.ts`). One `ConsoleClient`
instance per app. Multiplexes subscriptions over a single WebSocket.
Reconnect with exponential backoff; replays active subscriptions on
reconnect; rejects in-flight RPCs with `'disconnected'`.

**BaaS URL resolver** (`apps/web/src/lib/baas-url.ts`). Resolves the
REST and WS URLs at runtime from `window.location.hostname` to avoid
the `localhost`-vs-`127.0.0.1` cross-origin trap. Override per-deploy
with `VITE_BAAS_BASE_URL` / `VITE_WS_URL`.

## Subscription model: snapshot + tail

Every `subscribe` returns a snapshot first, then deltas indefinitely:

```
client → server  : subscribe(query, params)
server → client  : subscription.accepted (with subscription_id)
server → client  : snapshot (one message, one cursor)
server → client  : delta (zero or more, each with a cursor)
                   delta
                   delta
                   ...
client → server  : unsubscribe(subscription_id)   # eventually
```

The cursor is informational in v1 — we don't expose offset-based
replay because the gateway doesn't expose Kafka offsets to REST
callers. **Consistency model**: read-after-write with client-side
dedup. The client keys entities by `(id, last_modified_at)` and
ignores stale duplicates.

## Five named queries

| Name | Snapshot source | Delta source | Notes |
|---|---|---|---|
| `charge-points` | `GET /api/v1/charge-points` | `cp.boot`, `cp.status` | Resolver re-fetches `GET /charge-points/{cp_id}` per event for a complete row. Filter by `online`/`vendor` in params; mismatching events emit a `remove` delta. |
| `charge-point` | `GET /api/v1/charge-points/:cp_id` | `cp.boot`, `cp.status` (filtered by `cp_id`) | Same re-fetch pattern. Singleton; deltas replace the whole entity. |
| `transactions-active` | `GET /api/v1/transactions?active=true` | `tx.started` | Maps the protobuf payload's camelCase fields to the wire shape (`transaction_id`, `cp_id`, `id_tag`, `meter_start_wh`, `started_reported_at`, …). |
| `meter-history` | (empty in v1) | `cp.meter` (filtered by `cp_id`) | One Kafka event fans out to N deltas, one per `sampledValues[]` entry. Enum suffix stripped (e.g. `UNIT_WH` → `WH`). |
| `status-history` | (empty in v1) | `cp.status` (filtered by `cp_id`) | Empty `error_code`/`info` strings normalised to `null`. |

Adding a new query = one resolver in `queries.ts` + one entry in the
protocol's `QueryName` enum + corresponding `SnapshotForQuery` /
`DeltaForQuery` shape.

## RPC tunnel

Commands ride the same WebSocket as subscriptions. The client sends:

```json
{ "v": 1, "id": "r-7", "type": "rpc", "method": "remote-start",
  "params": { "cp_id": "CP_42", "id_tag": "OPERATOR" } }
```

The server routes by `method`, calls the gateway's REST, returns
the gateway's response in:

```json
{ "v": 1, "type": "rpc.result", "inReplyTo": "r-7",
  "result": { ... } }
```

The browser never holds a gateway token. The BaaS holds it in
`GATEWAY_TOKEN` and forwards on the operator's behalf. Authorisation
happens twice: once on the WS (the operator must have a valid JWT),
once at the gateway (the BaaS's bearer token).

## Multi-pod posture

Today: single-pod. Multi-pod requires:
- Each pod tails Kafka in the same consumer group → only one pod
  receives each partition's events. Subscriptions on *other* pods
  miss them. Fix: switch to one consumer group **per pod**, so every
  pod sees every event. Per-pod CPU cost grows with topic volume.
- WS sticky routing isn't needed (subscriptions are pod-local).
  Operators reconnect to any pod and the snapshot+tail loop
  re-establishes state.

This is documented but not implemented. Single-pod is fine for v1.

## Failure modes

| What goes wrong | What happens | Mitigation |
|---|---|---|
| Gateway down | Snapshot fetches fail. WS subscriptions return `error: upstream_unavailable`. Active subs get no deltas. | UI shows the error; operator retries. |
| Kafka down | No deltas. Snapshots still work. | UI shows snapshots only; flag the staleness in the connection-status badge once we wire it. |
| BaaS pod restart | Every WS drops. Clients reconnect, re-subscribe, re-snapshot. ~1 s of pause. | Acceptable for v1. |
| Bad JWT | WS closes with code 4401. | Client clears token, prompts for re-login. |
| Slow consumer | A noisy charger floods `cp.meter`. | TODO — per-connection rate limit + meter-sample coalescing. Not implemented. |
