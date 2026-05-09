# 06 — Roadmap

Status as of 2026-05-09. Reflects what's actually in-tree, not
aspirations.

## Phase 0 — Foundations [done]

- [x] Repo scaffolded (apps/server, apps/web, packages/protocol,
      packages/api-types).
- [x] Toolchain green: install, gen:api-types, typecheck, test, build.
- [x] WS protocol designed (zod-validated envelope, versioned).
- [x] Server: config, JWT, Kafka tail (with protobuf decoder), REST
      proxy, broker, WS route, /sys/status, auth (login + PoW).
- [x] Web: WS client, subscription hook, AppShell, login + system +
      inspect pages, theme switcher (light/dark/system), brand
      palette wired to Tailwind tokens.
- [x] Dev token mint script and bcrypt hash-password helper.
- [x] All five named query resolvers with correct wire-shape mapping
      (charge-points, charge-point, transactions-active,
      meter-history, status-history).
- [x] Broker tests (15) + auth tests (8) + config tests (5) +
      protocol envelope and wire-shape tests.

## Phase 1 — Functional v1 [now]

- [x] Boot locally end-to-end against the real gateway at least once.
      Charge-points table loads from snapshot; live deltas flow on
      every BootNotification / StatusNotification.
- [x] Active-transactions and per-charger detail pages light up live.
- [x] Login form with username + password + PoW CAPTCHA, replacing
      the paste-a-JWT dev hack.
- [x] CORS wired so `localhost` and `127.0.0.1` both work without
      preflight failures.
- [x] Wire-shape regression fixture: `packages/protocol/test/wire-shapes.test.ts`
      parses real captured gateway responses; if the schemas drift
      from the gateway, CI fails.
- [x] Charge points page expanded: table + grid views (toggleable),
      server-side filters (online/vendor) + client-side filters
      (search, status), cursor pagination with page-size dropdown,
      per-row connector drill-down, status pills colour-coded by
      OCPP state.
- [x] Snapshot envelope carries `next_cursor` for the
      `charge-points` query (protocol package + server resolver +
      web client).
- [ ] First component test on the web side (FleetPage with a fake
      ConsoleClient). The page now has enough state to be worth
      testing — view toggle, filter pipeline, pagination cursor
      stack, delta application.
- [ ] Connection-status banner: show "stale" when Kafka tail lags or
      gateway snapshot is older than N seconds.
- [ ] WS client: dedupe entities by `(id, last_modified_at)` instead
      of last-write-wins.
- [ ] Drift sentry: a CI job that boots the gateway in compose and
      asserts every wire-shape fixture still parses (catches gateway
      schema drift before it lands in console-side prod).

## Phase M — Mobile responsiveness [parallel track, ~2.25 days]

The on-call read path has to work on a phone. Plan, breakpoints,
and current gaps in [`08-mobile.md`](./08-mobile.md). Each
sub-phase is shippable on its own.

- [x] **M-1** — AppShell mobile drawer. Sidebar collapses to a
      hamburger sheet below `lg`; persistent above. Auto-closes on
      route change. Built on `@radix-ui/react-dialog` (already in
      deps); shadcn-style `<Sheet>` primitive added under
      `components/ui/sheet.tsx`. Bundle +9 KB gz.
- [ ] **M-2** — Header compaction below `sm`: title shrinks to icon
      only, sign-out becomes icon-only with `aria-label`,
      ws-status pill becomes a dot. (~0.25 day)
- [ ] **M-3** — Mobile-first FleetPage. Default to grid below `sm`;
      filter bar collapses to a "Filters (N)" sheet trigger;
      pagination row stacks vertically. (~0.5 day)
- [ ] **M-4** — Mobile-first ChargerDetailPage. Stacked commands
      (RemoteStop + Reset only on phone; RemoteStart hidden behind
      a "More" disclosure to reduce misclick risk); connector table
      → card list below `sm`. (~0.25 day)
- [ ] **M-5** — Mobile-first TransactionsPage. 5-column table →
      card list below `sm`. (~0.25 day)
- [ ] **M-6** — Touch + accessibility polish: 44 × 44 hit targets,
      focus-visible across the new sheet/drawer patterns,
      real-device pass on iOS Safari + Android Chrome. (~0.5 day)

## Phase 2 — Production-shaped [later]

- [ ] JWT verification via JWKS (RS256). Plug into a real IdP.
      Strip the `mint-token` and `hash-password` scripts from the
      production image.
- [ ] Multi-tenant: BaaS enforces `cp_id → tenant_id` on every event
      before fan-out. Backed by a small in-memory map seeded from a
      side service or env config.
- [ ] Role enforcement: `Principal.roles` is populated but not
      checked. Add a `requireRole(role)` wrapper for RPCs (RemoteStop
      requires `operator`, Reset requires `admin`).
- [ ] WS-side Origin allow-list (HTTP CORS is wired; WebSocket
      handshake doesn't yet check Origin).
- [ ] Per-connection rate limit (`WS_MAX_SUBSCRIPTIONS_PER_CONN` in
      config but not enforced) + meter-sample coalescing for noisy
      chargers.
- [ ] Meter-history snapshot path: paginated read from a ClickHouse
      view (gateway must expose one — or BaaS opens its own ClickHouse
      connection in read-only).
- [ ] Audit log for every RPC: principal sub + cp_id + method +
      outcome, append-only.
- [ ] Helm chart for the server.
- [ ] httpOnly cookie auth for the WS upgrade so XSS can't exfil the
      JWT (currently in `localStorage`).

## Phase 3 — Multi-pod [way later]

- [ ] One Kafka consumer group **per pod** (so every pod sees every
      event); current single-group model means subscriptions miss
      events delivered to other pods.
- [ ] In-memory snapshot store (replaces the per-event `getChargePoint`
      re-fetch in the charge-points / charge-point resolvers).
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
  gateway PR, not a console PR. (One exception so far:
  `eveys-mobility/OCPP#130` added `GET /api/v1/transactions` because
  the per-cp endpoint forced N+1 fan-out.)
