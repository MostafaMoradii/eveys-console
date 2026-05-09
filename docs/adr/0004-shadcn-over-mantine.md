# ADR-0004 — UI on shadcn/ui (vs Mantine, MUI, etc.)

- **Status**: Accepted
- **Date**: 2026-05-09
- **Author**: Eveys engineering
- **Supersedes**: an earlier in-session choice of Mantine

## Context

The console needs a dense, table-heavy admin UI. The first scaffold
shipped with Mantine 7 (a full installable component library) and
worked, but two concerns surfaced:

- **Visual identity**. The product needs to feel distinctly Eveys
  (orange / slate brand palette). Theming Mantine is doable but
  every customisation fights the framework.
- **Library coupling**. With Mantine, every Mantine major bump is a
  forced migration of every page that uses any of its components.
  The library decides our upgrade cadence.

shadcn/ui is a different shape: not an installable library at all,
but a CLI that copies primitive component sources into the repo.
The components are then plain React + Tailwind code we own and
edit directly.

## Decision

**shadcn/ui** (Radix primitives + Tailwind CSS) for all UI
components. The shadcn-style sources live at
`apps/web/src/components/ui/` and are owned by this repo. The brand
palette is wired into Tailwind theme tokens
(`apps/web/tailwind.config.ts`); CSS variables in `index.css` map
brand colours to semantic roles (primary, accent, destructive,
success).

## Alternatives considered

- **Mantine 7** (the original choice). Rich component set out of
  the box. Rejected for the brand-control reason above; the lock-in
  to one library's release cadence outweighs the day-zero
  ergonomics.
- **MUI** (Material-UI). Excellent table widgets. Rejected because
  Material design is even more visually opinionated than Mantine,
  and we're not building a Material product.
- **Build everything from scratch on Radix**. Maximum control.
  Rejected because shadcn is exactly that, with the boring
  per-component scaffolding already done. We benefit from the
  community's accessibility work without the maintenance burden.
- **Cloudscape**. AWS's design system; built for consoles. Rejected
  because we're not deploying inside AWS Console aesthetics; the
  Cloudscape look is wrong for the Eveys brand.

## Consequences

### Positive

- Every component is in `src/`. We can change a button's hover
  state by editing one file we own. No "fork the library" workaround.
- Same MIT license as Mantine — no ownership trade.
- Smaller bundle: 1727 modules, ~115 KB gz JS, ~5 KB gz CSS (vs
  Mantine's 6680 modules, ~129 KB JS, ~29 KB CSS at the same page
  count).
- Brand palette is explicit and one-step to retheme — change CSS
  variables in `apps/web/src/index.css`.

### Negative / costs

- We own the component code. Bug in shadcn's `<Toast>`? Our problem
  to fix.
- Smaller component set than Mantine. Some patterns (date pickers,
  rich select) need to be built or pulled from elsewhere when we
  reach for them.
- The shadcn CLI's `init`/`add` workflow needs to be re-run when a
  new primitive is wanted; output is committed not consumed.

### Risks

- **Component drift across the repo.** If multiple developers
  customise the same primitive in different directions, the UI
  becomes inconsistent. Mitigated by treating `components/ui/` as
  shared code with the same review bar as `lib/`.

### Reversibility

Reversible at high cost. Switching back to Mantine or to MUI is
~250–500 LOC of page rewrites at current page count, more as the UI
grows. Today's call assumes brand control matters more than the
short-term migration cost.

## References

- `docs/01-stack.md` — full UI dependency table.
- `apps/web/src/components/ui/` — owned shadcn component sources.
- `apps/web/src/index.css` — brand-palette CSS variables.
