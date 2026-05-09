# 06 — Roadmap

Status as of 2026-05-09. Reflects what's actually in-tree, not
aspirations.

## Phase 0 — Foundations [done]

- [x] Repo scaffolded (apps/server, apps/web, packages/protocol,
      packages/api-types).
- [x] Toolchain green: install, gen:api-types, typecheck, test, build.
- [x] WS protocol designed (zod-validated envelope, versioned).
- [x] Server: config, JWT, Kafka tail, REST proxy, broker, WS route.
- [x] Web: WS client, subscription hook, AppShell, three pages.
- [x] Dev token mint script (`apps/server/scripts/mint-dev-token.mjs`).
- [x] Broker tests (8 cases: subscribe, route, isolate, unsubscribe,
      list-membership, filter-remove).

## Phase 1 — Functional v1 [now]

- [ ] Boot it locally end-to-end against the gateway at least once.
      Fleet table loads from snapshot; live deltas flow when chargers
      change status.
- [ ] First component test on the web side (FleetPage with a fake
      ConsoleClient).
- [ ] Connection-status banner: show "stale" when Kafka tail lags or
      gateway snapshot is older than N seconds.
- [ ] WS client: properly de-dupe entities by
      `(id, last_modified_at)` instead of last-write-wins.

## Phase 2 — Production-shaped [later]

- [ ] JWT verification via JWKS (RS256). Plug into a real IdP.
- [ ] Multi-tenant: BaaS enforces `cp_id → tenant_id` on every event
      before fan-out. Backed by a small in-memory map seeded from a
      side service or env config.
- [ ] Per-connection rate limit + meter-sample coalescing for noisy
      chargers.
- [ ] Meter-history snapshot path: paginated read from a ClickHouse
      view (gateway must expose one — or BaaS opens its own ClickHouse
      connection in read-only).
- [ ] WS server: `WS_MAX_SUBSCRIPTIONS_PER_CONN` enforcement (config
      exists, not yet wired).
- [ ] Helm chart for the server.
- [ ] Web: web/test/ component tests for FleetPage and
      ChargerDetailPage with vitest + @testing-library/react.

## Phase 3 — Multi-pod [way later]

- [ ] One Kafka consumer group **per pod** (so every pod sees every
      event); current single-group model means subscriptions miss
      events delivered to other pods.
- [ ] Pod-aware metrics (Prometheus on `:9100`).
- [ ] Trace context propagation (OpenTelemetry across browser → BaaS
      → gateway).

## Out of scope, ever

- Building a shared component library as an installable package. The
  shadcn/ui sources live inline under `apps/web/src/components/ui/`
  and are owned by this repo.
- A general predicate-based subscription language (Hasura-style).
  Named queries only; new views = small server change.
- Modifying the gateway. If a feature needs a gateway change, it's a
  gateway PR, not a console PR.
