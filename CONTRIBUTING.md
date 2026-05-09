# Contributing

Thanks for considering a contribution.

## Workflow

- Branch off `main`: `feature/<short-slug>`, `fix/<short-slug>`,
  `chore/<short-slug>`.
- Every PR must have green CI (format, typecheck, tests, build) and
  include tests for new behavior.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>(<scope>): <subject>` where `<type>` is one of
  `feature`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`,
  `build`, `revert`.
- Squash on merge. Linear history.

## Getting started

```bash
pnpm install
pnpm gen:api-types        # generate gateway types from the OpenAPI spec
pnpm dev                  # runs server + web in parallel
```

The README covers what the service does, how to run it locally, and
the directory layout.
