# 04 — Local dev

## Prerequisites

- Node ≥ 20.10 (`brew install node@20`)
- pnpm 9.15 (`corepack prepare pnpm@9.15.0 --activate`)
- The OCPP gateway running locally (the sibling repo
  `eveys-mobility/OCPP`) with:
  - REST reachable on `:8080`
  - `EVEYS_OCPP_REST_INBOUND_TOKENS=dev-token` so the BaaS can call it
  - `EVEYS_OCPP_REST_OPENAPI_ENABLED=true` so `pnpm gen:api-types` can
    pull the spec (alternatively, point at the committed spec file)
  - Kafka reachable on `:9092`

## First boot

```bash
git clone <eveys-console-repo>
cd eveys-console
pnpm install
pnpm gen:api-types

cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
# edit apps/server/.env: set JWT_SECRET (≥16 bytes), GATEWAY_TOKEN,
# KAFKA_BROKERS

pnpm dev
```

That brings up:

- Server on `http://localhost:8090`
- Web on `http://localhost:5180`

## Authenticating

The web app needs a JWT signed with `JWT_SECRET`, audience
`eveys-console`, issuer `eveys-console`. The server ships a mint
script:

```bash
pnpm --filter @eveys-console/server mint-token
# Pipe to clipboard:
pnpm --filter @eveys-console/server mint-token | pbcopy
```

Paste the token into the field in the top bar of the UI.

## Daily inner loop

```bash
pnpm dev          # both apps with HMR
pnpm typecheck    # ~3 s
pnpm test         # ~1 s
pnpm build        # full prod build
pnpm format       # prettier across the tree
```

## When the gateway's spec changes

Re-run the generator:

```bash
pnpm gen:api-types
```

This rewrites `packages/api-types/src/generated/openapi.ts`. The
file is gitignored — every clone regenerates it. CI runs the same
generator before typecheck.

## Common failure modes

| Symptom | Likely cause |
|---|---|
| `ERR_PNPM_UNSUPPORTED_ENGINE` on install | Node < 20.10 or pnpm not pinned via corepack. Re-run `corepack prepare pnpm@9.15.0 --activate`. |
| Web shows `connection: closed` and never opens | JWT secret in the token doesn't match `JWT_SECRET` in the server's `.env`. Re-mint. |
| Snapshot loads but no live updates | The Kafka tail isn't reaching the broker. Check `KAFKA_BROKERS` and that the gateway is publishing. |
| Subscriptions return `unauthenticated` | Token expired (default TTL 8 h). Re-mint. |
| `pnpm gen:api-types` fails to find the spec | Set `GATEWAY_OPENAPI_SPEC=/abs/path/openapi.yaml`. The default discovers `../ocpp/docs/api/openapi.yaml`. |
