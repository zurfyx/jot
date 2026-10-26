# D07: Design: editor direction A, landing direction 2, Geist

Status: `DECIDED`

## Decision

- **Editor: direction A, "Pure page".** The window is the document, a centred column of
  about 680px. The only chrome is a status pill and Share floating top right, plus a ⌘K
  command menu and a selection toolbar that appear on demand.
- **Landing: direction 2, "Split with action panel".** Story and a still note preview on
  the left, one framed "Start or join" panel on the right, three explanatory columns below
  a hairline.
- **Type: Geist**, open licence, via `@fontsource-variable/geist`; Geist Mono only for codes
  and ids.
- Gerard's UI rules apply: white canvas, theme tokens only (dark mode included), one
  accent, few boxes, motion only on state change with reduced motion respected, text near
  70 characters per line. `docs/design.md` is the living description.
