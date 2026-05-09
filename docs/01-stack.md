# 01 — Stack

Authoritative version pins live in each package's `package.json`.
This doc explains *why* each piece is here. Don't add a dependency
without updating this file.

## Language and runtime

| Component | Version | Why |
|---|---|---|
| Node.js | ≥ 20.10 | LTS line. Native test runner, native fetch, native WebSocket on the *client* side; mature on the server side. |
| TypeScript | 5.7 | Strict mode + `exactOptionalPropertyTypes` everywhere — catches the difference between "missing prop" and "prop: undefined" at compile time. |
| pnpm | 9.15 | Workspaces are first-class; lockfile is deterministic; faster than npm. Pinned via `corepack`. |

## Server (`apps/server`)

| Component | Version | Why |
|---|---|---|
| Fastify | 5.2 | Smallest plug-in HTTP/WS framework with first-class TypeScript. Faster than Express; more honest about middleware than Koa. |
| `@fastify/websocket` | 11.0 | Wraps `ws` with a Fastify route adapter. One way to register a WS endpoint, no boilerplate. |
| `@fastify/jwt` | 9.0 | Verifies JWTs against `JWT_SECRET`. HS256 today; switch to RS256 + JWKS by changing the `secret` option to a function. |
| `@fastify/sensible` | 6.0 | `httpErrors` helpers + a few small niceties. Drops a lot of boilerplate from error handling. |
| `kafkajs` | 2.2 | Pure-JS Kafka client. No native bindings, runs anywhere Node runs, including distroless. The `node-rdkafka` alternative is faster but needs librdkafka, which complicates the runtime image. |
| `undici` | 6.21 | Modern HTTP client with `request()` ergonomics. Pinned to v6 because v7 needs Node 20.18+. |
| `pino` | 9.5 | Fast structured JSON logger. Same shape as the gateway's `structlog` output (one log line per event, keyed fields). `pino-pretty` for dev. |
| `zod` | 3.24 | Runtime validation of env config and inbound WS messages. Single source of truth: a zod schema → a TS type via `z.infer`. |

### Server test

| Component | Version | Why |
|---|---|---|
| `vitest` | 2.1 | Vite-native test runner. ESM-first; same config across server/web. |
| `tsx` | 4.19 | Runs TypeScript without a build step in dev. Used by `pnpm dev`. |

## Web (`apps/web`)

| Component | Version | Why |
|---|---|---|
| React | 18.3 | Stable major. Strict mode in dev; concurrent rendering. React 19 lands later — wait for ecosystem catch-up. |
| Vite | 6.0 | Fast dev server, fast prod build, ESM-native. Replaces Webpack/Rollup config with sensible defaults. |
| Mantine | 7.15 | Component library. Includes a `<Table>`, `<AppShell>`, notifications, hooks. Equally good for dashboards as Cloudscape but un-opinionated on visual identity. |
| `@tabler/icons-react` | 3.26 | Mantine's recommended icon set. ~5k icons, tree-shakeable. |
| TanStack Router | 1.94 | Type-safe routing. We use the manual route tree (`src/routeTree.ts`) because file-based routing's codegen plugin requires a newer Node than 20.10. |
| TanStack Query | 5.62 | Data fetching/caching for any future REST calls outside the WS. Currently configured but unused — the WS subscription model covers v1 needs. |
| zod | 3.24 | Same package as the server; the protocol envelope is validated on both sides. |

### Web test

| Component | Version | Why |
|---|---|---|
| `vitest` | 2.1 | Same as server. |
| `jsdom` | 25 | DOM for component tests when we add them. None today. |

## Shared (`packages/`)

| Package | Why |
|---|---|
| `@eveys-console/protocol` | The wire format between the WS server and the WS client. Versioned, zod-validated. **Both apps import it.** Adding a new envelope type means changing this package, not server-then-client. |
| `@eveys-console/api-types` | Types generated from the gateway's `docs/api/openapi.yaml` via `openapi-typescript`. **Read-only, gitignored.** Re-run `pnpm gen:api-types` after the gateway's spec changes. |

## Build, ship

| Component | Version | Why |
|---|---|---|
| `prettier` | 3.4 | Code formatter. Default config + 100-col print width. |
| Distroless `nodejs20-debian12:nonroot` | — | Server runtime image. No shell, no package manager, root-less. ~70 MB. |
| GitHub Actions | — | CI: format check + typecheck + test + build on every push and PR. |

## Licenses

Every dep above is OSI-approved permissive (MIT / Apache-2.0 / BSD-3-Clause).
The repo itself ships under **Apache-2.0**. Mantine is MIT, so combining
into a single binary is fine.

## Versions to think before bumping

- **Node 20.10**. Bumping above 20.18 unlocks `undici@7` and TanStack
  Router file-based plugin. Worth doing once the rest of the team's
  Node is on a recent 20.x.
- **TanStack Router 1.94**. The 1.16x line moved to file-based routing
  with a codegen plugin that needs Node 20.19+. We use 1.94 with a
  manual route tree. If we ever upgrade Node, we should also upgrade
  Router and adopt file-based routing.
- **Mantine 7**. Mantine 8 alpha exists; wait for stable + Tabler icons
  parity.
