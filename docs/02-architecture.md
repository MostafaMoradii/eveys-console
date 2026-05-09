# 02 — Architecture

```
                     Browser (React app)
                            │
                wss://baas/ws  (auth + subs + RPCs, single connection)
                            │
                            ▼
            ┌────────────────────────────────┐
            │  Realtime BaaS (apps/server)   │
            │                                │
            │  WS gateway → broker           │
            │       │           │            │
            │       │           ▼            │
            │       │   subscription state   │
            │       │   (per connection)     │
            │       │                        │
            │   ┌───┴────┐    ┌──────────┐   │
            │   │ Kafka  │    │ REST     │   │
            │   │ tail   │    │ proxy +  │   │
            │   │        │    │ commands │   │
            │   └────┬───┘    └────┬─────┘   │
            └────────┼─────────────┼─────────┘
                     ▼             ▼
            ┌────────────────────────────────┐
            │ eveys-mobility/OCPP            │
            │ Kafka topics + REST + commands │
            │ (unmodified)                   │
            └────────────────────────────────┘
                            │
                            │ OCPP-J
                            ▼
                        Chargers
```

## Components

**WS server** (`apps/server/src/routes/ws.ts`). Terminates the
browser connection. Validates the JWT in the WS subprotocol (the
browser's only way to authenticate a `new WebSocket()` without
cookies). Owns the per-connection lifecycle: heartbeat, dispatch,
graceful close.

**Broker** (`apps/server/src/broker/`). The only stateful component.
Holds a map of `connectionId → { subscriptions: Map<id, Subscription> }`.
On every Kafka event, asks each subscription's resolver "does this
event affect you?" and delivers a delta if so.

**Query resolvers** (`apps/server/src/broker/queries.ts`). One per
named query. Each knows: how to fetch the snapshot (call the gateway's
REST), and how to map a Kafka event to a delta (or `null` if the
event is irrelevant). Adding a new query = adding a resolver here +
extending the protocol's `QueryName` enum.

**Kafka tail** (`apps/server/src/kafka/tail.ts`). One consumer group
per BaaS deployment. Decodes the gateway's versioned event envelope
into `KafkaEvent { topic, cpId, cursor, payload, timestamp }`. Each
listener gets every event; the broker's per-subscription filter
decides relevance.

**REST proxy** (`apps/server/src/rest/gateway-client.ts`). Typed
client for the gateway's `/api/v1/...`. Used by:
- Resolvers' snapshot fetches.
- The WS layer's RPC dispatch (RemoteStart, RemoteStop, Reset, …).

**Web client** (`apps/web/src/api/ws-client.ts`). One `ConsoleClient`
instance per app. Multiplexes subscriptions over a single WebSocket.
Reconnect with exponential backoff; replays active subscriptions on
reconnect; rejects in-flight RPCs with `'disconnected'`.

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

| Name | Snapshot source | Delta source |
|---|---|---|
| `charge-points` | `GET /api/v1/charge-points` | `cp.boot`, `cp.status` |
| `charge-point` | `GET /api/v1/charge-points/:cp_id` | `cp.boot`, `cp.status` (filtered by `cp_id`) |
| `transactions-active` | `GET /api/v1/transactions?active=true` | `tx.started` |
| `meter-history` | (empty for v1) | `cp.meter` (filtered by `cp_id`) |
| `status-history` | (empty for v1) | `cp.status` (filtered by `cp_id`) |

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
