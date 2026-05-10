# 05 — Conventions

These are the rules that should be obvious from reading the code,
documented here for the cases when they aren't.

## TypeScript

- **`strict: true` and `exactOptionalPropertyTypes: true`** in
  `tsconfig.base.json`. Don't relax them per-package. The compile
  errors they catch are real bugs (passing `undefined` where a
  property is meant to be absent).
- **No `any`** in committed code. Use `unknown` and narrow. The
  exception is two `// eslint-disable-next-line` lines on Fastify's
  plugin signature where the typed plugin generic conflicts with
  passing a typed pino logger; documented inline.
- **No barrel-export `index.ts` files for the apps.** Direct file
  imports keep the dependency graph honest. The two exceptions are
  `packages/protocol/src/index.ts` and `packages/api-types/src/index.ts`,
  which exist to give external consumers a stable import path.

## File layout

- **Server**: one concern per directory under `src/` (`auth/`,
  `broker/`, `kafka/`, `rest/`, `routes/`). `main.ts` is the only
  file that knows the concrete topology. Vendored upstream schemas
  (the gateway's events `.proto`) live under `proto/` next to
  `src/`, not inside it — they're inputs, not source.
- **Web**: routes are declared in `routeTree.ts`; pages live in
  `pages/`; reusable components live in `components/` (shadcn UI
  primitives under `components/ui/`); hooks live in `hooks/`;
  API/network code lives in `api/` and `lib/`. Don't mix.

## Naming

- **Files**: `kebab-case.ts` for server modules; `PascalCase.tsx`
  for React components and pages. Match the convention in adjacent
  files; don't introduce a third style.
- **Exports**: prefer named exports. Default exports only when a
  framework demands it (e.g. Vite's HMR boundary).
- **Test files**: colocated under `test/` per app/package, named
  `<unit>.test.ts` (or `.test.tsx` for components). No coverage
  gate yet; ~238 tests today across the workspace — broker, auth
  module, config loader + meta, protocol envelope, live wire-shape
  fixtures, FleetPage and ConfigView (Console + Gateway) components,
  diagnostics receiver (store + routes + history panel),
  TransactionDetailPage (header / chart data shape / phase rows /
  SoC card) plus the sys-transactions proxy, per-charger transactions
  history (proxy route + history panel).
  Component-test infra on
  the web side: vitest + jsdom + `@testing-library/{react,dom,
user-event,jest-dom}`, with a small `test/setup.ts` that shims
  `matchMedia` and `scrollIntoView` for jsdom.

## Logging

- **One log line per event**, not per code path. Use structlog-style
  keyed fields, never string interpolation.
- Reserved field names: `cp_id`, `connection_id`, `subscription_id`,
  `request_id`, `topic`, `cursor`. If you log one of these, name it
  exactly.
- Severity: `error` for user-visible failures; `warn` for recoverable
  weirdness; `info` for lifecycle (startup, connect, subscribe);
  `debug` for hot-path detail.

## Error handling

- **Validate at boundaries** — env config (zod at boot), inbound WS
  messages (zod per message), outbound HTTP (typed client throws on
  non-2xx).
- **Don't swallow errors silently.** Either let them propagate or
  log them with the originating context.
- **Never catch `unknown` as `any`.** Use `instanceof Error` or fall
  back to a string.

## Commits and PRs

- Conventional Commits: `<type>(<scope>): <subject>` where `<type>`
  is `feature`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`,
  `ci`, `build`, `revert`.
- Squash on merge.
- Branch off `main`; PR back to `main`. No long-lived branches.
- Every PR runs CI: `format:check + typecheck + test + build`. Don't
  bypass with `--no-verify` unless the user explicitly asks; if a
  hook fails, fix the underlying issue.

## Doc-pointer rule (inherited from the gateway repo)

Don't cite `docs/...` from user-facing prose. The README's
Documentation index is the one place that exists to point at docs;
elsewhere, inline what matters or drop it. This is a UX rule for the
README and PR descriptions, not for code comments — code comments
referencing `docs/02-architecture.md` are fine.
