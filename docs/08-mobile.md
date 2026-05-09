# 08 — Mobile responsiveness

The console is designed primarily for desktop SRE / on-call use, but
on-call also means **carrying a phone**. An engineer waking up at
3 a.m. should be able to open the console on their phone, see what
the gateway thinks is wrong, and either issue a command or escalate.
Full desktop fidelity isn't required, but core read paths plus a
small set of write paths must work on a 360 px-wide screen with a
touch input.

This doc captures (a) what the target is, (b) where we are today,
and (c) the concrete plan to close the gap.

## Target

Three breakpoints, mapped to Tailwind defaults:

| Breakpoint | Tailwind prefix | Width       | Audience                                           |
| ---------- | --------------- | ----------- | -------------------------------------------------- |
| Phone      | (none)          | < 640 px    | On-call, away from desk. Read-mostly + a few RPCs. |
| Tablet     | `sm:` to `md:`  | 640–1023 px | Operator with a tablet. Read + write.              |
| Desktop    | `lg:` and up    | ≥ 1024 px   | Primary use case. Everything.                      |

**Phone goals (must-have):**

- Sign in.
- Read **System status** — service health at a glance.
- Read **Charge points** — find a specific charger by id or by status.
- Read **Charger detail** — see the connectors, last status, recent transitions.
- Issue **RemoteStop** and **Soft Reset**. Not RemoteStart (rarely needed
  from a phone; risk of misclick is real).
- Sign out.

**Phone non-goals:**

- Bulk operations (e.g. multi-select on the fleet table).
- Charging-profile management.
- Anything that would benefit from a multi-column layout fundamentally.

**Tablet goals:** desktop functionality, denser layout. No layout
tricks specific to this size.

**Desktop:** the current default; no regression.

## Today's state (2026-05-09)

What works:

- Viewport meta is set; the page renders at any width without
  horizontal scroll on the chrome.
- The **SystemPage card grid** is already responsive
  (`grid-cols-1 md:grid-cols-2 xl:grid-cols-3`).
