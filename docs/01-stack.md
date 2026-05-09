# 01 — Stack

This document is the inventory of every dependency the project ships
on, with the version pin and the upstream license. Update this file
in the same change that adds, removes, or bumps a dependency.

Authoritative version pins live in each package's `package.json`.
The license values come from the package's `LICENSE` file or its
`package.json` `license` field, verified against the live install.

## License posture

The repo is published under **Apache-2.0**.

Every dependency is permissive: MIT, Apache-2.0, BSD-2-Clause,
BSD-3-Clause, ISC, 0BSD, MIT-0, or Python-2.0. The project contains
no copyleft (GPL, LGPL, AGPL) and no source-available-only licenses
(SSPL, RSAL, BUSL, ELv2).

Practical consequences:

- The repo can be re-licensed or close-sourced.
- Binaries can be distributed under the Eveys brand without
  attribution requirements in the UI itself; source distributions
  must preserve upstream `LICENSE` files (kept automatically inside
  `node_modules`) and a top-level `NOTICE` summary.
- Any dependency may be modified without obligation to publish the
  modifications.

To re-audit the live install:

```bash
find node_modules/.pnpm -name package.json \
  -not -path '*/node_modules/*/node_modules/*' \
  | xargs -I {} node -e \
    "const p=require('{}');p.name&&console.log(p.name+'|'+p.version+'|'+(typeof p.license==='string'?p.license:'UNKNOWN'))" \
  | sort -u
```

## Language and runtime

| Component  | Version | License    | Role                                                                                                      |
| ---------- | ------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| Node.js    | ≥ 20.10 | MIT        | Runtime for the BaaS server and the build tooling.                                                        |
| TypeScript | 5.7     | Apache-2.0 | Source language for both apps and shared packages. Strict mode with `exactOptionalPropertyTypes` enabled. |
| pnpm       | 9.15    | MIT        | Package manager and workspace tool. Pinned via Corepack.                                                  |

## Server (`apps/server`)

| Component             | Version | License      | Role                                                                                                                                          |
| --------------------- | ------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Fastify               | 5.2     | MIT          | HTTP and WebSocket framework.                                                                                                                 |
| `@fastify/websocket`  | 11.0    | MIT          | WebSocket route adapter. Wraps `ws`.                                                                                                          |
| `@fastify/jwt`        | 9.0     | MIT          | JWT signing + verification (login + WS auth).                                                                                                 |
| `@fastify/cors`       | 10.0    | MIT          | CORS for the auth and sys-status REST routes. Allow-list in `ALLOWED_ORIGINS`; falls back to permissive in dev.                               |
| `@fastify/rate-limit` | 10.2    | MIT          | Per-IP rate limit. Currently scoped to `POST /auth/login`.                                                                                    |
| `@fastify/sensible`   | 6.0     | MIT          | HTTP error helpers.                                                                                                                           |
| `ws` (transitive)     | 8.20    | MIT          | Underlying WebSocket implementation.                                                                                                          |
| `kafkajs`             | 2.2     | MIT          | Pure-JS Kafka client. No native bindings.                                                                                                     |
| `protobufjs`          | 7.4     | BSD-3-Clause | Decodes the gateway's `eveys.events.v1.EventEnvelope` Kafka payloads. Pure JS; loads the vendored `.proto` at boot.                           |
| `undici`              | 6.21    | MIT          | HTTP client used by the gateway proxy.                                                                                                        |
| `pino`                | 9.5     | MIT          | Structured JSON logger.                                                                                                                       |
| `pino-pretty`         | 11.3    | MIT          | Dev-only human-readable transport for pino. Engaged when `LOG_PRETTY=true`.                                                                   |
| `bcryptjs`            | 2.4     | MIT          | Password hashing for `CONSOLE_USERS`. Pure JS — no native build, runs in distroless. ~10× slower than native `bcrypt`; login is not hot-path. |
| `zod`                 | 3.24    | MIT          | Runtime validation for env config, login bodies, and inbound WebSocket messages.                                                              |

### Server test

| Component | Version | License | Role                                    |
| --------- | ------- | ------- | --------------------------------------- |
| Vitest    | 2.1     | MIT     | Test runner.                            |
| tsx       | 4.19    | MIT     | TypeScript executor used by `pnpm dev`. |

## Web (`apps/web`)

The UI is built on **shadcn/ui**. shadcn/ui is not an installable
component library — it is a code generator that copies component
sources into `apps/web/src/components/ui/`. Those files are owned by
this repo, edited like any other source file, and styled with
Tailwind CSS. The runtime dependencies are the small set of Radix UI
primitives those components rely on.

