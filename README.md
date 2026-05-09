# eveys-console

Realtime operator console for the OCPP gateway. A WebSocket-backed
backend-as-a-service plus a React UI for tracking and managing charge
points without polling.

The service consumes the gateway's existing event stream (Kafka topics)
and REST API, multiplexes per-tab subscriptions over a single
WebSocket, and tunnels OCPP commands (`RemoteStart`, `RemoteStop`,
`Reset`, …) over the same connection. The gateway is unmodified.

Apache-2.0.

## Surfaces

| Surface | Bind | Direction | Purpose |
|---|---|---|---|
| WebSocket | `:8090/ws` | browser → BaaS | Auth + subscriptions + RPCs in one connection. Subprotocol: `eveys-console-v1` + `bearer.<jwt>`. |
| Health | `:8090/healthz`, `:8090/readyz` | k8s → BaaS | Liveness / readiness probes. |
| Web | `:5180` (dev) | browser | React + Mantine + TanStack Router console. |

## Repo layout

```
apps/
├── server/                Node + Fastify + ws + kafkajs BaaS
│   └── src/
│       ├── auth/          JWT verification, principal shape
│       ├── broker/        per-connection subscription state, query resolvers
│       ├── kafka/         Kafka tail (one consumer group per deployment)
│       ├── rest/          typed client to the gateway's /api/v1
│       ├── routes/        WS + health Fastify routes
│       └── main.ts        process entry — wires the components
└── web/                   React + Mantine + TanStack Router console
    └── src/
        ├── api/           typed WS client (subscribe / rpc / reconnect)
        ├── components/    AppShell
        ├── hooks/         useSubscription
        ├── lib/           WS context provider
        ├── pages/         FleetPage, ChargerDetailPage, TransactionsPage
        └── routes/        TanStack Router file-based routes

packages/
├── protocol/              shared WS envelope contract (zod schemas + TS types)
└── api-types/             types generated from the gateway's OpenAPI spec
```

## Quick start

Prereqs: Node ≥ 20.10, `pnpm` 9.15 (`corepack prepare pnpm@9.15.0 --activate`),
Docker (for a local Kafka if you don't have one running already), the
OCPP gateway running locally and reachable at `http://localhost:8080`
with `EVEYS_OCPP_REST_INBOUND_TOKENS=dev-token`.

```bash
pnpm install
pnpm gen:api-types
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
# edit apps/server/.env: set JWT_SECRET, GATEWAY_TOKEN, KAFKA_BROKERS

pnpm dev
```

Server on `http://localhost:8090`, web on `http://localhost:5180`. Paste a
JWT (signed with `JWT_SECRET`, audience `eveys-console`, issuer
`eveys-console`) into the token field in the top bar to connect.

## Realtime model

Each browser tab opens one WebSocket. Inside that connection it can:

- **subscribe** to a named query (`charge-points`, `charge-point`,
  `transactions-active`, `meter-history`, `status-history`). The server
  returns a snapshot from the gateway's REST, then a stream of deltas
  derived from the Kafka tail.
- **unsubscribe** when the component unmounts.
- **rpc** to issue OCPP commands; the server forwards to the gateway and
  relays the response back over the same WebSocket.

The protocol is defined in `packages/protocol/src/envelope.ts` (zod
schemas; the same types are imported by both server and web).

Snapshot/tail consistency is **read-after-write with dedup**: clients
key entities by `(cp_id, last_modified_at)` so the small overlap window
between snapshot fetch and the first delta is harmless. Cloudscape /
Mantine table components handle this naturally with `trackBy`.

## Build, test, ship

```bash
pnpm format        # prettier
pnpm typecheck     # tsc --noEmit across all packages
pnpm test          # vitest, all packages
pnpm build         # tsc + vite build, both apps
```

CI runs `format:check + typecheck + test + build` on every PR.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
