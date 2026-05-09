# 00 — Overview

> The realtime operator console for the OCPP gateway. A WebSocket-backed
> backend-as-a-service plus a React UI for tracking and managing charge
> points without polling. The gateway is unmodified.

## What this repo is

`eveys-console` is a separate service from the OCPP gateway
(`eveys-mobility/OCPP`). It depends on the gateway only through:

1. The gateway's existing **Kafka topics** (`cp.boot`, `cp.status`,
   `cp.meter`, `tx.started`) for live events.
2. The gateway's existing **REST API** (`/api/v1/...`) for snapshot
   reads and command dispatch.
3. The gateway's **OpenAPI spec** (`docs/api/openapi.yaml`) for typing.

The gateway never knows the BaaS exists. Modifying the gateway is
**out of scope** for any change to this repo.

## Two deployable artifacts

```
eveys-console/
├── apps/
│   ├── server/   the BaaS  — Node + Fastify + ws + kafkajs
│   └── web/      the UI    — React 18 + shadcn/ui (Tailwind + Radix) + TanStack Router
└── packages/
    ├── protocol/   shared WS envelope (zod, both apps import)
    └── api-types/  generated from the gateway's OpenAPI 3.1 spec
```

Both apps deploy together. Same release cadence, same versioning,
shared types end-to-end.

## What's in scope

- Live tracking of every charger in the fleet.
- Drill-down to a single charger with its connectors and recent
  state.
- Active-transactions view.
- Issuing OCPP commands (RemoteStart, RemoteStop, Reset) over the
  same WebSocket.
- JWT auth for operators (HS256 in dev, swap to RS256 + JWKS in
  production).

## What's out of scope

- Modifying the gateway. Not even a single line.
- Owning user accounts / RFID tokens / billing. Those live in the
  configured backend behind the gateway.
- Replacing the gateway's REST API. We consume it; we don't redefine
  it.
- A general predicate-based subscription language (Hasura-style).
  Named queries only.