| Component                  | Version | License    | Role                                                                          |
| -------------------------- | ------- | ---------- | ----------------------------------------------------------------------------- |
| React                      | 18.3    | MIT        | UI runtime.                                                                   |
| Vite                       | 6.0     | MIT        | Dev server and production bundler.                                            |
| Tailwind CSS               | 3.4     | MIT        | Utility-first styling. Configured in `tailwind.config.ts`.                    |
| `tailwindcss-animate`      | 1.0     | MIT        | Animation utility classes used by Radix transitions.                          |
| `class-variance-authority` | 0.7     | Apache-2.0 | Variant-based class composition. Used by every shadcn component.              |
| `clsx`                     | 2.1     | MIT        | Conditional class composition.                                                |
| `tailwind-merge`           | 2.6     | MIT        | Resolves Tailwind class conflicts (e.g., `p-4` + `p-2`).                      |
| `@radix-ui/react-slot`     | 1.1     | MIT        | `<Slot>` primitive for the `asChild` pattern.                                 |
| `@radix-ui/react-dialog`   | 1.1     | MIT        | Modal primitive.                                                              |
| `@radix-ui/react-toast`    | 1.2     | MIT        | Toast primitive used by the toaster component.                                |
| `lucide-react`             | 0.469   | ISC        | Icon set.                                                                     |
| TanStack Router            | 1.94    | MIT        | Type-safe routing. The route tree is declared manually in `src/routeTree.ts`. |
| TanStack Query             | 5.62    | MIT        | Reserved for non-WebSocket data fetching.                                     |
| zod                        | 3.24    | MIT        | Same package as the server. The protocol envelope is validated on both sides. |

### Web test

| Component                     | Version | License | Role                                                                                                                                                                                                                                              |
| ----------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest                        | 2.1     | MIT     | Test runner. Configured separately in `vitest.config.ts` because vitest pulls vite@5 as a peer while the workspace runs vite@6 — co-locating the `test` field on `vite.config.ts` trips a `Plugin`-type clash under `exactOptionalPropertyTypes`. |
| jsdom                         | 25      | MIT     | DOM implementation for component tests. Shimmed in `test/setup.ts` for `matchMedia` and `scrollIntoView`.                                                                                                                                         |
| `@testing-library/react`      | 16.1    | MIT     | Render + query helpers for React component tests.                                                                                                                                                                                                 |
| `@testing-library/dom`        | 10.4    | MIT     | Underlying DOM-query library (peer of @testing-library/react).                                                                                                                                                                                    |
| `@testing-library/user-event` | 14.5    | MIT     | Realistic user-interaction simulator (typing, clicking, selectOptions).                                                                                                                                                                           |
| `@testing-library/jest-dom`   | 6.6     | MIT     | Custom matchers (`toBeInTheDocument`, `toBeDisabled`, …) registered via `test/setup.ts`.                                                                                                                                                          |
| `autoprefixer`                | 10.4    | MIT     | PostCSS plugin used by the Tailwind pipeline.                                                                                                                                                                                                     |
| `postcss`                     | 8.4     | MIT     | CSS pipeline.                                                                                                                                                                                                                                     |

## Shared packages

| Package                    | License    | Role                                                                                                                                       |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `@eveys-console/protocol`  | Apache-2.0 | The WebSocket envelope contract between server and web. Versioned, zod-validated. Imported by both apps.                                   |
| `@eveys-console/api-types` | Apache-2.0 | Types generated from the gateway's `openapi.yaml` via `openapi-typescript`. Read-only and gitignored; regenerated by `pnpm gen:api-types`. |

## Build and CI

| Component                              | Version | License             | Role                                                             |
| -------------------------------------- | ------- | ------------------- | ---------------------------------------------------------------- |
| Prettier                               | 3.4     | MIT                 | Code formatter.                                                  |
| Distroless `nodejs20-debian12:nonroot` | n/a     | Apache-2.0          | Server runtime image.                                            |
| GitHub Actions                         | n/a     | proprietary service | Runs format check, typecheck, tests, build on every push and PR. |

## License obligations on distribution

- **MIT, ISC, BSD-2/3-Clause** — preserve the copyright notice and
  license text. No source-disclosure obligation.
- **Apache-2.0** — preserve the `LICENSE` file and any `NOTICE`.
  Mark modifications.
- **0BSD, MIT-0** — no obligations.
- **Python-2.0** (`argparse@2`) — preserve the copyright. Compatible
  with closed-source distribution.
- **CC-BY-4.0** (`caniuse-lite`) — data-only, never bundled into
  build output. No obligations on the shipped product.

`pnpm install` retains every upstream `LICENSE` file inside
`node_modules` automatically. A top-level `NOTICE` aggregating
attribution will be generated from `pnpm licenses list` before the
first binary release.

## Versions to think before bumping

- **Node 20.10**. Bumping past 20.18 unlocks `undici@7` and the
  TanStack Router file-based routing plugin. Coordinate with the
  team's installed Node baseline.
- **TanStack Router 1.94**. The 1.16x line moved to file-based
  routing with a codegen plugin that requires Node 20.19+. The
  manual `routeTree.ts` is the workaround. Adopt file-based routing
  when Node is bumped.
- **Tailwind CSS 3.4**. Tailwind 4 is in beta with a different
  config surface. Wait for a stable release.
- **React 18.3**. React 19 is stable; defer until the TanStack
  ecosystem is fully on it.