- The **FleetPage grid view** is already responsive
  (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`).
- shadcn/ui primitives (Button, Card, Badge, Input, Select) render
  correctly at any width because they're just styled HTML.
- The toast viewport collapses to full-width on phones (`sm:max-w-[420px]`).

What doesn't:

- **AppShell sidebar is fixed at `w-56`**. On a 360 px viewport that
  leaves ~144 px for the page content. The sidebar should collapse
  into a hamburger drawer below `md`.
- **Header is too dense on phones.** The status badge + theme
  toggle + sign-out button line wraps weirdly under 600 px because
  every element competes for the right edge.
- **FleetPage filter bar (4 fields side-by-side)** wraps to four
  rows on a phone. Each Input is `w-[260px]` or `w-[160px]` —
  fixed widths that don't shrink. Should stack to `w-full` on phone.
- **FleetPage table view is unusable on phone.** 8 columns at
  ~360 px wide doesn't render anything you can read. The grid view
  is fine; we should default mobile to grid and hide the toggle.
- **ChargerDetailPage commands row** has 3 buttons side-by-side
  with full labels — works on tablet, breaks on phone.
- **TransactionsPage table** has 5 columns with long ISO
  timestamps; same readability problem as the FleetPage table.
- **LoginPage works on phone** — the card is `max-w-sm` already.
  No change needed.

In short: most of the structural work is in `AppShell.tsx` plus
table-vs-card view defaults; the rest is per-page polish.

## Plan

Five increments, each shippable on its own.

### Phase M-1 — AppShell mobile drawer

The sidebar is the biggest blocker. Replace `<nav class="w-56">`
with a layout that:

- On `lg` and up: keeps the current 224 px persistent sidebar.
- Below `lg`: hides the sidebar; shows a hamburger button in the
  header that opens a drawer (slide-in from the left). Tapping a
  link or outside the drawer closes it.
- Same nav contents in both modes.

Adds one Radix primitive (`@radix-ui/react-dialog` already in deps;
the shadcn `<Sheet>` component is built on it). Footprint stays
small.

### Phase M-2 — Header compaction

- Below `sm`: drop the "OCPP Gateway · System Console" title to
  just the bolt icon; the page title in the main area is enough.
- Status badge stays. Theme toggle stays but loses its inner
  borders to save pixels. Sign-out collapses to an icon-only button
  with `aria-label`.
- Token-staleness badge ("ws: open / closed / connecting") becomes
  a small dot rather than a labeled pill.

### Phase M-3 — Mobile-first FleetPage

- **Default to grid view on phones** (override the user's saved
  view-mode pref _for this session_ when below `sm`; respect it on
  resize back up). The grid is already responsive; the table is
  the problem.
- Filter bar:
  - Search field becomes `w-full` below `sm`.
  - Online + Vendor + Status select stack into a row that scrolls
    horizontally (Apple-style chip row), or collapse into a single
    "Filters (3)" button that opens a sheet with all four fields.
    The sheet is the cleaner pattern; pick that.
- Pagination row: stack vertically on phone (`Rows per page` on
  one line, page nav on another).

### Phase M-4 — Mobile-first ChargerDetailPage

- Header: charger metadata wraps; status badges below the title.
- Commands: stack vertically on phone, full-width buttons, with
  RemoteStart hidden behind a "More" disclosure (per the
  non-goals — reduces misclick risk on a small touch target).
- Connectors table: convert to a card-per-connector layout below
  `sm` (same data, no horizontal scroll).

### Phase M-5 — Mobile-first TransactionsPage

- Convert the 5-column table to a card list on phone. Each card
  shows tx_id + cp_id (compact mono), id_tag, started timestamp
  (relative), consumed_wh.
- Server-side `active=true` is already the only filter; no filter
  bar to compact.

### Phase M-6 — Touch + accessibility polish

- Bump every interactive element below 44 × 44 px hit target
  (Apple HIG / Material guidance) for touch. Most shadcn primitives
  are already there; the small icon-buttons in the FleetPage
  filter bar are not.
- Verify focus-visible rings render correctly across the new
  drawer/sheet patterns.
- Test with iOS Safari + Android Chrome at the actual breakpoints
  on a real device (DevTools device emulation lies about touch
  scrolling momentum and viewport units).

## Out of scope for this plan

- Native iOS / Android app. The browser is the target.
- Offline mode / service worker. The console is online-only by
  design (it's a live view of a service).
- Push notifications for alerts. Different concern; would need a
  service-worker-backed notification permission flow and
  server-side filtering by subscriber. Worth a separate ADR if it
  ever comes up.

## Effort estimate

Per phase, with one engineer, including a real-device pass:

- M-1: 0.5 day
- M-2: 0.25 day
- M-3: 0.5 day (sheet + state for filters takes the most time)
- M-4: 0.25 day
- M-5: 0.25 day
- M-6: 0.5 day
- **Total**: ~2.25 days

The phases are independent. M-1 unblocks the rest visually but
doesn't strictly gate any of them.

## Test posture

- Add Playwright (or Cypress) once one of the M-\* phases lands;
  cover the three breakpoints (360, 768, 1280) on each page.
- Until then: manual QA against the breakpoints in DevTools, and
  one real-device pass per phase before declaring it done.
- Keep an eye on bundle size: every Radix primitive we add (Sheet
  for the drawer, anything else) shows up in `pnpm build` output.
  Acceptable cost: < 25 KB gz total across all phases.

## Touch and a11y posture (after M-6)

- **Hit-area utility**: `.touch-target` in `index.css` extends a
  control's hit area to 44 × 44 px **only on touch devices**
  (`@media (pointer: coarse)`) via a transparent `::before`
  overlay. The visible size doesn't change; desktop is unaffected.
- **Applied to**: hamburger menu, theme-toggle items, sheet close
  button. Pagination Previous/Next + page-size select grow from
  `h-7` to `h-9` below `sm` instead, since their visible size
  needed bumping anyway.
- **Not applied to**: the FleetPage row-expand chevron and view-
  toggle buttons — both are desktop-only (the row-expand chevron
  only renders in table view, which is hidden below `sm` after
  M-3; the view-toggle is hidden too).
- **Focus-visible**: Buttons use `focus-visible:` so a click
  doesn't leave the ring lingering; Inputs and Selects use plain
  `focus:` because the orange-border-on-focus is the visual
  affordance "this is where typing goes" — desirable regardless of
  input modality. The Sheet close button was on plain `focus:`
  (lit up after a click); switched to `focus-visible:`.
- **Real-device verification**: still owed. The M-6 commit verified
  every change in DevTools at 360 / 768 / 1280 px and via tab-key
  navigation. iOS Safari and Android Chrome haven't been hit
  hands-on; the things to watch for are touch-callout behaviour on
  the hamburger button, the sheet's backdrop tap dismissal on iOS,
  and the bottom-anchored filter sheet's keyboard-aware resize on
  Android.
