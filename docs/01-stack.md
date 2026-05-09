# 01 — Stack

Authoritative version pins live in each package's `package.json`.
This doc explains *why* each piece is here, **and the license each
ships under**. Don't add a dependency without updating this file.

## License policy

The repo ships under **Apache-2.0**. Every dep below is OSI-approved
permissive (MIT / Apache-2.0 / BSD / ISC / 0BSD). **No copyleft**
(GPL/LGPL/AGPL). **No source-available-only** (SSPL/RSAL/BUSL/ELv2).
This means:

- We can close-source the repo if we ever decide to.
- We can ship under the Eveys brand without UI-level attribution
  obligations (`NOTICE` covers source-distribution attribution).
- We can modify any vendored component without publishing the
  modifications.

Audit the live install with:

```bash
find node_modules/.pnpm -name package.json -not -path '*/node_modules/*/node_modules/*' \
  | xargs -I {} node -e "const p=require('{}');p.name&&console.log(p.name+'|'+p.version+'|'+(typeof p.license==='string'?p.license:'UNKNOWN'))" \
  | sort -u
```

As of 2026-05-09: 344 unique packages, all permissive.

## Language and runtime

| Component | Version | License | Why |
|---|---|---|---|
| Node.js | ≥ 20.10 | MIT | LTS line. Native test runner, native fetch, native WebSocket on the *client* side; mature on the server side. |
| TypeScript | 5.7 | Apache-2.0 | Strict mode + `exactOptionalPropertyTypes` everywhere — catches the difference between "missing prop" and "prop: undefined" at compile time. |
| pnpm | 9.15 | MIT | Workspaces are first-class; lockfile is deterministic; faster than npm. Pinned via `corepack`. |

## Server (`apps/server`)

| Component | Version | License | Why |
|---|---|---|---|
| Fastify | 5.2 | MIT | Smallest plug-in HTTP/WS framework with first-class TypeScript. Faster than Express; more honest about middleware than Koa. |
| `@fastify/websocket` | 11.0 | MIT | Wraps `ws` with a Fastify route adapter. One way to register a WS endpoint, no boilerplate. |
| `@fastify/jwt` | 9.0 | MIT | Verifies JWTs against `JWT_SECRET`. HS256 today; switch to RS256 + JWKS by changing the `secret` option to a function. |
| `@fastify/sensible` | 6.0 | MIT | `httpErrors` helpers + a few small niceties. Drops a lot of boilerplate from error handling. |
| `ws` (transitive) | 8.20 | MIT | The underlying WebSocket implementation. Comes via `@fastify/websocket`. |
| `kafkajs` | 2.2 | MIT | Pure-JS Kafka client. No native bindings, runs anywhere Node runs, including distroless. The `node-rdkafka` alternative is faster but needs librdkafka, which complicates the runtime image. |
| `undici` | 6.21 | MIT | Modern HTTP client with `request()` ergonomics. Pinned to v6 because v7 needs Node 20.18+. |
| `pino` | 9.5 | MIT | Fast structured JSON logger. Same shape as the gateway's `structlog` output (one log line per event, keyed fields). `pino-pretty` for dev. |
| `zod` | 3.24 | MIT | Runtime validation of env config and inbound WS messages. Single source of truth: a zod schema → a TS type via `z.infer`. |

### Server test

| Component | Version | License | Why |
|---|---|---|---|
| `vitest` | 2.1 | MIT | Vite-native test runner. ESM-first; same config across server/web. |
| `tsx` | 4.19 | MIT | Runs TypeScript without a build step in dev. Used by `pnpm dev`. |

## Web (`apps/web`)

| Component | Version | License | Why |
|---|---|---|---|
| React | 18.3 | MIT | Stable major. Strict mode in dev; concurrent rendering. React 19 lands later — wait for ecosystem catch-up. |
| Vite | 6.0 | MIT | Fast dev server, fast prod build, ESM-native. Replaces Webpack/Rollup config with sensible defaults. |
| Mantine | 7.15 | MIT | Component library. Includes a `<Table>`, `<AppShell>`, notifications, hooks. Un-opinionated on visual identity; themeable via CSS variables. **MIT means we can close-source on top, modify without publishing, ship under our brand.** |
| `@tabler/icons-react` | 3.26 | MIT | Mantine's recommended icon set. ~5k icons, tree-shakeable. |
| TanStack Router | 1.94 | MIT | Type-safe routing. We use the manual route tree (`src/routeTree.ts`) because file-based routing's codegen plugin requires a newer Node than 20.10. |
| TanStack Query | 5.62 | MIT | Data fetching/caching for any future REST calls outside the WS. Currently configured but unused — the WS subscription model covers v1 needs. |
| zod | 3.24 | MIT | Same package as the server; the protocol envelope is validated on both sides. |

### Web test

| Component | Version | License | Why |
|---|---|---|---|
| `vitest` | 2.1 | MIT | Same as server. |
| `jsdom` | 25 | MIT | DOM for component tests when we add them. None today. |

## Shared (`packages/`)

| Package | Why |
|---|---|
| `@eveys-console/protocol` | The wire format between the WS server and the WS client. Versioned, zod-validated. **Both apps import it.** Adding a new envelope type means changing this package, not server-then-client. |
| `@eveys-console/api-types` | Types generated from the gateway's `docs/api/openapi.yaml` via `openapi-typescript`. **Read-only, gitignored.** Re-run `pnpm gen:api-types` after the gateway's spec changes. |

## Build, ship

| Component | Version | License | Why |
|---|---|---|---|
| `prettier` | 3.4 | MIT | Code formatter. Default config + 100-col print width. |
| Distroless `nodejs20-debian12:nonroot` | — | Apache-2.0 | Server runtime image. No shell, no package manager, root-less. ~70 MB. |
| GitHub Actions | — | (service) | CI: format check + typecheck + test + build on every push and PR. |

## License obligations on distribution

Combining permissive code into a closed-source product is allowed.
The only obligations on distribution:

- **Apache-2.0 deps** (TypeScript, OpenTelemetry-style upstreams):
  preserve the `LICENSE` file and `NOTICE` if present in their
  source. Modifications must be marked.
- **MIT / ISC / BSD deps**: preserve the copyright notice and the
  license text. No source-disclosure obligation.
- **0BSD / MIT-0**: no obligations whatsoever.
- **Python-2.0** (`argparse@2`): preserve the copyright; Python
  Software Foundation License is permissive and explicitly compatible
  with closed-source distribution.

In practice: `node_modules` retains all upstream `LICENSE` files
automatically; we surface third-party attribution in a top-level
`NOTICE` (TODO — generate from `pnpm licenses list` before first
binary release).

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
