# Architecture Decision Records

ADRs capture the **why** of significant decisions, so future
engineers (and future-us) can understand the constraints we lived
under.

Code shows _what_. Commits show _what changed_. Neither shows _why
we chose this over the alternatives_.

## When to write one

Write an ADR when you:

- Pick a technology that's load-bearing (UI lib, RPC transport,
  auth scheme, persistence shape).
- Decide _not_ to do something obvious (and want to remember why a
  year from now).
- Establish a project-wide convention.
- Cross a one-way door (security model, API surface, persistence
  shape).

Don't write an ADR for:

- Implementation details that can be refactored without touching
  contracts.
- Style preferences (those go in `docs/05-conventions.md`).
- Bug fixes.

## Format

Copy `template.md` to `NNNN-short-title.md` (next available number).
Status starts at `Proposed`; flips to `Accepted` after merge. ADRs
are append-only history; never delete one. Supersession is done by
writing a new ADR and marking the old one `Superseded by ADR-MMMM`.

## Index

| #                                                       | Title                                                                   | Status                            | Date       |
| ------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------- | ---------- |
| [0001](./0001-console-shape-consume-gateway.md)         | Console as a Console that consumes the gateway, not modifies it         | Accepted                          | 2026-05-09 |
| [0002](./0002-websocket-over-sse-or-polling.md)         | WebSocket as the live transport (vs SSE or polling)                     | Accepted                          | 2026-05-09 |
| [0003](./0003-named-queries-over-predicate-language.md) | Named queries instead of a predicate-based subscription language        | Accepted                          | 2026-05-09 |
| [0004](./0004-shadcn-over-mantine.md)                   | UI on shadcn/ui (vs Mantine, MUI, etc.)                                 | Accepted                          | 2026-05-09 |
| [0005](./0005-resolver-async-array-api.md)              | Resolver API: `deltasFromEvent → Promise<Delta[]>`                      | Accepted                          | 2026-05-09 |
| [0006](./0006-refetch-instead-of-snapshot-store.md)     | Re-fetch from gateway REST on every event (vs in-memory snapshot store) | Accepted (revisit Phase 3)        | 2026-05-09 |
| [0007](./0007-jwt-in-ws-subprotocol-header.md)          | JWT in the WebSocket `Sec-WebSocket-Protocol` header                    | Accepted (revisit at cookie auth) | 2026-05-09 |
| [0008](./0008-self-hosted-pow-captcha.md)               | Self-hosted proof-of-work CAPTCHA on login (vs reCAPTCHA / Turnstile)   | Accepted                          | 2026-05-09 |
