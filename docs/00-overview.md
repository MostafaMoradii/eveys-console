# 00 — Overview

> System-administration console for the OCPP gateway. A WebSocket-
> backed Console plus a React UI, sign-in protected, that gives SRE / on-
> call engineers a live view of the gateway's service state and a
> drill-down into individual charge points and transactions.
>
> The gateway is unmodified; everything here builds on its existing
> Kafka topics + REST API.

## What this repo is

`eveys-console` is a separate service from the OCPP gateway
(`eveys-mobility/OCPP`). It depends on the gateway only through:

1. The gateway's existing **Kafka topics** (`cp.boot`, `cp.status`,
   `cp.meter`, `tx.started`) for live events.
2. The gateway's existing **REST API** (`/api/v1/...`) for snapshot
   reads and command dispatch.
3. The gateway's **OpenAPI spec** (`docs/api/openapi.yaml`) for typing.
4. The gateway's **event-envelope proto schema** for decoding the
   protobuf-encoded Kafka payloads.

The gateway never knows the Console exists.

## Two deployable artifacts

```
eveys-console/
├── apps/
│   ├── server/   the Console  — Node + Fastify + ws + kafkajs
│   └── web/      the UI    — React 18 + shadcn/ui (Tailwind + Radix) + TanStack Router
└── packages/
    ├── protocol/   shared WS envelope (zod, both apps import)
    └── api-types/  generated from the gateway's OpenAPI 3.1 spec
```

Both apps deploy together. Same release cadence, shared types
end-to-end.

## Audience and pages

Audience: SRE / on-call engineer administering the gateway. Primary
device is desktop; the on-call read path and a small set of
commands also have to work on a phone — see
[`08-mobile.md`](./08-mobile.md).

| Path                           | Page                | Purpose                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                            | System status       | Live grid of service health: Console uptime + WS connection count, Gateway probe + version, Postgres, Redis, Kafka tail. Polls `/sys/status` every 5 s.                                                                                                                                                                      |
| `/inspect/charge-points`       | Charge points       | Live list of every charger known to the gateway. Table or grid view (toggleable). Server-side filters (`online`, `vendor`) and client-side filters (text search across `cp_id`/`vendor`/`model`/`serial`, status enum). Cursor-paginated (50/100/250/500). Per-row expand → connector-level status, error code, last change. |
| `/inspect/charge-points/$cpId` | Charger detail      | Single charger, all its connectors. RemoteStart / RemoteStop / Soft Reset buttons.                                                                                                                                                                                                                                           |
| `/inspect/transactions`        | Active transactions | Live list of in-flight transactions.                                                                                                                                                                                                                                                                                         |

The login page (`/`) renders before any of the above when there's no
JWT in storage.

## In scope

- Live service status of the gateway and its data plane.
- Live charger inspection (list + drill-down).
- Live active-transactions list.
- Issuing OCPP commands (RemoteStart, RemoteStop, Reset) from the
  charger detail page.
- Username + password login (bcrypt-hashed users in env), with a
  client-side proof-of-work CAPTCHA on the login form.
- HS256 JWT auth (RS256 + JWKS swap-in is documented for prod).
- light / dark / system theme.

## Out of scope

- Modifying the gateway. Gateway changes are PRs against the gateway
  repo, not the console.
- Owning user accounts / RFID tokens / billing. Those live in the
  Eveys backend behind the gateway.
- Replacing the gateway's REST API. The console consumes it; it
  doesn't redefine it.
- A general predicate-based subscription language (Hasura-style).
  Named queries only.
- Customer-facing fleet dashboards. Different audience, different
  product.
