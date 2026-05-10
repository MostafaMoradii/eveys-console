# eveys-console

[![CI](https://github.com/MostafaMoradii/eveys-console/actions/workflows/ci.yml/badge.svg)](https://github.com/MostafaMoradii/eveys-console/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

System-administration console for the OCPP gateway. Sign-in
protected, single WebSocket per tab, live snapshot+tail subscriptions
backed by the gateway's existing Kafka topics and REST API.

The console targets SRE / on-call engineers operating the gateway —
not end-customer fleet managers. The front page is a service-status
grid (Console, Gateway, Postgres, Redis, Kafka). Charge-point and
transaction inspection live one level down under `/inspect`.

The gateway is consumed unchanged; everything the console offers is
built on the gateway's existing surfaces.

Apache-2.0.

## Surfaces

| Surface       | Bind                            | Direction         | Purpose                                                                                   |
| ------------- | ------------------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| WebSocket     | `:8090/ws`                      | browser → Console | Subscriptions + RPCs in one connection. Subprotocol: `eveys-console-v1` + `bearer.<jwt>`. |
| REST (auth)   | `:8090/auth/{challenge,login}`  | browser → Console | Proof-of-work CAPTCHA + username/password login. Returns a short-lived JWT.               |
| REST (status) | `:8090/sys/status`              | browser → Console | Aggregated service health (gateway probe + Kafka + WS connection count). JWT-protected.   |
| Health        | `:8090/healthz`, `:8090/readyz` | k8s → Console     | Liveness / readiness probes. Unauthenticated.                                             |
| Web           | `:5180` (dev)                   | browser           | React + shadcn/ui (Tailwind + Radix) + TanStack Router.                                   |

## Repo layout

```
apps/
├── server/                       Node + Fastify + ws + kafkajs Console server
│   ├── proto/events/v1/          vendored gateway event schema
│   ├── scripts/                  mint-dev-token, hash-password
│   └── src/
│       ├── auth/                 JWT verification, PoW CAPTCHA, user store (bcrypt)
│       ├── broker/               per-connection subscription state, query resolvers
│       ├── kafka/                Kafka tail + protobuf event-envelope decoder
│       ├── rest/                 typed client to the gateway's /api/v1
│       ├── routes/               auth, ws, sys-status, health
│       └── main.ts               process entry — wires the components
└── web/                          React + shadcn/ui console
    └── src/
        ├── api/                  typed clients (auth-client, sys-client, ws-client)
        ├── components/           AppShell, ThemeToggle, ui/ shadcn primitives
        ├── hooks/                useSubscription
        ├── lib/                  WS context, theme context, console-url resolver
        ├── pages/                LoginPage, SystemPage (/), Fleet/Charger/Transactions (/inspect)
        └── routeTree.ts          manual TanStack route tree

packages/
├── protocol/                     shared WS envelope contract (zod schemas + TS types)
└── api-types/                    types generated from the gateway's OpenAPI spec
```

## Quick start

Prereqs: Node ≥ 20.10, `pnpm` 9.15 (`corepack prepare pnpm@9.15.0 --activate`),
Docker, and the OCPP gateway running locally on `:8080` with REST + Kafka up.

```bash
pnpm install
pnpm gen:api-types
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
# edit apps/server/.env: set JWT_SECRET, GATEWAY_TOKEN, KAFKA_BROKERS,
# CONSOLE_USERS (one or more username:bcrypthash pairs).

# Hash a password for CONSOLE_USERS:
echo -n "yourPassword" | pnpm --filter @eveys-console/server hash-password

pnpm dev
```

Server on `http://localhost:8090`, web on `http://localhost:5180`.
Open the web URL, sign in with the username/password you put in
`CONSOLE_USERS`. The login form runs a small client-side
proof-of-work CAPTCHA before submitting (~50 ms in a real browser).

The `mint-token` script (`pnpm --filter @eveys-console/server mint-token`)
is also kept as a dev-only fallback for headless tests.

## Realtime model

Each browser tab opens one WebSocket. Inside that connection it can:

- **subscribe** to a named query (`charge-points`, `charge-point`,
  `transactions-active`, `meter-history`, `status-history`). The
  server returns a snapshot, then a stream of deltas. A single Kafka
  event can fan out to multiple deltas (e.g. one MeterValues report
  carries N samples → N appends).
- **unsubscribe** when the component unmounts.
- **rpc** to issue OCPP commands (`remote-start`, `remote-stop`,
  `reset`); the server forwards to the gateway's REST and relays the
  response back over the same WebSocket.

The wire format is defined in `packages/protocol/`. zod schemas
validate every message in both directions; both apps import the same
schemas so the contract is enforced symmetrically.

Snapshot+tail consistency is **read-after-write with dedup**: the
client keys collection rows by primary ID so the small window between
the snapshot fetch and the first delta is harmless. The FleetPage
reduces snapshot + latest delta into a `Map<cp_id, row>` on every
render.

Wire payloads from Kafka are protobuf-encoded `EventEnvelope`s (the
gateway's own schema, vendored at `apps/server/proto/events/v1/`).
The decoder lives in `apps/server/src/kafka/event-decoder.ts`.

## Build, test, ship

```bash
pnpm format        # prettier
pnpm typecheck     # tsc --noEmit across all packages
pnpm test          # vitest, all packages (~68 tests)
pnpm build         # tsc + vite build, both apps
```

CI runs `format:check + typecheck + test + build` on every PR.

## License

Apache-2.0. See [`LICENSE`](./LICENSE) for the licence text and
[`NOTICE`](./NOTICE) for attribution and trademark notices.
