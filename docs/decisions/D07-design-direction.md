# D07: Design: editor direction A, the fan landing page, Geist

Status: `DECIDED`

## Decision

- **Editor: direction A, "Pure page".** The window is the document, a centred column of
  about 680px. The only chrome is a status pill and Share floating top right, plus a ⌘K
  command menu and a selection toolbar that appear on demand.
- **Landing: "the fan", Clean in light and Night in dark.** The hero shows the product
  itself: three fanned notes (a recipe, the live example that types on its own, a new note
  in front) over a drifting glow in the author colours, beside "Just start typing." with
  both entry points, "Start a new note" (⌘↵) and "See the example". Either one grows its
  card into the editor with a view transition. Below it, no boxed card grids: an animated
  "two windows" how-to, auto-advancing feature tabs over one big note, a developer section,
  questions and a plain ending.
- **Type: Geist**, open licence, via `@fontsource-variable/geist`; Geist Mono only for codes
  and ids.
- Gerard's UI rules apply: white canvas, theme tokens only (dark mode included), one
  accent, few boxes, motion only on state change with reduced motion respected, text near
  70 characters per line. The landing page, a public playground page, may use the author
  colours and slow motion on the hero; everything still animates transform and opacity
  only and stops under reduced motion. `docs/design.md` is the living description.

## Why the landing page changed

The split page with an action panel read as bland and classy, and described the product
instead of showing it. Gerard picked the fan from about fifteen mock rounds in October
2026 (`jotmock14`, and `jotmock17` for the page below the hero). Card grids, stats strips
and service-style reassurance ("No sign-up", "Kept 90 days") were tried and rejected: jot is
a playground, not a service.
