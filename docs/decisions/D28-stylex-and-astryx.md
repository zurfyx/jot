# D28: Styles in StyleX, with Astryx components where they render identically

Status: `PROPOSED` (an experiment on `exp/astryx-stylex`; PR B carries the numbers)

## Context

jot was styled with three plain stylesheets (`styles.css`, `landing/landing.css`,
`docs/docs.css`, about 3,950 lines) and hand-built controls. The question was whether jot
should move to StyleX (`@stylexjs/stylex`) and Astryx (`@astryxdesign/*`, Meta's
open-source React design system on StyleX) without any visible or behavioural change, and
at what cost. The visual and interaction suite (D27) is the gate.

## Decision (proposed)

- **StyleX for every style.** `stylex.create` beside each component; tokens in
  `theme/tokens.stylex.ts` (`defineVars`, literal names such as `--bg`), dark and scoped
  sets in `theme/themes.ts` (`createTheme`); `stylex.keyframes`; `stylex.viewTransitionClass`
  for opening a note; `stylex.when.*` with markers for hover, focus and sibling rules;
  Lexical's theme classes are StyleX classes.
- **Built with `@astryxdesign/build`'s Vite plugin**, which compiles jot's styles and
  Astryx's component source in one pass and writes one atomic stylesheet, linked from
  `index.html`, in two cascade layers (`astryx-base`, then `product`).
- **A small global stylesheet** (`globals.css`) for what StyleX can't write: the element
  reset in the `reset` layer, `<body>`, `::highlight()`, the reduced-motion switch, the
  caret's scroll padding while the dock is up, a table selection's `::selection`; plus one
  inspector rule in `docs/docs.css`.
- **Astryx where it is identical in look and behaviour**: `Avatar` and `AvatarGroup`,
  `IconButton` (⋯ and Aa's format toggles), `ProgressBar` (Ask AI's download), under
  `<Theme>` at the app root with jot's theme (`theme/jotTheme.ts`: Neutral's tokens without
  its icons, pointed at jot's tokens, prebuilt to `theme/jot.css`).
- **Not Astryx**, with reasons recorded in PR B: `DropdownMenu` and `Popover` (focus moves
  into the menu even from the pointer, press-down opening, top layer, Esc returns to the
  trigger, scale entrance, no in-place panels), `Tooltip` (not the native tooltip),
  `Switch` (an input, can't sit in a menu item), labelled `Button` (its label clips glyphs
  at line-height 1 and changes text antialiasing), `CommandPalette` (modal dialog, blurred
  backdrop, fixed footer), `SideNav`/`Link` (different markup and sizing).

## Why it might be worth it

- One typed styling system, dead-code-free CSS, and tokens shared with Astryx's theme.
- The suite proves the port is pixel-identical and behaviour-identical, so the move is
  mechanical risk, not design risk.

## Why it might not

- StyleX writes one stylesheet for the whole app, so the landing page downloads the note
  page's and the docs' styles, and Astryx's component styles, on its first visit.
- Astryx's components share heavy infrastructure (layers, tooltips, i18n): four avatar
  circles or one icon button pull in tens of KB. The Theme provider alone adds to the
  landing page's first load.
- Every Astryx component used needed `xstyle` overrides of nearly every property to look
  like jot; the design system adds little where jot already has a settled look.

## Consequences if adopted

- `styles.css`, `landing.css` and `dock.css`-style files are gone; new UI is written in
  StyleX, and a raw colour anywhere but the token files is a review comment.
- Astryx upgrades need `pnpm exec astryx theme build src/client/theme/jotTheme.ts` and a
  run of the visual suite.
